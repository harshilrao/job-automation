import { Router } from 'express';
import * as authController from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { validate, schemas } from '../middleware/validation';

const router = Router();

// Public routes
router.post('/register', validate(schemas.register), authController.register);
router.post('/login', validate(schemas.login), authController.login);
router.post('/refresh', validate(schemas.refreshToken), authController.refreshToken);
router.post('/forgot-password', validate(schemas.forgotPassword), authController.forgotPassword);
router.post('/reset-password', validate(schemas.resetPassword), authController.resetPassword);
router.post('/verify-email', validate(schemas.verifyEmail), authController.verifyEmail);

// Protected routes (require authentication)
router.use(authenticate);
router.post('/logout', validate(schemas.logout), authController.logout);
router.post('/logout-all', authController.logoutAll);
router.get('/me', authController.getMe);
router.post('/resend-verification', authController.resendVerificationEmail);

export default router;