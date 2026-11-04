import { freeClaudeClient, ChatCompletionRequest, ChatMessage } from '../config/free-claude';
import { GeneratedResume } from '../models/GeneratedResume';
import { CoverLetter } from '../models/CoverLetter';
import { JobPosting } from '../models/JobPosting';
import { UserProfile } from '../models/UserProfile';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { sleep, retry } from '../utils/helpers';
import axios from 'axios';

export interface ResumeGenerationOptions {
  tone?: 'professional' | 'enthusiastic' | 'concise' | 'storytelling';
  focusKeywords?: string[];
  model?: string;
  provider?: string;
}

export interface CoverLetterGenerationOptions {
  tone?: 'professional' | 'enthusiastic' | 'concise' | 'storytelling';
  model?: string;
  provider?: string;
}

export interface ATSOptimizationResult {
  score: number;
  keywordMatch: number;
  formatScore: number;
  readabilityScore: number;
  missingKeywords: string[];
  suggestions: string[];
  optimizedResume?: string;
}

export interface AIModelConfig {
  id: string;
  name: string;
  provider: string;
  endpoint: string;
  apiKey?: string;
  maxTokens: number;
  supportsStreaming: boolean;
}

export class AIResumeGenerator {
  private models: AIModelConfig[] = [
    {
      id: 'free-claude',
      name: 'Free Claude (via free-claude-code)',
      provider: 'free-claude-code',
      endpoint: config.freeClaude.url,
      maxTokens: 8192,
      supportsStreaming: true,
    },
    {
      id: 'openrouter/free',
      name: 'OpenRouter Free Models',
      provider: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1',
      apiKey: config.ai.openRouterApiKey,
      maxTokens: 8192,
      supportsStreaming: true,
    },
    {
      id: 'groq/llama-3.3-70b-versatile',
      name: 'Groq Llama 3.3 70B',
      provider: 'groq',
      endpoint: 'https://api.groq.com/openai/v1',
      apiKey: config.ai.groqApiKey,
      maxTokens: 8192,
      supportsStreaming: true,
    },
  ];

  /**
   * Generate a tailored resume for a specific job
   */
  async generateResume(
    userProfile: any,
    jobPosting: any,
    options: ResumeGenerationOptions = {}
  ): Promise<{
    content: string;
    atsAnalysis: ATSOptimizationResult;
    model: string;
    provider: string;
  }> {
    const model = options.model || this.getBestModel();
    const provider = options.provider || this.getProviderForModel(model);

    logger.info('Generating resume', {
      jobTitle: jobPosting.title,
      company: jobPosting.company,
      model,
      provider,
    });

    let content: string;

    if (provider === 'free-claude-code') {
      content = await this.generateWithFreeClaude(userProfile, jobPosting, options);
    } else if (provider === 'openrouter') {
      content = await this.generateWithOpenRouter(userProfile, jobPosting, options);
    } else if (provider === 'groq') {
      content = await this.generateWithGroq(userProfile, jobPosting, options);
    } else {
      // Fallback to free-claude
      content = await this.generateWithFreeClaude(userProfile, jobPosting, options);
    }

    // Analyze ATS compatibility
    const atsAnalysis = await this.analyzeATSCompatibility(content, jobPosting.description);

    // If score is low, try to optimize
    let optimizedContent = content;
    if (atsAnalysis.score < 75) {
      optimizedContent = await this.optimizeForATS(content, jobPosting, atsAnalysis);
      const reAnalysis = await this.analyzeATSCompatibility(optimizedContent, jobPosting.description);
      if (reAnalysis.score > atsAnalysis.score) {
        atsAnalysis.score = reAnalysis.score;
        atsAnalysis.keywordMatch = reAnalysis.keywordMatch;
        atsAnalysis.missingKeywords = reAnalysis.missingKeywords;
        atsAnalysis.suggestions = reAnalysis.suggestions;
      }
    }

    return {
      content: optimizedContent,
      atsAnalysis,
      model,
      provider,
    };
  }

  /**
   * Generate cover letter for a job
   */
  async generateCoverLetter(
    userProfile: any,
    jobPosting: any,
    resumeContent: string,
    options: CoverLetterGenerationOptions = {}
  ): Promise<{
    content: string;
    model: string;
    provider: string;
  }> {
    const model = options.model || this.getBestModel();
    const provider = options.provider || this.getProviderForModel(model);

    logger.info('Generating cover letter', {
      jobTitle: jobPosting.title,
      company: jobPosting.company,
      model,
      provider,
    });

    let content: string;

    if (provider === 'free-claude-code') {
      content = await freeClaudeClient.generateCoverLetter(
        jobPosting.description,
        userProfile,
        resumeContent,
        { tone: options.tone, model }
      );
    } else if (provider === 'openrouter') {
      content = await this.generateCoverLetterWithOpenRouter(userProfile, jobPosting, resumeContent, options);
    } else if (provider === 'groq') {
      content = await this.generateCoverLetterWithGroq(userProfile, jobPosting, resumeContent, options);
    } else {
      content = await freeClaudeClient.generateCoverLetter(
        jobPosting.description,
        userProfile,
        resumeContent,
        { tone: options.tone, model }
      );
    }

    return { content, model, provider };
  }

  /**
   * Analyze resume for ATS compatibility
   */
  async analyzeATSCompatibility(
    resumeContent: string,
    jobDescription: string
  ): Promise<ATSOptimizationResult> {
    try {
      return await freeClaudeClient.analyzeATSCompatibility(resumeContent, jobDescription);
    } catch (error) {
      logger.error('ATS analysis failed:', error);
      return {
        score: 0,
        keywordMatch: 0,
        formatScore: 0,
        readabilityScore: 0,
        missingKeywords: [],
        suggestions: ['ATS analysis failed - please try again'],
      };
    }
  }

  /**
   * Generate resume using free-claude-code
   */
  private async generateWithFreeClaude(
    userProfile: any,
    jobPosting: any,
    options: ResumeGenerationOptions
  ): Promise<string> {
    return await freeClaudeClient.generateResume(jobPosting.description, userProfile, {
      tone: options.tone,
      focusKeywords: options.focusKeywords,
      model: options.model,
    });
  }

  /**
   * Generate resume using OpenRouter
   */
  private async generateWithOpenRouter(
    userProfile: any,
    jobPosting: any,
    options: ResumeGenerationOptions
  ): Promise<string> {
    if (!config.ai.openRouterApiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    const systemPrompt = this.buildResumeSystemPrompt(options.tone || 'professional');
    const userPrompt = this.buildResumeUserPrompt(jobPosting, userProfile, options.focusKeywords);

    const response = await retry(
      () => axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: options.model || 'openrouter/auto',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 4000,
        },
        {
          headers: {
            'Authorization': `Bearer ${config.ai.openRouterApiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'Job Automation',
          },
        }
      ),
      { maxAttempts: 3, shouldRetry: (e) => e.response?.status === 429 || e.response?.status >= 500 }
    );

    return response.data.choices[0]?.message?.content || '';
  }

  /**
   * Generate resume using Groq
   */
  private async generateWithGroq(
    userProfile: any,
    jobPosting: any,
    options: ResumeGenerationOptions
  ): Promise<string> {
    if (!config.ai.groqApiKey) {
      throw new Error('Groq API key not configured');
    }

    const systemPrompt = this.buildResumeSystemPrompt(options.tone || 'professional');
    const userPrompt = this.buildResumeUserPrompt(jobPosting, userProfile, options.focusKeywords);

    const response = await retry(
      () => axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: options.model || 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 4000,
        },
        {
          headers: {
            'Authorization': `Bearer ${config.ai.groqApiKey}`,
            'Content-Type': 'application/json',
          },
        }
      ),
      { maxAttempts: 3, shouldRetry: (e) => e.response?.status === 429 || e.response?.status >= 500 }
    );

    return response.data.choices[0]?.message?.content || '';
  }

  /**
   * Generate cover letter using OpenRouter
   */
  private async generateCoverLetterWithOpenRouter(
    userProfile: any,
    jobPosting: any,
    resumeContent: string,
    options: CoverLetterGenerationOptions
  ): Promise<string> {
    if (!config.ai.openRouterApiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    const systemPrompt = this.buildCoverLetterSystemPrompt(options.tone || 'professional');
    const userPrompt = this.buildCoverLetterUserPrompt(jobPosting, userProfile, resumeContent);

    const response = await retry(
      () => axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: options.model || 'openrouter/auto',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.4,
          max_tokens: 2000,
        },
        {
          headers: {
            'Authorization': `Bearer ${config.ai.openRouterApiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'Job Automation',
          },
        }
      ),
      { maxAttempts: 3 }
    );

    return response.data.choices[0]?.message?.content || '';
  }

  /**
   * Generate cover letter using Groq
   */
  private async generateCoverLetterWithGroq(
    userProfile: any,
    jobPosting: any,
    resumeContent: string,
    options: CoverLetterGenerationOptions
  ): Promise<string> {
    if (!config.ai.groqApiKey) {
      throw new Error('Groq API key not configured');
    }

    const systemPrompt = this.buildCoverLetterSystemPrompt(options.tone || 'professional');
    const userPrompt = this.buildCoverLetterUserPrompt(jobPosting, userProfile, resumeContent);

    const response = await retry(
      () => axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: options.model || 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.4,
          max_tokens: 2000,
        },
        {
          headers: {
            'Authorization': `Bearer ${config.ai.groqApiKey}`,
            'Content-Type': 'application/json',
          },
        }
      ),
      { maxAttempts: 3 }
    );

    return response.data.choices[0]?.message?.content || '';
  }

  /**
   * Optimize resume for ATS based on analysis
   */
  private async optimizeForATS(
    resumeContent: string,
    jobPosting: any,
    atsAnalysis: ATSOptimizationResult
  ): Promise<string> {
    const systemPrompt = `You are an ATS optimization expert. Improve the resume to increase ATS compatibility score.
Focus on:
1. Adding missing keywords naturally: ${atsAnalysis.missingKeywords.join(', ')}
2. Improving format and structure
3. Enhancing readability
4. Quantifying achievements with metrics
5. Using standard section headers

Return ONLY the optimized resume content.`;

    const userPrompt = `Job Description:
${jobPosting.description}

Current Resume:
${resumeContent}

ATS Analysis:
- Score: ${atsAnalysis.score}/100
- Keyword Match: ${atsAnalysis.keywordMatch}/100
- Missing Keywords: ${atsAnalysis.missingKeywords.join(', ')}
- Suggestions: ${atsAnalysis.suggestions.join('; ')}

Optimize this resume for better ATS compatibility.`;

    try {
      const response = await freeClaudeClient.chatCompletion({
        model: config.freeClaude.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        maxTokens: 4000,
      });

      return response.choices[0]?.message?.content || resumeContent;
    } catch (error) {
      logger.error('ATS optimization failed:', error);
      return resumeContent;
    }
  }

  /**
   * Get the best available model
   */
  private getBestModel(): string {
    // Prefer free-claude-code as primary
    if (config.freeClaude.url) {
      return config.freeClaude.model;
    }
    // Fallback to OpenRouter if configured
    if (config.ai.openRouterApiKey) {
      return 'openrouter/auto';
    }
    // Fallback to Groq
    if (config.ai.groqApiKey) {
      return 'llama-3.3-70b-versatile';
    }
    return 'openrouter/auto';
  }

  /**
   * Get provider for a model
   */
  private getProviderForModel(model: string): string {
    if (model.includes('free-claude') || model.includes('nvidia') || model.includes('gemini') || model.includes('deepseek')) {
      return 'free-claude-code';
    }
    if (model.includes('openrouter')) {
      return 'openrouter';
    }
    if (model.includes('groq') || model.includes('llama')) {
      return 'groq';
    }
    return 'free-claude-code';
  }

  /**
   * Build resume system prompt
   */
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

Return the resume in a structured format with these sections:
1. Professional Summary (2-3 sentences)
2. Technical Skills (categorized)
3. Soft Skills
4. Professional Experience (reverse chronological, with tailored bullets)
5. Education
6. Projects (relevant to the role)
7. Keywords (extracted from job description for ATS)`;
  }

  /**
   * Build resume user prompt
   */
  private buildResumeUserPrompt(
    jobPosting: any,
    userProfile: any,
    focusKeywords?: string[]
  ): string {
    return `Job Description:
${jobPosting.description}

Job Title: ${jobPosting.title}
Company: ${jobPosting.company}
Location: ${jobPosting.location?.city}, ${jobPosting.location?.province}
Required Skills: ${jobPosting.skills?.join(', ') || 'Not specified'}
Experience Level: ${jobPosting.experienceLevel}

User Profile:
${JSON.stringify(userProfile, null, 2)}

${focusKeywords && focusKeywords.length > 0 ? `Focus Keywords to Emphasize: ${focusKeywords.join(', ')}` : ''}

Create a tailored, ATS-optimized resume for this specific job. Return the resume content in a structured format.`;
  }

  /**
   * Build cover letter system prompt
   */
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

  /**
   * Build cover letter user prompt
   */
  private buildCoverLetterUserPrompt(
    jobPosting: any,
    userProfile: any,
    resumeContent: string
  ): string {
    return `Job Description:
${jobPosting.description}

Job Title: ${jobPosting.title}
Company: ${jobPosting.company}

User Profile:
${JSON.stringify(userProfile, null, 2)}

Generated Resume (for reference):
${resumeContent}

Write a tailored cover letter for this specific job application.`;
  }

  /**
   * Get available models
   */
  async getAvailableModels(): Promise<AIModelConfig[]> {
    try {
      const freeClaudeModels = await freeClaudeClient.listModels();
      return [
        ...this.models,
        ...freeClaudeModels.map(m => ({
          id: m.id,
          name: m.name,
          provider: 'free-claude-code',
          endpoint: config.freeClaude.url,
          maxTokens: m.maxOutputTokens,
          supportsStreaming: true,
        })),
      ];
    } catch {
      return this.models;
    }
  }

  /**
   * Generate multiple resume versions with different tones
   */
  async generateMultipleVersions(
    userProfile: any,
    jobPosting: any,
    tones: ('professional' | 'enthusiastic' | 'concise' | 'storytelling')[] = ['professional', 'enthusiastic', 'concise']
  ): Promise<Array<{ tone: string; content: string; atsAnalysis: ATSOptimizationResult }>> {
    const results = [];

    for (const tone of tones) {
      try {
        const result = await this.generateResume(userProfile, jobPosting, { tone });
        results.push({ tone, content: result.content, atsAnalysis: result.atsAnalysis });
        await sleep(1000); // Rate limiting
      } catch (error) {
        logger.error(`Failed to generate ${tone} version:`, error);
      }
    }

    return results;
  }
}

export const aiResumeGenerator = new AIResumeGenerator();
export default aiResumeGenerator;