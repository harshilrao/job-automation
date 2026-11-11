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
  baseResumeText?: string;
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
    console.log('[AI] Starting resume generation:', { model, provider, jobTitle: jobPosting.title });

    let content: string;

    if (provider === 'free-claude-code') {
      content = await this.generateWithFreeClaude(userProfile, jobPosting, options);
    } else if (provider === 'openrouter') {
      content = await this.generateWithOpenRouter(userProfile, jobPosting, options);
    } else if (provider === 'groq') {
      content = await this.generateWithGroq(userProfile, jobPosting, options);
      console.log('[AI] Groq generation complete, content length:', content?.length || 0);
    } else {
      // Fallback to free-claude
      content = await this.generateWithFreeClaude(userProfile, jobPosting, options);
    }

    console.log('[AI] Raw content generated:', { contentLength: content?.length || 0, preview: content?.slice(0, 200) });

    // Clean up tokenizer artifacts (q / / as space substitutes) and normalize spacing
    content = this.sanitizeResumeOutput(content);
    console.log('[AI] Sanitized content length:', content?.length || 0);

    // Analyze ATS compatibility (gracefully handle freeClaude being unavailable)
    let atsAnalysis: ATSOptimizationResult = {
      score: 0,
      keywordMatch: 0,
      formatScore: 0,
      readabilityScore: 0,
      missingKeywords: [],
      suggestions: ['ATS analysis skipped'],
    };
    try {
      atsAnalysis = await this.analyzeATSCompatibility(content, jobPosting.description);
      console.log('[AI] ATS analysis result:', atsAnalysis);
    } catch (error: any) {
      logger.error('ATS analysis failed:', error);
      console.error('[AI] ATS analysis error:', error.message);
    }

    // If score is low, try to optimize
    let optimizedContent = content;
    try {
      if (atsAnalysis.score < 75) {
        optimizedContent = await this.optimizeForATS(content, jobPosting, atsAnalysis);
        console.log('[AI] ATS optimization complete, optimized length:', optimizedContent?.length || 0);
      }
    } catch (error: any) {
      logger.error('ATS optimization failed:', error);
      console.error('[AI] ATS optimization error:', error.message);
      optimizedContent = content;
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
    jobDescription: string,
    model?: string
  ): Promise<ATSOptimizationResult> {
    // Try external API first (using same model as generation when provided)
    if (model) {
      try {
        const result = await this.analyzeATSWithAPI(resumeContent, jobDescription, model);
        if (result.score > 0) {
          return result;
        }
      } catch (error) {
        logger.error('ATS API analysis failed, falling back to local analysis:', error);
      }
    }

    // Fallback: local keyword-based ATS analysis (no external API needed)
    return this.localATSAnalysis(resumeContent, jobDescription);
  }

  /**
   * ATS analysis via external API (freeClaude/OpenRouter/Groq)
   */
  private async analyzeATSWithAPI(
    resumeContent: string,
    jobDescription: string,
    model: string
  ): Promise<ATSOptimizationResult> {
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

    const provider = this.getProviderForModel(model);

    let response: any;
    if (provider === 'free-claude-code') {
      response = await freeClaudeClient.chatCompletion({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 1,
        maxTokens: 4096,
      });
    } else if (provider === 'groq') {
      const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.ai.groqApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model.includes('/') ? model : `openai/${model}`,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 1,
          max_completion_tokens: 4096,
          stream: false,
        }),
      });
      const data = await groqResponse.json() as any;
      response = { choices: [{ message: { content: data.choices?.[0]?.message?.content || '' } }] };
    } else if (provider === 'openrouter') {
      const orResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.ai.openRouterApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 1,
          max_tokens: 4096,
        }),
      });
      const data = await orResponse.json() as any;
      response = { choices: [{ message: { content: data.choices?.[0]?.message?.content || '' } }] };
    } else {
      throw new Error(`Unsupported provider for ATS analysis: ${provider}`);
    }

    const content = response.choices?.[0]?.message?.content || '{}';
    try {
      return JSON.parse(content);
    } catch (e) {
      // Try to extract JSON from within the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      logger.error('Failed to parse ATS analysis response');
      return {
        score: 0,
        keywordMatch: 0,
        formatScore: 0,
        readabilityScore: 0,
        missingKeywords: [],
        suggestions: ['Failed to parse ATS analysis response'],
      };
    }
  }

  /**
   * Local ATS analysis fallback - no external API required
   * Computes score based on keyword matching between resume and job description
   */
  private localATSAnalysis(
    resumeContent: string,
    jobDescription: string
  ): ATSOptimizationResult {
    const lowerResume = resumeContent.toLowerCase();
    const lowerJob = jobDescription.toLowerCase();

    // Extract keywords from job description (simple word frequency)
    const jobWords = lowerJob
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3);

    // Common stop words to ignore
    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'been',
      'were', 'will', 'your', 'you', 'are', 'our', 'more', 'can', 'about',
      'job', 'role', 'position', 'work', 'team', 'company', 'looking',
      'seeking', 'need', 'needs', 'require', 'requires', 'experience',
      'skills', 'skill', 'strong', 'excellent', 'good', 'great', 'best',
    ]);

    const keywords = jobWords
      .filter((w) => !stopWords.has(w))
      .filter((w, i, arr) => arr.indexOf(w) === i) // unique
      .slice(0, 30);

    // Count matches in resume
    let matched = 0;
    const missing: string[] = [];
    for (const kw of keywords) {
      if (lowerResume.includes(kw)) {
        matched++;
      } else {
        missing.push(kw);
      }
    }

    const keywordMatch = keywords.length > 0 ? Math.round((matched / keywords.length) * 100) : 0;
    const score = Math.min(100, Math.round(keywordMatch * 0.7 + 30)); // Base 30 + keyword relevance

    const suggestions: string[] = [];
    if (missing.length > 0) {
      suggestions.push(`Consider adding these missing keywords: ${missing.slice(0, 10).join(', ')}`);
    }
    if (keywordMatch < 50) {
      suggestions.push('Tailor your resume more closely to the job description');
    }
    if (suggestions.length === 0) {
      suggestions.push('Good keyword alignment with the job description');
    }

    return {
      score,
      keywordMatch,
      formatScore: 80, // Assume decent format since structure is preserved
      readabilityScore: 80,
      missingKeywords: missing.slice(0, 10),
      suggestions,
    };
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
      baseResumeText: options.baseResumeText,
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
    const userPrompt = this.buildResumeUserPrompt(jobPosting, userProfile, options.focusKeywords, options.baseResumeText);

    const response = await retry(
      () => axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: options.model || 'openrouter/auto',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 1,
          max_tokens: 8192,
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
    const userPrompt = this.buildResumeUserPrompt(jobPosting, userProfile, options.focusKeywords, options.baseResumeText);
    const groqModel = options.model || config.ai.groqModel || 'openai/gpt-oss-120b';
    const modelId = groqModel.toLowerCase();
    console.log('[AI] Groq request:', { model: groqModel, jobTitle: jobPosting.title, company: jobPosting.company, promptLength: userPrompt.length });

    const reasoningModels = new Set([
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'qwen/qwen3.8-27b',
    ]);

    const response = await retry(
      () => axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: groqModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 1,
          max_completion_tokens: 4096,
          top_p: 1,
          // reasoning_effort is only supported by Groq reasoning models
          // (e.g. gpt-oss-120b, gpt-oss-20b). Sending it for non-reasoning
          // models (llama) causes a 400.
          ...(reasoningModels.has(modelId)
            ? { reasoning_effort: 'high' }
            : {}),
          stream: false,
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

    console.log('[AI] Groq response:', { status: response.status, hasChoices: Array.isArray(response.data.choices), contentLength: response.data.choices[0]?.message?.content?.length || 0 });
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
          temperature: 1,
          max_tokens: 4096,
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
          temperature: 1,
          max_tokens: 4096,
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

PRESERVE STRUCTURE EXACTLY:
- Use the EXACT same section headings as the current resume. Do NOT rename sections.
- Keep the EXACT same section order. Do NOT reorder sections.
- Do NOT add new sections (including no "KEYWORDS FOR ATS" section).
- Do NOT remove sections.
- Only improve wording inside existing sections.

Focus on:
1. Adding missing keywords naturally within existing sections: ${atsAnalysis.missingKeywords.join(', ')}
2. Improving format and readability within existing structure
3. Quantifying achievements with metrics
4. Keeping all facts truthful

Return ONLY the optimized resume content. Do NOT include a "KEYWORDS FOR ATS" section or any raw keyword list.`;

    const userPrompt = `Job Description:
${jobPosting.description}

Current Resume:
${resumeContent}

ATS Analysis:
- Score: ${atsAnalysis.score}/100
- Keyword Match: ${atsAnalysis.keywordMatch}/100
- Missing Keywords: ${atsAnalysis.missingKeywords.join(', ')}
- Suggestions: ${atsAnalysis.suggestions.join('; ')}

Optimize this resume for better ATS compatibility while preserving its exact structure. Do NOT add a KEYWORDS FOR ATS section.`;

    try {
      const response = await freeClaudeClient.chatCompletion({
        model: config.freeClaude.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 1,
        maxTokens: 8192,
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
    // Prefer Groq (has working API key)
    if (config.ai.groqApiKey) {
      return config.ai.groqModel || 'openai/gpt-oss-120b';
    }
    // Prefer OpenRouter if configured
    if (config.ai.openRouterApiKey) {
      return config.freeClaude.model;
    }
    // Fallback to free-claude-code
    if (config.freeClaude.url) {
      return config.freeClaude.model;
    }
    return 'openrouter/auto';
  }

  /**
   * Get provider for a model
   */
  private getProviderForModel(model: string): string {
    // Models with open_router/ prefix are served via free-claude-code proxy
    if (model.startsWith('open_router/')) {
      return 'free-claude-code';
    }
    if (model.includes('free-claude') || model.includes('gemini') || model.includes('deepseek')) {
      return 'free-claude-code';
    }
    // nvidia/nemotron and other models served directly via OpenRouter API
    if (model.includes('nvidia') || model.includes('openrouter') || model.includes('openrouter/')) {
      return 'openrouter';
    }
    if (model.includes('groq') || model.includes('llama') || model.includes('gpt-oss') || model.includes('openai/')) {
      return 'groq';
    }
    return 'openrouter';
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

  /**
   * Build resume user prompt
   */
  private buildResumeUserPrompt(
    jobPosting: any,
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
${jobPosting.description}

Job Title: ${jobPosting.title}
Company: ${jobPosting.company}
Location: ${jobPosting.location?.city}, ${jobPosting.location?.province}
Required Skills: ${jobPosting.skills?.join(', ') || 'Not specified'}
Experience Level: ${jobPosting.experienceLevel}

Candidate Profile:
${profileSummary}

${focusKeywordsLine}Create a tailored, ATS-optimized resume for this specific job.

CRITICAL: ${criticalInstruction} Only tailor the wording inside each section to match the job description while keeping all facts truthful. Follow the no-spacing-artifact rules and Month Year date format strictly.

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

  /**
   * Clean up common tokenizer artifacts from free model output
   * (e.g. "/" used as a space substitute) and normalize spacing.
   * The prompt is the primary defense against "q" artifacts; this handles
   * residual slash-spacing issues deterministically.
   */
  private sanitizeResumeOutput(text: string): string {
    if (!text) return text;
    return text
      // Replace slash used as a space substitute, but NOT slashes between non-space chars (e.g. "10/11", "http://")
      // Pattern 1: space-slash-nonSpace (" /2.5" -> " 2.5")
      .replace(/(\s)\/(\S)/g, '$1$2')
      // Pattern 2: nonSpace-slash-space ("years/ " -> "years ")
      .replace(/(\S)\/(\s)/g, '$1$2')
      // Pattern 3: slash at start of line ("/years" -> "years")
      .replace(/^\/(\S)/gm, '$1')
      // Pattern 4: slash at end of line ("skills/" -> "skills")
      .replace(/(\S)\/$/gm, '$1')
      // Collapse multiple spaces/tabs into one (preserve newlines)
      .replace(/[ \t]{2,}/g, ' ')
      // Trim trailing spaces on each line
      .replace(/[ \t]+$/gm, '')
      .trim();
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