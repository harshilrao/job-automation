import { Router } from 'express';
import * as applicationController from '../controllers/applicationController';
import { authenticate } from '../middleware/auth';
import { validate, schemas } from '../middleware/validation';

const router = Router();

router.use(authenticate);

// Application management
router.post('/apply', validate(schemas.applyToJob), applicationController.applyToJob);
router.get('/', applicationController.getApplications);
router.get('/stats', applicationController.getApplicationStats);
router.get('/intervention', applicationController.getNeedingIntervention);
router.get('/queue', applicationController.getQueueStatus);

// Specific routes must come before /:id to avoid :id capturing 'resumes'/'cover-letters'
router.get('/resumes', applicationController.getResumes);
router.get('/cover-letters', applicationController.getCoverLetters);

router.get('/:id', validate(schemas.idParam), applicationController.getApplicationById);

// Application actions
router.post('/:id/retry', validate(schemas.idParam), applicationController.retryApplication);
router.put('/:id/status', validate(schemas.idParam), applicationController.updateApplicationStatus);
router.post('/:id/withdraw', validate(schemas.idParam), applicationController.withdrawApplication);

// Bulk operations
router.post('/search-and-queue', applicationController.searchAndQueueJobs);

// Resume generation
router.post('/resume/generate', validate(schemas.generateResume), applicationController.generateResume);
router.get('/resumes/:id', validate(schemas.idParam), applicationController.getResumeById);

// Cover letter generation
router.post('/cover-letter/generate', validate(schemas.generateCoverLetter), applicationController.generateCoverLetter);

// ATS analysis
router.post('/ats/analyze', applicationController.analyzeATS);

// AI Models
router.get('/models', applicationController.getAvailableModels);

export default router;