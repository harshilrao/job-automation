// Shared TypeScript types for the Job Automation System

// ============================================
// Base Types
// ============================================

export interface ApiError {
  error: string;
  code: string;
  details?: any;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ============================================
// User & Profile Types
// ============================================

export interface Address {
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
}

export interface PersonalInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: Address;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
}

export interface Experience {
  company: string;
  position: string;
  startDate: string;
  endDate?: string;
  current: boolean;
  description?: string[];
  technologies?: string[];
  location?: string;
}

export interface Education {
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startDate: string;
  endDate?: string;
  gpa?: string;
  honors?: string[];
}

export interface Project {
  name: string;
  description: string;
  technologies?: string[];
  url?: string;
  githubUrl?: string;
}

export interface Skills {
  technical: string[];
  soft: string[];
  languages?: string[];
  certifications?: string[];
}

export interface Preferences {
  desiredRoles?: string[];
  desiredLocations?: string[];
  salaryMin?: number;
  salaryMax?: number;
  jobTypes?: string[];
  industries?: string[];
  workAuthorization?: string;
  remoteOnly?: boolean;
  hybridOnly?: boolean;
}

export interface UserProfile {
  userId: string;
  personalInfo: PersonalInfo;
  professionalSummary: string;
  experience: Experience[];
  education: Education[];
  projects: Project[];
  skills: Skills;
  preferences: Preferences;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Job Posting Types
// ============================================

export interface JobLocation {
  city: string;
  province: string;
  country: string;
  remote: boolean;
  hybrid: boolean;
}

export interface JobPosting {
  _id: string;
  externalId: string;
  source: string;
  title: string;
  company: string;
  location: JobLocation;
  description: string;
  descriptionHtml?: string;
  requirements: string[];
  responsibilities: string[];
  skills: string[];
  jobType: string;
  experienceLevel: string;
  industry?: string;
  department?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency: string;
  salaryPeriod: string;
  applicationUrl: string;
  originalJobUrl?: string;
  companyCareerUrl?: string;
  applyEmail?: string;
  postedDate: string;
  scrapedAt: string;
  expiresAt?: string;
  isActive: boolean;
  matchScore?: number;
  atsPlatform?: string;
  atsFields?: Record<string, any>;
  benefits?: string[];
}

export interface FilterCriteria {
  searchTerm: string;
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

export interface JobStats {
  total: number;
  recentCount: number;
  bySource: Record<string, number>;
  byCity: Record<string, number>;
  byJobType: Record<string, number>;
  byExperienceLevel: Record<string, number>;
}

// ============================================
// Application Types
// ============================================

export type ApplicationStatus =
  | 'pending'
  | 'in-progress'
  | 'submitted'
  | 'failed'
  | 'rejected'
  | 'interview'
  | 'offer'
  | 'withdrawn';

export type ApplicationMethod = 'manual' | 'auto' | 'extension' | 'api';

export interface ApplicationErrorLog {
  step: string;
  error: string;
  timestamp: string;
  resolved?: boolean;
  details?: any;
}

export interface ApplicationSubmissionData {
  confirmationNumber?: string;
  submissionUrl?: string;
  formData?: Record<string, any>;
  screenshots?: string[];
}

export interface ApplicationRecord {
  _id: string;
  userId: string;
  jobPostingId: string | JobPosting;
  resumeId?: string;
  coverLetterId?: string;
  status: ApplicationStatus;
  applicationMethod: ApplicationMethod;
  atsPlatform?: string;
  appliedAt?: string;
  responseReceivedAt?: string;
  errorLog: ApplicationErrorLog[];
  submissionData?: ApplicationSubmissionData;
  notes?: string;
  requiresHumanIntervention: boolean;
  interventionReason?: string;
  retryCount: number;
  lastRetryAt?: string;
  createdAt: string;
  updatedAt: string;
  applicationUrl?: string;
}

export interface ApplicationStats {
  total: number;
  pending: number;
  'in-progress': number;
  submitted: number;
  failed: number;
  rejected: number;
  interview: number;
  offer: number;
  withdrawn: number;
}

// ============================================
// AI Generation Types
// ============================================

export interface ResumeContent {
  professionalSummary: string;
  skills: {
    technical: string[];
    soft: string[];
  };
  experience: Array<{
    company: string;
    position: string;
    startDate: string;
    endDate?: string;
    current: boolean;
    bullets: string[];
  }>;
  education: Array<{
    institution: string;
    degree: string;
    fieldOfStudy: string;
    highlights: string[];
  }>;
  projects: Array<{
    name: string;
    description: string;
    technologies: string[];
    relevance: string;
  }>;
  keywords: string[];
}

export interface ATSAnalysis {
  keywordMatch: number;
  formatScore: number;
  readabilityScore: number;
  missingKeywords: string[];
  suggestions: string[];
}

export interface GeneratedResume {
  _id: string;
  userId: string;
  jobPostingId: string | JobPosting;
  version: number;
  content: ResumeContent;
  aiModel: string;
  aiProvider: string;
  atsScore?: number;
  atsAnalysis?: ATSAnalysis;
  pdfUrl?: string;
  latexSource?: string;
  status: 'draft' | 'reviewed' | 'approved' | 'submitted';
  createdAt: string;
  updatedAt: string;
}

export interface CoverLetter {
  _id: string;
  userId: string;
  jobPostingId: string | JobPosting;
  resumeId: string | GeneratedResume;
  version: number;
  content: string;
  aiModel: string;
  aiProvider: string;
  tone: 'professional' | 'enthusiastic' | 'concise' | 'storytelling';
  status: 'draft' | 'reviewed' | 'approved' | 'submitted';
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Search Filter Types
// ============================================

export interface JobSearchFilter {
  _id: string;
  userId: string;
  name: string;
  isDefault: boolean;
  filters: FilterCriteria;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Queue Types
// ============================================

export interface QueueItem {
  id: string;
  jobPostingId: string;
  userId: string;
  priority: number;
  resumeOptions?: any;
  coverLetterOptions?: any;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface QueueStatus {
  queue: QueueItem[];
  stats: {
    queued: number;
    processing: number;
    completed: number;
    failed: number;
  };
}

// ============================================
// AI Model Types
// ============================================

export interface AIModel {
  id: string;
  name: string;
  provider: string;
  description?: string;
  maxTokens?: number;
  supportsStreaming?: boolean;
}

export interface AIProvider {
  id: string;
  name: string;
  models: AIModel[];
  configured: boolean;
}

// ============================================
// Auth Types
// ============================================

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface AuthResponse {
  user: {
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
  };
  tokens: AuthTokens;
}

export interface JWTPayload {
  userId: string;
  email: string;
  iat: number;
  exp: number;
}