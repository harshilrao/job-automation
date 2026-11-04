import { Router } from 'express';
import * as jobController from '../controllers/jobController';
import { authenticate, optionalAuth } from '../middleware/auth';
import { validate, schemas } from '../middleware/validation';

const router = Router();

// Public routes
router.get('/stats', jobController.getJobStats);
router.get('/cities', jobController.getCities);
router.get('/companies', jobController.getCompanies);
router.get('/skills', jobController.getSkills);
router.get('/sources', jobController.getSources);
router.get('/job-types', jobController.getJobTypes);
router.get('/experience-levels', jobController.getExperienceLevels);
router.get('/industries', jobController.getIndustries);
router.get('/departments', jobController.getDepartments);

// Protected routes
router.use(authenticate);

router.get('/search', validate(schemas.jobSearch), jobController.searchJobs);
router.get('/:id', validate(schemas.jobId), jobController.getJobById);

// Search filters
router.post('/filters', validate(schemas.jobSearchFilter), jobController.saveSearchFilter);
router.get('/filters', jobController.getSearchFilters);
router.get('/filters/default', jobController.getDefaultSearchFilter);
router.put('/filters/:id', validate(schemas.idParam), jobController.updateSearchFilter);
router.delete('/filters/:id', validate(schemas.idParam), jobController.deleteSearchFilter);
router.post('/filters/:id/default', validate(schemas.idParam), jobController.setDefaultSearchFilter);
router.post('/filters/:id/apply', validate(schemas.idParam), jobController.applySavedFilter);

// Admin/scraper routes
router.post('/scrape', jobController.triggerScrape);

export default router;