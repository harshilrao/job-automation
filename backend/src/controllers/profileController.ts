import { Request, Response } from 'express';
import { UserProfile } from '../models/UserProfile';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../utils/logger';
import { encrypt, decrypt } from '../utils/helpers';

export const getProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  let profile = await UserProfile.findOne({ userId });
  if (!profile) {
    // Create empty profile
    profile = await UserProfile.create({
      userId,
      personalInfo: {
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        address: {
          street: '',
          city: '',
          province: 'ON',
          postalCode: '',
          country: 'Canada',
        },
      },
      skills: {
        technical: [],
        soft: [],
        languages: [],
        certifications: [],
      },
      experience: [],
      education: [],
      projects: [],
      preferences: {
        desiredRoles: [],
        desiredLocations: [],
        salaryMin: 0,
        salaryMax: 0,
        jobTypes: [],
        industries: [],
        workAuthorization: 'Canadian Citizen',
      },
    });
  }

  // Decrypt sensitive fields for response
  const profileObj = profile.toObject();

  // Return decrypted version for frontend
  res.json({ profile: profileObj });
});

export const updateProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const updateData = req.body;

  // Remove fields that shouldn't be updated directly
  delete updateData.userId;
  delete updateData.encryptedFields;
  delete updateData.createdAt;
  delete updateData.updatedAt;

  const profile = await UserProfile.findOneAndUpdate(
    { userId },
    { $set: updateData },
    { new: true, upsert: true, runValidators: true }
  );

  if (!profile) {
    throw createError('Profile not found', 'NOT_FOUND', 404);
  }

  res.json({ profile });
});

export const updatePersonalInfo = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { personalInfo } = req.body;

  const profile = await UserProfile.findOneAndUpdate(
    { userId },
    { $set: { personalInfo } },
    { new: true, runValidators: true }
  );

  if (!profile) {
    throw createError('Profile not found', 'NOT_FOUND', 404);
  }

  res.json({ profile });
});

export const updateSkills = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { skills } = req.body;

  const profile = await UserProfile.findOneAndUpdate(
    { userId },
    { $set: { skills } },
    { new: true, runValidators: true }
  );

  if (!profile) {
    throw createError('Profile not found', 'NOT_FOUND', 404);
  }

  res.json({ profile });
});

export const addExperience = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const experience = req.body;

  const profile = await UserProfile.findOneAndUpdate(
    { userId },
    { $push: { experience: { $each: [experience], $position: 0 } } },
    { new: true, runValidators: true }
  );

  if (!profile) {
    throw createError('Profile not found', 'NOT_FOUND', 404);
  }

  res.json({ profile });
});

export const updateExperience = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { index, ...experience } = req.body;

  const profile = await UserProfile.findOne({ userId });
  if (!profile) {
    throw createError('Profile not found', 'NOT_FOUND', 404);
  }

  if (index < 0 || index >= profile.experience.length) {
    throw createError('Invalid experience index', 'VALIDATION_ERROR', 400);
  }

  profile.experience[index] = { ...(profile.experience[index] as any).toObject(), ...experience };
  await profile.save();

  res.json({ profile });
});

export const deleteExperience = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { index } = req.params;

  const profile = await UserProfile.findOne({ userId });
  if (!profile) {
    throw createError('Profile not found', 'NOT_FOUND', 404);
  }

  const idx = parseInt(index, 10);
  if (idx < 0 || idx >= profile.experience.length) {
    throw createError('Invalid experience index', 'VALIDATION_ERROR', 400);
  }

  profile.experience.splice(idx, 1);
  await profile.save();

  res.json({ profile });
});

export const addEducation = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const education = req.body;

  const profile = await UserProfile.findOneAndUpdate(
    { userId },
    { $push: { education: { $each: [education], $position: 0 } } },
    { new: true, runValidators: true }
  );

  if (!profile) {
    throw createError('Profile not found', 'NOT_FOUND', 404);
  }

  res.json({ profile });
});

export const updateEducation = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { index, ...education } = req.body;

  const profile = await UserProfile.findOne({ userId });
  if (!profile) {
    throw createError('Profile not found', 'NOT_FOUND', 404);
  }

  if (index < 0 || index >= profile.education.length) {
    throw createError('Invalid education index', 'VALIDATION_ERROR', 400);
  }

  profile.education[index] = { ...(profile.education[index] as any).toObject(), ...education };
  await profile.save();

  res.json({ profile });
});

export const deleteEducation = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { index } = req.params;

  const profile = await UserProfile.findOne({ userId });
  if (!profile) {
    throw createError('Profile not found', 'NOT_FOUND', 404);
  }

  const idx = parseInt(index, 10);
  if (idx < 0 || idx >= profile.education.length) {
    throw createError('Invalid education index', 'VALIDATION_ERROR', 400);
  }

  profile.education.splice(idx, 1);
  await profile.save();

  res.json({ profile });
});

export const addProject = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const project = req.body;

  const profile = await UserProfile.findOneAndUpdate(
    { userId },
    { $push: { projects: { $each: [project], $position: 0 } } },
    { new: true, runValidators: true }
  );

  if (!profile) {
    throw createError('Profile not found', 'NOT_FOUND', 404);
  }

  res.json({ profile });
});

export const updateProject = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { index, ...project } = req.body;

  const profile = await UserProfile.findOne({ userId });
  if (!profile) {
    throw createError('Profile not found', 'NOT_FOUND', 404);
  }

  if (index < 0 || index >= profile.projects.length) {
    throw createError('Invalid project index', 'VALIDATION_ERROR', 400);
  }

  profile.projects[index] = { ...(profile.projects[index] as any).toObject(), ...project };
  await profile.save();

  res.json({ profile });
});

export const deleteProject = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { index } = req.params;

  const profile = await UserProfile.findOne({ userId });
  if (!profile) {
    throw createError('Profile not found', 'NOT_FOUND', 404);
  }

  const idx = parseInt(index, 10);
  if (idx < 0 || idx >= profile.projects.length) {
    throw createError('Invalid project index', 'VALIDATION_ERROR', 400);
  }

  profile.projects.splice(idx, 1);
  await profile.save();

  res.json({ profile });
});

export const updatePreferences = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { preferences } = req.body;

  const profile = await UserProfile.findOneAndUpdate(
    { userId },
    { $set: { preferences } },
    { new: true, runValidators: true }
  );

  if (!profile) {
    throw createError('Profile not found', 'NOT_FOUND', 404);
  }

  res.json({ profile });
});

export const updateProfessionalSummary = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const { professionalSummary } = req.body;

  const profile = await UserProfile.findOneAndUpdate(
    { userId },
    { $set: { professionalSummary } },
    { new: true, runValidators: true }
  );

  if (!profile) {
    throw createError('Profile not found', 'NOT_FOUND', 404);
  }

  res.json({ profile });
});

export const exportProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const profile = await UserProfile.findOne({ userId });
  if (!profile) {
    throw createError('Profile not found', 'NOT_FOUND', 404);
  }

  // Return full profile data for export
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename=profile-export.json');
  res.send(JSON.stringify(profile.toObject(), null, 2));
});

export const importProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const profileData = req.body;

  // Validate and sanitize
  delete profileData.userId;
  delete profileData._id;
  delete profileData.encryptedFields;
  delete profileData.createdAt;
  delete profileData.updatedAt;

  const profile = await UserProfile.findOneAndUpdate(
    { userId },
    { $set: profileData },
    { new: true, upsert: true, runValidators: true }
  );

  res.json({ profile });
});