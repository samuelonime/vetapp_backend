import express from 'express';
import {
  createAppointment,
  getAppointments,
  getAppointmentById,
  updateAppointment,
  cancelAppointment,
  completeAppointment,
  getVetAppointments,
  getOwnerAppointments,
  getAvailableSlots,
  rescheduleAppointment
} from '../controllers/appointmentController';
import { protect, vetOnly, ownerOnly } from '../middleware/auth';
import { appointmentValidation } from '../middleware/validation';

const router = express.Router();

// Protected routes
router.use(protect);

// Appointments
router.post('/', appointmentValidation, createAppointment);
router.get('/', getAppointments);
router.get('/slots/:vetId', getAvailableSlots);
router.get('/:id', getAppointmentById);
router.put('/:id', updateAppointment);
router.patch('/:id/status', updateAppointment);
router.post('/:id/cancel', cancelAppointment);
router.post('/:id/complete', vetOnly, completeAppointment);
router.post('/:id/reschedule', rescheduleAppointment);

// User-specific appointments (using /user and /vet instead of /owner/appointments, /vet/appointments)
router.get('/user', ownerOnly, getOwnerAppointments);
router.get('/vet', vetOnly, getVetAppointments);

export default router;