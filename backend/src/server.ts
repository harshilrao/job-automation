import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { config } from './config/env';
import { logger } from './utils/logger';
import { applicationOrchestrator } from './services/ApplicationOrchestrator';
import { jobScraperService } from './services/JobScraperService';
import cron from 'node-cron';

const app = createApp();

let server: any;

async function startServer(): Promise<void> {
  try {
    // Connect to database
    await connectDatabase();

    // Initialize application orchestrator
    // In production, you'd load user credentials from secure storage
    await applicationOrchestrator.initialize();

    // Start HTTP server
    server = app.listen(config.server.port, () => {
      logger.info(`Server running on port ${config.server.port}`);
      logger.info(`Environment: ${config.server.nodeEnv}`);
      logger.info(`Frontend URL: ${config.server.frontendUrl}`);
    });

    // Schedule job scraping
    if (config.scheduling.scraperCron) {
      cron.schedule(config.scheduling.scraperCron, async () => {
        logger.info('Running scheduled job scrape');
        try {
          // In production, get active user IDs and run for each
          const result = await jobScraperService.scrapeAllJobs();
          logger.info('Scheduled scrape completed', { totalFound: result.meta.totalFound });
        } catch (error: any) {
          logger.error('Scheduled scrape failed:', error);
        }
      }, {
        scheduled: true,
        timezone: 'America/Toronto',
      });
      logger.info(`Job scraper scheduled: ${config.scheduling.scraperCron}`);
    }

    // Schedule application processing (weekdays 9 AM)
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
      logger.info(`Application processor scheduled: ${config.scheduling.applicationCron}`);
    }

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully...`);

      // Stop accepting new connections
      if (server) {
        server.close(async () => {
          logger.info('HTTP server closed');

          // Close browser
          await applicationOrchestrator.close();

          // Disconnect database
          await disconnectDatabase();

          logger.info('Shutdown complete');
          process.exit(0);
        });

        // Force close after 30 seconds
        setTimeout(() => {
          logger.error('Force shutdown after timeout');
          process.exit(1);
        }, 30000);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      shutdown('UNCAUGHT_EXCEPTION');
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection:', reason);
    });

  } catch (error: any) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

export { app, server };