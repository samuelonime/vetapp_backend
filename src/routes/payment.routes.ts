import express from 'express';
import {
  initializePayment,
  verifyPayment,
  processPayout,
  getPaymentHistory,
  getVetEarnings
} from '../controllers/paymentController';
import { protect, vetOnly } from '../middleware/auth';
import { paymentValidation } from '../middleware/validation';

const router = express.Router();

// Protected routes
router.use(protect);

// Payment processing
router.post('/initialize', paymentValidation, initializePayment);
router.get('/verify/:reference', verifyPayment);
router.get('/history', getPaymentHistory);

// Vet earnings
router.get('/earnings', vetOnly, getVetEarnings);
router.post('/payout', vetOnly, processPayout);

export default router;