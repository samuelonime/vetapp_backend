// src/routes/workingHours.routes.ts
import express from 'express';
import { protect, vetOnly } from '../middleware/auth';
import {
  setWorkingHours,
  getWorkingHours,
  getVetWorkingHoursById
} from '../controllers/workingHours.controller';

const router = express.Router();

// Vet-only routes
router.use(protect, vetOnly);
router.put('/', setWorkingHours);
router.get('/', getWorkingHours);

// Public route (with authentication)
router.get('/:id/working-hours', protect, getVetWorkingHoursById);

export default router;