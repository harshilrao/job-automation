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
    } = {}
  ): Promise<string> {
    const systemPrompt = this.buildResumeSystemPrompt(options.tone || 'professional');
    const userPrompt = this.buildResumeUserPrompt(jobDescription, userProfile, options.focusKeywords);

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

    return `You are an expert resume writer and ATS optimization specialist. Create a tailored, ATS-friendly resume that matches the job description perfectly.

${toneInstructions[tone as keyof typeof toneInstructions] || toneInstructions.professional}

Guidelines:
1. Extract keywords from the job description and naturally incorporate them
2. Quantify achievements with numbers, percentages, and metrics
3. Use standard resume sections: Professional Summary, Skills, Experience, Education, Projects
4. Format for ATS parsing: standard headers, no columns, no graphics, simple formatting
5. Match the required skills and experience level from the job description
6. Highlight relevant technologies and methodologies mentioned in the job
7. Keep it to 1-2 pages maximum
8. Use action verbs and industry-standard terminology
9. Ensure no invented facts - only use information from the user profile
10. Optimize for both human readers and ATS algorithms

Return the resume in a structured format that can be converted to PDF.`;
  }

  private buildResumeUserPrompt(
    jobDescription: string,
    userProfile: any,
    focusKeywords?: string[]
  ): string {
    return `Job Description:
${jobDescription}

User Profile:
${JSON.stringify(userProfile, null, 2)}

${focusKeywords && focusKeywords.length > 0 ? `Focus Keywords to Emphasize: ${focusKeywords.join(', ')}` : ''}

Create a tailored, ATS-optimized resume for this specific job. Return the resume content in a structured format with these sections:
1. Professional Summary (2-3 sentences)
2. Technical Skills (categorized)
3. Soft Skills
4. Professional Experience (reverse chronological, with tailored bullets)
5. Education
6. Projects (relevant to the role)
7. Keywords (extracted from job description for ATS)

Focus on matching the job requirements while staying truthful to the user's actual experience.`;
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