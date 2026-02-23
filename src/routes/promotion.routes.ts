import express from 'express';
import {
  getPromotionPackages,
  createPromotion,
  getActivePromotions,
  getPromotionAnalytics,
  cancelPromotion,
  recordImpression,
  recordClick,
  verifyPromotionPayment,
  getPromotionReport
} from '../controllers/promotionController';
import { protect, vetOnly } from '../middleware/auth';

const router = express.Router();

// Public routes
router.get('/packages', getPromotionPackages);
router.post('/:id/impression', recordImpression);
router.post('/:id/click', recordClick);

// Protected routes
router.use(protect);

// Promotion management
router.post('/create', vetOnly, createPromotion);
router.get('/active', vetOnly, getActivePromotions);
router.get('/:id/analytics', vetOnly, getPromotionAnalytics);
router.post('/:id/cancel', vetOnly, cancelPromotion);
router.get('/report', vetOnly, getPromotionReport);
router.get('/verify/:reference', verifyPromotionPayment);

export default router;