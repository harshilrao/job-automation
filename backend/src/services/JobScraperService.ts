import { JobPosting } from '../models/JobPosting';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { sleep, retry, parseSalary, uniqueByFn, normalizeUrl, normalizeEmployerName, canonicalJobKey } from '../utils/helpers';
import { ONTARIO_CITIES, SCRAPER_DEFAULTS, JOB_SOURCES } from '../utils/constants';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';

export interface ScraperResult {
  jobs: JobPost[];
  errors: Record<string, string>;
  meta: {
    duration: number;
    sources: string[];
    totalFound: number;
  };
}

export interface ScraperConfig {
  searchTerms: string[];
  locations: string[];
  sources: string[];
  resultsWanted: number;
  hoursOld: number;
  countryIndeed: string;
}

export interface JobPost {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  jobUrl: string;
  applyUrl: string;
  source: string;
  datePosted: Date;
  salary?: { min?: number; max?: number; currency?: string; type?: string };
  jobType?: string;
  isRemote?: boolean;
  employmentType?: string;
  companyLogo?: string;
  companyUrl?: string;
  jobLevel?: string;
  jobFunction?: string;
  industry?: string;
  companyCareerUrl?: string;     // Employer's official careers page
  originalJobUrl?: string;       // Original employer posting (authoritative source)
  preferredQualifications?: string[];
  workArrangement?: 'remote' | 'hybrid' | 'on-site' | 'unspecified';
  discoveryDate?: Date;
  applicationUrl?: string;   // Resolved application URL (prefers original employer posting)
  applicationStatus?: 'active' | 'expired' | 'filled';
}

/**
 * Live scrape progress for the frontend loading bar / ETA display.
 */
export type ScrapeStatus =
  | 'idle'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'completed'
  | 'failed';

export interface ScrapeProgress {
  status: ScrapeStatus;
  currentSource: string | null;
  sources: string[];
  sourceIndex: number;
  totalSources: number;
  jobsFound: number;
  jobsSaved: number;
  jobsSkipped: number;
  jobsFailed: number;
  errors: Record<string, string>;
  startedAt: Date | null;
  etaMs: number | null;
  completedAt: Date | null;
  sourceProgress: Array<{
    source: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    jobsFound: number;
    error?: string;
  }>;
  /** Jobs found so far in this scrape session (capped, pre-deduplication), for real-time frontend display. */
  foundJobs: JobPost[];
  /** Final deduplicated unique jobs, computed once all sources finish (post-deduplication). */
  uniqueJobs?: JobPost[];
  /** Filters used by the session (snapshot), for display and refresh recovery. */
  filters?: ScrapeFilters;
  message?: string;
  sessionId?: string;
}

/**
 * Filter criteria used to drive a scraping session. Mirrors the frontend
 * FilterCriteria shape so the backend can scrape exactly what the user picked.
 */
export interface ScrapeFilters {
  searchTerm?: string;
  locations: string[];
  jobTypes: string[];
  experienceLevels: string[];
  industries: string[];
  departments: string[];
  salaryMin?: number;
  salaryMax?: number;
  postedWithinHours?: number;
  remoteOnly: boolean;
  hybridOnly: boolean;
  sources: string[];
  excludedCompanies: string[];
  excludedKeywords: string[];
  requiredKeywords: string[];
}

/**
 * A single scraping session. One active session per user at a time; sessions
 * are owned by their userId so one user can never cancel another's scrape.
 */
export interface ScrapeSession {
  sessionId: string;
  userId: string;
  status: ScrapeStatus;
  filters: ScrapeFilters;
  /** When false the scrape searches + validates but never writes to MongoDB. */
  save: boolean;
  startTime: Date;
  endTime?: Date;
  currentSource: string | null;
  sourceIndex: number;
  jobsDiscovered: number;
  jobsSaved: number;
  jobsSkipped: number;
  jobsFailed: number;
  errors: Record<string, string>;
  sourceProgress: Array<{
    source: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    jobsFound: number;
    error?: string;
  }>;
  foundJobs: JobPost[];
  /** Final deduplicated unique jobs for this session (post-deduplication), exposed to the frontend via progress. */
  uniqueJobs: JobPost[];
  abortController: AbortController;
  pythonProcess: ChildProcess | null;
  message?: string;
}

export class JobScraperService {
  private defaultConfig: ScraperConfig = {
    searchTerms: config.jobSearch.searchTerms,
    locations: config.jobSearch.cities,
    sources: config.jobSearch.sources,
    resultsWanted: SCRAPER_DEFAULTS.RESULTS_WANTED,
    hoursOld: SCRAPER_DEFAULTS.HOURS_OLD,
    countryIndeed: SCRAPER_DEFAULTS.COUNTRY_INDEED,
  };

  // Live scrape progress for frontend loading bar / ETA display.
  // Mirrored from the active session so the legacy getScrapeProgress() shape
  // keeps working for the scheduled scraper path.
  private scrapeProgress: ScrapeProgress = {
    status: 'idle',
    currentSource: null,
    sources: [],
    sourceIndex: 0,
    totalSources: 0,
    jobsFound: 0,
    jobsSaved: 0,
    jobsSkipped: 0,
    jobsFailed: 0,
    errors: {},
    startedAt: null,
    etaMs: null,
    completedAt: null,
    foundJobs: [],
    sourceProgress: [],
  };

  // Active scraping sessions keyed by session id. One active session per user
  // at a time; each session is owned by its userId.
  private sessions = new Map<string, ScrapeSession>();

  /**
   * Get scrape progress for the authenticated user's latest session, or for a
   * specific session id (ownership is verified). Returns null when there is no
   * matching session so the caller can report idle.
   */
  getScrapeProgress(userId?: string, sessionId?: string): ScrapeProgress | null {
    if (sessionId) {
      const session = this.getSession(sessionId, userId ?? '');
      if (!session) return null;
      return this.sessionToProgress(session);
    }
    if (userId) {
      const session = this.getLatestSession(userId);
      if (session) return this.sessionToProgress(session);
    }
    return { ...this.scrapeProgress };
  }

  /**
   * Start a filter-driven scraping session for a user. Returns immediately;
   * the scrape runs in the background and its progress is tracked on the
   * session. Rejects when the user already has an active session.
   */
  startScrape(userId: string, filters: ScrapeFilters, opts: { save?: boolean } = {}): ScrapeSession {
    if (this.getActiveSession(userId)) {
      throw new Error('A scraping session is already running for this user.');
    }

    const sessionId = `scrape-${userId}-${Date.now()}`;
    const session: ScrapeSession = {
      sessionId,
      userId,
      status: 'running',
      filters,
      save: opts.save ?? true,
      startTime: new Date(),
      currentSource: null,
      sourceIndex: 0,
      jobsDiscovered: 0,
      jobsSaved: 0,
      jobsSkipped: 0,
      jobsFailed: 0,
      errors: {},
      sourceProgress: [],
      foundJobs: [],
      uniqueJobs: [],
      abortController: new AbortController(),
      pythonProcess: null,
      message: 'Starting scrape...',
    };
    this.sessions.set(sessionId, session);

    // Fire and forget: the HTTP response must not wait for the scrape.
    this.runScrape(this.buildConfigFromFilters(filters), session).catch((error) => {
      session.status = 'failed';
      session.endTime = new Date();
      session.errors['_fatal'] = error instanceof Error ? error.message : String(error);
      session.message = 'Scraping failed.';
      this.mirrorLegacyProgress(session);
    });

    return session;
  }

  /**
   * Cancel a user's scraping session. Verifies ownership so one user cannot
   * cancel another user's session. Returns false when there is no
   * cancellable session.
   */
  cancelScrape(userId: string, sessionId: string): boolean {
    const session = this.getSession(sessionId, userId);
    if (!session) return false;
    if (session.status !== 'running' && session.status !== 'cancelling') return false;

    session.status = 'cancelling';
    session.message = 'Cancelling scraping...';
    session.abortController.abort();

    // Stop the in-flight Python JobSpy subprocess immediately rather than
    // waiting for the next abort check.
    try {
      session.pythonProcess?.kill();
    } catch {
      // ignore kill failures
    }

    console.log('[SCRAPER] Cancellation requested', { sessionId, userId });
    return true;
  }

  /** The user's most recent session (any status). */
  getLatestSession(userId: string): ScrapeSession | null {
    let latest: ScrapeSession | null = null;
    for (const session of this.sessions.values()) {
      if (session.userId !== userId) continue;
      if (!latest || session.startTime > latest.startTime) latest = session;
    }
    return latest;
  }

  /** The user's active (running or cancelling) session, if any. */
  getActiveSession(userId: string): ScrapeSession | null {
    let latest: ScrapeSession | null = null;
    for (const session of this.sessions.values()) {
      if (session.userId !== userId) continue;
      if (session.status !== 'running' && session.status !== 'cancelling') continue;
      if (!latest || session.startTime > latest.startTime) latest = session;
    }
    return latest;
  }

  /** Fetch a session only if it belongs to the given user. */
  getSession(sessionId: string, userId: string): ScrapeSession | null {
    const session = this.sessions.get(sessionId);
    return session && session.userId === userId ? session : null;
  }

  isAborted(session: ScrapeSession): boolean {
    return session.abortController.signal.aborted;
  }

  /** Strip non-serializable handles before sending progress to the frontend. */
  serializeSession(session: ScrapeSession): ScrapeProgress {
    const { abortController, pythonProcess, ...rest } = session;
    return rest as unknown as ScrapeProgress;
  }

  private sessionToProgress(session: ScrapeSession): ScrapeProgress {
    const progress = this.serializeSession(session);
    progress.status = session.status;
    progress.jobsFound = session.jobsDiscovered;
    progress.sources = session.sourceProgress.map((sp) => sp.source);
    progress.totalSources = session.sourceProgress.length;
    progress.startedAt = session.startTime;
    return progress;
  }

  /**
   * Compute estimated time remaining based on average time per completed source.
   */
  private computeEtaMs(startedAt: Date, completedSources: number, totalSources: number): number | null {
    if (completedSources === 0 || totalSources === 0) return null;
    const elapsed = Date.now() - startedAt.getTime();
    const avgPerSource = elapsed / completedSources;
    const remaining = totalSources - completedSources;
    return Math.max(0, avgPerSource * remaining);
  }

  /**
   * Append newly found jobs to the real-time display list, capped to avoid unbounded memory growth.
   */
  private addFoundJobs(jobs: JobPost[]): void {
    if (!jobs || jobs.length === 0) return;
    const MAX_FOUND_JOBS_DISPLAY = 200;
    this.scrapeProgress.foundJobs.push(...jobs);
    if (this.scrapeProgress.foundJobs.length > MAX_FOUND_JOBS_DISPLAY) {
      this.scrapeProgress.foundJobs = this.scrapeProgress.foundJobs.slice(-MAX_FOUND_JOBS_DISPLAY);
    }
  }

  /**
   * Scrape jobs from all configured sources for Ontario (legacy path used by
   * the scheduled scraper — no user, no filters, no cancellation).
   */
  async scrapeAllJobs(customConfig?: Partial<ScraperConfig>): Promise<ScraperResult> {
    const cfg = { ...this.defaultConfig, ...customConfig };
    return this.runScrape(cfg, null);
  }

  /**
   * Core scraping loop. Driven either by scrapeAllJobs (session === null,
   * legacy scheduled path) or by startScrape (filter-driven, cancellable).
   *
   * When a session is provided, progress, abort checks and filter validation
   * are applied to that session; otherwise only the legacy scrapeProgress
   * snapshot is updated.
   */
  private async runScrape(
    cfg: ScraperConfig,
    session: ScrapeSession | null
  ): Promise<ScraperResult> {
    const startTime = Date.now();
    const allJobs: JobPost[] = [];
    const errors: Record<string, string> = {};

    // Only scrape the sources the user explicitly selected. Job Bank (and any
    // other source) runs only when present in cfg.sources — never silently.
    const sourceList = [...cfg.sources];
    const includeJobBank = cfg.sources.includes('jobbank');
    const now = new Date();

    const initProgress = () => {
      const progress: Partial<ScrapeProgress> = {
        status: 'running',
        currentSource: null,
        sources: sourceList,
        sourceIndex: 0,
        totalSources: sourceList.length,
        jobsFound: 0,
        jobsSaved: 0,
        jobsSkipped: 0,
        jobsFailed: 0,
        errors: {},
        startedAt: now,
        etaMs: this.computeEtaMs(now, 0, sourceList.length),
        completedAt: null,
        foundJobs: [],
        sourceProgress: sourceList.map((s) => ({
          source: s,
          status: 'pending' as const,
          jobsFound: 0,
        })),
      };
      if (session) {
        Object.assign(session, progress);
        session.sourceProgress = sourceList.map((s) => ({
          source: s,
          status: 'pending' as const,
          jobsFound: 0,
        }));
        session.message = 'Starting scrape...';
      } else {
        this.scrapeProgress = { ...this.scrapeProgress, ...progress };
      }
    };
    initProgress();

    console.log('[SCRAPER] Scrape started', {
      sessionId: session?.sessionId,
      sources: cfg.sources,
      locations: cfg.locations,
      searchTerms: cfg.searchTerms,
      resultsWanted: cfg.resultsWanted,
      hoursOld: cfg.hoursOld,
    });

    // Scrape from each source (JobSpy sites). 'jobbank' is handled separately
    // via the Government of Canada CSV block below, so skip it here to avoid
    // scraping it twice when the user selected it.
    let completedCount = 0;
    for (const source of cfg.sources) {
      if (source === 'jobbank') continue;
      if (session && this.isAborted(session)) break;

      const setCurrent = (src: string | null) => {
        if (session) {
          session.currentSource = src;
          session.sourceIndex = src === null ? 0 : sourceList.indexOf(src);
        } else {
          this.scrapeProgress.currentSource = src;
          this.scrapeProgress.sourceIndex = src === null ? 0 : sourceList.indexOf(src);
        }
      };

      setCurrent(source);
      if (session) {
        session.sourceProgress = session.sourceProgress.map((sp) =>
          sp.source === source ? { ...sp, status: 'running' } : sp
        );
      } else {
        this.scrapeProgress.sourceProgress = this.scrapeProgress.sourceProgress.map((sp) =>
          sp.source === source ? { ...sp, status: 'running' } : sp
        );
      }

      console.log(`[SCRAPER] Starting scrape for source: ${source}`);
      try {
        let jobs: JobPost[];
        if (source === 'company') {
          // Company career websites aren't a JobSpy site; scrape them directly
          jobs = await this.scrapeCompanyCareers({ searchTerms: cfg.searchTerms });
        } else {
          jobs = await this.scrapeSource(source, cfg, session);
        }
        console.log(`[SCRAPER] Source ${source} returned ${jobs.length} jobs`);

        let matching = jobs;
        if (session) {
          // Validate results against the user's chosen filters BEFORE saving.
          matching = jobs.filter((job) => this.matchesFilters(job, session.filters));
          const skipped = jobs.length - matching.length;
          session.jobsDiscovered += jobs.length;
          session.jobsSkipped += skipped;
          console.log(`[SCRAPER] ${matching.length}/${jobs.length} jobs matched the selected filters`);
        }
        allJobs.push(...matching);

        completedCount += 1;
        if (session) {
          session.foundJobs.push(...matching);
          if (session.foundJobs.length > 200) {
            session.foundJobs = session.foundJobs.slice(-200);
          }
          session.sourceProgress = session.sourceProgress.map((sp) =>
            sp.source === source
              ? { ...sp, status: 'completed' as const, jobsFound: matching.length }
              : sp
          );
          this.mirrorLegacyProgress(session);
        } else {
          this.scrapeProgress.jobsFound = allJobs.length;
          this.addFoundJobs(jobs);
          this.scrapeProgress.sourceProgress = this.scrapeProgress.sourceProgress.map((sp) =>
            sp.source === source
              ? { ...sp, status: 'completed' as const, jobsFound: jobs.length }
              : sp
          );
          this.scrapeProgress.etaMs = this.computeEtaMs(
            this.scrapeProgress.startedAt!,
            completedCount,
            sourceList.length
          );
        }

        await sleep(SCRAPER_DEFAULTS.RATE_LIMIT_DELAY);
      } catch (error: any) {
        if (session && this.isAborted(session)) break;
        console.error(`[SCRAPER] Source ${source} FAILED:`, error.message);
        if (session) {
          session.errors[source] = error.message;
          session.sourceProgress = session.sourceProgress.map((sp) =>
            sp.source === source
              ? { ...sp, status: 'failed' as const, error: error.message }
              : sp
          );
          this.mirrorLegacyProgress(session);
        } else {
          errors[source] = error.message;
          this.scrapeProgress.errors[source] = error.message;
          this.scrapeProgress.sourceProgress = this.scrapeProgress.sourceProgress.map((sp) =>
            sp.source === source
              ? { ...sp, status: 'failed' as const, error: error.message }
              : sp
          );
        }
      }
    }

    // Also try Job Bank CSV (Government of Canada) — only when explicitly selected.
    const jobbankSource = 'jobbank';
    if (includeJobBank && (!session || !this.isAborted(session))) {
      if (session) {
        session.currentSource = jobbankSource;
        session.sourceIndex = sourceList.indexOf(jobbankSource);
        session.sourceProgress = session.sourceProgress.map((sp) =>
          sp.source === jobbankSource ? { ...sp, status: 'running' } : sp
        );
      } else {
        this.scrapeProgress.currentSource = jobbankSource;
        this.scrapeProgress.sourceIndex = sourceList.indexOf(jobbankSource);
        this.scrapeProgress.sourceProgress = this.scrapeProgress.sourceProgress.map((sp) =>
          sp.source === jobbankSource ? { ...sp, status: 'running' } : sp
        );
      }

      console.log('[SCRAPER] Starting Job Bank CSV scrape');
      try {
        const jobBankJobs = await this.scrapeJobBank();
        console.log(`[SCRAPER] Job Bank returned ${jobBankJobs.length} jobs`);

        let matching = jobBankJobs;
        if (session) {
          matching = jobBankJobs.filter((job) => this.matchesFilters(job, session.filters));
          const skipped = jobBankJobs.length - matching.length;
          session.jobsDiscovered += jobBankJobs.length;
          session.jobsSkipped += skipped;
        }
        allJobs.push(...matching);

        completedCount += 1;
        if (session) {
          session.foundJobs.push(...matching);
          if (session.foundJobs.length > 200) {
            session.foundJobs = session.foundJobs.slice(-200);
          }
          session.sourceProgress = session.sourceProgress.map((sp) =>
            sp.source === jobbankSource
              ? { ...sp, status: 'completed' as const, jobsFound: matching.length }
              : sp
          );
          this.mirrorLegacyProgress(session);
        } else {
          this.scrapeProgress.jobsFound = allJobs.length;
          this.addFoundJobs(jobBankJobs);
          this.scrapeProgress.sourceProgress = this.scrapeProgress.sourceProgress.map((sp) =>
            sp.source === jobbankSource
              ? { ...sp, status: 'completed' as const, jobsFound: jobBankJobs.length }
              : sp
          );
        }
      } catch (error: any) {
        if (session && this.isAborted(session)) {
          // fall through to finalize as cancelled
        } else {
          console.error('[SCRAPER] Job Bank FAILED:', error.message);
          if (session) {
            session.errors['jobbank'] = error.message;
            session.sourceProgress = session.sourceProgress.map((sp) =>
              sp.source === jobbankSource
                ? { ...sp, status: 'failed' as const, error: error.message }
                : sp
            );
            this.mirrorLegacyProgress(session);
          } else {
            errors['jobbank'] = error.message;
            this.scrapeProgress.errors['jobbank'] = error.message;
            this.scrapeProgress.sourceProgress = this.scrapeProgress.sourceProgress.map((sp) =>
              sp.source === jobbankSource
                ? { ...sp, status: 'failed' as const, error: error.message }
                : sp
            );
          }
        }
      }
    }

    console.log(`[SCRAPER] Total raw jobs collected: ${allJobs.length}`);

    // Resolve original employer postings for aggregator-sourced jobs.
    // Uses the original employer posting as the preferred authoritative source.
    // Abort-safe: stops processing results once cancellation is detected.
    if (!session || !this.isAborted(session)) {
      console.log('[SCRAPER] Resolving original employer postings...');
      const resolvedJobs = await this.resolveOriginalPostings(allJobs, session ?? undefined);
      console.log(`[SCRAPER] Resolution complete.`);

      // Deduplicate jobs using canonical URL or normalized employer+title
      const uniqueJobs = this.deduplicateJobs(resolvedJobs);
      console.log(
        `[SCRAPER] After dedup: ${uniqueJobs.length} unique jobs (removed ${
          resolvedJobs.length - uniqueJobs.length
        } duplicates)`
      );

      // Expose the final deduplicated collection to the frontend via progress polling.
      if (session) {
        session.uniqueJobs = uniqueJobs;
        this.mirrorLegacyProgress(session);
      }

      // Save to database (abort-safe: stops saving once cancellation detected)
      // When save === false this is a search-only scrape: results stay
      // "Discovered" and nothing is written to MongoDB.
      if (session?.save) {
        console.log('[SCRAPER] Saving jobs to database...');
        session.message = 'Saving jobs to database...';
        this.mirrorLegacyProgress(session);
        const savedResult = await this.saveJobs(uniqueJobs, session ?? undefined);
        console.log(`[SCRAPER] Saved ${savedResult.saved} new jobs to database`);

        session.jobsSaved = savedResult.saved + savedResult.updated;
        session.jobsSkipped += savedResult.skipped;
        session.jobsFailed += savedResult.failed;
      } else if (session) {
        console.log(`[SCRAPER] Search-only mode: ${uniqueJobs.length} jobs discovered, not saved to database.`);
        session.message = `Discovered ${uniqueJobs.length} jobs (search only, not saved).`;
        this.mirrorLegacyProgress(session);
      }
    }

    const duration = Date.now() - startTime;

    // Finalize progress
    if (session) {
      if (this.isAborted(session)) {
        session.status = 'cancelled';
        session.message = 'Scraping cancelled. Previously saved jobs have been preserved.';
      } else {
        session.status = 'completed';
        session.message = 'Scraping completed.';
      }
      session.endTime = new Date();
      session.currentSource = null;
      this.mirrorLegacyProgress(session);

      console.log('[SCRAPER] Session scrape completed', {
        sessionId: session.sessionId,
        status: session.status,
        duration,
        totalRaw: allJobs.length,
        saved: session.jobsSaved,
        skipped: session.jobsSkipped,
        errors: Object.keys(session.errors),
      });

      return {
        jobs: allJobs,
        errors: session.errors,
        meta: {
          duration,
          sources: cfg.sources,
          totalFound: session.jobsSaved,
        },
      };
    }

    this.scrapeProgress.status = 'completed';
    this.scrapeProgress.completedAt = new Date();
    this.scrapeProgress.currentSource = null;
    this.scrapeProgress.etaMs = 0;

    console.log('[SCRAPER] Legacy scrape completed', {
      duration,
      totalRaw: allJobs.length,
      errors: Object.keys(errors),
    });

    return {
      jobs: allJobs,
      errors,
      meta: {
        duration,
        sources: cfg.sources,
        totalFound: allJobs.length,
      },
    };
  }

  /**
   * Copy session progress onto the legacy singleton so getScrapeProgress()
   * without a user id still reflects the latest scrape.
   */
  private mirrorLegacyProgress(session: ScrapeSession): void {
    this.scrapeProgress = {
      status: session.status,
      currentSource: session.currentSource,
      sources: session.sourceProgress.map((sp) => sp.source),
      sourceIndex: session.sourceIndex,
      totalSources: session.sourceProgress.length,
      jobsFound: session.jobsDiscovered,
      jobsSaved: session.jobsSaved,
      jobsSkipped: session.jobsSkipped,
      jobsFailed: session.jobsFailed,
      errors: { ...session.errors },
      startedAt: session.startTime,
      etaMs: null,
      completedAt: session.endTime ?? null,
      foundJobs: session.foundJobs,
      sourceProgress: session.sourceProgress,
      filters: session.filters,
      message: session.message,
      sessionId: session.sessionId,
    };
  }

  /**
   * Build a JobSpy configuration from the user's chosen filters.
   * Filters are applied at the source where JobSpy supports them (search term,
   * location, hours-old). Everything else is validated on the results before
   * they are saved.
   */
  private buildConfigFromFilters(filters: ScrapeFilters): ScraperConfig {
    const searchTerms: string[] = [];
    if (filters.searchTerm) {
      searchTerms.push(filters.searchTerm);
    } else if (filters.departments?.length) {
      // JobSpy has no department filter, so search by department names.
      searchTerms.push(...filters.departments);
    } else {
      searchTerms.push(...this.defaultConfig.searchTerms);
    }

    const locations = filters.locations?.length
      ? [...filters.locations]
      : [...this.defaultConfig.locations];

    const sources = filters.sources?.length
      ? [...filters.sources]
      : [...this.defaultConfig.sources];

    return {
      searchTerms,
      locations,
      sources,
      resultsWanted: SCRAPER_DEFAULTS.RESULTS_WANTED,
      hoursOld: filters.postedWithinHours ?? SCRAPER_DEFAULTS.HOURS_OLD,
      countryIndeed: this.defaultConfig.countryIndeed,
    };
  }

  /**
   * Scrape jobs from a specific source using Python JobSpy via subprocess.
   * Abort-safe: stops between locations/search terms when cancellation is
   * requested.
   */
  private async scrapeSource(
    source: string,
    config: ScraperConfig,
    session: ScrapeSession | null
  ): Promise<JobPost[]> {
    const allJobs: JobPost[] = [];

    console.log(`[SCRAPER:${source}] Starting scrapeSource with ${config.locations.length} locations x ${config.searchTerms.length} search terms`);

    for (const location of config.locations) {
      if (session && this.isAborted(session)) break;
      for (const searchTerm of config.searchTerms) {
        if (session && this.isAborted(session)) break;
        console.log(`[SCRAPER:${source}] Scraping "${searchTerm}" in "${location}"`);
        try {
          const jobs = await retry(
            () => this.runPythonJobSpy(source, searchTerm, location, config, session),
            {
              maxAttempts: SCRAPER_DEFAULTS.MAX_RETRIES,
              // Don't retry once cancellation has been requested.
              shouldRetry: () => !(session && this.isAborted(session)),
            }
          );

          if (jobs && jobs.length > 0) {
            console.log(`[SCRAPER:${source}] Found ${jobs.length} jobs for "${searchTerm}" in "${location}"`);
            allJobs.push(...jobs);
          } else {
            console.log(`[SCRAPER:${source}] No jobs found for "${searchTerm}" in "${location}"`);
          }
        } catch (error: any) {
          if (session && this.isAborted(session)) break;
          console.error(`[SCRAPER:${source}] Failed for "${searchTerm}" in "${location}":`, error.message);
        }

        // Small delay between searches
        await sleep(500);
      }
      if (session && this.isAborted(session)) break;
    }

    console.log(`[SCRAPER:${source}] Total from this source: ${allJobs.length} jobs`);
    return allJobs;
  }

  /**
   * Run Python JobSpy script via subprocess.
   * Abort-safe: when the session is aborted the subprocess is killed and the
   * promise resolves with an empty list (cancellation, not failure).
   */
  private runPythonJobSpy(
    source: string,
    searchTerm: string,
    location: string,
    config: ScraperConfig,
    session: ScrapeSession | null
  ): Promise<JobPost[]> {
    return new Promise((resolve, reject) => {
      // Map source names to JobSpy site names
      const siteMap: Record<string, string> = {
        'indeed': 'indeed',
        'linkedin': 'linkedin',
        'glassdoor': 'glassdoor',
        'ziprecruiter': 'zip_recruiter',
        'jobbank': 'job_bank',
        'google': 'google',
        'company': 'company',
      };

      // Validate the source / platform before spawning a subprocess.
      if (!siteMap[source]) {
        reject(new Error(`Unsupported scraping source: ${source}`));
        return;
      }
      const siteName = siteMap[source];

      // Validate the Indeed country value (passed straight to Indeed by JobSpy).
      const countryIndeed = String(config.countryIndeed || 'Canada').trim();
      if (!countryIndeed || countryIndeed.length > 64) {
        reject(new Error(`Invalid Indeed country value: ${config.countryIndeed}`));
        return;
      }

      console.log(
        `[SCRAPER:${source}] Spawning Python JobSpy for "${searchTerm}" in "${location}" (site: ${siteName})`
      );

      // Fixed Python script: NO interpolation of external values. All
      // configuration is passed as JSON on stdin, which eliminates Python
      // string injection from quotes, backslashes, Unicode or newlines.
      const pythonScript = `
import sys
import json
import math
import re as _re
import pandas as pd
from jobspy import scrape_jobs

def safe_float(val):
    try:
        f = float(val)
        return f if not math.isnan(f) else None
    except (TypeError, ValueError):
        return None

def safe_str(val):
    if val is None:
        return ''
    try:
        if pd.isna(val):
            return ''
    except (TypeError, ValueError):
        pass
    return str(val)

try:
    config = json.loads(sys.stdin.read())
    site_name = config.get('site_name')
    search_term = config.get('search_term', '')
    location = config.get('location', '')
    results_wanted = int(config.get('results_wanted', 3) or 3)
    hours_old = int(config.get('hours_old', 72) or 72)
    country_indeed = config.get('country_indeed', 'Canada') or 'Canada'
    source = config.get('source', '')

    jobs = scrape_jobs(
        site_name=[site_name],
        search_term=search_term,
        location=f"{location}, ON, Canada",
        results_wanted=results_wanted,
        hours_old=hours_old,
        country_indeed=country_indeed,
        fetch_description=True,
    )

    # Convert to list of dicts
    result = []
    for _, row in jobs.iterrows():
        job_id = safe_str(row.get('job_id', ''))
        # Fallback: extract LinkedIn job ID from the job_url when job_id is empty.
        if not job_id:
            job_url = safe_str(row.get('job_url', ''))
            m = _re.search(r'/jobs/view/(\d+)', job_url)
            if m:
                job_id = m.group(1)
            else:
                job_id = job_url.rstrip('/').split('/')[-1] if job_url else ''
        description = safe_str(row.get('description', ''))
        if not description:
            print(f"[JOB:{job_id}] WARNING: no description retrieved", file=sys.stderr)
        else:
            print(f"[JOB:{job_id}] OK description ({len(description)} chars)", file=sys.stderr)
        job = {
            'id': f"{source}-{job_id}",
            'title': safe_str(row.get('title', '')),
            'company': safe_str(row.get('company', '')),
            'location': safe_str(row.get('location', '')),
            'description': description,
            'jobUrl': safe_str(row.get('job_url', '')),
            'applyUrl': safe_str(row.get('job_url', '')),
            'source': source,
            'datePosted': str(row.get('date_posted', '')) if row.get('date_posted') else '',
            'salary': {
                'min': safe_float(row.get('min_amount', 0)),
                'max': safe_float(row.get('max_amount', 0)),
                'currency': safe_str(row.get('currency', 'CAD')) if row.get('currency') else 'CAD',
                'type': safe_str(row.get('interval', 'yearly')) if row.get('interval') else 'yearly',
            },
            'jobType': safe_str(row.get('job_type', '')),
            'isRemote': bool(row.get('is_remote', False)),
            'employmentType': safe_str(row.get('job_type', '')),
            'companyLogo': '',
            'companyUrl': safe_str(row.get('company_url', '')),
            'jobLevel': '',
            'jobFunction': '',
            'industry': safe_str(row.get('company_industry', '')),
            'companyCareerUrl': '',
            'originalJobUrl': '',
            'preferredQualifications': [],
            'workArrangement': 'unspecified',
            'applicationStatus': 'active',
            'discoveryDate': '',
        }
        result.append(job)

    print(json.dumps(result))
except Exception as e:
    print(json.dumps({'error': str(e)}), file=sys.stderr)
    sys.exit(1)
`;

      const scraperConfig = {
        site_name: siteName,
        search_term: searchTerm,
        location,
        results_wanted: config.resultsWanted,
        hours_old: config.hoursOld,
        country_indeed: countryIndeed,
        source,
      };

      let stdinWritten = false;
      if (session) session.pythonProcess = spawn('python', ['-c', pythonScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60000, // 60 second timeout
      });
      const child = session ? session.pythonProcess : null;

      const stdin = child?.stdin;
      if (stdin) {
        stdin.write(JSON.stringify(scraperConfig));
        stdin.end();
        stdinWritten = true;
      }

      let stdout = '';
      let stderr = '';

      // Immediate kill on cancellation rather than waiting for loop checks.
      const onAbort = () => {
        try {
          child?.kill();
        } catch {
          // ignore kill failures
        }
      };
      if (session) {
        session.abortController.signal.addEventListener('abort', onAbort, { once: true });
      }

      const stdoutHandler = (data: Buffer) => {
        stdout += data.toString();
      };
      const stderrHandler = (data: Buffer) => {
        stderr += data.toString();
      };

      if (child) {
        child.stdout?.on('data', stdoutHandler);
        child.stderr?.on('data', stderrHandler);
      }

      child?.on('close', (code: number | null) => {
        if (session) {
          session.pythonProcess = null;
          session.abortController.signal.removeEventListener('abort', onAbort);
        }
        if (child) {
          child.stdout?.off('data', stdoutHandler);
          child.stderr?.off('data', stderrHandler);
        }

        console.log(`[SCRAPER:${source}] Python process exited with code ${code}`, {
          sessionId: session?.sessionId,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
        });

        if (session && this.isAborted(session)) {
          console.log(`[SCRAPER:${source}] Python process aborted for session ${session.sessionId}`);
          resolve([]);
          return;
        }

        if (!stdinWritten) {
          reject(new Error('Python JobSpy failed: could not write configuration to stdin'));
          return;
        }

        if (code !== 0) {
          console.error(`[SCRAPER:${source}] Python JobSpy FAILED (code ${code}):`, stderr);
          reject(new Error(`Python JobSpy failed (code ${code}): ${stderr}`));
          return;
        }

        try {
          const result = JSON.parse(stdout.trim());
          if (Array.isArray(result)) {
            console.log(`[SCRAPER:${source}] Python returned ${result.length} jobs`);
            // Convert datePosted strings to Date objects
            const jobs = result.map((job: any) => ({
              ...job,
              datePosted: job.datePosted ? new Date(job.datePosted) : new Date(),
              discoveryDate: new Date(),
              companyUrl: job.companyUrl || '',
              companyCareerUrl: job.companyCareerUrl || '',
              originalJobUrl: job.originalJobUrl || '',
              preferredQualifications: job.preferredQualifications || [],
              workArrangement: job.workArrangement || 'unspecified',
              applicationStatus: job.applicationStatus || 'active',
            }));
            resolve(jobs);
          } else if (result.error) {
            console.error(`[SCRAPER:${source}] Python returned error:`, result.error);
            reject(new Error(result.error));
          } else {
            console.log(`[SCRAPER:${source}] Python returned empty result`);
            resolve([]);
          }
        } catch (e: any) {
          console.error(`[SCRAPER:${source}] Failed to parse Python output:`, e.message, 'Output:', stdout);
          reject(new Error(`Failed to parse Python output: ${e.message}\nOutput: ${stdout}`));
        }
      });

      child?.on('error', (err: Error) => {
        if (session) session.pythonProcess = null;
        console.error(`[SCRAPER:${source}] Failed to spawn Python process:`, err.message);
        reject(new Error(`Failed to spawn Python process: ${err.message}`));
      });
    });
  }

  /**
   * Known aggregator domains. When a job URL points to one of these, the URL is
   * an aggregator listing, not the original employer posting. We attempt to
   * resolve the employer's official careers page as the authoritative source.
   */
  private readonly AGGREGATOR_DOMAINS = [
    'linkedin.com', 'indeed.com', 'glassdoor.com', 'ziprecruiter.com',
    'monster.com', 'careerbuilder.com', 'simplyhired.com', 'ziprecruiter.ca',
    'indeed.ca', 'linkedin.ca', 'glassdoor.ca',
  ];

  /**
   * Resolve the original employer posting for a job found on an aggregator.
   * Best-effort:
   * 1. If jobUrl is already on a company domain (not an aggregator), return it.
   * 2. Otherwise fetch the job page HTML and look for links to the employer's
   *    careers page (href with career/jobs/join-us keywords on a non-aggregator host).
   * Returns the original job URL or undefined if none could be resolved.
   */
  private async resolveOriginalJobPosting(jobUrl: string, companyName?: string): Promise<string | undefined> {
    try {
      const jobUrlObj = new URL(jobUrl);
      const host = jobUrlObj.hostname.toLowerCase();

      // If already on a company domain (not a known aggregator), treat as original.
      const isAggregator = this.AGGREGATOR_DOMAINS.some(d => host === d || host.endsWith(`.${d}`));
      if (!isAggregator) {
        return jobUrl;
      }

      // Fetch the aggregator job page to find a link to the employer's careers page.
      const response = await axios.get(jobUrl, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        maxRedirects: 5,
      });

      const html = response.data as string;
      if (!html || html.length < 1000) return undefined;

      // Look for anchor tags with career-related hrefs
      const careerLinkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
      const careerKeywords = ['career', 'careers', 'job', 'jobs', 'join-us', 'joinus', 'work-with-us', 'workwithus', 'employment', 'positions', 'opportunities'];

      const links: Array<{ href: string; text: string }> = [];
      let match: RegExpExecArray | null;
      while ((match = careerLinkRegex.exec(html)) !== null) {
        links.push({ href: match[1], text: match[2] || '' });
      }

      // Score links: prefer same-domain company career links
      const scored = links.map(link => {
        let score = 0;
        const hrefLower = link.href.toLowerCase();
        const textLower = link.text.toLowerCase();
        let resolvedUrl: string | undefined;

        // Must have a career keyword in href or text
        const hasKeyword = careerKeywords.some(k => hrefLower.includes(k) || textLower.includes(k));
        if (!hasKeyword) return { ...link, score: 0, url: undefined };

        try {
          const linkUrl = new URL(link.href, jobUrl);
          const linkHost = linkUrl.hostname.toLowerCase();

          // Skip aggregators
          if (this.AGGREGATOR_DOMAINS.some(d => linkHost === d || linkHost.endsWith(`.${d}`))) {
            return { ...link, score: 0, url: undefined };
          }

          score += 50; // Non-aggregator domain

          // Prefer links on the same host as redirected final URL
          if (linkHost === host) score += 30;

          // Prefer keyword in href
          if (careerKeywords.some(k => hrefLower.includes(k))) score += 20;

          // Prefer keyword in link text
          if (careerKeywords.some(k => textLower.includes(k))) score += 10;

          // If company name provided, prefer links containing it
          if (companyName) {
            const normCompany = normalizeEmployerName(companyName);
            if (normCompany && (hrefLower.includes(normCompany) || textLower.includes(normCompany))) {
              score += 15;
            }
          }

          resolvedUrl = linkUrl.href;
          return { ...link, score, url: resolvedUrl };
        } catch {
          return { ...link, score: 0, url: undefined };
        }
      });

      scored.sort((a, b) => b.score - a.score);
      const best = scored.find(l => l.score > 0);
      return best?.url;
    } catch (error: any) {
      // Network/fetch failures are non-fatal: we just can't resolve the original posting
      logger.debug(`Could not resolve original job posting for ${jobUrl}:`, error.message);
      return undefined;
    }
  }

  /**
   * Try common employer careers URL patterns for a company domain.
   * Returns the first pattern that responds with what looks like a careers page.
   */
  private async probeCompanyCareersUrl(companyDomain: string, companyName?: string): Promise<string | undefined> {
    const protocols = ['https://', 'http://'];
    const paths = [
      '/careers', '/jobs', '/join-us', '/work-with-us', '/employment', '/positions',
      '/about/careers', '/about/jobs', '/company/careers', '/company/jobs',
      '/careers/', '/jobs/', '/join-us/', '/work-with-us/',
    ];

    for (const protocol of protocols) {
      for (const path of paths) {
        const url = `${protocol}${companyDomain}${path}`;
        try {
          const response = await axios.get(url, {
            timeout: 10000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            maxRedirects: 3,
          });
          const html = (response.data as string) || '';
          const lower = html.toLowerCase();
          // Heuristic: careers pages usually mention jobs/careers/hiring prominently
          const careerSignal = ['career', 'job', 'join', 'hiring', 'position', 'opportunity'].some(k => lower.includes(k));
          if (careerSignal && html.length > 2000) {
            return url;
          }
        } catch {
          // Probe failed, try next pattern
        }
      }
    }
    return undefined;
  }

  /**
   * Scrape a company careers page for job listings. Best-effort: fetches the
   * careers page, extracts job-looking links, and returns minimal JobPost
   * entries. Callers should follow up with resolveOriginalJobPosting per job.
   */
  private async scrapeCompanyCareersPage(careerUrl: string, companyName: string): Promise<JobPost[]> {
    const jobs: JobPost[] = [];
    try {
      const response = await axios.get(careerUrl, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        maxRedirects: 5,
      });
      const html = (response.data as string) || '';
      if (!html || html.length < 1000) return jobs;

      // Extract links that look like job postings
      const jobLinkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
      const jobKeywords = ['job', 'position', 'role', 'opening', 'career'];
      const seen = new Set<string>();

      let match: RegExpExecArray | null;
      while ((match = jobLinkRegex.exec(html)) !== null) {
        const href = match[1];
        const text = (match[2] || '').trim();
        if (!href || !text || text.length < 5) continue;

        const hrefLower = href.toLowerCase();
        const textLower = text.toLowerCase();
        const looksLikeJob = jobKeywords.some(k => hrefLower.includes(k) || textLower.includes(k));
        if (!looksLikeJob) continue;

        try {
          const absUrl = new URL(href, careerUrl).href;
          if (seen.has(absUrl)) continue;
          seen.add(absUrl);

          jobs.push({
            id: `company-${normalizeUrl(absUrl)}`,
            title: text,
            company: companyName,
            location: '',
            description: '',
            jobUrl: absUrl,
            applyUrl: absUrl,
            source: 'company',
            datePosted: new Date(),
            companyCareerUrl: careerUrl,
            originalJobUrl: absUrl,
            workArrangement: 'unspecified',
            applicationStatus: 'active',
            discoveryDate: new Date(),
          });
        } catch {
          // Skip malformed URLs
        }
      }
    } catch (error: any) {
      logger.debug(`Failed to scrape company careers page ${careerUrl}:`, error.message);
    }
    return jobs;
  }

  /**
   * Scrape company career websites for configured companies. For each company
   * in the search terms, probe common careers URL patterns and scrape job links.
   */
  private async scrapeCompanyCareers(config: { searchTerms: string[] }): Promise<JobPost[]> {
    const jobs: JobPost[] = [];
    for (const company of config.searchTerms) {
      try {
        // Derive a domain guess from the company name
        const domainGuess = company.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';
        const careerUrl = await this.probeCompanyCareersUrl(domainGuess, company);
        if (careerUrl) {
          const companyJobs = await this.scrapeCompanyCareersPage(careerUrl, company);
          console.log(`[SCRAPER:company] ${company} careers page: ${companyJobs.length} jobs`);
          jobs.push(...companyJobs);
        }
      } catch (error: any) {
        console.error(`[SCRAPER:company] ${company} failed:`, error.message);
      }
      await sleep(1000);
    }
    return jobs;
  }

  /**
   * Scrape Job Bank (Government of Canada) monthly CSV
   */
  private async scrapeJobBank(): Promise<JobPost[]> {
    const csvPath = await this.downloadJobBankCSV();
    if (!csvPath) return [];

    // Parse CSV (simplified - in production use a proper CSV parser)
    const jobs: JobPost[] = [];
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split('\n').slice(1); // Skip header

    for (const line of lines) {
      if (!line.trim()) continue;
      const job = this.parseJobBankCSVLine(line);
      if (job) jobs.push(job);
    }

    return jobs;
  }

  /**
   * Download Job Bank CSV from open.canada.ca
   */
  private async downloadJobBankCSV(): Promise<string | null> {
    try {
      // Get package info to find latest CSV
      const packageUrl = 'https://open.canada.ca/data/api/action/package_show?id=ea639e28-c0fc-48bf-b5dd-b8899bd43072';
      const response = await axios.get(packageUrl);
      const resources = response.data.result.resources;

      // Find English CSV resource
      const csvResource = resources.find((r: any) =>
        r.format === 'CSV' && r.name.toLowerCase().includes('en')
      ) || resources.find((r: any) => r.format === 'CSV');

      if (!csvResource?.url) {
        logger.warn('No CSV resource found in Job Bank package');
        return null;
      }

      // Download CSV
      const csvResponse = await axios.get(csvResource.url, { responseType: 'stream' });
      const csvPath = path.join(process.cwd(), 'data', `jobbank-${Date.now()}.csv`);

      // Ensure data directory exists
      const dataDir = path.dirname(csvPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const writer = fs.createWriteStream(csvPath);
      csvResponse.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(csvPath));
        writer.on('error', reject);
      });
    } catch (error: any) {
      logger.error('Failed to download Job Bank CSV:', error.message);
      return null;
    }
  }

  /**
   * Parse a single line from Job Bank CSV
   */
  private parseJobBankCSVLine(line: string): JobPost | null {
    // Simplified CSV parsing - in production use 'csv-parse' library
    const fields = this.parseCSVLine(line);
    if (fields.length < 10) return null;

    // Map Job Bank CSV columns (approximate mapping)
    const [
      jobTitle, nocCode, naicsCode, workLocation, vacancies,
      salary, hours, requirements, employmentTerms, externalUrl
    ] = fields;

    // Filter for Ontario locations
    const isOntario = ONTARIO_CITIES.some(city =>
      workLocation.toLowerCase().includes(city.toLowerCase())
    );
    if (!isOntario) return null;

    const { min, max, currency } = parseSalary(salary);

    return {
      id: `jobbank-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title: jobTitle,
      company: 'Various Employers',
      location: workLocation,
      description: requirements,
      jobUrl: externalUrl || '',
      applyUrl: externalUrl || '',
      source: 'jobbank',
      datePosted: new Date(),
      salary: { min: min ?? undefined, max: max ?? undefined, currency, type: 'yearly' },
      jobType: employmentTerms,
      isRemote: workLocation.toLowerCase().includes('remote'),
      employmentType: employmentTerms,
      companyLogo: '',
      companyUrl: '',
      jobLevel: '',
      jobFunction: '',
      industry: naicsCode,
    };
  }

  /**
   * Simple CSV line parser
   */
  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  /**
   * Resolve original employer postings for jobs sourced from aggregators.
   * Sets originalJobUrl (authoritative employer URL) and companyCareerUrl
   * when they can be discovered. Failures are non-fatal. Abort-safe: stops
   * processing results once cancellation is detected.
   */
  private async resolveOriginalPostings(
    jobs: JobPost[],
    session?: ScrapeSession
  ): Promise<JobPost[]> {
    const AGGREGATOR_SOURCES = new Set(['indeed', 'linkedin', 'glassdoor', 'ziprecruiter', 'google']);
    const resolved: JobPost[] = [];

    for (const job of jobs) {
      if (session && this.isAborted(session)) break;
      let resolvedJob = { ...job };

      if (AGGREGATOR_SOURCES.has(job.source) && job.jobUrl) {
        try {
          const originalUrl = await this.resolveOriginalJobPosting(job.jobUrl, job.company);
          if (originalUrl) {
            resolvedJob.originalJobUrl = originalUrl;
            // If the resolved URL is on a company domain, treat it as the careers page too
            try {
              const host = new URL(originalUrl).hostname.toLowerCase();
              const isAgg = this.AGGREGATOR_DOMAINS.some(d => host === d || host.endsWith(`.${d}`));
              if (!isAgg) {
                resolvedJob.companyCareerUrl = originalUrl;
              }
            } catch {
              // ignore URL parse issues
            }
            resolvedJob.applicationUrl = resolvedJob.originalJobUrl || resolvedJob.applyUrl;
          }
        } catch (error: any) {
          logger.debug(`Original posting resolution failed for ${job.id}:`, error.message);
        }
      }

      // Determine work arrangement from location/description signals
      const locLower = (job.location || '').toLowerCase();
      const descLower = (job.description || '').toLowerCase();
      if (locLower.includes('remote') || descLower.includes('remote')) {
        resolvedJob.workArrangement = 'remote';
      } else if (locLower.includes('hybrid') || descLower.includes('hybrid')) {
        resolvedJob.workArrangement = 'hybrid';
      } else if (resolvedJob.workArrangement === 'unspecified') {
        resolvedJob.workArrangement = 'on-site';
      }

      // Mark as expired if the posting is older than the hours-old window
      if (job.datePosted) {
        const hoursOld = (Date.now() - job.datePosted.getTime()) / (1000 * 60 * 60);
        if (hoursOld > (SCRAPER_DEFAULTS.HOURS_OLD * 2)) {
          resolvedJob.applicationStatus = 'expired';
        }
      }

      resolved.push(resolvedJob);

      // Small delay to be respectful when resolving many aggregator pages
      if (AGGREGATOR_SOURCES.has(job.source)) {
        await sleep(300);
      }
    }

    return resolved;
  }

  /**
   * Deduplicate jobs using canonical URL (most reliable) or normalized
   * employer + title. Does NOT rely solely on title, company, and location
   * as required by the master instructions.
   */
  private deduplicateJobs(jobs: JobPost[]): JobPost[] {
    return uniqueByFn(jobs, (job) => {
      return canonicalJobKey(job.company, job.title, job.originalJobUrl || job.jobUrl);
    });
  }

  /**
   * Save jobs to MongoDB. Abort-safe: stops saving once cancellation is
   * detected so jobs successfully saved before cancellation are preserved.
   */
  private async saveJobs(
    jobs: JobPost[],
    session?: ScrapeSession
  ): Promise<{ saved: number; updated: number; skipped: number; failed: number }> {
    let saved = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    console.log(`[SCRAPER] saveJobs starting with ${jobs.length} jobs${session ? ` (session ${session.sessionId})` : ''}`);

    for (const job of jobs) {
      if (session && this.isAborted(session)) break;
      try {
        // Prefer dedup by originalJobUrl (authoritative employer URL) when available,
        // falling back to source+externalId. The same job may arrive from different
        // aggregators with different externalIds but the same canonical URL.
        const query: any = [{ source: job.source, externalId: job.id }];
        if (job.originalJobUrl) {
          query.push({ originalJobUrl: job.originalJobUrl });
        }

        let existing = await JobPosting.findOne({ $or: query });

        if (existing) {
          // Update if newer
          if (job.datePosted && job.datePosted > existing.postedDate) {
            await this.updateJobPosting(existing, job);
            updated++;
          } else {
            skipped++;
          }
        } else {
          await this.createJobPosting(job);
          saved++;
        }
      } catch (error: any) {
        failed++;
        console.error(`[SCRAPER] Failed to save job ${job.id}:`, error.message);
      }
    }

    console.log(
      `[SCRAPER] saveJobs completed: saved=${saved}, updated=${updated}, skipped=${skipped}, failed=${failed}`
    );
    return { saved, updated, skipped, failed };
  }

  /**
   * Save a single discovered job (individual "Save Job" action). Creates a new
   * posting or updates an existing one matched by source+externalId or
   * originalJobUrl. Returns the saved document's id and whether it was created.
   * Abort-safe: not session-bound, so a single save always completes.
   */
  public async saveSingleJob(job: JobPost): Promise<{ id: string; created: boolean }> {
    const query: any = [{ source: job.source, externalId: job.id }];
    if (job.originalJobUrl) {
      query.push({ originalJobUrl: job.originalJobUrl });
    }

    let existing = await JobPosting.findOne({ $or: query });
    const created = !existing;

    if (existing) {
      await this.updateJobPosting(existing, job);
      await existing.save();
    } else {
      await this.createJobPosting(job);
    }

    const doc = await JobPosting.findOne({ $or: query }).lean();
    return { id: (doc?._id ?? existing?._id ?? job.id).toString(), created };
  }

  /**
   * Create new job posting from scraped data
   */
  private async createJobPosting(job: JobPost): Promise<void> {
    const { min, max, currency } = job.salary || { min: null, max: null, currency: 'CAD' };

    await JobPosting.create({
      externalId: job.id,
      source: job.source,
      sourceUrl: job.jobUrl,
      companyCareerUrl: job.companyCareerUrl,
      originalJobUrl: job.originalJobUrl,
      title: job.title,
      company: job.company,
      companyLogo: job.companyLogo,
      location: {
        city: this.extractCity(job.location),
        province: 'ON',
        country: 'Canada',
        remote: job.workArrangement === 'remote' || job.isRemote || false,
        hybrid: job.workArrangement === 'hybrid' || job.location?.toLowerCase().includes('hybrid') || false,
      },
      description: job.description,
      requirements: this.extractRequirements(job.description),
      preferredQualifications: job.preferredQualifications || this.extractPreferredQualifications(job.description),
      responsibilities: this.extractResponsibilities(job.description),
      skills: this.extractSkills(job.description),
      salaryMin: min,
      salaryMax: max,
      salaryCurrency: currency || 'CAD',
      jobType: this.normalizeJobType(job.jobType || job.employmentType),
      workArrangement: job.workArrangement || 'unspecified',
      experienceLevel: this.guessExperienceLevel(job.title, job.description),
      industry: job.industry,
      department: job.jobFunction,
      postedDate: job.datePosted || new Date(),
      discoveryDate: job.discoveryDate || new Date(),
      applicationStatus: job.applicationStatus || 'active',
      applicationUrl: job.applyUrl || job.jobUrl,
      applicationType: this.determineApplicationType(job.applyUrl, job.source),
      atsPlatform: this.detectATSPlatform(job.applyUrl),
      scrapedAt: new Date(),
      lastUpdated: new Date(),
      isActive: job.applicationStatus !== 'expired',
      metadata: {
        originalJob: job,
      },
    });
  }

  /**
   * Update existing job posting
   */
  private async updateJobPosting(existing: any, job: JobPost): Promise<void> {
    const { min, max, currency } = job.salary || { min: null, max: null, currency: 'CAD' };

    existing.title = job.title;
    existing.company = job.company;
    existing.companyLogo = job.companyLogo;
    existing.companyCareerUrl = job.companyCareerUrl;
    existing.originalJobUrl = job.originalJobUrl;
    existing.location = {
      city: this.extractCity(job.location),
      province: 'ON',
      country: 'Canada',
      remote: job.workArrangement === 'remote' || job.isRemote || false,
      hybrid: job.workArrangement === 'hybrid' || job.location?.toLowerCase().includes('hybrid') || false,
    };
    existing.description = job.description;
    existing.requirements = this.extractRequirements(job.description);
    existing.preferredQualifications = job.preferredQualifications || this.extractPreferredQualifications(job.description);
    existing.responsibilities = this.extractResponsibilities(job.description);
    existing.skills = this.extractSkills(job.description);
    existing.salaryMin = min;
    existing.salaryMax = max;
    existing.salaryCurrency = currency || 'CAD';
    existing.jobType = this.normalizeJobType(job.jobType || job.employmentType);
    existing.workArrangement = job.workArrangement || 'unspecified';
    existing.experienceLevel = this.guessExperienceLevel(job.title, job.description);
    existing.industry = job.industry;
    existing.department = job.jobFunction;
    existing.postedDate = job.datePosted || existing.postedDate;
    existing.discoveryDate = job.discoveryDate || existing.discoveryDate;
    existing.applicationStatus = job.applicationStatus || 'active';
    existing.applicationUrl = job.applyUrl || job.jobUrl;
    existing.applicationType = this.determineApplicationType(job.applyUrl, job.source);
    existing.atsPlatform = this.detectATSPlatform(job.applyUrl);
    existing.lastUpdated = new Date();
    existing.isActive = job.applicationStatus !== 'expired';
    existing.metadata = { originalJob: job };

    await existing.save();
  }

  /**
   * Validate a scraped job against the session's chosen filters. Returns true
   * only when the job matches every criterion the user selected. This prevents
   * unrelated postings from being saved merely because they contain one broadly
   * matching keyword.
   */
  private matchesFilters(job: JobPost, filters: ScrapeFilters): boolean {
    const {
      searchTerm,
      locations,
      jobTypes,
      experienceLevels,
      industries,
      departments,
      salaryMin,
      salaryMax,
      postedWithinHours,
      remoteOnly,
      hybridOnly,
      excludedCompanies,
      excludedKeywords,
      requiredKeywords,
    } = filters;

    const searchable = `${job.title} ${job.company} ${job.description ?? ''}`.toLowerCase();

    if (searchTerm && !searchable.includes(searchTerm.toLowerCase())) return false;

    if (locations?.length) {
      const loc = `${job.location ?? ''}`.toLowerCase();
      if (!locations.some((l) => loc.includes(l.toLowerCase()))) return false;
    }

    if (jobTypes?.length) {
      const normalized = this.normalizeJobType(job.jobType || job.employmentType);
      if (!jobTypes.includes(normalized)) return false;
    }

    if (experienceLevels?.length) {
      const level = job.jobLevel || this.guessExperienceLevel(job.title, job.description ?? '');
      if (!experienceLevels.includes(level)) return false;
    }

    if (industries?.length) {
      if (!industries.includes(job.industry || '')) return false;
    }

    if (departments?.length) {
      if (!departments.includes(job.jobFunction || '')) return false;
    }

    if (remoteOnly && job.workArrangement !== 'remote' && !job.isRemote) return false;
    if (hybridOnly && job.workArrangement !== 'hybrid') return false;

    if (salaryMin != null) {
      const max = job.salary?.max;
      if (max == null || max < salaryMin) return false;
    }

    if (salaryMax != null) {
      const min = job.salary?.min;
      if (min == null || min > salaryMax) return false;
    }

    if (postedWithinHours && job.datePosted) {
      const cutoff = Date.now() - postedWithinHours * 60 * 60 * 1000;
      if (job.datePosted.getTime() < cutoff) return false;
    }

    if (excludedCompanies?.length && excludedCompanies.includes(job.company)) return false;

    if (excludedKeywords?.length && excludedKeywords.some((kw) => searchable.includes(kw.toLowerCase())))
      return false;

    if (requiredKeywords?.length && !requiredKeywords.every((kw) => searchable.includes(kw.toLowerCase())))
      return false;

    return true;
  }

  /**
   * Extract city from location string
   */
  private extractCity(location: string): string {
    for (const city of ONTARIO_CITIES) {
      if (location.toLowerCase().includes(city.toLowerCase())) {
        return city;
      }
    }
    // Default to Toronto if not found
    return 'Toronto';
  }

  /**
   * Extract requirements from description
   */
  private extractRequirements(description: string): string[] {
    const reqKeywords = [
      'requirements', 'qualifications', 'must have', 'required',
      'experience with', 'knowledge of', 'proficiency in',
      'bachelor', 'master', 'degree', 'certification',
      'years of experience', 'minimum', 'at least',
    ];

    const sentences = description.split(/[.!?]+/);
    return sentences
      .filter(s => reqKeywords.some(k => s.toLowerCase().includes(k)))
      .map(s => s.trim())
      .filter(s => s.length > 10)
      .slice(0, 10);
  }

  /**
   * Extract preferred qualifications from description
   */
  private extractPreferredQualifications(description: string): string[] {
    const prefKeywords = [
      'preferred', 'nice to have', 'bonus', 'plus', 'desired',
      'ideally', 'advantageous', 'furthermore', 'additionally',
    ];

    const sentences = description.split(/[.!?]+/);
    return sentences
      .filter(s => prefKeywords.some(k => s.toLowerCase().includes(k)))
      .map(s => s.trim())
      .filter(s => s.length > 10)
      .slice(0, 10);
  }

  /**
   * Extract responsibilities from description
   */
  private extractResponsibilities(description: string): string[] {
    const respKeywords = [
      'responsibilities', 'duties', 'you will', 'role includes',
      'key responsibilities', 'primary duties', 'accountable for',
      'responsible for', 'tasked with', 'overview',
    ];

    const sentences = description.split(/[.!?]+/);
    return sentences
      .filter(s => respKeywords.some(k => s.toLowerCase().includes(k)))
      .map(s => s.trim())
      .filter(s => s.length > 10)
      .slice(0, 10);
  }

  /**
   * Extract skills from description
   */
  private extractSkills(description: string): string[] {
    const commonSkills = [
      'javascript', 'typescript', 'python', 'java', 'c#', 'go', 'rust',
      'react', 'vue', 'angular', 'node.js', 'express', 'next.js',
      'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform',
      'sql', 'postgresql', 'mongodb', 'redis', 'elasticsearch',
      'git', 'ci/cd', 'jenkins', 'github actions', 'gitlab',
      'agile', 'scrum', 'kanban', 'jira', 'confluence',
      'machine learning', 'ai', 'tensorflow', 'pytorch', 'pandas',
      'rest', 'graphql', 'grpc', 'microservices', 'serverless',
    ];

    const found: string[] = [];
    const lowerDesc = description.toLowerCase();

    for (const skill of commonSkills) {
      if (lowerDesc.includes(skill.toLowerCase())) {
        found.push(skill);
      }
    }

    return found.slice(0, 20);
  }

  /**
   * Normalize job type
   */
  private normalizeJobType(jobType?: string): string {
    if (!jobType) return 'full-time';
    const lower = jobType.toLowerCase();
    if (lower.includes('part')) return 'part-time';
    if (lower.includes('contract')) return 'contract';
    if (lower.includes('intern')) return 'internship';
    if (lower.includes('temp')) return 'temporary';
    if (lower.includes('freelance')) return 'freelance';
    return 'full-time';
  }

  /**
   * Guess experience level from title and description
   */
  private guessExperienceLevel(title: string, description: string): string {
    const text = `${title} ${description}`.toLowerCase();

    if (text.includes('principal') || text.includes('staff') || text.includes('architect')) {
      return 'principal';
    }
    if (text.includes('lead') || text.includes('manager') || text.includes('director')) {
      return 'lead';
    }
    if (text.includes('senior') || text.includes('sr.')) {
      return 'senior';
    }
    if (text.includes('mid') || text.includes('intermediate') || text.includes('3+ years') || text.includes('5+ years')) {
      return 'mid';
    }
    if (text.includes('junior') || text.includes('jr.') || text.includes('entry') || text.includes('graduate') || text.includes('0-2 years') || text.includes('1-2 years')) {
      return 'junior';
    }
    if (text.includes('intern') || text.includes('co-op') || text.includes('student')) {
      return 'entry';
    }
    return 'mid'; // Default
  }

  /**
   * Determine application type from URL
   */
  private determineApplicationType(applyUrl: string, source: string): string {
    if (!applyUrl) return 'direct';

    const url = applyUrl.toLowerCase();
    if (url.includes('linkedin.com/jobs/apply') || url.includes('linkedin.com/easy-apply')) {
      return 'linkedin-easy';
    }
    if (url.includes('indeed.com/apply') || url.includes('indeed.com/jobs/')) {
      return 'indeed-apply';
    }
    if (url.includes('greenhouse.io') || url.includes('boards.greenhouse.io')) {
      return 'greenhouse';
    }
    if (url.includes('lever.co') || url.includes('jobs.lever.co')) {
      return 'lever';
    }
    if (url.includes('workday') || url.includes('myworkdayjobs')) {
      return 'workday';
    }
    if (url.includes('icims.com')) {
      return 'icims';
    }
    if (url.includes('smartrecruiters.com')) {
      return 'smartrecruiters';
    }
    if (url.includes('bamboohr.com')) {
      return 'bamboohr';
    }
    if (url.includes('taleo.net')) {
      return 'taleo';
    }
    if (url.includes('jobvite.com')) {
      return 'jobvite';
    }

    // Check if it's a company domain (likely company portal)
    try {
      const hostname = new URL(applyUrl).hostname;
      if (!['linkedin.com', 'indeed.com', 'glassdoor.com', 'ziprecruiter.com'].some(d => hostname.includes(d))) {
        return 'company-portal';
      }
    } catch {
      // Ignore URL parse errors
    }

    return 'direct';
  }

  /**
   * Detect ATS platform from apply URL
   */
  private detectATSPlatform(applyUrl?: string): string | undefined {
    if (!applyUrl) return undefined;

    const url = applyUrl.toLowerCase();
    if (url.includes('greenhouse.io') || url.includes('boards.greenhouse.io')) return 'greenhouse';
    if (url.includes('lever.co') || url.includes('jobs.lever.co')) return 'lever';
    if (url.includes('workday') || url.includes('myworkdayjobs')) return 'workday';
    if (url.includes('icims.com')) return 'icims';
    if (url.includes('smartrecruiters.com')) return 'smartrecruiters';
    if (url.includes('bamboohr.com')) return 'bamboohr';
    if (url.includes('taleo.net')) return 'taleo';
    if (url.includes('jobvite.com')) return 'jobvite';
    if (url.includes('oracle.com') || url.includes('taleo')) return 'oracle';
    if (url.includes('sap.com') || url.includes('successfactors')) return 'sap';

    return undefined;
  }

  /**
   * Get job statistics
   */
  async getStats(): Promise<{
    total: number;
    bySource: Record<string, number>;
    byCity: Record<string, number>;
    byJobType: Record<string, number>;
    byExperienceLevel: Record<string, number>;
    recentCount: number;
  }> {
    const [total, bySource, byCity, byJobType, byExperienceLevel, recentCount] = await Promise.all([
      JobPosting.countDocuments({ isActive: true }),
      JobPosting.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$source', count: { $sum: 1 } } },
      ]),
      JobPosting.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$location.city', count: { $sum: 1 } } },
      ]),
      JobPosting.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$jobType', count: { $sum: 1 } } },
      ]),
      JobPosting.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$experienceLevel', count: { $sum: 1 } } },
      ]),
      JobPosting.countDocuments({
        isActive: true,
        postedDate: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      }),
    ]);

    return {
      total,
      bySource: Object.fromEntries(bySource.map((s: any) => [s._id, s.count])),
      byCity: Object.fromEntries(byCity.map((s: any) => [s._id, s.count])),
      byJobType: Object.fromEntries(byJobType.map((s: any) => [s._id, s.count])),
      byExperienceLevel: Object.fromEntries(byExperienceLevel.map((s: any) => [s._id, s.count])),
      recentCount,
    };
  }
}

export const jobScraperService = new JobScraperService();
export default jobScraperService;