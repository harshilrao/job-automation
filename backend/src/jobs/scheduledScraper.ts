import cron from 'node-cron';
import { jobScraperService } from '../services/JobScraperService';
import { applicationOrchestrator } from '../services/ApplicationOrchestrator';
import { config } from '../config/env';
import { logger } from '../utils/logger';

export function startScheduledJobs(): void {
  // Job scraping - every 2 hours by default
  if (config.scheduling.scraperCron) {
    cron.schedule(config.scheduling.scraperCron, async () => {
      logger.info('Running scheduled job scrape');
      try {
        const result = await jobScraperService.scrapeAllJobs();
        logger.info('Scheduled scrape completed', {
          totalFound: result.meta.totalFound,
          duration: result.meta.duration,
          errors: Object.keys(result.errors),
        });
      } catch (error: any) {
        logger.error('Scheduled scrape failed:', error);
      }
    }, {
      scheduled: true,
      timezone: 'America/Toronto',
    });
    logger.info(`Job scraper scheduled with cron: ${config.scheduling.scraperCron}`);
  }

  // Application queue processing - weekdays 9 AM by default
  if (config.scheduling.applicationCron) {
    cron.schedule(config.scheduling.applicationCron, async () => {
      logger.info('Processing application queue');
      try {
        await applicationOrchestrator.processQueue();
      } catch (error: any) {
        logger.error('Queue processing failed:', error);
      }
    }, {
      scheduled: true,
      timezone: 'America/Toronto',
    });
    logger.info(`Application processor scheduled with cron: ${config.scheduling.applicationCron}`);
  }

  // Daily stats logging at midnight
  cron.schedule('0 0 * * *', async () => {
    logger.info('Daily stats snapshot');
    try {
      const stats = await jobScraperService.getStats();
      logger.info('Daily job stats', stats);
    } catch (error: any) {
      logger.error('Daily stats failed:', error);
    }
  }, {
    scheduled: true,
    timezone: 'America/Toronto',
  });
}

export function stopScheduledJobs(): void {
  cron.getTasks().forEach(task => task.stop());
  logger.info('All scheduled jobs stopped');
}

// Manual trigger functions for testing
export async function triggerScrape(): Promise<void> {
  logger.info('Manual scrape triggered');
  try {
    const result = await jobScraperService.scrapeAllJobs();
    logger.info('Manual scrape completed', {
      totalFound: result.meta.totalFound,
      duration: result.meta.duration,
    });
  } catch (error: any) {
    logger.error('Manual scrape failed:', error);
    throw error;
  }
}

export async function triggerApplicationProcessing(): Promise<void> {
  logger.info('Manual application processing triggered');
  try {
    await applicationOrchestrator.processQueue();
  } catch (error: any) {
    logger.error('Manual application processing failed:', error);
    throw error;
  }
}