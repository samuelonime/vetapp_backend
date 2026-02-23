import express from 'express';
import {
  getDashboardStats,
  getPendingVetApprovals,
  approveVet,
  rejectVet,
  getAllUsers,
  getUserDetails,
  updateUserStatus,
  getAllTransactions,
  getFinancialReport,
  getSystemAnalytics,
  getRecentActivities,
  getRevenueData
} from '../controllers/adminController';
import { protect, adminOnly } from '../middleware/auth';

const router = express.Router();

// Protected admin routes
router.use(protect);
router.use(adminOnly);

// Dashboard
router.get('/dashboard', getDashboardStats);
router.get('/analytics', getSystemAnalytics);
router.get('/activities', getRecentActivities);
router.get('/revenue/:timeframe', getRevenueData);

// Vet management
router.get('/vets/pending', getPendingVetApprovals);
router.put('/vets/:id/approve', approveVet);
router.put('/vets/:id/reject', rejectVet);

// User management
router.get('/users', getAllUsers);
router.get('/users/:id', getUserDetails);
router.put('/users/:id/status', updateUserStatus);

// Financial management
router.get('/transactions', getAllTransactions);
router.get('/financial-report', getFinancialReport);

export default router;