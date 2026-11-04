import { Router } from 'express';
import jobsRouter from './jobs';
import applicationsRouter from './applications';
import profileRouter from './profile';
import aiRouter from './ai';

const router = Router();

// API version prefix
router.use('/jobs', jobsRouter);
router.use('/applications', applicationsRouter);
router.use('/profile', profileRouter);
router.use('/ai', aiRouter);

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API info
router.get('/', (req, res) => {
  res.json({
    name: 'Job Automation API',
    version: '1.0.0',
    description: 'Automated job search and application system',
    endpoints: {
      jobs: '/api/jobs',
      applications: '/api/applications',
      profile: '/api/profile',
      ai: '/api/ai',
      health: '/api/health',
    },
  });
});

export default router;