import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';
import { logger } from '../utils/logger';

export const validate = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        }));

        logger.warn('Validation failed', { errors, path: req.path });

        res.status(400).json({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: errors,
        });
        return;
      }

      logger.error('Validation error:', error);
      res.status(500).json({
        error: 'Validation error',
        code: 'VALIDATION_ERROR',
      });
    }
  };
};

// Common validation schemas
export const schemas = {
  // Job search
  jobSearch: z.object({
    query: z.object({
      searchTerm: z.string().optional(),
      cities: z.array(z.string()).optional(),
      jobTypes: z.array(z.string()).optional(),
      experienceLevels: z.array(z.string()).optional(),
      industries: z.array(z.string()).optional(),
      departments: z.array(z.string()).optional(),
      salaryMin: z.number().optional(),
      salaryMax: z.number().optional(),
      postedWithinHours: z.number().optional(),
      remoteOnly: z.boolean().optional(),
      hybridOnly: z.boolean().optional(),
      sources: z.array(z.string()).optional(),
      excludedCompanies: z.array(z.string()).optional(),
      excludedKeywords: z.array(z.string()).optional(),
      requiredKeywords: z.array(z.string()).optional(),
      page: z.number().int().positive().default(1),
      limit: z.number().int().positive().max(100).default(20),
      sortBy: z.enum(['postedDate', 'salaryMax', 'title', 'company', 'matchScore']).default('postedDate'),
      sortOrder: z.enum(['asc', 'desc']).default('desc'),
    }),
  }),

  // Job ID param
  jobId: z.object({
    params: z.object({
      id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid job ID'),
    }),
  }),

  // User profile
  userProfile: z.object({
    body: z.object({
      personalInfo: z.object({
        firstName: z.string().min(1).max(50),
        lastName: z.string().min(1).max(50),
        email: z.string().email(),
        phone: z.string().min(10).max(20),
        address: z.object({
          street: z.string().min(1),
          city: z.string().min(1),
          province: z.string().min(1),
          postalCode: z.string().min(1),
          country: z.string().default('Canada'),
        }),
        linkedinUrl: z.string().url().optional().or(z.literal('')),
        githubUrl: z.string().url().optional().or(z.literal('')),
        portfolioUrl: z.string().url().optional().or(z.literal('')),
      }),
      professionalSummary: z.string().max(1000).optional(),
      skills: z.object({
        technical: z.array(z.string()).optional(),
        soft: z.array(z.string()).optional(),
        languages: z.array(z.string()).optional(),
        certifications: z.array(z.string()).optional(),
      }).optional(),
      experience: z.array(z.object({
        company: z.string().min(1),
        position: z.string().min(1),
        startDate: z.string().datetime(),
        endDate: z.string().datetime().optional(),
        current: z.boolean().default(false),
        description: z.array(z.string()).optional(),
        technologies: z.array(z.string()).optional(),
        location: z.string().optional(),
      })).optional(),
      education: z.array(z.object({
        institution: z.string().min(1),
        degree: z.string().min(1),
        fieldOfStudy: z.string().min(1),
        startDate: z.string().datetime(),
        endDate: z.string().datetime().optional(),
        gpa: z.string().optional(),
        honors: z.array(z.string()).optional(),
      })).optional(),
      projects: z.array(z.object({
        name: z.string().min(1),
        description: z.string().min(1),
        technologies: z.array(z.string()).optional(),
        url: z.string().url().optional().or(z.literal('')),
        githubUrl: z.string().url().optional().or(z.literal('')),
      })).optional(),
      preferences: z.object({
        desiredRoles: z.array(z.string()).optional(),
        desiredLocations: z.array(z.string()).optional(),
        salaryMin: z.number().min(0).optional(),
        salaryMax: z.number().min(0).optional(),
        jobTypes: z.array(z.string()).optional(),
        industries: z.array(z.string()).optional(),
        workAuthorization: z.string().optional(),
      }).optional(),
    }),
  }),

  // Resume generation
  generateResume: z.object({
    body: z.object({
      jobPostingId: z.string().regex(/^[0-9a-fA-F]{24}$/),
      tone: z.enum(['professional', 'enthusiastic', 'concise', 'storytelling']).default('professional'),
      focusKeywords: z.array(z.string()).optional(),
      model: z.string().optional(),
    }),
  }),

  // Cover letter generation
  generateCoverLetter: z.object({
    body: z.object({
      jobPostingId: z.string().regex(/^[0-9a-fA-F]{24}$/),
      resumeId: z.string().regex(/^[0-9a-fA-F]{24}$/),
      tone: z.enum(['professional', 'enthusiastic', 'concise', 'storytelling']).default('professional'),
      model: z.string().optional(),
    }),
  }),

  // Application
  applyToJob: z.object({
    body: z.object({
      jobPostingId: z.string().regex(/^[0-9a-fA-F]{24}$/),
      resumeId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
      coverLetterId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
      resumeOptions: z.object({
        tone: z.enum(['professional', 'enthusiastic', 'concise', 'storytelling']).default('professional'),
        focusKeywords: z.array(z.string()).optional(),
      }).optional(),
      coverLetterOptions: z.object({
        tone: z.enum(['professional', 'enthusiastic', 'concise', 'storytelling']).default('professional'),
      }).optional(),
    }),
  }),

  // Job search filter
  jobSearchFilter: z.object({
    body: z.object({
      name: z.string().min(1).max(100),
      isDefault: z.boolean().default(false),
      filters: z.object({
        searchTerm: z.string().optional(),
        locations: z.array(z.string()).optional(),
        jobTypes: z.array(z.string()).optional(),
        experienceLevels: z.array(z.string()).optional(),
        industries: z.array(z.string()).optional(),
        departments: z.array(z.string()).optional(),
        salaryMin: z.number().optional(),
        salaryMax: z.number().optional(),
        postedWithinHours: z.number().optional(),
        remoteOnly: z.boolean().default(false),
        hybridOnly: z.boolean().default(false),
        sources: z.array(z.string()).optional(),
        excludedCompanies: z.array(z.string()).optional(),
        excludedKeywords: z.array(z.string()).optional(),
        requiredKeywords: z.array(z.string()).optional(),
      }),
    }),
  }),

  // Pagination
  pagination: z.object({
    query: z.object({
      page: z.number().int().positive().default(1),
      limit: z.number().int().positive().max(100).default(20),
    }),
  }),

  // ID param
  idParam: z.object({
    params: z.object({
      id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID'),
    }),
  }),

  // User ID param
  userIdParam: z.object({
    params: z.object({
      userId: z.string().min(1),
    }),
  }),
};

export default validate;