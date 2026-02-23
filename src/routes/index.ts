import express from 'express';
import authRoutes from './auth.routes';
import vetRoutes from './vet.routes';
import appointmentRoutes from './appointment.routes';
import chatRoutes from './chat.routes';
import paymentRoutes from './payment.routes';
import subscriptionRoutes from './subscription.routes';
import promotionRoutes from './promotion.routes';
import reviewRoutes from './review.routes';
import adminRoutes from './admin.routes';

const router = express.Router();

// API routes
router.use('/auth', authRoutes);
router.use('/vets', vetRoutes);
router.use('/appointments', appointmentRoutes);
router.use('/chats', chatRoutes);
router.use('/payments', paymentRoutes);
router.use('/subscriptions', subscriptionRoutes);
router.use('/promotions', promotionRoutes);
router.use('/reviews', reviewRoutes);
router.use('/admin', adminRoutes);

// Health check
router.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

export default router;