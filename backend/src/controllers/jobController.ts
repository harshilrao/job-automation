import { Request, Response } from 'express';
import { JobPosting } from '../models/JobPosting';
import { JobSearchFilter, IJobSearchFilterDocument } from '../models/JobSearchFilter';
import { jobScraperService } from '../services/JobScraperService';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../utils/logger';
import mongoose from 'mongoose';

export const searchJobs = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  const {
    searchTerm,
    cities,
    jobTypes,
    experienceLevels,
    industries,
    departments,
    salaryMin,
    salaryMax,
    postedWithinHours,
    remoteOnly,
    hybridOnly,
    sources,
    excludedCompanies,
    excludedKeywords,
    requiredKeywords,
    page = 1,
    limit = 20,
    sortBy = 'postedDate',
    sortOrder = 'desc',
  } = req.query;

  const query: any = { isActive: true };

  if (searchTerm) {
    query.$text = { $search: searchTerm as string };
  }

  if (cities) {
    const cityArray = Array.isArray(cities) ? cities : [cities];
    query['location.city'] = { $in: cityArray };
  }

  if (jobTypes) {
    const typesArray = Array.isArray(jobTypes) ? jobTypes : [jobTypes];
    query.jobType = { $in: typesArray };
  }

  if (experienceLevels) {
    const levelsArray = Array.isArray(experienceLevels) ? experienceLevels : [experienceLevels];
    query.experienceLevel = { $in: levelsArray };
  }

  if (industries) {
    const industriesArray = Array.isArray(industries) ? industries : [industries];
    query.industry = { $in: industriesArray };
  }

  if (departments) {
    const deptsArray = Array.isArray(departments) ? departments : [departments];
    query.department = { $in: deptsArray };
  }

  if (salaryMin) {
    query.salaryMax = { $gte: Number(salaryMin) };
  }

  if (salaryMax) {
    query.salaryMin = { $lte: Number(salaryMax) };
  }

  if (postedWithinHours) {
    const cutoff = new Date(Date.now() - Number(postedWithinHours) * 60 * 60 * 1000);
    query.postedDate = { $gte: cutoff };
  }

  if (remoteOnly === 'true') {
    query['location.remote'] = true;
  }

  if (hybridOnly === 'true') {
    query['location.hybrid'] = true;
  }

  if (sources) {
    const sourcesArray = Array.isArray(sources) ? sources : [sources];
    query.source = { $in: sourcesArray };
  }

  if (excludedCompanies) {
    const companiesArray = Array.isArray(excludedCompanies) ? excludedCompanies : [excludedCompanies];
    query.company = { $nin: companiesArray };
  }

  if (requiredKeywords) {
    const keywordsArray = (Array.isArray(requiredKeywords) ? requiredKeywords : [requiredKeywords]) as string[];
    query.$and = keywordsArray.map((kw: string) => ({
      $or: [
        { title: { $regex: kw, $options: 'i' } },
        { description: { $regex: kw, $options: 'i' } },
        { skills: { $regex: kw, $options: 'i' } },
      ],
    }));
  }

  if (excludedKeywords) {
    const keywordsArray = (Array.isArray(excludedKeywords) ? excludedKeywords : [excludedKeywords]) as string[];
    query.$nor = keywordsArray.map((kw: string) => ({
      $or: [
        { title: { $regex: kw, $options: 'i' } },
        { description: { $regex: kw, $options: 'i' } },
      ],
    }));
  }

  const sort: any = {};
  sort[sortBy as string] = sortOrder === 'asc' ? 1 : -1;

  const skip = (Number(page) - 1) * Number(limit);

  const [jobs, total] = await Promise.all([
    JobPosting.find(query)
      .sort(sort)
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    JobPosting.countDocuments(query),
  ]);

  // If user is authenticated, add match scores
  let jobsWithScores = jobs;
  if (userId) {
    // This would be computed based on user profile skills
    // For now, just return jobs
  }

  res.json({
    jobs: jobsWithScores,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / Number(limit)),
    },
  });
});

export const getJobById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const job = await JobPosting.findById(id).lean();
  if (!job) {
    throw createError('Job not found', 'NOT_FOUND', 404);
  }

  res.json({ job });
});

export const getJobStats = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const stats = await jobScraperService.getStats();
  res.json({ stats });
});

export const triggerScrape = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  console.log('[SCRAPE] triggerScrape called, userId:', userId);
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  console.log('[SCRAPE] Calling jobScraperService.scrapeAllJobs()');
  const result = await jobScraperService.scrapeAllJobs();

  console.log('[SCRAPE] scrapeAllJobs completed:', {
    totalFound: result.meta.totalFound,
    uniqueJobs: result.meta.totalFound,
    errors: Object.keys(result.errors),
    duration: result.meta.duration,
  });

  res.json({
    message: 'Scraping completed',
    result: {
      totalFound: result.meta.totalFound,
      errors: result.errors,
      duration: result.meta.duration,
    },
  });
});

export const saveSearchFilter = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { name, isDefault, filters } = req.body;

  // If setting as default, unset other defaults
  if (isDefault) {
    await JobSearchFilter.updateMany(
      { userId, isDefault: true },
      { isDefault: false }
    );
  }

  const filter = await JobSearchFilter.create({
    userId,
    name,
    isDefault: isDefault || false,
    filters,
  });

  res.status(201).json({ filter });
});

export const getSearchFilters = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  console.log('[JOBS] getSearchFilters called, userId:', userId);
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const filters = await JobSearchFilter.find({ userId }).sort({ isDefault: -1, updatedAt: -1 });
  console.log('[JOBS] getSearchFilters found', filters.length, 'filters');
  res.json({ filters });
});

export const getDefaultSearchFilter = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const filter = await JobSearchFilter.getDefault(userId);
  res.json({ filter });
});

export const updateSearchFilter = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { id } = req.params;
  const { name, isDefault, filters } = req.body;

  const filter = await JobSearchFilter.findOneAndUpdate(
    { _id: id, userId },
    { name, isDefault, filters },
    { new: true }
  );

  if (!filter) {
    throw createError('Filter not found', 'NOT_FOUND', 404);
  }

  // If setting as default, unset other defaults
  if (isDefault) {
    await JobSearchFilter.updateMany(
      { userId, _id: { $ne: id }, isDefault: true },
      { isDefault: false }
    );
  }

  res.json({ filter });
});

export const deleteSearchFilter = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { id } = req.params;

  const filter = await JobSearchFilter.findOneAndDelete({ _id: id, userId });
  if (!filter) {
    throw createError('Filter not found', 'NOT_FOUND', 404);
  }

  res.json({ message: 'Filter deleted' });
});

export const setDefaultSearchFilter = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { id } = req.params;

  const filter = await JobSearchFilter.setDefault(userId, id);
  if (!filter) {
    throw createError('Filter not found', 'NOT_FOUND', 404);
  }

  res.json({ filter });
});

export const applySavedFilter = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { id } = req.params;
  const { page = 1, limit = 20 } = req.query;

  const filter = await JobSearchFilter.findOne({ _id: id, userId });
  if (!filter) {
    throw createError('Filter not found', 'NOT_FOUND', 404);
  }

  const query = (filter as unknown as IJobSearchFilterDocument).buildQuery();
  const skip = (Number(page) - 1) * Number(limit);

  const [jobs, total] = await Promise.all([
    JobPosting.find(query)
      .sort({ postedDate: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    JobPosting.countDocuments(query),
  ]);

  res.json({
    jobs,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / Number(limit)),
    },
  });
});

export const getCities = asyncHandler(async (req: Request, res: Response) => {
  const cities = await JobPosting.distinct('location.city', { isActive: true });
  res.json({ cities: cities.sort() });
});

export const getCompanies = asyncHandler(async (req: Request, res: Response) => {
  const companies = await JobPosting.distinct('company', { isActive: true });
  res.json({ companies: companies.sort() });
});

export const getSkills = asyncHandler(async (req: Request, res: Response) => {
  const skills = await JobPosting.distinct('skills', { isActive: true });
  res.json({ skills: skills.sort() });
});

export const getSources = asyncHandler(async (req: Request, res: Response) => {
  const sources = await JobPosting.distinct('source', { isActive: true });
  res.json({ sources });
});

export const getJobTypes = asyncHandler(async (req: Request, res: Response) => {
  const jobTypes = await JobPosting.distinct('jobType', { isActive: true });
  res.json({ jobTypes });
});

export const getExperienceLevels = asyncHandler(async (req: Request, res: Response) => {
  const levels = await JobPosting.distinct('experienceLevel', { isActive: true });
  res.json({ experienceLevels: levels });
});

export const getIndustries = asyncHandler(async (req: Request, res: Response) => {
  const industries = await JobPosting.distinct('industry', { isActive: true });
  res.json({ industries: industries.filter(Boolean).sort() });
});

export const getDepartments = asyncHandler(async (req: Request, res: Response) => {
  const departments = await JobPosting.distinct('department', { isActive: true });
  res.json({ departments: departments.filter(Boolean).sort() });
});