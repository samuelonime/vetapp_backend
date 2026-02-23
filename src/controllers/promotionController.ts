import { Request, Response, NextFunction } from 'express';
import { PrismaClient, PaymentStatus, SubscriptionStatus } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { ApiError, ApiResponse } from '../utils/response';
import logger from '../utils/logger';
import { PaystackService } from '../services/paystackService';
import { CommissionService } from '../services/commissionService';

const prisma = new PrismaClient();

// @desc    Get promotion packages
// @route   GET /api/v1/promotions/packages
// @access  Public
export const getPromotionPackages = async (
  _req: Request,  // Fixed: Added underscore
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    logger.info('Fetching promotion packages'); // Using logger to avoid unused import
    
    const packages = [
      {
        type: 'FEATURED',
        name: 'Featured Veterinarian',
        description: 'Get featured on homepage and top of search results',
        durationOptions: [
          { days: 7, amount: 2000 },
          { days: 14, amount: 3500 },
          { days: 30, amount: 6000 }
        ],
        benefits: [
          'Top position in search results',
          'Featured badge on profile',
          'Priority in recommendations',
          'Increased visibility by 300%'
        ]
      },
      {
        type: 'TOP_SEARCH',
        name: 'Top Search Result',
        description: 'Appear at the top of search results for your specialties',
        durationOptions: [
          { days: 7, amount: 1500 },
          { days: 14, amount: 2500 },
          { days: 30, amount: 4500 }
        ],
        benefits: [
          'First position in search results',
          'Highlighted listing',
          'For specific specialties',
          'Increased clicks by 200%'
        ]
      },
      {
        type: 'HOMEPAGE',
        name: 'Homepage Spotlight',
        description: 'Featured on the app homepage carousel',
        durationOptions: [
          { days: 7, amount: 3000 },
          { days: 14, amount: 5000 }
        ],
        benefits: [
          'Featured in homepage carousel',
          'Large banner display',
          'Highest visibility',
          'Direct call-to-action button'
        ]
      },
      {
        type: 'CATEGORY_FEATURED',
        name: 'Category Expert',
        description: 'Featured as expert in specific pet categories',
        durationOptions: [
          { days: 7, amount: 1000 },
          { days: 14, amount: 1800 },
          { days: 30, amount: 3000 }
        ],
        benefits: [
          'Featured in category pages',
          'Expert badge',
          'Category-specific promotion',
          'Targeted audience reach'
        ]
      }
    ];

    res.status(200).json(new ApiResponse(200, 'Promotion packages', { packages }));
  } catch (error: any) {
    logger.error('Error fetching promotion packages:', error);
    next(error);
  }
};

// @desc    Create promotion
// @route   POST /api/v1/promotions/create
// @access  Private (Vet only)
export const createPromotion = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only veterinarians can create promotions');
    }

    const { type, durationDays, metadata } = req.body;

    // Validate promotion type
    const validTypes = ['FEATURED', 'TOP_SEARCH', 'HOMEPAGE', 'CATEGORY_FEATURED'];
    if (!validTypes.includes(type)) {
      throw new ApiError(400, 'Invalid promotion type');
    }

    // Validate duration
    if (durationDays < 1 || durationDays > 30) {
      throw new ApiError(400, 'Duration must be between 1 and 30 days');
    }

    // Get vet profile
    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id },
      include: {
        subscriptions: {
          where: {
            status: SubscriptionStatus.ACTIVE,
            expiresAt: { gt: new Date() }
          }
        }
      }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet profile not found');
    }

    if (!vet.isApproved) {
      throw new ApiError(403, 'Vet account must be approved to create promotions');
    }

    // Check subscription limits
    const activeSubscription = vet.subscriptions?.[0];
    
    if (activeSubscription) {
      // Count active promotions using status and expiresAt
      const promotionCount = await prisma.promotion.count({
        where: {
          vetId: vet.id,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() }
        }
      });
      
      // Get max promotions from subscription features
      const features = activeSubscription.features as any;
      const maxPromotions = features?.maxPromotions || 0;
      
      if (maxPromotions > 0 && promotionCount >= maxPromotions) {
        throw new ApiError(403, 'You have reached your promotion limit. Upgrade your subscription.');
      }
    } else {
      // Free tier vets cannot create promotions
      throw new ApiError(403, 'Free tier vets cannot create promotions. Please upgrade to PRO or ENTERPRISE.');
    }

    // Check if vet already has active promotion of same type
    const existingPromotion = await prisma.promotion.findFirst({
      where: {
        vetId: vet.id,
        type: type,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() }
      }
    });

    if (existingPromotion) {
      throw new ApiError(400, `You already have an active ${type} promotion`);
    }

    // Calculate amount
    const baseAmount = CommissionService.calculatePromotionFee(durationDays);
    const amount = baseAmount * (type === 'HOMEPAGE' ? 1.5 : type === 'FEATURED' ? 1.2 : 1);

    // Create promotion record
    const startsAt = new Date();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    const promotion = await prisma.promotion.create({
      data: {
        vetId: vet.id,
        type: type,
        amount: amount,
        durationDays: durationDays,
        startsAt,
        expiresAt,
        status: 'PENDING',
        paymentStatus: 'PENDING',
        metadata: metadata || {},
        autoRenew: false
      }
    });

    // Initialize payment
    const paymentData = {
      email: req.user.email,
      amount: Math.round(amount * 100), // Convert to kobo
      metadata: {
        promotionId: promotion.id,
        vetId: vet.id,
        type,
        durationDays,
        amount
      },
      callback_url: `${process.env.CLIENT_URL}/promotion/callback`
    };

    const paystackResponse = await PaystackService.initializeTransaction(paymentData);

    // Create transaction record
    const transaction = await prisma.transaction.create({
      data: {
        userId: req.user.id,
        vetId: vet.id,
        type: 'PROMOTION',
        amount,
        platformFee: amount * 0.20, // Platform takes 20%
        paymentReference: paystackResponse.data.reference,
        paymentStatus: PaymentStatus.PENDING,
        metadata: {
          promotionId: promotion.id,
          type,
          durationDays
        }
      }
    });

    logger.info(`Transaction created: ${transaction.id} for promotion: ${promotion.id}`);

    // Update promotion with payment reference
    await prisma.promotion.update({
      where: { id: promotion.id },
      data: {
        paymentReference: paystackResponse.data.reference
      }
    });

    logger.info(`Promotion created: ${promotion.id} for vet: ${vet.id}`);

    res.status(200).json(
      new ApiResponse(200, 'Promotion payment initialized', {
        promotion,
        authorization_url: paystackResponse.data.authorization_url,
        reference: paystackResponse.data.reference
      })
    );
  } catch (error: any) {
    logger.error('Error creating promotion:', error);
    next(error);
  }
};

// @desc    Get vet's active promotions
// @route   GET /api/v1/promotions/active
// @access  Private (Vet only)
export const getActivePromotions = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only veterinarians can view promotions');
    }

    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet profile not found');
    }

    const promotions = await prisma.promotion.findMany({
      where: {
        vetId: vet.id,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() }
      },
      orderBy: { expiresAt: 'asc' }
    });

    res.status(200).json(
      new ApiResponse(200, 'Active promotions', { promotions })
    );
  } catch (error: any) {
    logger.error('Error fetching active promotions:', error);
    next(error);
  }
};

// @desc    Get promotion analytics
// @route   GET /api/v1/promotions/:id/analytics
// @access  Private (Vet only)
export const getPromotionAnalytics = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only veterinarians can view promotion analytics');
    }

    const { id } = req.params;

    const promotion = await prisma.promotion.findUnique({
      where: { id }
    });

    if (!promotion) {
      throw new ApiError(404, 'Promotion not found');
    }

    // Verify vet owns this promotion
    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vet || promotion.vetId !== vet.id) {
      throw new ApiError(403, 'Not authorized to view this promotion');
    }

    // Get appointments during promotion period
    const appointments = await prisma.appointment.count({
      where: {
        vetId: vet.id,
        createdAt: {
          gte: promotion.startsAt,  // Fixed: changed from startDate
          lte: promotion.expiresAt   // Fixed: changed from endDate
        },
        status: 'COMPLETED'
      }
    });

    // Calculate ROI
    const roi = appointments > 0 ?
      ((appointments * vet.consultationFee * 0.75) - promotion.amount) / promotion.amount * 100 : -100;

    res.status(200).json(
      new ApiResponse(200, 'Promotion analytics', {
        promotion,
        metrics: {
          impressions: promotion.impressions,
          clicks: promotion.clicks,
          conversions: promotion.conversions,
          ctr: promotion.clicks > 0 ? (promotion.clicks / promotion.impressions) * 100 : 0,
          conversionRate: promotion.clicks > 0 ? (promotion.conversions / promotion.clicks) * 100 : 0,
          costPerClick: promotion.clicks > 0 ? promotion.amount / promotion.clicks : promotion.amount,
          appointmentsDuringPromotion: appointments,
          estimatedRevenue: appointments * vet.consultationFee * 0.75,
          promotionCost: promotion.amount,
          roi
        },
        performance: {
          status: promotion.status,
          daysRemaining: Math.max(0, Math.ceil((promotion.expiresAt.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))),
          isActive: promotion.status === 'ACTIVE' && promotion.expiresAt > new Date()  // Fixed: changed from endDate
        }
      })
    );
  } catch (error: any) {
    logger.error('Error fetching promotion analytics:', error);
    next(error);
  }
};

// @desc    Cancel promotion
// @route   POST /api/v1/promotions/:id/cancel
// @access  Private (Vet only)
export const cancelPromotion = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only veterinarians can cancel promotions');
    }

    const { id } = req.params;
    const { reason } = req.body;

    const promotion = await prisma.promotion.findUnique({
      where: { id }
    });

    if (!promotion) {
      throw new ApiError(404, 'Promotion not found');
    }

    // Verify vet owns this promotion
    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vet || promotion.vetId !== vet.id) {
      throw new ApiError(403, 'Not authorized to cancel this promotion');
    }

    if (promotion.status !== 'ACTIVE') {
      throw new ApiError(400, 'Only active promotions can be cancelled');
    }

    // Calculate refund amount (pro-rata based on days used)
    const now = new Date();
    const totalDuration = promotion.expiresAt.getTime() - promotion.startsAt.getTime();  // Fixed: changed from startDate/endDate
    const usedDuration = now.getTime() - promotion.startsAt.getTime();  // Fixed: changed from startDate
    const usedPercentage = usedDuration / totalDuration;
    
    let refundAmount = 0;
    if (usedPercentage < 0.5) { // Refund 50% if less than half used
      refundAmount = promotion.amount * 0.5;
    }

    // Update promotion
    const updatedPromotion = await prisma.promotion.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancellationReason: reason,
        cancelledAt: now,
        expiresAt: now // End immediately  // Fixed: changed from endDate
      }
    });

    // Update vet's featured status if this was a FEATURED promotion
    if (promotion.type === 'FEATURED') {
      // Check if vet has any other active featured promotions
      const otherFeaturedPromotions = await prisma.promotion.count({
        where: {
          vetId: vet.id,
          type: 'FEATURED',
          status: 'ACTIVE',
          expiresAt: { gt: now },  // Fixed: changed from endDate
          id: { not: id }
        }
      });

      if (otherFeaturedPromotions === 0) {
        await prisma.vet.update({
          where: { id: vet.id },
          data: {
            isFeatured: false,
            featuredExpiresAt: null
          }
        });
      }
    }

    // Create refund transaction if applicable
    if (refundAmount > 0) {
      await prisma.transaction.create({
        data: {
          userId: req.user.id,
          vetId: vet.id,
          type: 'REFUND',
          amount: refundAmount,
          platformFee: 0,
          paymentReference: `REFUND_${Date.now()}_${promotion.id}`,
          paymentStatus: PaymentStatus.COMPLETED,
          metadata: {
            promotionId: promotion.id,
            originalAmount: promotion.amount,
            refundAmount,
            reason: 'Promotion cancellation'
          }
        }
      });
    }

    logger.info(`Promotion cancelled: ${id} by vet: ${vet.id}`);

    res.status(200).json(
      new ApiResponse(200, 'Promotion cancelled successfully', {
        promotion: updatedPromotion,
        refund: refundAmount > 0 ? {
          amount: refundAmount,
          reason: 'Pro-rata refund for unused period'
        } : null
      })
    );
  } catch (error: any) {
    logger.error('Error cancelling promotion:', error);
    next(error);
  }
};

// @desc    Record promotion impression
// @route   POST /api/v1/promotions/:id/impression
// @access  Public
export const recordImpression = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    const promotion = await prisma.promotion.findUnique({
      where: { id }
    });

    if (!promotion) {
      throw new ApiError(404, 'Promotion not found');
    }

    if (promotion.status !== 'ACTIVE' || promotion.expiresAt < new Date()) {  // Fixed: changed from endDate
      throw new ApiError(400, 'Promotion is not active');
    }

    // Record impression
    await prisma.promotion.update({
      where: { id },
      data: {
        impressions: { increment: 1 }
      }
    });

    res.status(200).json(new ApiResponse(200, 'Impression recorded'));
  } catch (error: any) {
    logger.error('Error recording impression:', error);
    next(error);
  }
};

// @desc    Record promotion click
// @route   POST /api/v1/promotions/:id/click
// @access  Public
export const recordClick = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    const promotion = await prisma.promotion.findUnique({
      where: { id }
    });

    if (!promotion) {
      throw new ApiError(404, 'Promotion not found');
    }

    if (promotion.status !== 'ACTIVE' || promotion.expiresAt < new Date()) {  // Fixed: changed from endDate
      throw new ApiError(400, 'Promotion is not active');
    }

    // Record click
    await prisma.promotion.update({
      where: { id },
      data: {
        clicks: { increment: 1 }
      }
    });

    res.status(200).json(new ApiResponse(200, 'Click recorded'));
  } catch (error: any) {
    logger.error('Error recording click:', error);
    next(error);
  }
};

// @desc    Verify promotion payment
// @route   GET /api/v1/promotions/verify/:reference
// @access  Private
export const verifyPromotionPayment = async (
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

    // Get promotion by payment reference
    const promotion = await prisma.promotion.findFirst({
      where: { paymentReference: reference }
    });

    if (!promotion) {
      throw new ApiError(404, 'Promotion not found');
    }

    if (promotion.paymentStatus === 'COMPLETED') {
      throw new ApiError(400, 'Payment already verified');
    }

    // Update promotion
    const updatedPromotion = await prisma.promotion.update({
      where: { id: promotion.id },
      data: {
        status: 'ACTIVE',
        paymentStatus: 'COMPLETED',
        startsAt: new Date(),  // Fixed: changed from startDate
        expiresAt: new Date(Date.now() + promotion.durationDays * 24 * 60 * 60 * 1000)  // Fixed: changed from duration to durationDays
      }
    });

    // Update vet's featured status if this is a FEATURED promotion
    if (promotion.type === 'FEATURED') {
      await prisma.vet.update({
        where: { id: promotion.vetId },
        data: {
          isFeatured: true,
          featuredExpiresAt: updatedPromotion.expiresAt  // Fixed: changed from endDate
        }
      });
    }

    // Update transaction
    await prisma.transaction.updateMany({
      where: { paymentReference: reference },
      data: {
        paymentStatus: PaymentStatus.COMPLETED,
        paystackData: verification.data
      }
    });

    logger.info(`Promotion payment verified: ${promotion.id}`);

    res.status(200).json(
      new ApiResponse(200, 'Promotion payment verified', {
        promotion: updatedPromotion
      })
    );
  } catch (error: any) {
    logger.error('Error verifying promotion payment:', error);
    next(error);
  }
};

// @desc    Get promotion performance report
// @route   GET /api/v1/promotions/report
// @access  Private (Vet only)
export const getPromotionReport = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only veterinarians can view promotion reports');
    }

    const { startDate, endDate } = req.query;

    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet profile not found');
    }

    const dateFilter: any = {};
    if (startDate) {
      dateFilter.gte = new Date(startDate as string);
    }
    if (endDate) {
      dateFilter.lte = new Date(endDate as string);
    }

    const promotions = await prisma.promotion.findMany({
      where: {
        vetId: vet.id,
        startsAt: Object.keys(dateFilter).length > 0 ? dateFilter : undefined  // Fixed: changed from startDate
      },
      orderBy: { startsAt: 'desc' }  // Fixed: changed from startDate
    });

    // Calculate overall metrics
    const overallMetrics = promotions.reduce(
      (acc, promotion) => {
        return {
          totalAmount: acc.totalAmount + promotion.amount,
          totalImpressions: acc.totalImpressions + promotion.impressions,
          totalClicks: acc.totalClicks + promotion.clicks,
          totalConversions: acc.totalConversions + promotion.conversions,
          count: acc.count + 1
        };
      },
      { totalAmount: 0, totalImpressions: 0, totalClicks: 0, totalConversions: 0, count: 0 }
    );

    const ctr = overallMetrics.totalImpressions > 0 ?
      (overallMetrics.totalClicks / overallMetrics.totalImpressions) * 100 : 0;
    
    const conversionRate = overallMetrics.totalClicks > 0 ?
      (overallMetrics.totalConversions / overallMetrics.totalClicks) * 100 : 0;
    
    const costPerClick = overallMetrics.totalClicks > 0 ?
      overallMetrics.totalAmount / overallMetrics.totalClicks : overallMetrics.totalAmount;

    // Get appointments during promotion periods
    let totalAppointments = 0;
    let totalRevenue = 0;

    for (const promotion of promotions) {
      const appointments = await prisma.appointment.count({
        where: {
          vetId: vet.id,
          createdAt: {
            gte: promotion.startsAt,  // Fixed: changed from startDate
            lte: promotion.expiresAt   // Fixed: changed from endDate
          },
          status: 'COMPLETED'
        }
      });

      totalAppointments += appointments;
      totalRevenue += appointments * vet.consultationFee * 0.75; // Assuming 75% of fee goes to vet
    }

    const overallRoi = overallMetrics.totalAmount > 0 ?
      ((totalRevenue - overallMetrics.totalAmount) / overallMetrics.totalAmount) * 100 : 0;

    res.status(200).json(
      new ApiResponse(200, 'Promotion performance report', {
        summary: {
          totalPromotions: overallMetrics.count,
          totalSpent: overallMetrics.totalAmount,
          totalImpressions: overallMetrics.totalImpressions,
          totalClicks: overallMetrics.totalClicks,
          totalConversions: overallMetrics.totalConversions,
          overallCtr: ctr,
          overallConversionRate: conversionRate,
          overallCostPerClick: costPerClick,
          estimatedRevenue: totalRevenue,
          overallRoi
        },
        promotions: promotions.map(promotion => ({
          ...promotion,
          ctr: promotion.impressions > 0 ? (promotion.clicks / promotion.impressions) * 100 : 0,
          conversionRate: promotion.clicks > 0 ? (promotion.conversions / promotion.clicks) * 100 : 0,
          costPerClick: promotion.clicks > 0 ? promotion.amount / promotion.clicks : promotion.amount,
          daysActive: Math.ceil((promotion.expiresAt.getTime() - promotion.startsAt.getTime()) / (1000 * 60 * 60 * 24))  // Fixed: changed from startDate/endDate
        })),
        recommendations: getPromotionRecommendations(promotions, vet)
      })
    );
  } catch (error: any) {
    logger.error('Error fetching promotion report:', error);
    next(error);
  }
};

// Helper function for promotion recommendations
function getPromotionRecommendations(promotions: any[], vet: any): string[] {
  const recommendations: string[] = [];

  if (promotions.length === 0) {
    recommendations.push(
      "Start with a FEATURED promotion to increase visibility",
      "Consider TOP_SEARCH promotion for your primary specialties",
      "Run promotions for at least 14 days for best results"
    );
    return recommendations;
  }

  // Analyze promotion performance
  const avgCtr = promotions.reduce((sum, p) => sum + (p.clicks / p.impressions || 0), 0) / promotions.length;
  const avgConversionRate = promotions.reduce((sum, p) => sum + (p.conversions / p.clicks || 0), 0) / promotions.length;

  if (avgCtr < 0.02) {
    recommendations.push("Your CTR is low. Consider updating your profile picture and description.");
  }

  if (avgConversionRate < 0.1) {
    recommendations.push("Your conversion rate can be improved. Consider adjusting your consultation fee or offering a first-time discount.");
  }

  // Check promotion type distribution
  const typeCounts: Record<string, number> = {};
  promotions.forEach(p => {
    typeCounts[p.type] = (typeCounts[p.type] || 0) + 1;
  });

  if (!typeCounts['FEATURED'] && vet.rating >= 4) {
    recommendations.push("With your high rating, a FEATURED promotion would likely perform well.");
  }

  if (!typeCounts['CATEGORY_FEATURED'] && vet.specialties.length > 0) {
    recommendations.push(`Consider CATEGORY_FEATURED promotion for your specialty in ${vet.specialties[0]}`);
  }

  // Check duration
  const avgDuration = promotions.reduce((sum, p) => sum + p.durationDays, 0) / promotions.length;
  if (avgDuration < 14) {
    recommendations.push("Promotions shorter than 14 days may not build sufficient momentum. Consider longer durations.");
  }

  return recommendations.slice(0, 3); // Return top 3 recommendations
}