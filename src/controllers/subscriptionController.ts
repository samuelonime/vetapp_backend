import { Request, Response, NextFunction } from 'express';
import { PrismaClient, SubscriptionStatus, SubscriptionTier } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { ApiError, ApiResponse } from '../utils/response';
import logger from '../utils/logger';
import { PaystackService } from '../services/paystackService';
import { CommissionService } from '../services/commissionService';

const prisma = new PrismaClient();

// @desc    Get subscription plans
// @route   GET /api/v1/subscriptions/plans
// @access  Public
export const getSubscriptionPlans = async (
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const plans = [
      {
        tier: 'FREE' as SubscriptionTier,
        name: 'Free Plan',
        amount: 0,
        currency: 'NGN',
        features: {
          maxAppointments: 20,
          maxPromotions: 0,
          commissionRate: 0.25,
          featuredPriority: false,
          analyticsAccess: false,
          customBranding: false,
          dedicatedSupport: false,
          videoCallMinutes: 60
        },
        description: 'Perfect for starting out'
      },
      {
        tier: 'PRO' as SubscriptionTier,
        name: 'Pro Plan',
        amount: CommissionService.getTierPricing('PRO'),
        currency: 'NGN',
        features: {
          maxAppointments: 50,
          maxPromotions: 2,
          commissionRate: 0.10,
          featuredPriority: true,
          analyticsAccess: true,
          customBranding: false,
          dedicatedSupport: false,
          videoCallMinutes: 300
        },
        description: 'For growing veterinary practice'
      },
      {
        tier: 'ENTERPRISE' as SubscriptionTier,
        name: 'Enterprise Plan',
        amount: CommissionService.getTierPricing('ENTERPRISE'),
        currency: 'NGN',
        features: {
          maxAppointments: 0, // unlimited
          maxPromotions: 5,
          commissionRate: 0.08,
          featuredPriority: true,
          analyticsAccess: true,
          customBranding: true,
          dedicatedSupport: true,
          videoCallMinutes: 0 // unlimited
        },
        description: 'For established veterinary clinics'
      }
    ];

    res.status(200).json(new ApiResponse(200, 'Subscription plans', { plans }));
  } catch (error: any) {
    next(error);
  }
};

// @desc    Subscribe to a plan
// @route   POST /api/v1/subscriptions/subscribe
// @access  Private (Vet only)
export const subscribeToPlan = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only veterinarians can subscribe to plans');
    }

    const { tier, durationMonths = 1 } = req.body;

    if (!['PRO', 'ENTERPRISE'].includes(tier)) {
      throw new ApiError(400, 'Invalid subscription tier');
    }

    // Get vet profile
    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet profile not found');
    }

    // Check if already subscribed to this tier
    const activeSubscription = await prisma.subscription.findFirst({
      where: {
        vetId: vet.id,
        tier: tier as SubscriptionTier,
        status: SubscriptionStatus.ACTIVE,
        expiresAt: { gt: new Date() }
      }
    });

    if (activeSubscription) {
      throw new ApiError(400, `You already have an active ${tier} subscription`);
    }

    // Calculate amount
    const monthlyAmount = CommissionService.getTierPricing(tier);
    const totalAmount = monthlyAmount * durationMonths;

    // Calculate commission
    const commission = CommissionService.calculateSubscriptionCommission(totalAmount);

    // Create Paystack plan if not exists
    let paystackPlanCode = `VETCONNECT_${tier}_MONTHLY`;
    
    try {
      const planData = await PaystackService.createPlan({
        name: `VetConnect ${tier} Plan`,
        amount: monthlyAmount * 100, // Convert to kobo
        interval: 'monthly',
        currency: 'NGN'
      });
      paystackPlanCode = planData.data.plan_code;
    } catch (error) {
      logger.warn('Paystack plan creation failed, using default code', error);
    }

    // Create subscription record
    const startsAt = new Date();
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + durationMonths);

    const features = tier === 'PRO' ? {
      maxAppointments: 50,
      maxPromotions: 2,
      commissionRate: 0.10,
      featuredPriority: true,
      analyticsAccess: true,
      customBranding: false,
      dedicatedSupport: false,
      videoCallMinutes: 300
    } : {
      maxAppointments: 0,
      maxPromotions: 5,
      commissionRate: 0.08,
      featuredPriority: true,
      analyticsAccess: true,
      customBranding: true,
      dedicatedSupport: true,
      videoCallMinutes: 0
    };

    const subscription = await prisma.subscription.create({
      data: {
        vetId: vet.id,
        tier: tier as SubscriptionTier,
        amount: totalAmount,
        paystackPlanCode,
        paystackSubscriptionCode: `SUB_${Date.now()}_${vet.id}`,
        status: SubscriptionStatus.PENDING,
        startsAt,
        expiresAt,
        autoRenew: true,
        features
      }
    });

    // Initialize payment
    const paymentData = {
      email: req.user.email,
      amount: totalAmount * 100, // Convert to kobo
      metadata: {
        subscriptionId: subscription.id,
        vetId: vet.id,
        tier,
        durationMonths,
        type: 'subscription'
      },
      callback_url: `${process.env.CLIENT_URL}/subscription/callback`
    };

    const paystackResponse = await PaystackService.initializeTransaction(paymentData);

    // Create transaction record
    const transaction = await prisma.transaction.create({
      data: {
        userId: req.user.id,
        vetId: vet.id,
        subscriptionId: subscription.id,
        type: 'SUBSCRIPTION',
        amount: totalAmount,
        platformFee: commission.platformEarns,
        vetEarned: commission.vetEarns,
        paymentReference: paystackResponse.data.reference,
        paymentStatus: 'PENDING',
        metadata: {
          subscriptionId: subscription.id,
          tier,
          durationMonths
        }
      }
    });

    // Update subscription with payment reference
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        paymentReference: paystackResponse.data.reference
      }
    });

    res.status(200).json(
      new ApiResponse(200, 'Subscription payment initialized', {
        subscription,
        transaction,
        authorization_url: paystackResponse.data.authorization_url,
        reference: paystackResponse.data.reference
      })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Get current subscription
// @route   GET /api/v1/subscriptions/current
// @access  Private (Vet only)
export const getCurrentSubscription = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only veterinarians can view subscriptions');
    }

    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet profile not found');
    }

    const subscription = await prisma.subscription.findFirst({
      where: {
        vetId: vet.id,
        status: SubscriptionStatus.ACTIVE,
        expiresAt: { gt: new Date() }
      }
    });

    // Parse features from JSON if they exist
    const features = subscription?.features ? (subscription.features as any) : {};

    // Get subscription usage
    const usage = {
      appointments: {
        used: await prisma.appointment.count({
          where: {
            vetId: vet.id,
            createdAt: {
              gte: subscription?.startsAt || new Date(0)
            }
          }
        }),
        limit: features.maxAppointments || 20
      },
      promotions: {
        used: await prisma.promotion.count({
          where: {
            vetId: vet.id,
            isActive: true,
            expiresAt: { gt: new Date() }
          }
        }),
        limit: features.maxPromotions || 0
      },
      videoMinutes: {
        used: 0, // Would need to track video call durations
        limit: features.videoCallMinutes || 60
      }
    };

    res.status(200).json(
      new ApiResponse(200, 'Current subscription', {
        subscription,
        vetTier: vet.subscriptionTier,
        usage,
        daysRemaining: subscription ? 
          Math.ceil((subscription.expiresAt.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) : 0
      })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Cancel subscription
// @route   POST /api/v1/subscriptions/cancel
// @access  Private (Vet only)
export const cancelSubscription = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only veterinarians can cancel subscriptions');
    }

    const { reason } = req.body;

    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet profile not found');
    }

    const subscription = await prisma.subscription.findFirst({
      where: {
        vetId: vet.id,
        status: SubscriptionStatus.ACTIVE,
        expiresAt: { gt: new Date() }
      }
    });

    if (!subscription) {
      throw new ApiError(404, 'No active subscription found');
    }

    // Update subscription
    const updatedSubscription = await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: SubscriptionStatus.CANCELLED,
        cancellationReason: reason,
        cancelledAt: new Date(),
        autoRenew: false,
        isActive: false
      }
    });

    // Update vet tier to FREE
    await prisma.vet.update({
      where: { id: vet.id },
      data: {
        subscriptionTier: SubscriptionTier.FREE,
        subscriptionExpiresAt: null
      }
    });

    res.status(200).json(
      new ApiResponse(200, 'Subscription cancelled successfully', {
        subscription: updatedSubscription
      })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Update subscription auto-renew
// @route   PUT /api/v1/subscriptions/auto-renew
// @access  Private (Vet only)
export const updateAutoRenew = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only veterinarians can update subscription settings');
    }

    const { autoRenew } = req.body;

    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet profile not found');
    }

    const subscription = await prisma.subscription.findFirst({
      where: {
        vetId: vet.id,
        status: SubscriptionStatus.ACTIVE,
        expiresAt: { gt: new Date() }
      }
    });

    if (!subscription) {
      throw new ApiError(404, 'No active subscription found');
    }

    const updatedSubscription = await prisma.subscription.update({
      where: { id: subscription.id },
      data: { autoRenew }
    });

    res.status(200).json(
      new ApiResponse(200, 'Auto-renew updated', {
        autoRenew: updatedSubscription.autoRenew
      })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Get subscription history
// @route   GET /api/v1/subscriptions/history
// @access  Private (Vet only)
export const getSubscriptionHistory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only veterinarians can view subscription history');
    }

    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet profile not found');
    }

    const subscriptions = await prisma.subscription.findMany({
      where: { vetId: vet.id },
      orderBy: { createdAt: 'desc' },
      skip,
      take
    });

    const total = await prisma.subscription.count({
      where: { vetId: vet.id }
    });

    res.status(200).json(
      new ApiResponse(200, 'Subscription history', {
        subscriptions,
        pagination: {
          page: parseInt(page as string),
          limit: take,
          total,
          pages: Math.ceil(total / take)
        }
      })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Verify subscription payment
// @route   GET /api/v1/subscriptions/verify/:reference
// @access  Private
export const verifySubscriptionPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { reference } = req.params;

    // Verify with Paystack
    const verification = await PaystackService.verifyTransaction(reference);

    if (verification.data.status !== 'success') {
      throw new ApiError(400, 'Payment failed or pending');
    }

    // Get transaction
    const transaction = await prisma.transaction.findUnique({
      where: { paymentReference: reference }
    });

    if (!transaction) {
      throw new ApiError(404, 'Transaction not found');
    }

    if (transaction.paymentStatus === 'COMPLETED') {
      throw new ApiError(400, 'Payment already verified');
    }

    // Update transaction
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        paymentStatus: 'COMPLETED',
        paystackData: verification.data
      }
    });

    // Update subscription
    if (!transaction.subscriptionId) {
      throw new ApiError(404, 'Subscription ID not found in transaction');
    }

    const subscription = await prisma.subscription.update({
      where: { id: transaction.subscriptionId },
      data: {
        status: SubscriptionStatus.ACTIVE,
        isActive: true
      }
    });

    // Update vet tier
    if (transaction.vetId) {
      await prisma.vet.update({
        where: { id: transaction.vetId },
        data: {
          subscriptionTier: subscription.tier,
          subscriptionExpiresAt: subscription.expiresAt
        }
      });
    }

    res.status(200).json(
      new ApiResponse(200, 'Subscription payment verified', {
        subscription,
        transaction
      })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Get subscription analytics
// @route   GET /api/v1/subscriptions/analytics
// @access  Private (Vet only)
export const getSubscriptionAnalytics = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only veterinarians can view analytics');
    }

    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet profile not found');
    }

    // Get current subscription
    const subscription = await prisma.subscription.findFirst({
      where: {
        vetId: vet.id,
        status: SubscriptionStatus.ACTIVE,
        expiresAt: { gt: new Date() }
      }
    });

    if (!subscription) {
      throw new ApiError(404, 'No active subscription found');
    }

    // Parse features
    const features = subscription.features ? (subscription.features as any) : {};

    // Calculate appointment growth
    const now = new Date();
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    const currentMonthAppointments = await prisma.appointment.count({
      where: {
        vetId: vet.id,
        createdAt: {
          gte: new Date(now.getFullYear(), now.getMonth(), 1)
        }
      }
    });

    const lastMonthAppointments = await prisma.appointment.count({
      where: {
        vetId: vet.id,
        createdAt: {
          gte: new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1),
          lt: new Date(now.getFullYear(), now.getMonth(), 1)
        }
      }
    });

    const appointmentGrowth = lastMonthAppointments > 0 ?
      ((currentMonthAppointments - lastMonthAppointments) / lastMonthAppointments) * 100 : 100;

    // Calculate earnings growth
    const currentMonthEarnings = await prisma.transaction.aggregate({
      where: {
        vetId: vet.id,
        type: 'CONSULTATION',
        paymentStatus: 'COMPLETED',
        createdAt: {
          gte: new Date(now.getFullYear(), now.getMonth(), 1)
        }
      },
      _sum: { vetEarned: true }
    });

    const lastMonthEarnings = await prisma.transaction.aggregate({
      where: {
        vetId: vet.id,
        type: 'CONSULTATION',
        paymentStatus: 'COMPLETED',
        createdAt: {
          gte: new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1),
          lt: new Date(now.getFullYear(), now.getMonth(), 1)
        }
      },
      _sum: { vetEarned: true }
    });

    const currentEarnings = currentMonthEarnings._sum.vetEarned || 0;
    const lastEarnings = lastMonthEarnings._sum.vetEarned || 0;
    const earningsGrowth = lastEarnings > 0 ?
      ((currentEarnings - lastEarnings) / lastEarnings) * 100 : 100;

    // Get appointment type distribution
    const appointmentTypes = await prisma.appointment.groupBy({
      by: ['type'],
      where: {
        vetId: vet.id,
        createdAt: {
          gte: new Date(now.getFullYear(), now.getMonth() - 3, 1) // Last 3 months
        }
      },
      _count: true
    });

    res.status(200).json(
      new ApiResponse(200, 'Subscription analytics', {
        overview: {
          currentTier: subscription.tier,
          daysRemaining: Math.ceil((subscription.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
          totalEarnings: vet.totalEarnings,
          availableEarnings: vet.availableEarnings,
          totalAppointments: currentMonthAppointments + lastMonthAppointments,
          rating: vet.rating
        },
        growth: {
          appointments: {
            current: currentMonthAppointments,
            previous: lastMonthAppointments,
            growth: appointmentGrowth
          },
          earnings: {
            current: currentEarnings,
            previous: lastEarnings,
            growth: earningsGrowth
          }
        },
        distribution: {
          appointmentTypes
        },
        subscription: {
          ...subscription,
          features
        }
      })
    );
  } catch (error: any) {
    next(error);
  }
};