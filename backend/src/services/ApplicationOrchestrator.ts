import { JobScraperService } from './JobScraperService';
import { AIResumeGenerator } from './AIResumeGenerator';
import { BrowserAutomationService } from './BrowserAutomationService';
import { JobPosting } from '../models/JobPosting';
import { UserProfile } from '../models/UserProfile';
import { GeneratedResume } from '../models/GeneratedResume';
import { CoverLetter } from '../models/CoverLetter';
import { ApplicationRecord } from '../models/ApplicationRecord';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { sleep, encrypt, decrypt } from '../utils/helpers';
import { ApplicationRecord as IApplicationRecord } from '../models/ApplicationRecord';
import * as fs from 'fs';
import * as path from 'path';

export interface ApplicationJob {
  jobPostingId: string;
  userId: string;
  priority: number;
  scheduledAt?: Date;
  resumeOptions?: {
    tone?: 'professional' | 'enthusiastic' | 'concise' | 'storytelling';
    focusKeywords?: string[];
  };
  coverLetterOptions?: {
    tone?: 'professional' | 'enthusiastic' | 'concise' | 'storytelling';
  };
}

export interface OrchestratorStats {
  queueLength: number;
  processing: number;
  completed: number;
  failed: number;
  humanInterventionRequired: number;
}

export class ApplicationOrchestrator {
  private jobScraper: JobScraperService;
  private aiGenerator: AIResumeGenerator;
  private browserAutomation: BrowserAutomationService;
  private jobQueue: ApplicationJob[] = [];
  private isProcessing = false;
  private processingJob: ApplicationJob | null = null;
  private stats: OrchestratorStats = {
    queueLength: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    humanInterventionRequired: 0,
  };

  constructor() {
    this.jobScraper = new JobScraperService();
    this.aiGenerator = new AIResumeGenerator();
    this.browserAutomation = new BrowserAutomationService();
  }

  /**
   * Initialize the orchestrator
   */
  async initialize(userCredentials?: any): Promise<void> {
    await this.browserAutomation.initialize(userCredentials);
    logger.info('Application Orchestrator initialized');
  }

  /**
   * Add job to application queue
   */
  async addToQueue(job: ApplicationJob): Promise<void> {
    // Check if already applied
    const alreadyApplied = await ApplicationRecord.hasApplied(job.userId, job.jobPostingId as any);
    if (alreadyApplied) {
      logger.info('Already applied to this job, skipping', { jobPostingId: job.jobPostingId });
      return;
    }

    // Check if in queue
    const inQueue = this.jobQueue.some(j => j.jobPostingId === job.jobPostingId && j.userId === job.userId);
    if (inQueue) {
      logger.info('Job already in queue', { jobPostingId: job.jobPostingId });
      return;
    }

    this.jobQueue.push(job);
    this.jobQueue.sort((a, b) => b.priority - a.priority); // Higher priority first
    this.stats.queueLength = this.jobQueue.length;

    logger.info('Job added to queue', { jobPostingId: job.jobPostingId, queueLength: this.stats.queueLength });
  }

  /**
   * Add multiple jobs to queue
   */
  async addMultipleToQueue(jobs: ApplicationJob[]): Promise<number> {
    let added = 0;
    for (const job of jobs) {
      await this.addToQueue(job);
      added++;
    }
    return added;
  }

  /**
   * Process the application queue
   */
  async processQueue(): Promise<void> {
    if (this.isProcessing) {
      logger.warn('Queue already processing');
      return;
    }

    this.isProcessing = true;
    logger.info('Starting queue processing', { queueLength: this.jobQueue.length });

    while (this.jobQueue.length > 0) {
      const job = this.jobQueue.shift()!;
      this.processingJob = job;
      this.stats.processing = 1;
      this.stats.queueLength = this.jobQueue.length;

      try {
        await this.processApplication(job);
        this.stats.completed++;
      } catch (error: any) {
        logger.error('Failed to process application:', error);
        this.stats.failed++;
      } finally {
        this.processingJob = null;
        this.stats.processing = 0;
        // Delay between applications to avoid rate limiting
        await sleep(5000);
      }
    }

    this.isProcessing = false;
    logger.info('Queue processing complete', this.stats);
  }

  /**
   * Process a single application
   */
  private async processApplication(job: ApplicationJob): Promise<void> {
    const { jobPostingId, userId } = job;

    logger.info('Processing application', { jobPostingId, userId });

    // Create application record
    const applicationRecord = await ApplicationRecord.create({
      userId,
      jobPostingId,
      resumeId: '' as any, // Will be updated
      status: 'in-progress',
      applicationUrl: '', // Will be updated
      applicationMethod: 'automated',
      submissionData: { formFields: {}, screenshots: [] },
      errorLog: [],
      humanInterventionRequired: false,
    });

    try {
      // Get job posting
      const jobPosting = await JobPosting.findById(jobPostingId);
      if (!jobPosting) {
        throw new Error('Job posting not found');
      }

      // Update application record with URL
      applicationRecord.applicationUrl = jobPosting.applicationUrl;
      applicationRecord.atsPlatform = jobPosting.atsPlatform;
      await applicationRecord.save();

      // Get user profile
      const userProfile = await UserProfile.findOne({ userId });
      if (!userProfile) {
        throw new Error('User profile not found');
      }

      // Generate resume
      logger.info('Generating resume', { jobPostingId });
      const resumeResult = await this.aiGenerator.generateResume(
        userProfile.toObject(),
        jobPosting.toObject(),
        job.resumeOptions
      );

      // Save generated resume
      const generatedResume = await GeneratedResume.createNewVersion(
        userId,
        jobPosting._id,
        this.parseResumeContent(resumeResult.content),
        resumeResult.model,
        resumeResult.provider
      );

      // Update with ATS analysis
      generatedResume.atsScore = resumeResult.atsAnalysis.score;
      generatedResume.atsAnalysis = resumeResult.atsAnalysis;
      generatedResume.status = 'approved';
      await generatedResume.save();

      // Update application record
      applicationRecord.resumeId = generatedResume._id;
      await applicationRecord.save();

      // Generate cover letter
      logger.info('Generating cover letter', { jobPostingId });
      const coverLetterResult = await this.aiGenerator.generateCoverLetter(
        userProfile.toObject(),
        jobPosting.toObject(),
        resumeResult.content,
        job.coverLetterOptions
      );

      // Save cover letter
      const coverLetter = await CoverLetter.createNewVersion(
        userId,
        jobPosting._id,
        generatedResume._id,
        coverLetterResult.content,
        coverLetterResult.model,
        coverLetterResult.provider,
        job.coverLetterOptions?.tone || 'professional'
      );

      coverLetter.status = 'approved';
      await coverLetter.save();

      applicationRecord.coverLetterId = coverLetter._id;
      await applicationRecord.save();

      // Apply via browser automation
      logger.info('Starting browser automation', { jobPostingId });
      const applicationResult = await this.browserAutomation.fillAndSubmitApplication(
        await this.browserAutomation.analyzeApplicationForm(jobPosting.applicationUrl),
        userProfile.toObject(),
        undefined, // resumePath - would need to generate PDF
        undefined  // coverLetterPath - would need to generate PDF
      );

      // Update application record with result
      applicationRecord.status = applicationResult.success ? 'submitted' : 'failed';
      applicationRecord.appliedAt = applicationResult.success ? new Date() : undefined;
      applicationRecord.submissionData = {
        formFields: {},
        screenshots: applicationResult.screenshots,
        confirmationNumber: applicationResult.confirmationNumber,
        confirmationEmail: applicationResult.confirmationEmail,
      };
      applicationRecord.errorLog = applicationResult.errorLog;
      applicationRecord.humanInterventionRequired = applicationResult.humanInterventionRequired;
      applicationRecord.interventionReason = applicationResult.interventionReason;

      if (applicationResult.humanInterventionRequired) {
        this.stats.humanInterventionRequired++;
        applicationRecord.status = 'pending'; // Mark as pending for human review
      }

      await applicationRecord.save();

      logger.info('Application processed', {
        jobPostingId,
        success: applicationResult.success,
        humanInterventionRequired: applicationResult.humanInterventionRequired,
      });

    } catch (error: any) {
      logger.error('Application processing failed:', error);

      applicationRecord.status = 'failed';
      applicationRecord.errorLog.push({
        step: 'processing',
        error: error.message,
        timestamp: new Date(),
        resolved: false,
      });
      applicationRecord.humanInterventionRequired = true;
      applicationRecord.interventionReason = error.message;
      this.stats.humanInterventionRequired++;

      await applicationRecord.save();
    }
  }

  /**
   * Parse resume content string into structured object
   */
  private parseResumeContent(content: string): any {
    // This is a simplified parser - in production, use a more robust approach
    // or have the AI return structured JSON directly
    return {
      professionalSummary: this.extractSection(content, 'Professional Summary'),
      skills: {
        technical: this.extractListItems(content, 'Technical Skills'),
        soft: this.extractListItems(content, 'Soft Skills'),
      },
      experience: this.extractExperience(content),
      education: this.extractEducation(content),
      projects: this.extractProjects(content),
      keywords: this.extractListItems(content, 'Keywords'),
    };
  }

  private extractSection(content: string, sectionName: string): string {
    const regex = new RegExp(`${sectionName}[:\\n]([\\s\\S]*?)(?=\\n[A-Z][a-z]+:|$)`, 'i');
    const match = content.match(regex);
    return match ? match[1].trim() : '';
  }

  private extractListItems(content: string, sectionName: string): string[] {
    const section = this.extractSection(content, sectionName);
    return section
      .split('\n')
      .map(line => line.replace(/^[-•*]\s*/, '').trim())
      .filter(line => line.length > 0);
  }

  private extractExperience(content: string): any[] {
    // Simplified - would need better parsing
    return [];
  }

  private extractEducation(content: string): any[] {
    return [];
  }

  private extractProjects(content: string): any[] {
    return [];
  }

  /**
   * Get queue status
   */
  getQueueStatus(): {
    queue: ApplicationJob[];
    processing: ApplicationJob | null;
    stats: OrchestratorStats;
  } {
    return {
      queue: this.jobQueue,
      processing: this.processingJob,
      stats: this.stats,
    };
  }

  /**
   * Get applications needing human intervention
   */
  async getNeedingIntervention(userId: string): Promise<any[]> {
    return ApplicationRecord.getNeedingIntervention(userId);
  }

  /**
   * Retry failed application
   */
  async retryApplication(applicationId: string): Promise<void> {
    const record = await ApplicationRecord.findById(applicationId);
    if (!record) {
      throw new Error('Application record not found');
    }

    // Reset status
    record.status = 'pending';
    record.humanInterventionRequired = false;
    record.interventionReason = undefined;
    record.errorLog = [];
    await record.save();

    // Re-add to queue
    await this.addToQueue({
      jobPostingId: record.jobPostingId.toString(),
      userId: record.userId,
      priority: 100, // High priority for retries
    });
  }

  /**
   * Search and queue jobs automatically
   */
  async searchAndQueueJobs(
    userId: string,
    filters: {
      searchTerm?: string;
      cities?: string[];
      jobTypes?: string[];
      experienceLevels?: string[];
      maxApplications?: number;
    } = {}
  ): Promise<number> {
    // Search for jobs
    const jobs = await JobPosting.findByFilters({
      searchTerm: filters.searchTerm,
      cities: filters.cities,
      jobTypes: filters.jobTypes,
      experienceLevels: filters.experienceLevels,
      postedWithinHours: 72, // Last 3 days
      remoteOnly: false,
      hybridOnly: false,
    }).limit(filters.maxApplications || 10);

    // Add to queue
    const applicationJobs: ApplicationJob[] = jobs.map((job, index) => ({
      jobPostingId: job._id.toString(),
      userId,
      priority: 100 - index, // Higher priority for better matches
    }));

    return this.addMultipleToQueue(applicationJobs);
  }

  /**
   * Scheduled job scraping and queueing
   */
  async scheduledScrapeAndQueue(userId: string): Promise<void> {
    logger.info('Running scheduled scrape and queue', { userId });

    // Scrape new jobs
    const result = await this.jobScraper.scrapeAllJobs();
    logger.info('Scheduled scrape completed', { totalFound: result.meta.totalFound });

    // Queue top matches
    await this.searchAndQueueJobs(userId, {
      maxApplications: 5,
    });
  }

  /**
   * Close orchestrator
   */
  async close(): Promise<void> {
    await this.browserAutomation.close();
    logger.info('Application Orchestrator closed');
  }
}

export const applicationOrchestrator = new ApplicationOrchestrator();
export default applicationOrchestrator;