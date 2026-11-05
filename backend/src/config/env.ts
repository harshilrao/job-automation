import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

interface Config {
  // MongoDB
  mongodb: {
    uri: string;
    dbName: string;
  };

  // Server
  server: {
    port: number;
    nodeEnv: string;
    frontendUrl: string;
  };

  // JWT
  jwt: {
    secret: string;
    expiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
  };

  // free-claude-code
  freeClaude: {
    url: string;
    model: string;
  };

  // AI Providers
  ai: {
    openRouterApiKey?: string;
    groqApiKey?: string;
    groqModel?: string;
    anthropicApiKey?: string;
  };

  // Playwright
  playwright: {
    browser: string;
    headless: boolean;
    userDataDir: string;
    timeout: number;
  };

  // Encryption
  encryption: {
    key: string;
  };

  // Scheduling
  scheduling: {
    scraperCron: string;
    applicationCron: string;
  };

  // Email
  email: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
  };

  // Redis
  redis: {
    url: string;
  };

  // Logging
  logging: {
    level: string;
    file: string;
  };

  // Rate Limiting
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };

  // Ontario Job Search
  jobSearch: {
    cities: string[];
    sources: string[];
    searchTerms: string[];
  };
}

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue?: number): number {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a number`);
  }
  return parsed;
}

function getEnvBoolean(key: string, defaultValue?: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.toLowerCase() === 'true';
}

function getEnvArray(key: string, defaultValue?: string[]): string[] {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

export const config: Config = {
  mongodb: {
    uri: getEnv('MONGODB_URI'),
    dbName: getEnv('MONGODB_DB_NAME', 'job_automation'),
  },
  server: {
    port: getEnvNumber('PORT', 3000),
    nodeEnv: getEnv('NODE_ENV', 'development'),
    frontendUrl: getEnv('FRONTEND_URL', 'http://localhost:5173'),
  },
  jwt: {
    secret: getEnv('JWT_SECRET'),
    expiresIn: getEnv('JWT_EXPIRES_IN', '7d'),
    refreshSecret: getEnv('JWT_REFRESH_SECRET'),
    refreshExpiresIn: getEnv('JWT_REFRESH_EXPIRES_IN', '30d'),
  },
  freeClaude: {
    url: getEnv('FREE_CLAUDE_URL', 'http://localhost:8080'),
    model: getEnv('FREE_CLAUDE_MODEL', 'open_router/openrouter/free'),
  },
  ai: {
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    groqApiKey: process.env.GROQ_API_KEY,
    groqModel: getEnv('GROQ_MODEL', 'openai/gpt-oss-120b'),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  },
  playwright: {
    browser: getEnv('PLAYWRIGHT_BROWSER', 'chromium'),
    headless: getEnvBoolean('PLAYWRIGHT_HEADLESS', false),
    userDataDir: getEnv('PLAYWRIGHT_USER_DATA_DIR', './browser-profile'),
    timeout: getEnvNumber('PLAYWRIGHT_TIMEOUT', 60000),
  },
  encryption: {
    key: getEnv('ENCRYPTION_KEY'),
  },
  scheduling: {
    scraperCron: getEnv('SCRAPER_CRON', '0 */2 * * *'),
    applicationCron: getEnv('APPLICATION_CRON', '0 9 * * 1-5'),
  },
  email: {
    host: getEnv('SMTP_HOST', 'smtp.gmail.com'),
    port: getEnvNumber('SMTP_PORT', 587),
    user: getEnv('SMTP_USER', ''),
    pass: getEnv('SMTP_PASS', ''),
    from: getEnv('EMAIL_FROM', 'Job Automation <noreply@jobautomation.com>'),
  },
  redis: {
    url: getEnv('REDIS_URL', 'redis://localhost:6379'),
  },
  logging: {
    level: getEnv('LOG_LEVEL', 'info'),
    file: getEnv('LOG_FILE', './logs/app.log'),
  },
  rateLimit: {
    windowMs: getEnvNumber('RATE_LIMIT_WINDOW_MS', 900000),
    maxRequests: getEnvNumber('RATE_LIMIT_MAX_REQUESTS', 100),
  },
  jobSearch: {
    cities: getEnvArray('ONTARIO_CITIES', ['Toronto']),
    sources: getEnvArray('JOB_SOURCES', ['indeed', 'linkedin', 'glassdoor', 'ziprecruiter']),
    searchTerms: getEnvArray('JOB_SEARCH_TERMS', [
      'it support', 'help desk', 'technical support', 'desktop support',
      'system administrator', 'network administrator'
    ]),
  },
};

export default config;