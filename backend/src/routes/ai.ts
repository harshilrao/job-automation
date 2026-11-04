import { Router } from 'express';
import * as aiController from '../controllers/aiController';
import { optionalAuth } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { z } from 'zod';

const router = Router();

// Public AI endpoints (with optional auth for rate limiting)
router.use(optionalAuth);

// Free Claude status and models
router.get('/free-claude/status', aiController.getFreeClaudeStatus);
router.get('/models', aiController.getAvailableModels);

// Test endpoints
router.post('/free-claude/test', validate(z.object({ body: z.object({ prompt: z.string(), model: z.string().optional() }) })), aiController.testFreeClaude);
router.post('/free-claude/stream', validate(z.object({ body: z.object({ prompt: z.string(), model: z.string().optional() }) })), aiController.streamFreeClaude);

// Utility endpoints
router.post('/extract-keywords', validate(z.object({ body: z.object({ text: z.string(), maxKeywords: z.number().optional() }) })), aiController.extractKeywords);
router.post('/improve-resume', validate(z.object({ body: z.object({ resume: z.string(), jobDescription: z.string(), focus: z.string().optional() }) })), aiController.improveResume);
router.post('/interview-prep', validate(z.object({ body: z.object({ jobDescription: z.string(), resume: z.string().optional(), userProfile: z.any().optional() }) })), aiController.generateInterviewPrep);
router.post('/analyze-fit', validate(z.object({ body: z.object({ jobDescription: z.string(), userProfile: z.any() }) })), aiController.analyzeJobFit);
router.post('/rewrite-bullets', validate(z.object({ body: z.object({ bullets: z.array(z.string()), jobDescription: z.string().optional(), tone: z.enum(['professional', 'enthusiastic', 'concise', 'storytelling']).optional() }) })), aiController.rewriteBulletPoints);
router.post('/thank-you-note', validate(z.object({ body: z.object({ interviewerName: z.string(), jobTitle: z.string(), company: z.string(), interviewNotes: z.string().optional(), tone: z.enum(['professional', 'enthusiastic', 'concise', 'storytelling']).optional() }) })), aiController.generateThankYouNote);
router.post('/negotiate-salary', validate(z.object({ body: z.object({ currentOffer: z.number(), targetSalary: z.number(), justification: z.string().optional(), company: z.string().optional(), role: z.string().optional() }) })), aiController.negotiateSalary);

export default router;