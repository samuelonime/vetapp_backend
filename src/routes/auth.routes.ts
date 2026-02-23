import express from 'express';
import {
  register,
  registerOwner,
  registerVet,
  login,
  logout,
  getMe,
  updateProfile,
  updateVetProfile,
  refreshToken,
  verifyEmail,
  updateLocation,
  updateFCMToken,
  forgotPassword,
  resetPassword,
  changePassword,
  verifyVetLicense
} from '../controllers/authController';
import { protect } from '../middleware/auth';
import {
  registerValidation,
  loginValidation
} from '../middleware/validation';

const router = express.Router();

// Public routes
router.post('/register', registerValidation, register);
router.post('/register/owner', registerValidation, registerOwner);
router.post('/register/vet', registerValidation, registerVet);
router.post('/login', loginValidation, login);
router.post('/refresh-token', refreshToken);
router.get('/verify-email/:token', verifyEmail);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Protected routes
router.use(protect);
router.post('/logout', logout);
router.get('/me', getMe);
router.get('/profile', getMe);
router.put('/profile', updateProfile);
router.put('/vet/profile', updateVetProfile);
router.post('/vet/verify', verifyVetLicense);
router.post('/change-password', changePassword);
router.put('/location', updateLocation);
router.put('/fcm-token', updateFCMToken);

export default router;