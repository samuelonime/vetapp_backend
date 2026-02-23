import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { ApiError, ApiResponse } from '../utils/response';
import logger from '../utils/logger';

const prisma = new PrismaClient();

// @desc    Create a review
// @route   POST /api/v1/reviews
// @access  Private (Pet Owner only)
export const createReview = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'OWNER') {
      throw new ApiError(403, 'Only pet owners can create reviews');
    }

    const { appointmentId, rating, comment, anonymous = false, categories = [] } = req.body;

    // Validate rating
    if (rating < 1 || rating > 5) {
      throw new ApiError(400, 'Rating must be between 1 and 5');
    }

    // Check if appointment exists and belongs to user
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId }
    });

    if (!appointment) {
      throw new ApiError(404, 'Appointment not found');
    }

    if (appointment.ownerId !== req.user.id) {
      throw new ApiError(403, 'You can only review your own appointments');
    }

    if (appointment.status !== 'COMPLETED') {
      throw new ApiError(400, 'You can only review completed appointments');
    }

    // Check if review already exists for this appointment
    const existingReview = await prisma.review.findUnique({
      where: { appointmentId }
    });

    if (existingReview) {
      throw new ApiError(400, 'You have already reviewed this appointment');
    }

    // Create review with all the new fields
    const review = await prisma.review.create({
      data: {
        appointmentId,
        ownerId: req.user.id,
        vetId: appointment.vetId,
        rating,
        comment,
        anonymous,
        categories: categories.length > 0 ? categories : undefined,
        // Remove isVerified field - it doesn't exist in your model
      }
    });

    // Update vet's rating
    await updateVetRating(appointment.vetId);

    res.status(201).json(
      new ApiResponse(201, 'Review created successfully', { review })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Get vet reviews
// @route   GET /api/v1/reviews/vet/:vetId
// @access  Public
export const getVetReviews = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { vetId } = req.params;
    const { page = 1, limit = 20, rating } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    // Check if vet exists
    const vet = await prisma.vet.findUnique({
      where: { id: vetId }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet not found');
    }

    // Build where clause
    const where: any = { vetId, reported: false }; // Only show non-reported reviews
    if (rating) {
      where.rating = parseInt(rating as string);
    }

    // Get reviews - petType doesn't exist in Appointment model, so remove it
    const reviews = await prisma.review.findMany({
      where,
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true
          }
        },
        appointment: {
          select: {
            id: true,
            type: true,
            createdAt: true
            // Remove petType: true since it doesn't exist in your Appointment model
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take
    });

    // Get review statistics (excluding reported reviews)
    const totalReviews = await prisma.review.count({ 
      where: { vetId, reported: false } 
    });

    const ratingDistribution = await prisma.review.groupBy({
      by: ['rating'],
      where: { vetId, reported: false },
      _count: true
    });

    // Calculate distribution percentages
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    ratingDistribution.forEach(item => {
      distribution[item.rating as keyof typeof distribution] = item._count as number;
    });

    // Get average rating (excluding reported reviews)
    const avgRating = await prisma.review.aggregate({
      where: { vetId, reported: false },
      _avg: { rating: true }
    });

    res.status(200).json(
      new ApiResponse(200, 'Vet reviews retrieved', {
        reviews,
        statistics: {
          totalReviews,
          averageRating: avgRating._avg.rating?.toFixed(1) || '0.0',
          distribution,
          vetRating: vet.rating
        },
        pagination: {
          page: parseInt(page as string),
          limit: take,
          total: totalReviews,
          pages: Math.ceil(totalReviews / take)
        }
      })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Add vet reply to review
// @route   PUT /api/v1/reviews/:id/reply
// @access  Private (Vet only)
export const addVetReply = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only veterinarians can reply to reviews');
    }

    const { id } = req.params;
    const { reply } = req.body;

    // Find review
    const review = await prisma.review.findUnique({
      where: { id }
    });

    if (!review) {
      throw new ApiError(404, 'Review not found');
    }

    // Verify vet owns this review
    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vet || review.vetId !== vet.id) {
      throw new ApiError(403, 'You can only reply to reviews of your own appointments');
    }

    // Update review with vet reply
    const updatedReview = await prisma.review.update({
      where: { id },
      data: {
        vetReply: reply,
        vetReplyAt: new Date()
      }
    });

    res.status(200).json(
      new ApiResponse(200, 'Reply added successfully', { review: updatedReview })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Report a review
// @route   POST /api/v1/reviews/:id/report
// @access  Private
export const reportReview = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    // Find review
    const review = await prisma.review.findUnique({
      where: { id }
    });

    if (!review) {
      throw new ApiError(404, 'Review not found');
    }

    // Update review as reported
    const updatedReview = await prisma.review.update({
      where: { id },
      data: {
        reported: true,
        reportReason: reason,
        reportCount: { increment: 1 }
        // Remove reportedBy since it doesn't exist in your model
      }
    });

    // Create notification for admins
    await prisma.notification.create({
      data: {
        userId: req.user.id,
        title: 'Review Reported',
        message: `Review ${id} has been reported for: ${reason}`,
        type: 'REPORT',
        data: {
          reviewId: id,
          reporterId: req.user.id,
          reason,
          review: updatedReview
        }
      }
    });

    res.status(200).json(
      new ApiResponse(200, 'Review reported successfully. Admins will review it.')
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Mark review as helpful
// @route   POST /api/v1/reviews/:id/helpful
// @access  Private
export const markHelpful = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    // Find review
    const review = await prisma.review.findUnique({
      where: { id }
    });

    if (!review) {
      throw new ApiError(404, 'Review not found');
    }

    // Check if user already marked as helpful
    const isHelpful = Array.isArray(review.helpful) && review.helpful.includes(req.user.id);

    let updatedReview;
    if (isHelpful) {
      // Remove user from helpful list
      updatedReview = await prisma.review.update({
        where: { id },
        data: {
          helpful: {
            set: Array.isArray(review.helpful) 
              ? review.helpful.filter(userId => userId !== req.user.id)
              : []
          }
        }
      });
    } else {
      // Add user to helpful list
      updatedReview = await prisma.review.update({
        where: { id },
        data: {
          helpful: {
            push: req.user.id
          }
        }
      });
    }

    res.status(200).json(
      new ApiResponse(200, isHelpful ? 'Removed from helpful' : 'Marked as helpful', {
        review: updatedReview,
        helpfulCount: Array.isArray(updatedReview.helpful) ? updatedReview.helpful.length : 0,
        isHelpful: !isHelpful
      })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Get my reviews
// @route   GET /api/v1/reviews/my-reviews
// @access  Private (Pet Owner only)
export const getMyReviews = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'OWNER') {
      throw new ApiError(403, 'Only pet owners can view their reviews');
    }

    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const reviews = await prisma.review.findMany({
      where: { ownerId: req.user.id },
      include: {
        vet: {
          select: {
            id: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
                avatar: true
              }
            },
            rating: true,
            specialties: true
          }
        },
        appointment: {
          select: {
            id: true,
            type: true,
            createdAt: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take
    });

    const total = await prisma.review.count({
      where: { ownerId: req.user.id }
    });

    res.status(200).json(
      new ApiResponse(200, 'User reviews retrieved', {
        reviews,
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

// @desc    Update a review
// @route   PUT /api/v1/reviews/:id
// @access  Private (Review Owner only)
export const updateReview = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { rating, comment, categories } = req.body;

    // Find review
    const review = await prisma.review.findUnique({
      where: { id }
    });

    if (!review) {
      throw new ApiError(404, 'Review not found');
    }

    // Check if user owns the review
    if (review.ownerId !== req.user.id) {
      throw new ApiError(403, 'You can only update your own reviews');
    }

    // Update review
    const updatedReview = await prisma.review.update({
      where: { id },
      data: {
        rating: rating !== undefined ? rating : review.rating,
        comment: comment !== undefined ? comment : review.comment,
        categories: categories !== undefined ? categories : review.categories,
        updatedAt: new Date()
      }
    });

    // Update vet's rating
    await updateVetRating(review.vetId);

    res.status(200).json(
      new ApiResponse(200, 'Review updated successfully', { review: updatedReview })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Delete a review
// @route   DELETE /api/v1/reviews/:id
// @access  Private (Review Owner or Admin)
export const deleteReview = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    // Find review
    const review = await prisma.review.findUnique({
      where: { id }
    });

    if (!review) {
      throw new ApiError(404, 'Review not found');
    }

    // Check if user owns the review or is admin
    const isOwner = review.ownerId === req.user.id;
    const isAdmin = req.user.userType === 'ADMIN';

    if (!isOwner && !isAdmin) {
      throw new ApiError(403, 'You can only delete your own reviews');
    }

    // Store vetId before deleting
    const vetId = review.vetId;

    // Delete review
    await prisma.review.delete({
      where: { id }
    });

    // Log deletion if by admin
    if (isAdmin) {
      await prisma.adminLog.create({
        data: {
          adminId: req.user.id,
          action: 'DELETE_REVIEW',
          entity: 'Review',
          entityId: id,
          oldData: review,
          newData: null,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        }
      });
    }

    // Update vet's rating
    await updateVetRating(vetId);

    res.status(200).json(
      new ApiResponse(200, 'Review deleted successfully')
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Get review statistics
// @route   GET /api/v1/reviews/stats/:vetId
// @access  Public
export const getReviewStatistics = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { vetId } = req.params;

    // Check if vet exists
    const vet = await prisma.vet.findUnique({
      where: { id: vetId }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet not found');
    }

    // Get all non-reported reviews for this vet
    const where = { vetId, reported: false };

    // Get total reviews
    const totalReviews = await prisma.review.count({ where });

    // Get rating distribution
    const ratingDistribution = await prisma.review.groupBy({
      by: ['rating'],
      where,
      _count: true
    });

    // Calculate distribution
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    ratingDistribution.forEach(item => {
      distribution[item.rating as keyof typeof distribution] = item._count as number;
    });

    // Get average rating
    const avgRating = await prisma.review.aggregate({
      where,
      _avg: { rating: true }
    });

    // Get reviews with vet replies
    const reviewsWithReplies = await prisma.review.count({
      where: {
        ...where,
        vetReply: { not: null }
      }
    });

    // Get recent reviews (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentReviews = await prisma.review.count({
      where: {
        ...where,
        createdAt: { gte: thirtyDaysAgo }
      }
    });

    res.status(200).json(
      new ApiResponse(200, 'Review statistics retrieved', {
        vetId,
        totalReviews,
        averageRating: avgRating._avg.rating?.toFixed(1) || '0.0',
        distribution,
        vetRating: vet.rating,
        reviewsWithReplies,
        recentReviews,
        replyRate: totalReviews > 0 ? ((reviewsWithReplies / totalReviews) * 100).toFixed(1) : '0.0'
      })
    );
  } catch (error: any) {
    next(error);
  }
};

// Alias for markAsHelpful to match route file
export const markAsHelpful = markHelpful;

// @desc    Get vet rating summary by categories
// @route   GET /api/v1/reviews/vet/:vetId/categories
// @access  Public
export const getVetCategoryRatings = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { vetId } = req.params;
    const categories = ['PROFESSIONALISM', 'KNOWLEDGE', 'COMMUNICATION', 'BEDSIDE_MANNER', 'VALUE'];

    // Check if vet exists
    const vet = await prisma.vet.findUnique({
      where: { id: vetId }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet not found');
    }

    // Get all non-reported reviews for this vet with categories
    const reviews = await prisma.review.findMany({
      where: { 
        vetId,
        reported: false,
        categories: { not: null } // Only reviews with categories
      },
      select: {
        id: true,
        rating: true,
        categories: true
      }
    });

    // Calculate average ratings per category
    const categoryRatings: Record<string, { total: number; count: number }> = {};
    
    // Initialize all categories
    categories.forEach(category => {
      categoryRatings[category] = { total: 0, count: 0 };
    });

    // Calculate totals for categories that have data
    reviews.forEach(review => {
      if (review.categories) {
        try {
          // Parse categories JSON
          const categoriesData = typeof review.categories === 'string' 
            ? JSON.parse(review.categories) 
            : review.categories;
          
          if (Array.isArray(categoriesData)) {
            categoriesData.forEach((cat: any) => {
              if (cat.category && typeof cat.rating === 'number') {
                const categoryName = cat.category.toUpperCase();
                if (categoryRatings[categoryName]) {
                  categoryRatings[categoryName].total += cat.rating;
                  categoryRatings[categoryName].count += 1;
                }
              }
            });
          }
        } catch (error) {
          logger.error('Error parsing categories:', error);
        }
      }
    });

    // Calculate final averages
    const result: Record<string, { average: number; count: number }> = {};
    Object.entries(categoryRatings).forEach(([category, data]) => {
      result[category] = {
        average: data.count > 0 ? parseFloat((data.total / data.count).toFixed(1)) : 0,
        count: data.count
      };
    });

    res.status(200).json(
      new ApiResponse(200, 'Category ratings retrieved', {
        vetId,
        categories: result,
        overallRating: vet.rating,
        totalReviews: reviews.length
      })
    );
  } catch (error: any) {
    next(error);
  }
};

// Helper function to update vet rating
async function updateVetRating(vetId: string): Promise<void> {
  try {
    // Get all non-reported reviews for this vet
    const reviews = await prisma.review.findMany({
      where: { 
        vetId,
        reported: false 
      }
    });

    if (reviews.length === 0) {
      // If no reviews, set rating to 0
      await prisma.vet.update({
        where: { id: vetId },
        data: {
          rating: 0,
          totalReviews: 0
        }
      });
      return;
    }

    // Calculate average rating
    const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
    const averageRating = totalRating / reviews.length;

    // Update vet
    await prisma.vet.update({
      where: { id: vetId },
      data: {
        rating: parseFloat(averageRating.toFixed(1)),
        totalReviews: reviews.length
      }
    });
  } catch (error) {
    logger.error('Error updating vet rating:', error);
  }
}