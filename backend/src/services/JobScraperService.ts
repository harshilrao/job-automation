import { JobPosting } from '../models/JobPosting';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { sleep, retry, parseSalary, uniqueByFn } from '../utils/helpers';
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

    // Scrape from each source using Python JobSpy
    for (const source of cfg.sources) {
      console.log(`[SCRAPER] Starting scrape for source: ${source}`);
      try {
        const jobs = await this.scrapeSource(source, cfg);
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

    // Deduplicate jobs
    const uniqueJobs = this.deduplicateJobs(allJobs);
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
            'companyUrl': '',
            'jobLevel': '',
            'jobFunction': '',
            'industry': str(row.get('company_industry', '')),
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
   * Deduplicate jobs based on title, company, and location
   */
  private deduplicateJobs(jobs: JobPost[]): JobPost[] {
    return uniqueByFn(jobs, (job) => {
      const title = job.title?.toLowerCase().trim() || '';
      const company = job.company?.toLowerCase().trim() || '';
      const location = job.location?.toLowerCase().trim() || '';
      return `${title}|${company}|${location}`;
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
        const existing = await JobPosting.findOne({
          source: job.source,
          externalId: job.id,
        });

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
      title: job.title,
      company: job.company,
      companyLogo: job.companyLogo,
      location: {
        city: this.extractCity(job.location),
        province: 'ON',
        country: 'Canada',
        remote: job.isRemote || false,
        hybrid: job.location?.toLowerCase().includes('hybrid') || false,
      },
      description: job.description,
      requirements: this.extractRequirements(job.description),
      responsibilities: [],
      skills: this.extractSkills(job.description),
      salaryMin: min,
      salaryMax: max,
      salaryCurrency: currency || 'CAD',
      jobType: this.normalizeJobType(job.jobType),
      experienceLevel: this.guessExperienceLevel(job.title, job.description),
      industry: job.industry,
      department: job.jobFunction,
      postedDate: job.datePosted || new Date(),
      applicationUrl: job.applyUrl || job.jobUrl,
      applicationType: this.determineApplicationType(job.applyUrl, job.source),
      atsPlatform: this.detectATSPlatform(job.applyUrl),
      scrapedAt: new Date(),
      lastUpdated: new Date(),
      isActive: true,
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
    existing.location = {
      city: this.extractCity(job.location),
      province: 'ON',
      country: 'Canada',
      remote: job.isRemote || false,
      hybrid: job.location?.toLowerCase().includes('hybrid') || false,
    };
    existing.description = job.description;
    existing.requirements = this.extractRequirements(job.description);
    existing.skills = this.extractSkills(job.description);
    existing.salaryMin = min;
    existing.salaryMax = max;
    existing.salaryCurrency = currency || 'CAD';
    existing.jobType = this.normalizeJobType(job.jobType);
    existing.experienceLevel = this.guessExperienceLevel(job.title, job.description);
    existing.industry = job.industry;
    existing.department = job.jobFunction;
    existing.postedDate = job.datePosted || existing.postedDate;
    existing.applicationUrl = job.applyUrl || job.jobUrl;
    existing.applicationType = this.determineApplicationType(job.applyUrl, job.source);
    existing.atsPlatform = this.detectATSPlatform(job.applyUrl);
    existing.lastUpdated = new Date();
    existing.isActive = true;
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