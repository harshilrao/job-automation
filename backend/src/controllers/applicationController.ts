import { Request, Response } from 'express';
import { ApplicationRecord } from '../models/ApplicationRecord';
import { GeneratedResume, IResumeContent } from '../models/GeneratedResume';
import { CoverLetter } from '../models/CoverLetter';
import { JobPosting } from '../models/JobPosting';
import { applicationOrchestrator } from '../services/ApplicationOrchestrator';
import { aiResumeGenerator } from '../services/AIResumeGenerator';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../utils/logger';
import mongoose from 'mongoose';
import multer from 'multer';
import mammoth from 'mammoth';
import { UserProfile } from '../models/UserProfile';

const pdfParse = require('pdf-parse');

// Multer memory storage for resume upload parsing
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req: any, file: any, cb: any) => {
    const allowed = ['.pdf', '.docx', '.doc', '.txt'];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOCX, and TXT files are allowed'));
    }
  },
}).single('resume');

export const uploadResume = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  upload(req as any, res as any, async (err: any) => {
    if (err) {
      throw createError(err.message, 'VALIDATION_ERROR', 400);
    }

    const multerReq = req as any;
    if (!multerReq.file) {
      throw createError('No file uploaded', 'VALIDATION_ERROR', 400);
    }

    const { originalname, buffer, mimetype } = multerReq.file;
    const ext = originalname.toLowerCase().slice(originalname.lastIndexOf('.'));

    let extractedText = '';

    try {
      if (ext === '.pdf') {
        const pdfData = await pdfParse(buffer);
        extractedText = pdfData.text;
      } else if (ext === '.docx' || ext === '.doc') {
        const result = await mammoth.extractRawText({ buffer });
        extractedText = result.value;
      } else if (ext === '.txt') {
        extractedText = buffer.toString('utf-8');
      }
    } catch (parseErr: any) {
      logger.error('Resume parse error:', parseErr);
      throw createError('Failed to parse resume file', 'VALIDATION_ERROR', 422);
    }

    if (!extractedText || extractedText.trim().length === 0) {
      throw createError('No text could be extracted from the file', 'VALIDATION_ERROR', 422);
    }

    // Save extracted text to user profile
    const profile = await UserProfile.findOne({ userId });
    if (!profile) {
      throw createError('User profile not found. Please complete your profile first.', 'NOT_FOUND', 404);
    }

    profile.baseResumeText = extractedText;
    await profile.save();

    logger.info('Resume uploaded', { userId, fileName: originalname, textLength: extractedText.length });

    res.json({
      message: 'Resume uploaded successfully',
      text: extractedText,
      textLength: extractedText.length,
    });
  });
});

export const applyToJob = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { jobPostingId, resumeOptions, coverLetterOptions } = req.body;

  // Check if already applied
  const alreadyApplied = await ApplicationRecord.hasApplied(userId, new mongoose.Types.ObjectId(jobPostingId));
  if (alreadyApplied) {
    throw createError('Already applied to this job', 'DUPLICATE_ENTRY', 409);
  }

  // Add to orchestrator queue
  await applicationOrchestrator.addToQueue({
    jobPostingId,
    userId,
    priority: 50,
    resumeOptions,
    coverLetterOptions,
  });

  res.json({
    message: 'Application queued successfully',
    status: 'queued',
  });
});

export const getApplications = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { status, page = 1, limit = 20 } = req.query;

  const query: any = { userId };
  if (status) {
    query.status = status;
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [applications, total] = await Promise.all([
    ApplicationRecord.find(query)
      .populate('jobPostingId')
      .populate('resumeId')
      .populate('coverLetterId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    ApplicationRecord.countDocuments(query),
  ]);

  res.json({
    applications,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / Number(limit)),
    },
  });
});

export const getApplicationById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { id } = req.params;

  const application = await ApplicationRecord.findOne({ _id: id, userId })
    .populate('jobPostingId')
    .populate('resumeId')
    .populate('coverLetterId')
    .lean();

  if (!application) {
    throw createError('Application not found', 'NOT_FOUND', 404);
  }

  res.json({ application });
});

export const getApplicationStats = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const stats = await ApplicationRecord.getStats(userId);
  res.json({ stats });
});

export const getNeedingIntervention = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const applications = await applicationOrchestrator.getNeedingIntervention(userId);
  res.json({ applications });
});

export const retryApplication = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { id } = req.params;

  const application = await ApplicationRecord.findOne({ _id: id, userId });
  if (!application) {
    throw createError('Application not found', 'NOT_FOUND', 404);
  }

  await applicationOrchestrator.retryApplication(id);

  res.json({ message: 'Application re-queued for retry' });
});

export const updateApplicationStatus = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { id } = req.params;
  const { status, notes } = req.body;

  const application = await ApplicationRecord.findOne({ _id: id, userId });
  if (!application) {
    throw createError('Application not found', 'NOT_FOUND', 404);
  }

  application.status = status;
  if (notes) application.notes = notes;
  if (status === 'interview' && !application.responseReceivedAt) {
    application.responseReceivedAt = new Date();
  }

  await application.save();

  res.json({ application });
});

export const withdrawApplication = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { id } = req.params;

  const application = await ApplicationRecord.findOne({ _id: id, userId });
  if (!application) {
    throw createError('Application not found', 'NOT_FOUND', 404);
  }

  if (!['pending', 'in-progress', 'submitted'].includes(application.status)) {
    throw createError('Cannot withdraw application in current status', 'VALIDATION_ERROR', 400);
  }

  application.status = 'withdrawn';
  await application.save();

  res.json({ message: 'Application withdrawn', application });
});

export const getQueueStatus = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const status = applicationOrchestrator.getQueueStatus();
  res.json({ queue: status });
});

export const searchAndQueueJobs = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { searchTerm, cities, jobTypes, experienceLevels, maxApplications = 5 } = req.body;

  const count = await applicationOrchestrator.searchAndQueueJobs(userId, {
    searchTerm,
    cities,
    jobTypes,
    experienceLevels,
    maxApplications,
  });

  res.json({ message: `${count} jobs added to application queue`, count });
});

export const generateResume = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { jobPostingId, tone, focusKeywords, model } = req.body;
  console.log('[RESUME] generateResume called:', { userId, jobPostingId, tone, focusKeywords, model });

  const userProfile = await req.userProfile;
  if (!userProfile) {
    throw createError('User profile not found. Please complete your profile first.', 'NOT_FOUND', 404);
  }

  const jobPosting = await JobPosting.findById(jobPostingId);
  if (!jobPosting) {
    throw createError('Job posting not found', 'NOT_FOUND', 404);
  }

  console.log('[RESUME] User profile:', JSON.stringify(userProfile.toObject()).slice(0, 500));
  console.log('[RESUME] Job posting:', JSON.stringify(jobPosting.toObject()).slice(0, 500));

  const baseResumeText = req.body.baseResumeText || userProfile.baseResumeText;

  const result = await aiResumeGenerator.generateResume(
    userProfile.toObject(),
    jobPosting.toObject(),
    { tone, focusKeywords, model, baseResumeText }
  );

  console.log('[RESUME] Generation result:', {
    model: result.model,
    provider: result.provider,
    contentLength: result.content?.length || 0,
    contentPreview: result.content?.slice(0, 200),
    atsScore: result.atsAnalysis?.score,
    atsAnalysis: result.atsAnalysis,
  });

  // Save the generated resume - parse content into IResumeContent structure
  const resumeContent: IResumeContent = {
    professionalSummary: result.content.split('\n')[0] || 'Generated resume',
    skills: { technical: [], soft: [] },
    experience: [],
    education: [],
    projects: [],
    keywords: [],
  };

  const generatedResume = await GeneratedResume.createNewVersion(
    userId,
    jobPosting._id,
    resumeContent,
    result.model,
    result.provider
  );

  generatedResume.atsScore = result.atsAnalysis.score;
  generatedResume.atsAnalysis = result.atsAnalysis;
  generatedResume.rawContent = result.content;
  generatedResume.status = 'draft';
  await generatedResume.save();

  console.log('[RESUME] Saved to DB:', { id: generatedResume._id, status: generatedResume.status });

  res.json({
    resume: generatedResume,
    content: result.content,
    atsAnalysis: result.atsAnalysis,
  });
});

export const generateCoverLetter = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { jobPostingId, resumeId, tone, model } = req.body;

  const userProfile = await req.userProfile;
  if (!userProfile) {
    throw createError('User profile not found', 'NOT_FOUND', 404);
  }

  const jobPosting = await JobPosting.findById(jobPostingId);
  if (!jobPosting) {
    throw createError('Job posting not found', 'NOT_FOUND', 404);
  }

  const resume = await GeneratedResume.findById(resumeId);
  if (!resume) {
    throw createError('Resume not found', 'NOT_FOUND', 404);
  }

  const result = await aiResumeGenerator.generateCoverLetter(
    userProfile.toObject(),
    jobPosting.toObject(),
    resume.content.professionalSummary, // Simplified - would need full resume content
    { tone, model }
  );

  const coverLetter = await CoverLetter.createNewVersion(
    userId,
    jobPosting._id,
    resume._id,
    result.content,
    result.model,
    result.provider,
    tone || 'professional'
  );

  coverLetter.status = 'draft';
  await coverLetter.save();

  res.json({
    coverLetter,
    content: result.content,
  });
});

export const getResumes = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { jobPostingId } = req.query;

  const query: any = { userId };
  if (jobPostingId) {
    query.jobPostingId = jobPostingId;
  }

  const resumes = await GeneratedResume.find(query)
    .populate('jobPostingId')
    .sort({ createdAt: -1 })
    .lean();

  res.json({ resumes });
});

export const getResumeById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { id } = req.params;

  const resume = await GeneratedResume.findOne({ _id: id, userId })
    .populate('jobPostingId')
    .lean();

  if (!resume) {
    throw createError('Resume not found', 'NOT_FOUND', 404);
  }

  res.json({ resume });
});

export const getCoverLetters = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { jobPostingId, resumeId } = req.query;

  const query: any = { userId };
  if (jobPostingId) query.jobPostingId = jobPostingId;
  if (resumeId) query.resumeId = resumeId;

  const coverLetters = await CoverLetter.find(query)
    .populate('jobPostingId')
    .populate('resumeId')
    .sort({ createdAt: -1 })
    .lean();

  res.json({ coverLetters });
});

export const getAvailableModels = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const models = await aiResumeGenerator.getAvailableModels();
  res.json({ models });
});

export const analyzeATS = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { resumeId, jobPostingId } = req.body;

  const resume = await GeneratedResume.findOne({ _id: resumeId, userId });
  if (!resume) {
    throw createError('Resume not found', 'NOT_FOUND', 404);
  }

  const jobPosting = await JobPosting.findById(jobPostingId);
  if (!jobPosting) {
    throw createError('Job posting not found', 'NOT_FOUND', 404);
  }

  // Convert resume content to string for analysis
  const resumeText = JSON.stringify(resume.content);

  const analysis = await aiResumeGenerator.analyzeATSCompatibility(resumeText, jobPosting.description);

  // Update resume with analysis
  resume.atsScore = analysis.score;
  resume.atsAnalysis = analysis;
  await resume.save();

  res.json({ analysis });
});