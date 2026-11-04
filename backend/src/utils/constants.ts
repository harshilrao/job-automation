/**
 * Application constants
 */

export const ONTARIO_CITIES = [
  'Toronto',
  'Ottawa',
  'Mississauga',
  'Brampton',
  'Hamilton',
  'London',
  'Markham',
  'Vaughan',
  'Windsor',
  'Kitchener',
  'Oakville',
  'Richmond Hill',
  'Burlington',
  'Oshawa',
  'Barrie',
  'Guelph',
  'St. Catharines',
  'Kingston',
  'Peterborough',
  'Waterloo',
  'Cambridge',
  'Thunder Bay',
  'Sudbury',
  'Belleville',
  'Sarnia',
  'Cornwall',
  'Timmins',
  'North Bay',
  'Sault Ste. Marie',
] as const;

export const JOB_TYPES = [
  'full-time',
  'part-time',
  'contract',
  'internship',
  'temporary',
  'freelance',
] as const;

export const EXPERIENCE_LEVELS = [
  'entry',
  'junior',
  'mid',
  'senior',
  'lead',
  'principal',
  'executive',
] as const;

export const INDUSTRIES = [
  'Technology',
  'Financial Services',
  'Healthcare',
  'Manufacturing',
  'Retail',
  'Education',
  'Government',
  'Consulting',
  'Telecommunications',
  'Media & Entertainment',
  'Real Estate',
  'Transportation',
  'Energy',
  'Non-profit',
  'Hospitality',
  'Construction',
  'Automotive',
  'Aerospace',
  'Biotechnology',
  'E-commerce',
] as const;

export const DEPARTMENTS = [
  'Engineering',
  'Product',
  'Design',
  'Data Science',
  'DevOps/Infrastructure',
  'QA/Testing',
  'Security',
  'Management',
  'Sales',
  'Marketing',
  'Customer Success',
  'Operations',
  'HR',
  'Finance',
  'Legal',
  'IT Support',
  'Research',
] as const;

export const JOB_SOURCES = [
  'indeed',
  'linkedin',
  'glassdoor',
  'ziprecruiter',
  'jobbank',
  'google',
  'company',
] as const;

export const APPLICATION_STATUSES = [
  'pending',
  'in-progress',
  'submitted',
  'failed',
  'rejected',
  'interview',
  'offer',
  'withdrawn',
] as const;

export const ATS_PLATFORMS = [
  'greenhouse',
  'lever',
  'workday',
  'icims',
  'smartrecruiters',
  'bamboohr',
  'taleo',
  'jobvite',
  'oracle',
  'sap',
  'custom',
  'unknown',
] as const;

export const AI_MODELS = {
  FREE_CLAUDE: 'free-claude',
  OPENROUTER_FREE: 'openrouter/free',
  GROQ_LLAMA: 'groq/llama-3.3-70b-versatile',
  NVIDIA_NEMOTRON: 'nvidia_nim/nvidia/nemotron-3-ultra-550b-a55b',
  GEMINI_FLASH: 'gemini/models/gemini-3.1-flash-lite',
  DEEPSEEK: 'deepseek/deepseek-chat',
} as const;

export const RESUME_SECTIONS = [
  'professionalSummary',
  'skills',
  'experience',
  'education',
  'projects',
  'certifications',
  'languages',
  'publications',
] as const;

export const COVER_LETTER_TONES = [
  'professional',
  'enthusiastic',
  'concise',
  'storytelling',
] as const;

export const SCRAPER_DEFAULTS = {
  RESULTS_WANTED: 50,
  HOURS_OLD: 72,
  COUNTRY_INDEED: 'Canada',
  RATE_LIMIT_DELAY: 2000,
  MAX_RETRIES: 3,
} as const;

export const BROWSER_AUTOMATION = {
  TIMEOUT: 60000,
  NAVIGATION_TIMEOUT: 30000,
  ELEMENT_TIMEOUT: 10000,
  SCREENSHOT_QUALITY: 80,
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
} as const;

export const ATS_KEYWORDS_CATEGORIES = {
  TECHNICAL_SKILLS: 'technical_skills',
  SOFT_SKILLS: 'soft_skills',
  CERTIFICATIONS: 'certifications',
  TOOLS: 'tools',
  METHODOLOGIES: 'methodologies',
  DOMAIN_KNOWLEDGE: 'domain_knowledge',
} as const;

export const NOTIFICATION_TYPES = [
  'application_submitted',
  'application_failed',
  'interview_scheduled',
  'offer_received',
  'rejection_received',
  'new_job_match',
  'resume_generated',
  'cover_letter_generated',
] as const;

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  SCRAPER_ERROR: 'SCRAPER_ERROR',
  AI_GENERATION_ERROR: 'AI_GENERATION_ERROR',
  BROWSER_AUTOMATION_ERROR: 'BROWSER_AUTOMATION_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  // Auth-specific errors
  EMAIL_EXISTS: 'EMAIL_EXISTS',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  REFRESH_TOKEN_REQUIRED: 'REFRESH_TOKEN_REQUIRED',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  INVALID_RESET_TOKEN: 'INVALID_RESET_TOKEN',
  INVALID_VERIFICATION_TOKEN: 'INVALID_VERIFICATION_TOKEN',
} as const;