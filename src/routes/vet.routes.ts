import express from 'express';
import workingHoursRoutes from './workingHours.routes';
import {
  registerVet,
  getNearbyVets,
  getVetById,
  updateVetProfile,
  updateOnlineStatus,
  getVetDashboardStats,
  searchVets,
  getVetProfile,
  getVetEarnings,
  getVetAnalytics,
  getVetServices,
  getVetReviews,
  getVetWorkingHours
} from '../controllers/vetController';
import { protect, vetOnly } from '../middleware/auth';
import { uploadLicense } from '../middleware/upload';
import { vetRegistrationValidation } from '../middleware/validation';

const router = express.Router();

// Protected routes
router.use(protect);

// Public vet routes (no subscription check needed)
router.get('/nearby', getNearbyVets);
router.get('/search', searchVets);
router.get('/:id', getVetById);

// Vet registration (no subscription check needed yet)
router.post('/register', uploadLicense, vetRegistrationValidation, registerVet);

// Vet-only routes (don't require subscription check)
router.get('/profile', vetOnly, getVetProfile);
router.get('/dashboard-stats', vetOnly, getVetDashboardStats);
router.get('/working-hours', vetOnly, getVetWorkingHours);
router.get('/services', vetOnly, getVetServices);
router.get('/reviews', vetOnly, getVetReviews);
router.get('/earnings', vetOnly, getVetEarnings);
router.get('/analytics', vetOnly, getVetAnalytics);
router.put('/profile', vetOnly, updateVetProfile);
router.put('/online-status', vetOnly, updateOnlineStatus);

// Working hours sub-routes
router.use('/working-hours', workingHoursRoutes);

export default router;