import { Request, Response } from 'express';
import { freeClaudeClient } from '../config/free-claude';
import { aiResumeGenerator } from '../services/AIResumeGenerator';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../utils/logger';

export const getFreeClaudeStatus = asyncHandler(async (req: Request, res: Response) => {
  const healthy = await freeClaudeClient.healthCheck();
  const models = await freeClaudeClient.listModels();

  res.json({
    healthy,
    models: models.map(m => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
      supportsTools: m.supportsTools,
      supportsVision: m.supportsVision,
    })),
  });
});

export const getAvailableModels = asyncHandler(async (req: Request, res: Response) => {
  const models = await aiResumeGenerator.getAvailableModels();
  res.json({ models });
});

export const testFreeClaude = asyncHandler(async (req: Request, res: Response) => {
  const { prompt, model } = req.body;

  if (!prompt) {
    throw createError('Prompt is required', 'VALIDATION_ERROR', 400);
  }

  const response = await freeClaudeClient.chatCompletion({
    model: model || 'open_router/openrouter/free',
    messages: [
      { role: 'user', content: prompt },
    ],
    temperature: 1,
    maxTokens: 4096,
  });

  res.json({
    response: response.choices[0]?.message?.content,
    usage: response.usage,
  });
});

export const streamFreeClaude = asyncHandler(async (req: Request, res: Response) => {
  const { prompt, model } = req.body;

  if (!prompt) {
    throw createError('Prompt is required', 'VALIDATION_ERROR', 400);
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    for await (const chunk of freeClaudeClient.streamChatCompletion({
      model: model || 'open_router/openrouter/free',
      messages: [{ role: 'user', content: prompt }],
      temperature: 1,
      maxTokens: 4096,
      stream: true,
    })) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error: any) {
    logger.error('Stream error:', error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

export const extractKeywords = asyncHandler(async (req: Request, res: Response) => {
  const { text, maxKeywords = 20 } = req.body;

  if (!text) {
    throw createError('Text is required', 'VALIDATION_ERROR', 400);
  }

  const response = await freeClaudeClient.chatCompletion({
    model: 'open_router/openrouter/free',
    messages: [
      {
        role: 'system',
        content: `Extract the top ${maxKeywords} most important technical keywords, skills, and technologies from the given text. Return ONLY a JSON array of strings.`,
      },
      { role: 'user', content: text },
    ],
    temperature: 1,
    maxTokens: 2048,
  });

  let keywords: string[] = [];
  try {
    keywords = JSON.parse(response.choices[0]?.message?.content || '[]');
  } catch {
    // Fallback: extract from response text
    keywords = response.choices[0]?.message?.content
      ?.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .slice(0, maxKeywords) || [];
  }

  res.json({ keywords });
});

export const improveResume = asyncHandler(async (req: Request, res: Response) => {
  const { resume, jobDescription, focus } = req.body;

  if (!resume || !jobDescription) {
    throw createError('Resume and job description are required', 'VALIDATION_ERROR', 400);
  }

  const systemPrompt = `You are an expert resume optimizer. Improve the resume to better match the job description.
Focus on: ${focus || 'overall ATS compatibility and relevance'}
Return ONLY the improved resume content.`;

  const response = await freeClaudeClient.chatCompletion({
    model: 'open_router/openrouter/free',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Job Description:\n${jobDescription}\n\nCurrent Resume:\n${resume}\n\nImprove this resume for the job.`,
      },
    ],
    temperature: 1,
    maxTokens: 8192,
  });

  res.json({
    improvedResume: response.choices[0]?.message?.content,
  });
});

export const generateInterviewPrep = asyncHandler(async (req: Request, res: Response) => {
  const { jobDescription, resume, userProfile } = req.body;

  if (!jobDescription) {
    throw createError('Job description is required', 'VALIDATION_ERROR', 400);
  }

  const systemPrompt = `You are an interview coach. Generate comprehensive interview preparation materials including:
1. Likely technical questions with sample answers
2. Behavioral questions with STAR method examples
3. Questions to ask the interviewer
4. Company research talking points
5. Salary negotiation tips

Return as structured JSON.`;

  const response = await freeClaudeClient.chatCompletion({
    model: 'open_router/openrouter/free',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Job Description:\n${jobDescription}\n\nResume:\n${resume || 'Not provided'}\n\nUser Profile:\n${JSON.stringify(userProfile || {}, null, 2)}`,
      },
    ],
    temperature: 1,
    maxTokens: 8192,
  });

  let prep: any = {};
  try {
    prep = JSON.parse(response.choices[0]?.message?.content || '{}');
  } catch {
    prep = { raw: response.choices[0]?.message?.content };
  }

  res.json({ prep });
});

export const analyzeJobFit = asyncHandler(async (req: Request, res: Response) => {
  const { jobDescription, userProfile } = req.body;

  if (!jobDescription || !userProfile) {
    throw createError('Job description and user profile are required', 'VALIDATION_ERROR', 400);
  }

  const systemPrompt = `Analyze how well the user profile matches the job description. Return a JSON object with:
{
  "overallFit": number (0-100),
  "skillMatch": number (0-100),
  "experienceMatch": number (0-100),
  "educationMatch": number (0-100),
  "matchedSkills": string[],
  "missingSkills": string[],
  "strengths": string[],
  "gaps": string[],
  "recommendations": string[],
  "estimatedCompetitiveness": "high" | "medium" | "low"
}`;

  const response = await freeClaudeClient.chatCompletion({
    model: 'open_router/openrouter/free',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Job Description:\n${jobDescription}\n\nUser Profile:\n${JSON.stringify(userProfile, null, 2)}`,
      },
    ],
    temperature: 1,
    maxTokens: 4096,
  });

  let analysis: any = {};
  try {
    analysis = JSON.parse(response.choices[0]?.message?.content || '{}');
  } catch {
    analysis = { raw: response.choices[0]?.message?.content };
  }

  res.json({ analysis });
});

export const rewriteBulletPoints = asyncHandler(async (req: Request, res: Response) => {
  const { bullets, jobDescription, tone = 'professional' } = req.body;

  if (!bullets || !Array.isArray(bullets)) {
    throw createError('Bullets array is required', 'VALIDATION_ERROR', 400);
  }

  const toneInstructions = {
    professional: 'Use formal, results-oriented language with metrics',
    enthusiastic: 'Use energetic language showing passion and impact',
    concise: 'Be brief and punchy, focus on key achievements',
    storytelling: 'Frame as mini-stories with context, action, result',
  };

  const systemPrompt = `Rewrite the following bullet points to be more impactful and tailored to the job description.
${toneInstructions[tone as keyof typeof toneInstructions] || toneInstructions.professional}
Focus on quantifiable achievements and relevant keywords.
Return ONLY a JSON array of improved bullet points.`;

  const response = await freeClaudeClient.chatCompletion({
    model: 'open_router/openrouter/free',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Job Description:\n${jobDescription || 'Not provided'}\n\nCurrent Bullets:\n${bullets.map((b: string, i: number) => `${i + 1}. ${b}`).join('\n')}`,
      },
    ],
    temperature: 1,
    maxTokens: 4096,
  });

  let improvedBullets: string[] = [];
  try {
    improvedBullets = JSON.parse(response.choices[0]?.message?.content || '[]');
  } catch {
    improvedBullets = response.choices[0]?.message?.content
      ?.split('\n')
      .map(l => l.trim().replace(/^\d+\.\s*/, ''))
      .filter(l => l.length > 0) || bullets;
  }

  res.json({ bullets: improvedBullets });
});

export const generateThankYouNote = asyncHandler(async (req: Request, res: Response) => {
  const { interviewerName, jobTitle, company, interviewNotes, tone = 'professional' } = req.body;

  if (!interviewerName || !jobTitle || !company) {
    throw createError('Interviewer name, job title, and company are required', 'VALIDATION_ERROR', 400);
  }

  const toneInstructions = {
    professional: 'Formal and polished',
    enthusiastic: 'Warm and appreciative',
    concise: 'Brief and direct',
    storytelling: 'Personal and memorable',
  };

  const systemPrompt = `Write a thank you note after a job interview.
${toneInstructions[tone as keyof typeof toneInstructions] || toneInstructions.professional}
Include specific references to the conversation.
Keep it professional and timely.`;

  const response = await freeClaudeClient.chatCompletion({
    model: 'open_router/openrouter/free',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Interviewer: ${interviewerName}
Job Title: ${jobTitle}
Company: ${company}
Interview Notes: ${interviewNotes || 'General discussion about role and experience'}
Tone: ${tone}`,
      },
    ],
    temperature: 1,
    maxTokens: 2048,
  });

  res.json({
    note: response.choices[0]?.message?.content,
  });
});

export const negotiateSalary = asyncHandler(async (req: Request, res: Response) => {
  const { currentOffer, targetSalary, justification, company, role } = req.body;

  if (!currentOffer || !targetSalary) {
    throw createError('Current offer and target salary are required', 'VALIDATION_ERROR', 400);
  }

  const systemPrompt = `Write a professional salary negotiation email/script.
Be respectful, data-driven, and collaborative.
Include market research justification and value proposition.`;

  const response = await freeClaudeClient.chatCompletion({
    model: 'open_router/openrouter/free',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Current Offer: $${currentOffer}
Target Salary: $${targetSalary}
Justification: ${justification || 'Market rate and experience'}
Company: ${company || 'Not specified'}
Role: ${role || 'Not specified'}`,
      },
    ],
    temperature: 1,
    maxTokens: 4096,
  });

  res.json({
    negotiation: response.choices[0]?.message?.content,
  });
});