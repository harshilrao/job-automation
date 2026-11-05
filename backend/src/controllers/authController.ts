import { Request, Response } from 'express';
import { User } from '../models/User';
import { UserProfile } from '../models/UserProfile';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../utils/logger';
import { generateTokens, verifyRefreshToken } from '../middleware/auth';
import crypto from 'crypto';

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, firstName, lastName } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    throw createError('Email already registered', 'EMAIL_EXISTS', 409);
  }

  // Create user (password will be hashed by pre-save hook)
  const user = await User.create({
    email: email.toLowerCase(),
    passwordHash: password, // Will be hashed by pre-save hook
  });

  // Create initial empty profile with placeholder values for required fields
  await UserProfile.create({
    userId: user._id.toString(),
    personalInfo: {
      firstName: firstName || '',
      lastName: lastName || '',
      email: email.toLowerCase(),
      phone: '000-000-0000',
      address: {
        street: 'Not provided',
        city: 'Not provided',
        province: 'ON',
        postalCode: '00000',
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

  // Generate tokens
  const { accessToken, refreshToken } = generateTokens(user._id.toString(), user.email);

  // Save refresh token to user
  await user.addRefreshToken(refreshToken);

  // Update last login
  user.lastLoginAt = new Date();
  await user.save();

  logger.info(`New user registered: ${user.email}`);

  res.status(201).json({
    message: 'Registration successful',
    user: {
      id: user._id,
      email: user.email,
      isEmailVerified: user.isEmailVerified,
    },
    tokens: {
      accessToken,
      refreshToken,
    },
  });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  // Find user with password hash
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash +refreshTokens');
  if (!user) {
    throw createError('Invalid email or password', 'INVALID_CREDENTIALS', 401);
  }

  // Verify password
  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    throw createError('Invalid email or password', 'INVALID_CREDENTIALS', 401);
  }

  // Generate tokens
  const { accessToken, refreshToken } = generateTokens(user._id.toString(), user.email);

  // Save refresh token to user
  await user.addRefreshToken(refreshToken);

  // Update last login
  user.lastLoginAt = new Date();
  await user.save();

  logger.info(`User logged in: ${user.email}`);

  res.json({
    message: 'Login successful',
    user: {
      id: user._id,
      email: user.email,
      isEmailVerified: user.isEmailVerified,
    },
    tokens: {
      accessToken,
      refreshToken,
    },
  });
});

export const logout = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { refreshToken } = req.body;

  if (refreshToken && req.user) {
    const user = await User.findById(req.user.userId).select('+refreshTokens');
    if (user) {
      await user.removeRefreshToken(refreshToken);
    }
  }

  logger.info(`User logged out: ${req.user?.email}`);

  res.json({ message: 'Logged out successfully' });
});

export const logoutAll = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (req.user) {
    const user = await User.findById(req.user.userId).select('+refreshTokens');
    if (user) {
      user.refreshTokens = [];
      await user.save();
    }
  }

  logger.info(`User logged out from all devices: ${req.user?.email}`);

  res.json({ message: 'Logged out from all devices successfully' });
});

export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    throw createError('Refresh token required', 'REFRESH_TOKEN_REQUIRED', 400);
  }

  // Verify refresh token
  const decoded = verifyRefreshToken(refreshToken);
  if (!decoded) {
    throw createError('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN', 401);
  }

  // Find user and check if refresh token exists
  const user = await User.findById(decoded.userId).select('+refreshTokens');
  if (!user || !user.hasValidRefreshToken(refreshToken)) {
    throw createError('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN', 401);
  }

  // Generate new tokens
  const tokens = generateTokens(user._id.toString(), user.email);

  // Replace old refresh token with new one
  await user.removeRefreshToken(refreshToken);
  await user.addRefreshToken(tokens.refreshToken);

  logger.info(`Token refreshed for user: ${user.email}`);

  res.json({
    message: 'Token refreshed successfully',
    tokens,
  });
});

export const getMe = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const user = await User.findById(req.user.userId);
  if (!user) {
    throw createError('User not found', 'NOT_FOUND', 404);
  }

  res.json({
    user: {
      id: user._id,
      email: user.email,
      isEmailVerified: user.isEmailVerified,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    },
  });
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() });
  // Always return success to prevent email enumeration
  if (!user) {
    return res.json({
      message: 'If an account exists, a password reset link has been sent',
    });
  }

  // Generate reset token
  const resetToken = crypto.randomBytes(32).toString('hex');
  user.passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  user.passwordResetExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  await user.save();

  // TODO: Send email with reset token
  // For now, log the token (in production, send via email)
  logger.info(`Password reset token for ${user.email}: ${resetToken}`);

  res.json({
    message: 'If an account exists, a password reset link has been sent',
    // In development, include token for testing
    ...(process.env.NODE_ENV === 'development' && { resetToken }),
  });
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { token, password } = req.body;

  if (!token || !password) {
    throw createError('Token and new password are required', 'VALIDATION_ERROR', 400);
  }

  // Hash token to compare with stored hash
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: new Date() },
  }).select('+passwordHash +refreshTokens');

  if (!user) {
    throw createError('Invalid or expired reset token', 'INVALID_RESET_TOKEN', 400);
  }

  // Update password (will be hashed by pre-save hook)
  user.passwordHash = password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  // Invalidate all refresh tokens on password reset
  user.refreshTokens = [];
  await user.save();

  logger.info(`Password reset for user: ${user.email}`);

  res.json({ message: 'Password reset successful' });
});

export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.body;

  if (!token) {
    throw createError('Verification token required', 'VALIDATION_ERROR', 400);
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await User.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationExpires: { $gt: new Date() },
  });

  if (!user) {
    throw createError('Invalid or expired verification token', 'INVALID_VERIFICATION_TOKEN', 400);
  }

  user.isEmailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;
  await user.save();

  logger.info(`Email verified for user: ${user.email}`);

  res.json({ message: 'Email verified successfully' });
});

export const resendVerificationEmail = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw createError('Authentication required', 'AUTHENTICATION_ERROR', 401);
  }

  const user = await User.findById(req.user.userId);
  if (!user) {
    throw createError('User not found', 'NOT_FOUND', 404);
  }

  if (user.isEmailVerified) {
    return res.json({ message: 'Email is already verified' });
  }

  // Generate new verification token
  const verificationToken = crypto.randomBytes(32).toString('hex');
  user.emailVerificationToken = crypto.createHash('sha256').update(verificationToken).digest('hex');
  user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  await user.save();

  // TODO: Send verification email
  logger.info(`Verification token resent for ${user.email}: ${verificationToken}`);

  res.json({
    message: 'Verification email sent',
    ...(process.env.NODE_ENV === 'development' && { verificationToken }),
  });
});