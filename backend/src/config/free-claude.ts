import { config } from './env';
import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';

export interface FreeClaudeModel {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
  pricing: {
    input: number;
    output: number;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: any[];
  toolCallId?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  tools?: any[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finishReason: string;
  }>;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// Streaming chunk response (different structure from non-streaming)
export interface ChatCompletionStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finishReason: string | null;
  }>;
}

class FreeClaudeClient {
  private client: AxiosInstance;
  private baseUrl: string;
  private defaultModel: string;
  private modelsCache: FreeClaudeModel[] = [];
  private cacheExpiry: number = 0;

  constructor() {
    this.baseUrl = config.freeClaude.url;
    this.defaultModel = config.freeClaude.model;

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 120000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        logger.debug(`FreeClaude request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        logger.error('FreeClaude request error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`FreeClaude response: ${response.status}`);
        return response;
      },
      (error) => {
        logger.error('FreeClaude response error:', error.response?.data || error.message);
        return Promise.reject(error);
      }
    );
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get('/health');
      return true;
    } catch (error) {
      logger.error('FreeClaude health check failed:', error);
      return false;
    }
  }

  async listModels(): Promise<FreeClaudeModel[]> {
    // Cache models for 5 minutes
    if (this.modelsCache && Date.now() < this.cacheExpiry) {
      return this.modelsCache;
    }

    try {
      const response = await this.client.get('/v1/models');
      this.modelsCache = response.data.data || [];
      this.cacheExpiry = Date.now() + 5 * 60 * 1000;
      return this.modelsCache;
    } catch (error) {
      logger.error('Failed to fetch models from FreeClaude:', error);
      // Return default models if API fails
      return this.getDefaultModels();
    }
  }

  private getDefaultModels(): FreeClaudeModel[] {
    return [
      {
        id: 'open_router/openrouter/free',
        name: 'OpenRouter Free Models',
        provider: 'OpenRouter',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        supportsTools: true,
        supportsVision: true,
        pricing: { input: 0, output: 0 },
      },
      {
        id: 'groq/llama-3.3-70b-versatile',
        name: 'Llama 3.3 70B Versatile',
        provider: 'Groq',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        supportsTools: true,
        supportsVision: false,
        pricing: { input: 0, output: 0 },
      },
      {
        id: 'nvidia_nim/nvidia/nemotron-3-ultra-550b-a55b',
        name: 'Nemotron 3 Ultra',
        provider: 'NVIDIA NIM',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        supportsTools: true,
        supportsVision: false,
        pricing: { input: 0, output: 0 },
      },
      {
        id: 'gemini/models/gemini-3.1-flash-lite',
        name: 'Gemini 3.1 Flash Lite',
        provider: 'Google AI Studio',
        contextWindow: 1000000,
        maxOutputTokens: 8192,
        supportsTools: true,
        supportsVision: true,
        pricing: { input: 0, output: 0 },
      },
    ];
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const model = request.model || this.defaultModel;

    try {
      const response = await this.client.post('/v1/chat/completions', {
        ...request,
        model,
      });

      return response.data;
    } catch (error: any) {
      logger.error('FreeClaude chat completion failed:', {
        model,
        error: error.response?.data || error.message,
        status: error.response?.status,
      });
      throw new Error(`FreeClaude API error: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  async *streamChatCompletion(request: ChatCompletionRequest): AsyncGenerator<ChatCompletionStreamChunk> {
    const model = request.model || this.defaultModel;

    try {
      const response = await this.client.post('/v1/chat/completions', {
        ...request,
        model,
        stream: true,
      }, {
        responseType: 'stream',
      });

      for await (const chunk of this.parseSSEStream(response.data)) {
        yield chunk;
      }
    } catch (error: any) {
      logger.error('FreeClaude stream chat completion failed:', {
        model,
        error: error.response?.data || error.message,
      });
      throw error;
    }
  }

  private async *parseSSEStream(stream: any): AsyncGenerator<ChatCompletionStreamChunk> {
    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of stream) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            return;
          }
          try {
            yield JSON.parse(data);
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
  }

  async generateResume(
    jobDescription: string,
    userProfile: any,
    options: {
      tone?: 'professional' | 'enthusiastic' | 'concise' | 'storytelling';
      focusKeywords?: string[];
      model?: string;
      baseResumeText?: string;
    } = {}
  ): Promise<string> {
    const systemPrompt = this.buildResumeSystemPrompt(options.tone || 'professional');
    const userPrompt = this.buildResumeUserPrompt(jobDescription, userProfile, options.focusKeywords, options.baseResumeText);

    const response = await this.chatCompletion({
      model: options.model || this.defaultModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      maxTokens: 4000,
    });

    return response.choices[0]?.message?.content || '';
  }

  async generateCoverLetter(
    jobDescription: string,
    userProfile: any,
    resumeContent: string,
    options: {
      tone?: 'professional' | 'enthusiastic' | 'concise' | 'storytelling';
      model?: string;
    } = {}
  ): Promise<string> {
    const systemPrompt = this.buildCoverLetterSystemPrompt(options.tone || 'professional');
    const userPrompt = this.buildCoverLetterUserPrompt(jobDescription, userProfile, resumeContent);

    const response = await this.chatCompletion({
      model: options.model || this.defaultModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
      maxTokens: 2000,
    });

    return response.choices[0]?.message?.content || '';
  }

  async analyzeATSCompatibility(
    resumeContent: string,
    jobDescription: string
  ): Promise<{
    score: number;
    keywordMatch: number;
    formatScore: number;
    readabilityScore: number;
    missingKeywords: string[];
    suggestions: string[];
  }> {
    const systemPrompt = `You are an ATS (Applicant Tracking System) expert. Analyze the resume against the job description and provide a detailed compatibility report. Return ONLY a JSON object with the following structure:
{
  "score": number (0-100),
  "keywordMatch": number (0-100),
  "formatScore": number (0-100),
  "readabilityScore": number (0-100),
  "missingKeywords": string[],
  "suggestions": string[]
}`;

    const userPrompt = `Job Description:\n${jobDescription}\n\nResume:\n${resumeContent}\n\nAnalyze the resume for ATS compatibility and provide the JSON report.`;

    const response = await this.chatCompletion({
      model: this.defaultModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      maxTokens: 2000,
    });

    try {
      return JSON.parse(response.choices[0]?.message?.content || '{}');
    } catch (e) {
      logger.error('Failed to parse ATS analysis response');
      return {
        score: 0,
        keywordMatch: 0,
        formatScore: 0,
        readabilityScore: 0,
        missingKeywords: [],
        suggestions: ['Failed to analyze - please try again'],
      };
    }
  }

  private buildResumeSystemPrompt(tone: string): string {
    const toneInstructions = {
      professional: 'Use formal, professional language. Focus on achievements and measurable results.',
      enthusiastic: 'Use energetic, passionate language. Show excitement for the role and company.',
      concise: 'Be brief and direct. Use bullet points. Focus on key qualifications only.',
      storytelling: 'Use narrative format. Connect experiences to the role through stories.',
    };

    return `You are an expert resume writer. Create a tailored, ATS-friendly resume that PRESERVES the candidate's uploaded resume structure exactly.

PRESERVE THE ORIGINAL RESUME STRUCTURE EXACTLY:
- Use the EXACT same section headings as the uploaded resume. Do NOT rename sections (e.g., do not change "Experience" to "PROFESSIONAL EXPERIENCE").
- Keep the EXACT same section order as the uploaded resume. Do NOT reorder sections.
- Do NOT add new sections that were not in the original.
- Do NOT remove sections that were in the original.
- Keep the same visual density and section grouping as the original.
- Maintain 1-2 pages maximum.

TAILORING RULES (only change wording inside existing sections, never structure):
- Rewrite the professional summary to target the specific job, using verified skills from the resume.
- Rewrite experience bullets to be achievement-oriented and keyword-aligned with the job description.
- Reorder/prioritize skills within the skills section to emphasize those mentioned in the job description.
- Keep all actual facts unchanged: company names, job titles, employment dates, education, skills.
- Use information from the user profile and uploaded resume only. Do NOT invent facts, companies, or metrics.
- Include numerical results only when provided by the candidate. Never fabricate metrics.

STRICT RULES:
1. NO spacing artifacts. Use normal spaces only.
2. Use normal date format: Month Year (e.g., Aug 2021 to Dec 2023).
3. Keep to 1-2 pages maximum.
4. Tone: ${toneInstructions[tone as keyof typeof toneInstructions] || toneInstructions.professional}
5. Optimize for both human readers and ATS algorithms.
6. Do NOT include a "KEYWORDS FOR ATS" section or any raw keyword list in the resume output.

Return ONLY the resume content in plain text, using the exact same section headings and order as the uploaded resume.`;
  }

  private buildResumeUserPrompt(
    jobDescription: string,
    userProfile: any,
    focusKeywords?: string[],
    baseResumeText?: string
  ): string {
    const profileSummary = baseResumeText
      ? `UPLOADED RESUME (PRESERVE THIS STRUCTURE - this is the candidate's original resume format, fonts, and layout):
${baseResumeText}`
      : this.buildProfileSummary(userProfile);

    const focusKeywordsLine = focusKeywords && focusKeywords.length > 0
      ? `Focus Keywords to Emphasize: ${focusKeywords.join(', ')}\n\n`
      : '';

    const criticalInstruction = baseResumeText
      ? 'PRESERVE the uploaded resume\'s exact section headings and section order. Do NOT rename sections, do NOT reorder sections, do NOT add or remove sections.'
      : 'CREATE a professional resume from scratch using the candidate profile above. Include all relevant sections: header with contact info, professional summary, technical skills, professional experience, education, and projects.';

    return `Job Description:
${jobDescription}

Candidate Profile:
${profileSummary}

${focusKeywordsLine}Create a tailored, ATS-optimized resume for this specific job using the STRICT RULES from the system instructions.

CRITICAL: ${criticalInstruction} Only tailor the wording inside each section to match the job requirements while staying truthful to the user's actual experience. Follow the no-spacing-artifact rules and Month Year date format strictly.

IMPORTANT: Do NOT include a "KEYWORDS FOR ATS" section or any raw keyword list in the resume output. Keywords are used internally for ATS optimization only and must not appear as a section on the resume.`;
  }

  private buildProfileSummary(userProfile: any): string {
    const pi = userProfile?.personalInfo || {};
    const name = `${pi.firstName || ''} ${pi.lastName || ''}`.trim() || 'Candidate';
    const contact = [
      pi.address?.city && pi.address?.province ? `${pi.address.city}, ${pi.address.province}` : '',
      pi.phone,
      pi.email,
      pi.linkedinUrl,
      pi.githubUrl,
      pi.portfolioUrl,
    ].filter(Boolean).join(' • ');

    const lines: string[] = [
      `NAME: ${name}`,
      contact ? `CONTACT: ${contact}` : '',
      '',
    ];

    if (userProfile?.professionalSummary) {
      lines.push(`PROFESSIONAL SUMMARY:\n${userProfile.professionalSummary}`);
      lines.push('');
    }

    const skills = userProfile?.skills;
    if (skills) {
      const skillParts: string[] = [];
      if (skills.technical?.length) skillParts.push(`Technical: ${skills.technical.join(', ')}`);
      if (skills.soft?.length) skillParts.push(`Soft Skills: ${skills.soft.join(', ')}`);
      if (skills.languages?.length) skillParts.push(`Languages: ${skills.languages.join(', ')}`);
      if (skills.certifications?.length) skillParts.push(`Certifications: ${skills.certifications.join(', ')}`);
      if (skillParts.length) {
        lines.push(`TECHNICAL SKILLS:\n${skillParts.join('\n')}`);
        lines.push('');
      }
    }

    if (userProfile?.experience?.length) {
      lines.push('PROFESSIONAL EXPERIENCE:');
      for (const exp of userProfile.experience) {
        const start = exp.startDate ? new Date(exp.startDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';
        const end = exp.current ? 'Present' : exp.endDate ? new Date(exp.endDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';
        const dateRange = start && end ? `${start} to ${end}` : start || end;
        lines.push(`\n${exp.position} at ${exp.company}${exp.location ? ` (${exp.location})` : ''}`);
        if (dateRange) lines.push(`  ${dateRange}`);
        if (exp.description?.length) {
          for (const d of exp.description) lines.push(`  • ${d}`);
        }
        if (exp.technologies?.length) lines.push(`  Technologies: ${exp.technologies.join(', ')}`);
      }
      lines.push('');
    }

    if (userProfile?.education?.length) {
      lines.push('EDUCATION:');
      for (const edu of userProfile.education) {
        const start = edu.startDate ? new Date(edu.startDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';
        const end = edu.endDate ? new Date(edu.endDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';
        const dateRange = start && end ? `${start} to ${end}` : start || end;
        lines.push(`\n${edu.degree} in ${edu.fieldOfStudy}`);
        lines.push(`  ${edu.institution}${dateRange ? ` (${dateRange})` : ''}`);
        if (edu.gpa) lines.push(`  GPA: ${edu.gpa}`);
        if (edu.honors?.length) lines.push(`  Honors: ${edu.honors.join(', ')}`);
      }
      lines.push('');
    }

    if (userProfile?.projects?.length) {
      lines.push('PROJECTS:');
      for (const proj of userProfile.projects) {
        lines.push(`\n${proj.name}`);
        if (proj.description) lines.push(`  ${proj.description}`);
        if (proj.technologies?.length) lines.push(`  Technologies: ${proj.technologies.join(', ')}`);
      }
      lines.push('');
    }

    return lines.join('\n').trim();
  }

  private buildCoverLetterSystemPrompt(tone: string): string {
    const toneInstructions = {
      professional: 'Formal, polished, and respectful. Standard business letter format.',
      enthusiastic: 'Energetic and passionate. Show genuine excitement and cultural fit.',
      concise: 'Brief and to the point. 3 paragraphs maximum. High impact.',
      storytelling: 'Narrative-driven. Connect personal journey to the role and company mission.',
    };

    return `You are an expert cover letter writer. Create a compelling, tailored cover letter.

${toneInstructions[tone as keyof typeof toneInstructions] || toneInstructions.professional}

Guidelines:
1. Address the hiring manager or company specifically
2. Hook with a strong opening that shows you understand the role
3. Connect 2-3 key experiences to the job requirements
4. Show knowledge of the company and why you want to work there
5. End with a clear call to action
6. Keep it to one page (3-4 paragraphs)
7. No invented facts - only use real experiences from the profile
8. Match the tone to the company culture (research from job description)`;
  }

  private buildCoverLetterUserPrompt(
    jobDescription: string,
    userProfile: any,
    resumeContent: string
  ): string {
    return `Job Description:
${jobDescription}

User Profile:
${JSON.stringify(userProfile, null, 2)}

Generated Resume (for reference):
${resumeContent}

Write a tailored cover letter for this specific job application.`;
  }
}

export const freeClaudeClient = new FreeClaudeClient();
export default freeClaudeClient;