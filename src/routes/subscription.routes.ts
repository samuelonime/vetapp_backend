import express from 'express';
import {
  getSubscriptionPlans,
  subscribeToPlan,
  getCurrentSubscription,
  cancelSubscription,
  updateAutoRenew,
  getSubscriptionHistory,
  verifySubscriptionPayment,
  getSubscriptionAnalytics
} from '../controllers/subscriptionController';
import { protect, vetOnly } from '../middleware/auth';

const router = express.Router();

// Public routes
router.get('/plans', getSubscriptionPlans);

// Protected routes
router.use(protect);

// Subscription management
router.post('/subscribe', vetOnly, subscribeToPlan);
router.get('/current', vetOnly, getCurrentSubscription);
router.post('/cancel', vetOnly, cancelSubscription);
router.put('/auto-renew', vetOnly, updateAutoRenew);
router.get('/history', vetOnly, getSubscriptionHistory);
router.get('/analytics', vetOnly, getSubscriptionAnalytics);
router.get('/verify/:reference', verifySubscriptionPayment);

export default router;