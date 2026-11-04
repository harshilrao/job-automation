import { Router } from 'express';
import * as profileController from '../controllers/profileController';
import { authenticate } from '../middleware/auth';
import { validate, schemas } from '../middleware/validation';

const router = Router();

router.use(authenticate);

// Profile CRUD
router.get('/', profileController.getProfile);
router.put('/', profileController.updateProfile);

// Personal info
router.put('/personal-info', profileController.updatePersonalInfo);

// Skills
router.put('/skills', profileController.updateSkills);

// Experience
router.post('/experience', profileController.addExperience);
router.put('/experience/:index', profileController.updateExperience);
router.delete('/experience/:index', profileController.deleteExperience);

// Education
router.post('/education', profileController.addEducation);
router.put('/education/:index', profileController.updateEducation);
router.delete('/education/:index', profileController.deleteEducation);

// Projects
router.post('/projects', profileController.addProject);
router.put('/projects/:index', profileController.updateProject);
router.delete('/projects/:index', profileController.deleteProject);

// Preferences
router.put('/preferences', profileController.updatePreferences);

// Professional summary
router.put('/summary', profileController.updateProfessionalSummary);

// Import/Export
router.get('/export', profileController.exportProfile);
router.post('/import', profileController.importProfile);

export default router;