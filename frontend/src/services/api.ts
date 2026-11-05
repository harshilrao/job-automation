import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { ApiError } from '@shared/types';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

class ApiService {
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // Load tokens from localStorage
    this.accessToken = localStorage.getItem('accessToken');
    this.refreshToken = localStorage.getItem('refreshToken');
    console.log('[API] Initialized. baseURL:', API_BASE_URL, '| hasAccessToken:', !!this.accessToken, '| hasRefreshToken:', !!this.refreshToken);

    // Request interceptor
    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        console.log('[API] Request:', config.method?.toUpperCase(), config.url, this.accessToken ? 'with Bearer token' : 'WITHOUT token');
        if (this.accessToken) {
          config.headers.Authorization = `Bearer ${this.accessToken}`;
        }
        return config;
      },
      (error) => {
        console.error('[API] Request error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        console.log('[API] Response:', response.status, response.config.url);
        return response;
      },
      async (error: AxiosError<ApiError>) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
        console.error('[API] Response error:', error.response?.status, error.response?.data, error.config?.url);

        if (error.response?.status === 401 && !originalRequest._retry) {
          console.log('[API] Got 401, attempting token refresh for:', originalRequest.url);
          originalRequest._retry = true;

          try {
            await this.refreshAccessToken();
            if (this.accessToken) {
              console.log('[API] Token refresh succeeded, retrying:', originalRequest.url);
              originalRequest.headers.Authorization = `Bearer ${this.accessToken}`;
              return this.client(originalRequest);
            }
          } catch {
            // Refresh failed, redirect to login
            console.error('[API] Token refresh failed, clearing tokens and redirecting to /login');
            this.clearTokens();
            window.location.href = '/login';
          }
        }

        return Promise.reject(error);
      }
    );
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) throw new Error('No refresh token');

    const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
      refreshToken: this.refreshToken,
    });

    this.setTokens(response.data.tokens.accessToken, response.data.tokens.refreshToken);
  }

  setTokens(accessToken: string, refreshToken: string): void {
    console.log('[API] setTokens: saving accessToken and refreshToken to memory + localStorage');
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
  }

  clearTokens(): void {
    console.log('[API] clearTokens: removing tokens from memory + localStorage');
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  // Auth endpoints
  async login(email: string, password: string) {
    console.log('[API] login called for:', email);
    try {
      const response = await this.client.post('/auth/login', { email, password });
      console.log('[API] login response:', response.status, response.data);
      this.setTokens(response.data.tokens.accessToken, response.data.tokens.refreshToken);
      return response.data;
    } catch (error: any) {
      console.error('[API] login error:', error.response?.status, error.response?.data || error.message);
      throw error;
    }
  }

  async register(data: { email: string; password: string; firstName: string; lastName: string }) {
    console.log('[API] register called for:', data.email);
    try {
      const response = await this.client.post('/auth/register', data);
      console.log('[API] register response:', response.status, response.data);
      this.setTokens(response.data.tokens.accessToken, response.data.tokens.refreshToken);
      return response.data;
    } catch (error: any) {
      console.error('[API] register error:', error.response?.status, error.response?.data || error.message);
      throw error;
    }
  }

  async logout() {
    console.log('[API] logout called');
    await this.client.post('/auth/logout');
    this.clearTokens();
  }

  async getMe() {
    console.log('[API] getMe called');
    const response = await this.client.get('/auth/me');
    console.log('[API] getMe response:', response.status, response.data);
    return response.data;
  }

  // Jobs endpoints
  async searchJobs(params: {
    searchTerm?: string;
    cities?: string[];
    jobTypes?: string[];
    experienceLevels?: string[];
    industries?: string[];
    departments?: string[];
    salaryMin?: number;
    salaryMax?: number;
    postedWithinHours?: number;
    remoteOnly?: boolean;
    hybridOnly?: boolean;
    sources?: string[];
    excludedCompanies?: string[];
    excludedKeywords?: string[];
    requiredKeywords?: string[];
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
  }) {
    console.log('[API] searchJobs called with params:', params);
    const response = await this.client.get('/jobs/search', { params });
    console.log('[API] searchJobs response:', response.status, JSON.stringify(response.data).slice(0, 500));
    return response.data;
  }

  async getJobById(id: string) {
    const response = await this.client.get(`/jobs/${id}`);
    return response.data;
  }

  async getJobStats() {
    const response = await this.client.get('/jobs/stats');
    return response.data;
  }

  async triggerScrape() {
    const response = await this.client.post('/jobs/scrape');
    return response.data;
  }

  async getCities() {
    const response = await this.client.get('/jobs/cities');
    return response.data;
  }

  async getCompanies() {
    const response = await this.client.get('/jobs/companies');
    return response.data;
  }

  async getSkills() {
    const response = await this.client.get('/jobs/skills');
    return response.data;
  }

  async getSources() {
    const response = await this.client.get('/jobs/sources');
    return response.data;
  }

  async getJobTypes() {
    const response = await this.client.get('/jobs/job-types');
    return response.data;
  }

  async getExperienceLevels() {
    const response = await this.client.get('/jobs/experience-levels');
    return response.data;
  }

  async getIndustries() {
    const response = await this.client.get('/jobs/industries');
    return response.data;
  }

  async getDepartments() {
    const response = await this.client.get('/jobs/departments');
    return response.data;
  }

  // Search filters
  async saveSearchFilter(data: { name: string; isDefault?: boolean; filters: any }) {
    const response = await this.client.post('/jobs/filters', data);
    return response.data;
  }

  async getSearchFilters() {
    console.log('[API] getSearchFilters called');
    try {
      const response = await this.client.get('/jobs/filters');
      console.log('[API] getSearchFilters response:', response.status, response.data);
      return response.data;
    } catch (error: any) {
      console.error('[API] getSearchFilters error:', error.response?.status, error.response?.data || error.message);
      throw error;
    }
  }

  async getDefaultSearchFilter() {
    const response = await this.client.get('/jobs/filters/default');
    return response.data;
  }

  async updateSearchFilter(id: string, data: any) {
    const response = await this.client.put(`/jobs/filters/${id}`, data);
    return response.data;
  }

  async deleteSearchFilter(id: string) {
    const response = await this.client.delete(`/jobs/filters/${id}`);
    return response.data;
  }

  async setDefaultSearchFilter(id: string) {
    const response = await this.client.post(`/jobs/filters/${id}/default`);
    return response.data;
  }

  async applySavedFilter(id: string, params: { page?: number; limit?: number }) {
    const response = await this.client.post(`/jobs/filters/${id}/apply`, null, { params });
    return response.data;
  }

  // Applications endpoints
  async applyToJob(data: {
    jobPostingId: string;
    resumeId?: string;
    coverLetterId?: string;
    resumeOptions?: any;
    coverLetterOptions?: any;
  }) {
    const response = await this.client.post('/applications/apply', data);
    return response.data;
  }

  async getApplications(params?: { status?: string; page?: number; limit?: number }) {
    const response = await this.client.get('/applications', { params });
    return response.data;
  }

  async getApplicationById(id: string) {
    const response = await this.client.get(`/applications/${id}`);
    return response.data;
  }

  async getApplicationStats() {
    const response = await this.client.get('/applications/stats');
    return response.data;
  }

  async getNeedingIntervention() {
    const response = await this.client.get('/applications/intervention');
    return response.data;
  }

  async getQueueStatus() {
    const response = await this.client.get('/applications/queue');
    return response.data;
  }

  async retryApplication(id: string) {
    const response = await this.client.post(`/applications/${id}/retry`);
    return response.data;
  }

  async updateApplicationStatus(id: string, data: { status: string; notes?: string }) {
    const response = await this.client.put(`/applications/${id}/status`, data);
    return response.data;
  }

  async withdrawApplication(id: string) {
    const response = await this.client.post(`/applications/${id}/withdraw`);
    return response.data;
  }

  async searchAndQueueJobs(data: {
    searchTerm?: string;
    cities?: string[];
    jobTypes?: string[];
    experienceLevels?: string[];
    maxApplications?: number;
  }) {
    const response = await this.client.post('/applications/search-and-queue', data);
    return response.data;
  }

  // Resume generation
  async generateResume(data: {
    jobPostingId: string;
    tone?: string;
    focusKeywords?: string[];
    model?: string;
  }) {
    const response = await this.client.post('/applications/resume/generate', data);
    return response.data;
  }

  async getResumes(params?: { jobPostingId?: string }) {
    const response = await this.client.get('/applications/resumes', { params });
    return response.data;
  }

  async getResumeById(id: string) {
    const response = await this.client.get(`/applications/resumes/${id}`);
    return response.data;
  }

  // Cover letter generation
  async generateCoverLetter(data: {
    jobPostingId: string;
    resumeId: string;
    tone?: string;
    model?: string;
  }) {
    const response = await this.client.post('/applications/cover-letter/generate', data);
    return response.data;
  }

  async getCoverLetters(params?: { jobPostingId?: string; resumeId?: string }) {
    const response = await this.client.get('/applications/cover-letters', { params });
    return response.data;
  }

  // ATS analysis
  async analyzeATS(data: { resumeId: string; jobPostingId: string }) {
    const response = await this.client.post('/applications/ats/analyze', data);
    return response.data;
  }

  async getAvailableModels() {
    const response = await this.client.get('/applications/models');
    return response.data;
  }

  // Profile endpoints
  async getProfile() {
    const response = await this.client.get('/profile');
    return response.data;
  }

  async updateProfile(data: any) {
    const response = await this.client.put('/profile', data);
    return response.data;
  }

  async updatePersonalInfo(data: any) {
    const response = await this.client.put('/profile/personal-info', data);
    return response.data;
  }

  async updateSkills(data: any) {
    const response = await this.client.put('/profile/skills', data);
    return response.data;
  }

  async addExperience(data: any) {
    const response = await this.client.post('/profile/experience', data);
    return response.data;
  }

  async updateExperience(index: number, data: any) {
    const response = await this.client.put(`/profile/experience/${index}`, data);
    return response.data;
  }

  async deleteExperience(index: number) {
    const response = await this.client.delete(`/profile/experience/${index}`);
    return response.data;
  }

  async addEducation(data: any) {
    const response = await this.client.post('/profile/education', data);
    return response.data;
  }

  async updateEducation(index: number, data: any) {
    const response = await this.client.put(`/profile/education/${index}`, data);
    return response.data;
  }

  async deleteEducation(index: number) {
    const response = await this.client.delete(`/profile/education/${index}`);
    return response.data;
  }

  async addProject(data: any) {
    const response = await this.client.post('/profile/projects', data);
    return response.data;
  }

  async updateProject(index: number, data: any) {
    const response = await this.client.put(`/profile/projects/${index}`, data);
    return response.data;
  }

  async deleteProject(index: number) {
    const response = await this.client.delete(`/profile/projects/${index}`);
    return response.data;
  }

  async updatePreferences(data: any) {
    const response = await this.client.put('/profile/preferences', data);
    return response.data;
  }

  async updateProfessionalSummary(summary: string) {
    const response = await this.client.put('/profile/summary', { professionalSummary: summary });
    return response.data;
  }

  async exportProfile() {
    const response = await this.client.get('/profile/export', { responseType: 'blob' });
    return response.data;
  }

  async importProfile(data: any) {
    const response = await this.client.post('/profile/import', data);
    return response.data;
  }

  // AI endpoints
  async getFreeClaudeStatus() {
    const response = await this.client.get('/ai/free-claude/status');
    return response.data;
  }

  async getAIModels() {
    const response = await this.client.get('/ai/models');
    return response.data;
  }

  async testFreeClaude(prompt: string, model?: string) {
    const response = await this.client.post('/ai/free-claude/test', { prompt, model });
    return response.data;
  }

  async extractKeywords(text: string, maxKeywords?: number) {
    const response = await this.client.post('/ai/extract-keywords', { text, maxKeywords });
    return response.data;
  }

  async improveResume(resume: string, jobDescription: string, focus?: string) {
    const response = await this.client.post('/ai/improve-resume', { resume, jobDescription, focus });
    return response.data;
  }

  async generateInterviewPrep(data: { jobDescription: string; resume?: string; userProfile?: any }) {
    const response = await this.client.post('/ai/interview-prep', data);
    return response.data;
  }

  async analyzeJobFit(data: { jobDescription: string; userProfile: any }) {
    const response = await this.client.post('/ai/analyze-fit', data);
    return response.data;
  }

  async rewriteBulletPoints(data: { bullets: string[]; jobDescription?: string; tone?: string }) {
    const response = await this.client.post('/ai/rewrite-bullets', data);
    return response.data;
  }

  async generateThankYouNote(data: { interviewerName: string; jobTitle: string; company: string; interviewNotes?: string; tone?: string }) {
    const response = await this.client.post('/ai/thank-you-note', data);
    return response.data;
  }

  async negotiateSalary(data: { currentOffer: number; targetSalary: number; justification?: string; company?: string; role?: string }) {
    const response = await this.client.post('/ai/negotiate-salary', data);
    return response.data;
  }
}

export const api = new ApiService();
export default api;