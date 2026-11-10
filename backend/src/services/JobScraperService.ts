import { JobPosting } from '../models/JobPosting';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { sleep, retry, parseSalary, uniqueByFn, normalizeUrl, normalizeEmployerName, canonicalJobKey } from '../utils/helpers';
import { ONTARIO_CITIES, SCRAPER_DEFAULTS, JOB_SOURCES } from '../utils/constants';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

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
  applicationStatus?: 'active' | 'expired' | 'filled';
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

  /**
   * Scrape jobs from all configured sources for Ontario
   */
  async scrapeAllJobs(customConfig?: Partial<ScraperConfig>): Promise<ScraperResult> {
    const cfg = { ...this.defaultConfig, ...customConfig };
    const startTime = Date.now();
    const allJobs: JobPost[] = [];
    const errors: Record<string, string> = {};

    console.log('[SCRAPER] scrapeAllJobs started', {
      sources: cfg.sources,
      locations: cfg.locations,
      searchTerms: cfg.searchTerms,
      resultsWanted: cfg.resultsWanted,
      hoursOld: cfg.hoursOld,
    });

    // Scrape from each source
    for (const source of cfg.sources) {
      console.log(`[SCRAPER] Starting scrape for source: ${source}`);
      try {
        let jobs: JobPost[];
        if (source === 'company') {
          // Company career websites aren't a JobSpy site; scrape them directly
          jobs = await this.scrapeCompanyCareers({ searchTerms: cfg.searchTerms });
        } else {
          jobs = await this.scrapeSource(source, cfg);
        }
        console.log(`[SCRAPER] Source ${source} returned ${jobs.length} jobs`);
        allJobs.push(...jobs);
        await sleep(SCRAPER_DEFAULTS.RATE_LIMIT_DELAY);
      } catch (error: any) {
        console.error(`[SCRAPER] Source ${source} FAILED:`, error.message);
        errors[source] = error.message;
      }
    }

    // Also try Job Bank CSV (Government of Canada)
    console.log('[SCRAPER] Starting Job Bank CSV scrape');
    try {
      const jobBankJobs = await this.scrapeJobBank();
      console.log(`[SCRAPER] Job Bank returned ${jobBankJobs.length} jobs`);
      allJobs.push(...jobBankJobs);
    } catch (error: any) {
      console.error('[SCRAPER] Job Bank FAILED:', error.message);
      errors['jobbank'] = error.message;
    }

    console.log(`[SCRAPER] Total raw jobs collected: ${allJobs.length}`);

    // Resolve original employer postings for aggregator-sourced jobs.
    // Uses the original employer posting as the preferred authoritative source.
    console.log('[SCRAPER] Resolving original employer postings...');
    const resolvedJobs = await this.resolveOriginalPostings(allJobs);
    console.log(`[SCRAPER] Resolution complete.`);

    // Deduplicate jobs using canonical URL or normalized employer+title
    const uniqueJobs = this.deduplicateJobs(resolvedJobs);
    console.log(`[SCRAPER] After dedup: ${uniqueJobs.length} unique jobs`);

    // Save to database
    console.log('[SCRAPER] Saving jobs to database...');
    const savedCount = await this.saveJobs(uniqueJobs);
    console.log(`[SCRAPER] Saved ${savedCount} new jobs to database`);

    const duration = Date.now() - startTime;
    console.log('[SCRAPER] scrapeAllJobs completed', {
      duration,
      totalRaw: allJobs.length,
      uniqueJobs: uniqueJobs.length,
      saved: savedCount,
      errors: Object.keys(errors),
    });

    return {
      jobs: uniqueJobs,
      errors,
      meta: {
        duration,
        sources: cfg.sources,
        totalFound: uniqueJobs.length,
      },
    };
  }

  /**
   * Scrape jobs from a specific source using Python JobSpy via subprocess
   */
  private async scrapeSource(source: string, config: ScraperConfig): Promise<JobPost[]> {
    const allJobs: JobPost[] = [];

    console.log(`[SCRAPER:${source}] Starting scrapeSource with ${config.locations.length} locations x ${config.searchTerms.length} search terms`);

    for (const location of config.locations) {
      for (const searchTerm of config.searchTerms) {
        console.log(`[SCRAPER:${source}] Scraping "${searchTerm}" in "${location}"`);
        try {
          const jobs = await retry(
            () => this.runPythonJobSpy(source, searchTerm, location, config),
            { maxAttempts: SCRAPER_DEFAULTS.MAX_RETRIES }
          );

          if (jobs && jobs.length > 0) {
            console.log(`[SCRAPER:${source}] Found ${jobs.length} jobs for "${searchTerm}" in "${location}"`);
            allJobs.push(...jobs);
          } else {
            console.log(`[SCRAPER:${source}] No jobs found for "${searchTerm}" in "${location}"`);
          }
        } catch (error: any) {
          console.error(`[SCRAPER:${source}] Failed for "${searchTerm}" in "${location}":`, error.message);
        }

        // Small delay between searches
        await sleep(500);
      }
    }

    console.log(`[SCRAPER:${source}] Total from this source: ${allJobs.length} jobs`);
    return allJobs;
  }

  /**
   * Run Python JobSpy script via subprocess
   */
  private runPythonJobSpy(
    source: string,
    searchTerm: string,
    location: string,
    config: ScraperConfig
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

      const siteName = siteMap[source] || source;

      console.log(`[SCRAPER:${source}] Spawning Python JobSpy for "${searchTerm}" in "${location}" (site: ${siteName})`);

      // Python script to run JobSpy
      const pythonScript = `
import sys
import json
import math
from jobspy import scrape_jobs

def safe_float(val):
    try:
        f = float(val)
        return f if not math.isnan(f) else None
    except (TypeError, ValueError):
        return None

try:
    jobs = scrape_jobs(
        site_name=["${siteName}"],
        search_term="${searchTerm.replace(/"/g, '\\"')}",
        location="${location.replace(/"/g, '\\"')}, ON, Canada",
        results_wanted=${config.resultsWanted},
        hours_old=${config.hoursOld},
        country_indeed="${config.countryIndeed}",
    )

    # Convert to list of dicts
    result = []
    for _, row in jobs.iterrows():
        job = {
            'id': f"${source}-{row.get('job_id', '')}",
            'title': str(row.get('title', '')),
            'company': str(row.get('company', '')),
            'location': str(row.get('location', '')),
            'description': str(row.get('description', '')),
            'jobUrl': str(row.get('job_url', '')),
            'applyUrl': str(row.get('job_url', '')),
            'source': "${source}",
            'datePosted': str(row.get('date_posted', '')) if row.get('date_posted') else '',
            'salary': {
                'min': safe_float(row.get('min_amount', 0)),
                'max': safe_float(row.get('max_amount', 0)),
                'currency': str(row.get('currency', 'CAD')) if row.get('currency') else 'CAD',
                'type': str(row.get('interval', 'yearly')) if row.get('interval') else 'yearly',
            },
            'jobType': str(row.get('job_type', '')),
            'isRemote': bool(row.get('is_remote', False)),
            'employmentType': str(row.get('job_type', '')),
            'companyLogo': '',
            'companyUrl': str(row.get('company_url', '')),
            'jobLevel': '',
            'jobFunction': '',
            'industry': str(row.get('company_industry', '')),
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

      const pythonProcess = spawn('python', ['-c', pythonScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60000, // 60 second timeout
      });

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      pythonProcess.on('close', (code) => {
        console.log(`[SCRAPER:${source}] Python process exited with code ${code}`, {
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
        });

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

      pythonProcess.on('error', (err) => {
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

        // Must have a career keyword in href or text
        const hasKeyword = careerKeywords.some(k => hrefLower.includes(k) || textLower.includes(k));
        if (!hasKeyword) return { ...link, score: 0 };

        try {
          const linkUrl = new URL(link.href, jobUrl);
          const linkHost = linkUrl.hostname.toLowerCase();

          // Skip aggregators
          if (this.AGGREGATOR_DOMAINS.some(d => linkHost === d || linkHost.endsWith(`.${d}`))) {
            return { ...link, score: 0 };
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

          return { ...link, score, url: linkUrl.href };
        } catch {
          return { ...link, score: 0 };
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
   * when they can be discovered. Failures are non-fatal.
   */
  private async resolveOriginalPostings(jobs: JobPost[]): Promise<JobPost[]> {
    const AGGREGATOR_SOURCES = new Set(['indeed', 'linkedin', 'glassdoor', 'ziprecruiter', 'google']);
    const resolved: JobPost[] = [];

    for (const job of jobs) {
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
   * Save jobs to MongoDB
   */
  private async saveJobs(jobs: JobPost[]): Promise<number> {
    let saved = 0;
    let updated = 0;
    let skipped = 0;

    console.log(`[SCRAPER] saveJobs starting with ${jobs.length} jobs`);

    for (const job of jobs) {
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
        console.error(`[SCRAPER] Failed to save job ${job.id}:`, error.message);
      }
    }

    console.log(`[SCRAPER] saveJobs completed: saved=${saved}, updated=${updated}, skipped=${skipped}`);
    return saved;
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