import express from 'express';
import {
  createReview,
  getVetReviews,
  getMyReviews,
  updateReview,
  addVetReply,
  markAsHelpful, 
  reportReview,
  deleteReview,
  getReviewStatistics
} from '../controllers/reviewController';
import { protect, vetOnly, ownerOnly } from '../middleware/auth';
import { reviewValidation } from '../middleware/validation';

const router = express.Router();

// Public routes
router.get('/vet/:vetId', getVetReviews);
router.get('/stats/:vetId', getReviewStatistics);

// Protected routes
router.use(protect);

// Review management
router.post('/', ownerOnly, reviewValidation, createReview);
router.get('/my-reviews', getMyReviews);
router.put('/:id', ownerOnly, updateReview);
router.post('/:id/reply', vetOnly, addVetReply);
router.post('/:id/helpful', markAsHelpful);
router.post('/:id/report', reportReview);
router.delete('/:id', deleteReview);

export default router;