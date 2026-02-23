import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { ApiError, ApiResponse } from '../utils/response';
import logger from '../utils/logger';  // Now we'll use this
import { uploadToCloudinary } from '../middleware/upload';

const prisma = new PrismaClient();

// @desc    Register as veterinarian
// @route   POST /api/v1/vets/register
// @access  Private (Owner only)
export const registerVet = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'OWNER') {
      throw new ApiError(400, 'Only pet owners can register as vets');
    }

    const {
      licenseNumber,
      specialties,
      experienceYears,
      consultationFee,
      bankDetails
    } = req.body;

    // Check if license number already exists
    const existingVet = await prisma.vet.findUnique({
      where: { licenseNumber }
    });

    if (existingVet) {
      throw new ApiError(400, 'License number already registered');
    }

    // Upload license document
    let licenseDocumentUrl = '';
    if (req.file) {
      const uploadResult = await uploadToCloudinary(req.file, 'licenses');
      licenseDocumentUrl = uploadResult.url;
    } else {
      throw new ApiError(400, 'License document is required');
    }

    // Create vet profile
    const vet = await prisma.vet.create({
      data: {
        userId: req.user.id,
        licenseNumber,
        licenseDocument: licenseDocumentUrl,
        specialties: Array.isArray(specialties) ? specialties : [specialties],
        experienceYears: parseInt(experienceYears),
        consultationFee: parseFloat(consultationFee),
        bankDetails: bankDetails ? JSON.parse(bankDetails) : null
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true
          }
        }
      }
    });

    // Update user type to VET
    await prisma.user.update({
      where: { id: req.user.id },
      data: { userType: 'VET' }
    });

    // LOG THE REGISTRATION
    logger.info(`Vet registered: ${vet.id} - ${licenseNumber}`);

    res.status(201).json(
      new ApiResponse(201, 'Vet registration submitted for approval', { vet })
    );
  } catch (error: any) {
    // LOG THE ERROR
    logger.error('Vet registration error:', error);
    next(error);
  }
};

// @desc    Get nearby veterinarians
// @route   GET /api/v1/vets/nearby
// @access  Private
export const getNearbyVets = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { latitude, longitude, radius = 50, page = 1, limit = 20 } = req.query;

    if (!latitude || !longitude) {
      throw new ApiError(400, 'Latitude and longitude are required');
    }

    const lat = parseFloat(latitude as string);
    const lng = parseFloat(longitude as string);
    const radiusInMeters = parseFloat(radius as string) * 1000; // Convert km to meters
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    // LOG THE SEARCH
    logger.info(`Searching vets near: ${lat}, ${lng}, radius: ${radiusInMeters}m`);

    // Get user's location
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { location: true }
    });

    // Find nearby vets with geospatial query
    const query: any = {
      isApproved: true,
      user: {
        location: {
          not: null
        }
      }
    };

    // If user has location, use geospatial query
    if (user?.location) {
      // LOG USER LOCATION FOUND
      logger.debug(`User location found for ${req.user.id}`);

      const vets = await prisma.vet.findMany({
        where: query,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
              location: true
              // REMOVED: onlineStatus: true - not in User model
            }
          },
          subscriptions: {
            where: {
              isActive: true,
              expiresAt: { gt: new Date() }
            },
            orderBy: { tier: 'desc' },
            take: 1
          },
          promotions: {
            where: {
              isActive: true,
              expiresAt: { gt: new Date() }
            }
          }
        },
        orderBy: [
          { isFeatured: 'desc' },
          { subscriptionTier: 'desc' },
          { rating: 'desc' }
        ],
        skip,
        take
      });

      // LOG VETS FOUND
      logger.debug(`Found ${vets.length} vets with location data`);

      // Calculate distance for each vet
      const vetsWithDistance = vets.map(vet => {
        // Check if vet has user and user has location
        if (vet.user && (vet.user as any).location) {
          const vetLocation = (vet.user as any).location;
          const distance = calculateDistance(
            lat,
            lng,
            vetLocation.coordinates[1],
            vetLocation.coordinates[0]
          );
          
          // Use radiusInMeters to filter
          const isWithinRadius = distance * 1000 <= radiusInMeters;
          return { ...vet, distance, isWithinRadius };
        }
        return { ...vet, distance: null, isWithinRadius: false };
      });

      // Filter vets within radius
      const filteredVets = vetsWithDistance.filter(vet => vet.isWithinRadius);

      // Sort by distance
      filteredVets.sort((a, b) => {
        if (a.distance === null) return 1;
        if (b.distance === null) return -1;
        return a.distance - b.distance;
      });

      // Get total count
      const total = await prisma.vet.count({ where: query });

      // LOG RESULTS
      logger.info(`Returning ${filteredVets.length} vets within ${radius}km radius`);

      res.status(200).json(
        new ApiResponse(200, 'Nearby vets retrieved', {
          vets: filteredVets,
          searchRadius: radiusInMeters / 1000, // Convert back to km for response
          pagination: {
            page: parseInt(page as string),
            limit: take,
            total,
            pages: Math.ceil(total / take)
          }
        })
      );
    } else {
      // Fallback: Get all approved vets
      logger.debug('User location not found, using fallback');
      
      const vets = await prisma.vet.findMany({
        where: { isApproved: true },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true
            }
          }
        },
        orderBy: [
          { isFeatured: 'desc' },
          { subscriptionTier: 'desc' },
          { rating: 'desc' }
        ],
        skip,
        take
      });

      const total = await prisma.vet.count({ where: { isApproved: true } });

      res.status(200).json(
        new ApiResponse(200, 'Vets retrieved', {
          vets,
          pagination: {
            page: parseInt(page as string),
            limit: take,
            total,
            pages: Math.ceil(total / take)
          }
        })
      );
    }
  } catch (error: any) {
    logger.error('Error getting nearby vets:', error);
    next(error);
  }
};

// @desc    Get vet by ID
// @route   GET /api/v1/vets/:id
// @access  Private
export const getVetById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    logger.info(`Fetching vet details for ID: ${id}`);

    const vet = await prisma.vet.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
            email: true,
            phone: true,
            createdAt: true
          }
        },
        reviews: {
          include: {
            owner: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                avatar: true
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        subscriptions: {
          where: {
            isActive: true,
            expiresAt: { gt: new Date() }
          },
          orderBy: { tier: 'desc' },
          take: 1
        },
        promotions: {
          where: {
            isActive: true,
            expiresAt: { gt: new Date() }
          }
        }
      }
    });

    if (!vet || !vet.isApproved) {
      logger.warn(`Vet not found or not approved: ${id}`);
      throw new ApiError(404, 'Vet not found');
    }

    // Get vet's availability (simplified)
    const appointments = await prisma.appointment.findMany({
      where: {
        vetId: id,
        status: 'CONFIRMED',
        scheduledAt: { gt: new Date() }
      },
      select: {
        scheduledAt: true
      }
    });

    const bookedSlots = appointments.map(apt => apt.scheduledAt);

    logger.info(`Successfully fetched vet: ${vet.id}`);

    res.status(200).json(
      new ApiResponse(200, 'Vet details', {
        vet,
        availability: {
          bookedSlots,
          workingHours: {
            start: '08:00',
            end: '20:00'
          }
        }
      })
    );
  } catch (error: any) {
    logger.error('Error getting vet by ID:', error);
    next(error);
  }
};

// @desc    Update vet profile
// @route   PUT /api/v1/vets/profile
// @access  Private (Vet only)
export const updateVetProfile = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only veterinarians can update vet profile');
    }

    const {
      specialties,
      experienceYears,
      consultationFee,
      bankDetails
    } = req.body;

    // LOG UPDATE REQUEST
    logger.info(`Updating vet profile for user: ${req.user.id}`, req.body);

    // Get vet profile
    const vetProfile = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vetProfile) {
      throw new ApiError(404, 'Vet profile not found');
    }

    // Update vet profile
    const updatedVet = await prisma.vet.update({
      where: { userId: req.user.id },
      data: {
        specialties: specialties ? (Array.isArray(specialties) ? specialties : [specialties]) : undefined,
        experienceYears: experienceYears ? parseInt(experienceYears) : undefined,
        consultationFee: consultationFee ? parseFloat(consultationFee) : undefined,
        bankDetails: bankDetails ? JSON.parse(bankDetails) : undefined,
        updatedAt: new Date()
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true
          }
        }
      }
    });

    logger.info(`Vet profile updated: ${updatedVet.id}`);

    res.status(200).json(new ApiResponse(200, 'Profile updated', { vet: updatedVet }));
  } catch (error: any) {
    logger.error('Error updating vet profile:', error);
    next(error);
  }
};

// @desc    Update vet online status
// @route   PUT /api/v1/vets/online-status
// @access  Private (Vet only)
export const updateOnlineStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only veterinarians can update online status');
    }

    const { onlineStatus } = req.body;

    logger.info(`Updating online status for vet user: ${req.user.id} to ${onlineStatus}`);

    const updatedVet = await prisma.vet.update({
      where: { userId: req.user.id },
      data: {
        onlineStatus: onlineStatus === 'true' || onlineStatus === true,
        lastSeen: new Date()
      }
    });

    logger.info(`Vet ${req.user.id} online status: ${updatedVet.onlineStatus}`);

    res.status(200).json(
      new ApiResponse(200, 'Online status updated', {
        onlineStatus: updatedVet.onlineStatus,
        lastSeen: updatedVet.lastSeen
      })
    );
  } catch (error: any) {
    logger.error('Error updating online status:', error);
    next(error);
  }
};

// @desc    Get vet dashboard stats
// @route   GET /api/v1/vets/dashboard/stats
// @access  Private (Vet only)
export const getVetDashboardStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only veterinarians can access dashboard');
    }

    logger.info(`Fetching dashboard stats for vet user: ${req.user.id}`);

    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet profile not found');
    }

    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get appointments stats
    const totalAppointments = await prisma.appointment.count({
      where: { vetId: vet.id }
    });

    const todayAppointments = await prisma.appointment.count({
      where: {
        vetId: vet.id,
        scheduledAt: {
          gte: today,
          lt: tomorrow
        }
      }
    });

    const pendingAppointments = await prisma.appointment.count({
      where: {
        vetId: vet.id,
        status: 'PENDING'
      }
    });

    // Get earnings stats
    const todayEarnings = await prisma.transaction.aggregate({
      where: {
        vetId: vet.id,
        paymentStatus: 'COMPLETED',
        createdAt: {
          gte: today,
          lt: tomorrow
        }
      },
      _sum: {
        vetEarned: true
      }
    });

    const monthlyEarnings = await prisma.transaction.aggregate({
      where: {
        vetId: vet.id,
        paymentStatus: 'COMPLETED',
        createdAt: {
          gte: new Date(today.getFullYear(), today.getMonth(), 1)
        }
      },
      _sum: {
        vetEarned: true
      }
    });

    // Get reviews stats
    const recentReviews = await prisma.review.findMany({
      where: { vetId: vet.id },
      include: {
        owner: {
          select: {
            firstName: true,
            lastName: true,
            avatar: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    // Get upcoming appointments
    const upcomingAppointments = await prisma.appointment.findMany({
      where: {
        vetId: vet.id,
        status: 'CONFIRMED',
        scheduledAt: { gt: new Date() }
      },
      include: {
        owner: {
          select: {
            firstName: true,
            lastName: true,
            avatar: true,
            phone: true
          }
        }
      },
      orderBy: { scheduledAt: 'asc' },
      take: 10
    });

    logger.info(`Dashboard stats fetched for vet: ${vet.id}`);

    res.status(200).json(
      new ApiResponse(200, 'Dashboard stats retrieved', {
        stats: {
          totalAppointments,
          todayAppointments,
          pendingAppointments,
          totalEarnings: vet.totalEarnings,
          availableEarnings: vet.availableEarnings,
          todayEarnings: todayEarnings._sum.vetEarned || 0,
          monthlyEarnings: monthlyEarnings._sum.vetEarned || 0,
          rating: vet.rating,
          totalReviews: vet.totalReviews
        },
        recentReviews,
        upcomingAppointments
      })
    );
  } catch (error: any) {
    logger.error('Error getting dashboard stats:', error);
    next(error);
  }
};

// @desc    Search veterinarians
// @route   GET /api/v1/vets/search
// @access  Private
export const searchVets = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      query,
      specialty,
      minRating,
      maxFee,
      page = 1,
      limit = 20
    } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    logger.info(`Searching vets with params:`, {
      query,
      specialty,
      minRating,
      maxFee,
      page,
      limit
    });

    // Build search query
    const where: any = {
      isApproved: true
    };

    // Search by name or specialty
    if (query) {
      where.OR = [
        {
          user: {
            OR: [
              { firstName: { contains: query as string, mode: 'insensitive' } },
              { lastName: { contains: query as string, mode: 'insensitive' } }
            ]
          }
        },
        {
          specialties: {
            has: query as string
          }
        }
      ];
    }

    // Filter by specialty
    if (specialty) {
      where.specialties = {
        has: specialty as string
      };
    }

    // Filter by minimum rating
    if (minRating) {
      where.rating = {
        gte: parseFloat(minRating as string)
      };
    }

    // Filter by maximum fee
    if (maxFee) {
      where.consultationFee = {
        lte: parseFloat(maxFee as string)
      };
    }

    const vets = await prisma.vet.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
            location: true
          }
        },
        subscriptions: {
          where: {
            isActive: true,
            expiresAt: { gt: new Date() }
          },
          orderBy: { tier: 'desc' },
          take: 1
        },
        promotions: {
          where: {
            isActive: true,
            expiresAt: { gt: new Date() }
          }
        }
      },
      orderBy: [
        { isFeatured: 'desc' },
        { subscriptionTier: 'desc' },
        { rating: 'desc' }
      ],
      skip,
      take
    });

    const total = await prisma.vet.count({ where });

    logger.info(`Search results: ${vets.length} vets found`);

    res.status(200).json(
      new ApiResponse(200, 'Vets retrieved', {
        vets,
        pagination: {
          page: parseInt(page as string),
          limit: take,
          total,
          pages: Math.ceil(total / take)
        }
      })
    );
  } catch (error: any) {
    logger.error('Error searching vets:', error);
    next(error);
  }
};

// Helper function to calculate distance between two coordinates
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(value: number): number {
  return value * Math.PI / 180;
}

// @desc    Get vet profile
// @route   GET /api/vets/profile
// @access  Private (Vet only)
export const getVetProfile = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only vets can access this endpoint');
    }

    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
            avatar: true
          }
        }
      }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet profile not found');
    }

    res.status(200).json(
      new ApiResponse(200, 'Vet profile retrieved', { vet })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Get vet working hours
// @route   GET /api/vets/working-hours
// @access  Private (Vet only)
export const getVetWorkingHours = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only vets can access this endpoint');
    }

    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet not found');
    }

    const workingHours = vet.workingHours || {};

    res.status(200).json(
      new ApiResponse(200, 'Working hours retrieved', { workingHours })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Get vet services
// @route   GET /api/vets/services
// @access  Private (Vet only)
export const getVetServices = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only vets can access this endpoint');
    }

    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet not found');
    }

    const services = vet.specialties || [];

    res.status(200).json(
      new ApiResponse(200, 'Services retrieved', { services })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Get vet reviews
// @route   GET /api/vets/reviews
// @access  Private (Vet only)
export const getVetReviews = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only vets can access this endpoint');
    }

    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet not found');
    }

    const reviews = await prisma.review.findMany({
      where: { vetId: vet.id },
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json(
      new ApiResponse(200, 'Reviews retrieved', { reviews })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Get vet earnings
// @route   GET /api/vets/earnings
// @access  Private (Vet only)
export const getVetEarnings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only vets can access this endpoint');
    }

    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet not found');
    }

    const earnings = {
      totalEarnings: vet.totalEarnings || 0,
      availableEarnings: vet.availableEarnings || 0,
      pendingEarnings: vet.pendingEarnings || 0
    };

    res.status(200).json(
      new ApiResponse(200, 'Earnings retrieved', earnings)
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Get vet analytics
// @route   GET /api/vets/analytics
// @access  Private (Vet only)
export const getVetAnalytics = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only vets can access this endpoint');
    }

    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet not found');
    }

    const totalAppointments = await prisma.appointment.count({
      where: { vetId: vet.id }
    });

    const completedAppointments = await prisma.appointment.count({
      where: {
        vetId: vet.id,
        status: 'COMPLETED'
      }
    });

    const analytics = {
      totalAppointments,
      completedAppointments,
      completionRate: totalAppointments > 0 ? (completedAppointments / totalAppointments) * 100 : 0,
      rating: vet.rating,
      totalReviews: vet.totalReviews,
      totalEarnings: vet.totalEarnings || 0,
      subscriptionTier: vet.subscriptionTier,
      isFeatured: vet.isFeatured
    };

    res.status(200).json(
      new ApiResponse(200, 'Analytics retrieved', analytics)
    );
  } catch (error: any) {
    next(error);
  }
};