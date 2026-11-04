import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { logger } from '../utils/logger';
import { ERROR_CODES, HTTP_STATUS } from '../utils/constants';

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: any;

  constructor(message: string, code: string, statusCode: number, details?: any) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}

export const createError = (
  message: string,
  code: keyof typeof ERROR_CODES = 'INTERNAL_ERROR',
  statusCode: number = HTTP_STATUS.INTERNAL_SERVER_ERROR,
  details?: any
): AppError => {
  return new AppError(message, ERROR_CODES[code], statusCode, details);
};

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  logger.error('Error:', {
    message: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
  });

  // Zod validation errors
  if (error instanceof ZodError) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      error: 'Validation failed',
      code: ERROR_CODES.VALIDATION_ERROR,
      details: error.errors.map(e => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  // Mongoose validation errors
  if (error instanceof mongoose.Error.ValidationError) {
    const details = Object.values(error.errors).map(e => ({
      field: e.path,
      message: e.message,
    }));

    res.status(HTTP_STATUS.BAD_REQUEST).json({
      error: 'Validation failed',
      code: ERROR_CODES.VALIDATION_ERROR,
      details,
    });
    return;
  }

  // Mongoose duplicate key error
  if (error instanceof mongoose.Error && error.name === 'MongoServerError' && (error as any).code === 11000) {
    const field = Object.keys((error as any).keyPattern)[0];
    res.status(HTTP_STATUS.CONFLICT).json({
      error: 'Duplicate entry',
      code: ERROR_CODES.DUPLICATE_ENTRY,
      details: { field },
    });
    return;
  }

  // Mongoose cast error (invalid ObjectId)
  if (error instanceof mongoose.Error.CastError) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      error: 'Invalid ID format',
      code: ERROR_CODES.VALIDATION_ERROR,
      details: { field: error.path, value: error.value },
    });
    return;
  }

  // Custom app errors
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
      details: error.details,
    });
    return;
  }

  // JWT errors
  if (error.name === 'JsonWebTokenError') {
    res.status(HTTP_STATUS.UNAUTHORIZED).json({
      error: 'Invalid token',
      code: ERROR_CODES.AUTHENTICATION_ERROR,
    });
    return;
  }

  if (error.name === 'TokenExpiredError') {
    res.status(HTTP_STATUS.UNAUTHORIZED).json({
      error: 'Token expired',
      code: ERROR_CODES.AUTHENTICATION_ERROR,
    });
    return;
  }

  // Default error
  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : error.message,
    code: ERROR_CODES.INTERNAL_ERROR,
  });
};

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(HTTP_STATUS.NOT_FOUND).json({
    error: 'Route not found',
    code: ERROR_CODES.NOT_FOUND,
    details: { path: req.path, method: req.method },
  });
};

export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export default errorHandler;