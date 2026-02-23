import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { ApiError, ApiResponse } from '../utils/response';
import logger from '../utils/logger';

const prisma = new PrismaClient();

// @desc    Get dashboard statistics
// @route   GET /api/v1/admin/dashboard
// @access  Private (Admin only)
export const getDashboardStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const startTime = Date.now();
  const adminId = req.user.id;
  
  try {
    logger.info('Admin dashboard stats requested', { 
      adminId,
      userType: req.user.userType,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    if (req.user.userType !== 'ADMIN') {
      logger.warn('Non-admin attempted to access admin dashboard', {
        userId: req.user.id,
        userType: req.user.userType,
        ip: req.ip
      });
      throw new ApiError(403, 'Only admins can access dashboard');
    }

    // Get date ranges
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);
    
    const lastMonth = new Date(today);
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    
    const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);

    // User statistics
    logger.debug('Fetching user statistics...', { adminId });
    const totalUsers = await prisma.user.count();
    const totalOwners = await prisma.user.count({ where: { userType: 'OWNER' } });
    const totalVets = await prisma.user.count({ where: { userType: 'VET' } });
    const newUsersToday = await prisma.user.count({
      where: { createdAt: { gte: today } }
    });
    const newUsersThisWeek = await prisma.user.count({
      where: { createdAt: { gte: lastWeek } }
    });

    // Vet statistics
    logger.debug('Fetching vet statistics...', { adminId });
    const totalApprovedVets = await prisma.vet.count({ where: { isApproved: true } });
    const pendingVets = await prisma.vet.count({ where: { isApproved: false } });
    const activeVets = await prisma.vet.count({
      where: {
        isApproved: true,
        onlineStatus: true,
        lastSeen: { gte: lastWeek }
      }
    });

    // Subscription statistics
    logger.debug('Fetching subscription statistics...', { adminId });
    const activeSubscriptions = await prisma.subscription.count({
      where: {
        status: 'ACTIVE',
        expiresAt: { gt: new Date() }
      }
    });
    
    const proSubscriptions = await prisma.subscription.count({
      where: {
        tier: 'PRO',
        status: 'ACTIVE',
        expiresAt: { gt: new Date() }
      }
    });
    
    const enterpriseSubscriptions = await prisma.subscription.count({
      where: {
        tier: 'ENTERPRISE',
        status: 'ACTIVE',
        expiresAt: { gt: new Date() }
      }
    });

    // Promotion statistics
    logger.debug('Fetching promotion statistics...', { adminId });
    const activePromotions = await prisma.promotion.count({
      where: {
        status: 'ACTIVE',
        expiresAt: { gt: new Date() }
      }
    });
    
    const promotionRevenue = await prisma.transaction.aggregate({
      where: {
        type: 'PROMOTION',
        paymentStatus: 'COMPLETED',
        createdAt: { gte: thisMonthStart }
      },
      _sum: { amount: true }
    });

    // Appointment statistics
    logger.debug('Fetching appointment statistics...', { adminId });
    const totalAppointments = await prisma.appointment.count();
    const todayAppointments = await prisma.appointment.count({
      where: { createdAt: { gte: today } }
    });
    
    const completedAppointments = await prisma.appointment.count({
      where: { status: 'COMPLETED' }
    });
    
    const pendingAppointments = await prisma.appointment.count({
      where: { status: 'PENDING' }
    });

    // Revenue statistics
    logger.debug('Fetching revenue statistics...', { adminId });
    const totalRevenue = await prisma.transaction.aggregate({
      where: { paymentStatus: 'COMPLETED' },
      _sum: { amount: true, platformFee: true }
    });

    const todayRevenue = await prisma.transaction.aggregate({
      where: {
        paymentStatus: 'COMPLETED',
        createdAt: { gte: today }
      },
      _sum: { amount: true, platformFee: true }
    });

    const thisMonthRevenue = await prisma.transaction.aggregate({
      where: {
        paymentStatus: 'COMPLETED',
        createdAt: { gte: thisMonthStart }
      },
      _sum: { amount: true, platformFee: true }
    });

    const lastMonthRevenue = await prisma.transaction.aggregate({
      where: {
        paymentStatus: 'COMPLETED',
        createdAt: { gte: lastMonthStart, lte: lastMonthEnd }
      },
      _sum: { amount: true, platformFee: true }
    });

    // Calculate growth percentages
    const userGrowth = newUsersThisWeek > 0 ? 
      (newUsersToday / newUsersThisWeek * 100).toFixed(1) : '0.0';
    
    const revenueGrowth = lastMonthRevenue._sum.platformFee && lastMonthRevenue._sum.platformFee > 0 ?
      ((thisMonthRevenue._sum.platformFee! - lastMonthRevenue._sum.platformFee!) / lastMonthRevenue._sum.platformFee! * 100).toFixed(1) : '0.0';

    // Get recent activities
    logger.debug('Fetching recent activities...', { adminId });
    const recentActivities = await prisma.adminLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        admin: {
          select: {
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    // Get pending vet approvals
    logger.debug('Fetching pending vet approvals...', { adminId });
    const pendingApprovals = await prisma.vet.findMany({
      where: { isApproved: false },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            createdAt: true
          }
        }
      },
      take: 5
    });

    // Get recent transactions
    logger.debug('Fetching recent transactions...', { adminId });
    const recentTransactions = await prisma.transaction.findMany({
      where: { paymentStatus: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true
          }
        },
        vet: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        }
      }
    });

    const executionTime = Date.now() - startTime;
    
    logger.info('Admin dashboard stats fetched successfully', {
      adminId,
      executionTime: `${executionTime}ms`,
      stats: {
        totalUsers,
        totalVets,
        totalAppointments,
        activeSubscriptions
      }
    });

    res.status(200).json(
      new ApiResponse(200, 'Admin dashboard statistics', {
        overview: {
          totalUsers,
          totalOwners,
          totalVets,
          totalApprovedVets,
          pendingVets,
          activeVets,
          totalAppointments,
          completedAppointments,
          activeSubscriptions,
          activePromotions
        },
        today: {
          newUsers: newUsersToday,
          appointments: todayAppointments,
          revenue: todayRevenue._sum.platformFee || 0,
          pendingAppointments
        },
        revenue: {
          total: totalRevenue._sum.platformFee || 0,
          thisMonth: thisMonthRevenue._sum.platformFee || 0,
          lastMonth: lastMonthRevenue._sum.platformFee || 0,
          growth: revenueGrowth,
          promotionRevenue: promotionRevenue._sum.amount || 0
        },
        subscriptions: {
          total: activeSubscriptions,
          pro: proSubscriptions,
          enterprise: enterpriseSubscriptions,
          distribution: {
            pro: proSubscriptions > 0 ? (proSubscriptions / activeSubscriptions * 100).toFixed(1) : '0.0',
            enterprise: enterpriseSubscriptions > 0 ? (enterpriseSubscriptions / activeSubscriptions * 100).toFixed(1) : '0.0'
          }
        },
        growth: {
          users: userGrowth,
          revenue: revenueGrowth
        },
        activities: recentActivities,
        pendingApprovals,
        recentTransactions
      })
    );
  } catch (error: any) {
    const executionTime = Date.now() - startTime;
    logger.error('Error fetching admin dashboard stats', {
      adminId: req.user?.id,
      error: error.message,
      stack: error.stack,
      executionTime: `${executionTime}ms`
    });
    next(error);
  }
};

// @desc    Get pending vet approvals
// @route   GET /api/v1/admin/vets/pending
// @access  Private (Admin only)
export const getPendingVetApprovals = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const startTime = Date.now();
  
  try {
    logger.info('Pending vet approvals requested', { 
      adminId: req.user.id,
      userType: req.user.userType
    });
    
    if (req.user.userType !== 'ADMIN') {
      logger.warn('Non-admin attempted to view pending vet approvals', {
        userId: req.user.id,
        userType: req.user.userType
      });
      throw new ApiError(403, 'Only admins can view pending approvals');
    }

    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    logger.debug('Fetching pending vet approvals from database', {
      adminId: req.user.id,
      page,
      limit,
      skip,
      take
    });

    const pendingVets = await prisma.vet.findMany({
      where: { isApproved: false },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            createdAt: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take
    });

    const total = await prisma.vet.count({ where: { isApproved: false } });

    const executionTime = Date.now() - startTime;
    
    logger.info('Pending vet approvals fetched successfully', {
      adminId: req.user.id,
      count: pendingVets.length,
      total,
      executionTime: `${executionTime}ms`
    });

    res.status(200).json(
      new ApiResponse(200, 'Pending vet approvals', {
        vets: pendingVets,
        pagination: {
          page: parseInt(page as string),
          limit: take,
          total,
          pages: Math.ceil(total / take)
        }
      })
    );
  } catch (error: any) {
    const executionTime = Date.now() - startTime;
    logger.error('Error fetching pending vet approvals', {
      adminId: req.user?.id,
      error: error.message,
      stack: error.stack,
      executionTime: `${executionTime}ms`
    });
    next(error);
  }
};

// @desc    Approve vet
// @route   PUT /api/v1/admin/vets/:id/approve
// @access  Private (Admin only)
export const approveVet = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const startTime = Date.now();
  
  try {
    const { id } = req.params;
    
    logger.info('Vet approval request', { 
      adminId: req.user.id,
      vetId: id,
      userType: req.user.userType
    });
    
    if (req.user.userType !== 'ADMIN') {
      logger.warn('Non-admin attempted to approve vet', {
        userId: req.user.id,
        userType: req.user.userType,
        vetId: id
      });
      throw new ApiError(403, 'Only admins can approve vets');
    }

    const vet = await prisma.vet.findUnique({
      where: { id },
      include: { user: true }
    });

    if (!vet) {
      logger.warn('Vet not found for approval', { vetId: id });
      throw new ApiError(404, 'Vet not found');
    }

    if (vet.isApproved) {
      logger.warn('Attempted to approve already approved vet', { vetId: id });
      throw new ApiError(400, 'Vet is already approved');
    }

    logger.debug('Updating vet approval status', { vetId: id });
    
    // Update vet approval status
    const updatedVet = await prisma.vet.update({
      where: { id },
      data: {
        isApproved: true,
        approvalDate: new Date(),
        licenseVerified: true
      },
      include: { user: true }
    });

    // Create admin log
    await prisma.adminLog.create({
      data: {
        adminId: req.user.id,
        action: 'APPROVE_VET',
        entity: 'Vet',
        entityId: id,
        oldData: vet,
        newData: updatedVet,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      }
    });

    const executionTime = Date.now() - startTime;
    
    logger.info('Vet approved successfully', {
      adminId: req.user.id,
      vetId: id,
      vetUserId: vet.userId,
      executionTime: `${executionTime}ms`
    });

    // Send approval notification (implement notification service)
    // await sendVetApprovalNotification(vet.user.email, vet.user.firstName);

    res.status(200).json(
      new ApiResponse(200, 'Vet approved successfully', { vet: updatedVet })
    );
  } catch (error: any) {
    const executionTime = Date.now() - startTime;
    logger.error('Error approving vet', {
      adminId: req.user?.id,
      vetId: req.params?.id,
      error: error.message,
      stack: error.stack,
      executionTime: `${executionTime}ms`
    });
    next(error);
  }
};

// @desc    Reject vet
// @route   PUT /api/v1/admin/vets/:id/reject
// @access  Private (Admin only)
export const rejectVet = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const startTime = Date.now();
  
  try {
    const { id } = req.params;
    const { reason } = req.body;

    logger.info('Vet rejection request', { 
      adminId: req.user.id,
      vetId: id,
      userType: req.user.userType,
      reason: reason?.substring(0, 100) // Log first 100 chars
    });
    
    if (req.user.userType !== 'ADMIN') {
      logger.warn('Non-admin attempted to reject vet', {
        userId: req.user.id,
        userType: req.user.userType,
        vetId: id
      });
      throw new ApiError(403, 'Only admins can reject vets');
    }

    if (!reason || reason.trim().length === 0) {
      logger.warn('Vet rejection attempted without reason', { vetId: id });
      throw new ApiError(400, 'Rejection reason is required');
    }

    const vet = await prisma.vet.findUnique({
      where: { id },
      include: { user: true }
    });

    if (!vet) {
      logger.warn('Vet not found for rejection', { vetId: id });
      throw new ApiError(404, 'Vet not found');
    }

    if (vet.isApproved) {
      logger.warn('Attempted to reject already approved vet', { vetId: id });
      throw new ApiError(400, 'Vet is already approved');
    }

    logger.debug('Processing vet rejection', { 
      vetId: id,
      userId: vet.userId 
    });

    // Update user type back to OWNER
    await prisma.user.update({
      where: { id: vet.userId },
      data: { userType: 'OWNER' }
    });

    // Delete vet profile
    await prisma.vet.delete({
      where: { id }
    });

    // Create admin log
    await prisma.adminLog.create({
      data: {
        adminId: req.user.id,
        action: 'REJECT_VET',
        entity: 'Vet',
        entityId: id,
        oldData: vet,
        newData: null,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      }
    });

    const executionTime = Date.now() - startTime;
    
    logger.info('Vet rejected successfully', {
      adminId: req.user.id,
      vetId: id,
      userId: vet.userId,
      reasonLength: reason.length,
      executionTime: `${executionTime}ms`
    });

    // Send rejection notification (implement notification service)
    // await sendVetRejectionNotification(vet.user.email, vet.user.firstName, reason);

    res.status(200).json(
      new ApiResponse(200, 'Vet registration rejected', { reason })
    );
  } catch (error: any) {
    const executionTime = Date.now() - startTime;
    logger.error('Error rejecting vet', {
      adminId: req.user?.id,
      vetId: req.params?.id,
      error: error.message,
      stack: error.stack,
      executionTime: `${executionTime}ms`
    });
    next(error);
  }
};


// @desc    Get all users
// @route   GET /api/v1/admin/users
// @access  Private (Admin only)
export const getAllUsers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'ADMIN') {
      throw new ApiError(403, 'Only admins can view all users');
    }

    const { 
      page = 1, 
      limit = 20, 
      search, 
      userType, 
      isVerified,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    // Build where clause
    const where: any = {};
    
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } }
      ];
    }
    
    if (userType) {
      where.userType = userType;
    }
    
    if (isVerified !== undefined) {
      where.isVerified = isVerified === 'true';
    }

    // Build sort order
    const orderBy: any = {};
    orderBy[sortBy as string] = sortOrder;

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        phone: true,
        userType: true,
        firstName: true,
        lastName: true,
        avatar: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true,
        vetProfile: {
          select: {
            id: true,
            isApproved: true,
            subscriptionTier: true
          }
        }
      },
      orderBy,
      skip,
      take
    });

    const total = await prisma.user.count({ where });

    res.status(200).json(
      new ApiResponse(200, 'Users retrieved', {
        users,
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

// @desc    Get user details
// @route   GET /api/v1/admin/users/:id
// @access  Private (Admin only)
export const getUserDetails = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'ADMIN') {
      throw new ApiError(403, 'Only admins can view user details');
    }

    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        vetProfile: true,
        appointments: {
          include: {
             vet: {
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
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        reviews: {
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      }
    });

    if (!user) {
      throw new ApiError(404, 'User not found');
    }

    res.status(200).json(
      new ApiResponse(200, 'User details', { user })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Update user status
// @route   PUT /api/v1/admin/users/:id/status
// @access  Private (Admin only)
export const updateUserStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'ADMIN') {
      throw new ApiError(403, 'Only admins can update user status');
    }

    const { id } = req.params;
    const { isActive, isVerified} = req.body;

    const user = await prisma.user.findUnique({
      where: { id }
    });

    if (!user) {
      throw new ApiError(404, 'User not found');
    }

    // Prevent admin from disabling themselves
    if (id === req.user.id && isActive === false) {
      throw new ApiError(400, 'Cannot disable your own account');
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        isActive: isActive !== undefined ? isActive : user.isActive,
        isVerified: isVerified !== undefined ? isVerified : user.isVerified
      }
    });

    // Create admin log
    await prisma.adminLog.create({
      data: {
        adminId: req.user.id,
        action: 'UPDATE_USER_STATUS',
        entity: 'User',
        entityId: id,
        oldData: user,
        newData: updatedUser,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      }
    });

    res.status(200).json(
      new ApiResponse(200, 'User status updated', { user: updatedUser })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Get all transactions
// @route   GET /api/v1/admin/transactions
// @access  Private (Admin only)
export const getAllTransactions = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'ADMIN') {
      throw new ApiError(403, 'Only admins can view all transactions');
    }

    const { 
      page = 1, 
      limit = 20,
      type,
      paymentStatus,
      startDate,
      endDate,
      search
    } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    // Build where clause
    const where: any = {};

    if (type) {
      where.type = type;
    }

    if (paymentStatus) {
      where.paymentStatus = paymentStatus;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    if (search) {
      where.OR = [
        { paymentReference: { contains: search, mode: 'insensitive' } },
        { user: { 
          OR: [
            { email: { contains: search, mode: 'insensitive' } },
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } }
          ]
        }},
        { vet: { 
          user: {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } }
            ]
          }
        }}
      ];
    }

    const transactions = await prisma.transaction.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        vet: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        },
        appointment: {
          select: {
            id: true,
            type: true,
            status: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take
    });

    const total = await prisma.transaction.count({ where });

    // Calculate totals
    const totals = await prisma.transaction.aggregate({
      where,
      _sum: {
        amount: true,
        platformFee: true,
        vetEarned: true
      }
    });

    res.status(200).json(
      new ApiResponse(200, 'Transactions retrieved', {
        transactions,
        summary: {
          totalAmount: totals._sum.amount || 0,
          totalPlatformFee: totals._sum.platformFee || 0,
          totalVetEarned: totals._sum.vetEarned || 0,
          totalTransactions: total
        },
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

// @desc    Get financial report
// @route   GET /api/v1/admin/financial-report
// @access  Private (Admin only)
export const getFinancialReport = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'ADMIN') {
      throw new ApiError(403, 'Only admins can view financial reports');
    }

    const { period = 'month', year, month } = req.query;

    const now = new Date();
    const currentYear = year ? parseInt(year as string) : now.getFullYear();
    const currentMonth = month ? parseInt(month as string) - 1 : now.getMonth();

    let startDate: Date;
    let endDate: Date;

    switch (period) {
      case 'day':
        startDate = new Date(currentYear, currentMonth, now.getDate());
        endDate = new Date(currentYear, currentMonth, now.getDate() + 1);
        break;
      case 'week':
        startDate = new Date(currentYear, currentMonth, now.getDate() - 7);
        endDate = new Date();
        break;
      case 'month':
        startDate = new Date(currentYear, currentMonth, 1);
        endDate = new Date(currentYear, currentMonth + 1, 0);
        break;
      case 'year':
        startDate = new Date(currentYear, 0, 1);
        endDate = new Date(currentYear, 11, 31);
        break;
      default:
        startDate = new Date(currentYear, currentMonth, 1);
        endDate = new Date(currentYear, currentMonth + 1, 0);
    }

    // Get transactions for period
    const transactions = await prisma.transaction.findMany({
      where: {
        paymentStatus: 'COMPLETED',
        createdAt: { gte: startDate, lte: endDate }
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Calculate totals by type
    const typeTotals = await prisma.transaction.groupBy({
      by: ['type'],
      where: {
        paymentStatus: 'COMPLETED',
        createdAt: { gte: startDate, lte: endDate }
      },
      _sum: {
        amount: true,
        platformFee: true
      },
      _count: true
    });

    // Get daily revenue for chart
    const dailyRevenue = await prisma.transaction.aggregate({
      _sum: { amount: true },
      where: {
        paymentStatus: 'COMPLETED',
        createdAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }
    });

    // Get top earning vets - Using multiple queries approach
    // First get transactions with vet information
    const vetTransactions = await prisma.transaction.findMany({
      where: {
        paymentStatus: 'COMPLETED',
        vetEarned: { not: null },
        createdAt: { gte: startDate, lte: endDate },
        vetId: { not: null }
      },
      include: {
        vet: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        }
      }
    });

    // Group by vet and calculate totals
    const vetEarningsMap = new Map();
    vetTransactions.forEach(transaction => {
      if (transaction.vet && transaction.vetId) {
        const existing = vetEarningsMap.get(transaction.vetId);
        if (existing) {
          existing.total_earned += transaction.vetEarned || 0;
          existing.transaction_count += 1;
        } else {
          vetEarningsMap.set(transaction.vetId, {
            id: transaction.vetId,
            firstName: transaction.vet.user?.firstName || 'Unknown',
            lastName: transaction.vet.user?.lastName || '',
            total_earned: transaction.vetEarned || 0,
            transaction_count: 1
          });
        }
      }
    });

    // Convert to array and sort
    const topVets = Array.from(vetEarningsMap.values())
      .sort((a, b) => b.total_earned - a.total_earned)
      .slice(0, 10);

    // Get subscription revenue
    const subscriptionRevenue = await prisma.transaction.aggregate({
      where: {
        type: 'SUBSCRIPTION',
        paymentStatus: 'COMPLETED',
        createdAt: { gte: startDate, lte: endDate }
      },
      _sum: {
        amount: true,
        platformFee: true
      },
      _count: true
    });

    // Get promotion revenue
    const promotionRevenue = await prisma.transaction.aggregate({
      where: {
        type: 'PROMOTION',
        paymentStatus: 'COMPLETED',
        createdAt: { gte: startDate, lte: endDate }
      },
      _sum: {
        amount: true,
        platformFee: true
      },
      _count: true
    });

    // Calculate platform earnings
    const platformEarnings = await prisma.transaction.aggregate({
      where: {
        paymentStatus: 'COMPLETED',
        createdAt: { gte: startDate, lte: endDate }
      },
      _sum: {
        platformFee: true
      }
    });

    res.status(200).json(
      new ApiResponse(200, 'Financial report', {
        period: {
          start: startDate,
          end: endDate,
          type: period
        },
        summary: {
          totalTransactions: transactions.length,
          totalAmount: transactions.reduce((sum, t) => sum + t.amount, 0),
          platformEarnings: platformEarnings._sum.platformFee || 0,
          subscriptionRevenue: subscriptionRevenue._sum.platformFee || 0,
          promotionRevenue: promotionRevenue._sum.platformFee || 0
        },
        breakdown: {
          byType: typeTotals.map(t => ({
            type: t.type,
            totalAmount: t._sum.amount,
            platformFee: t._sum.platformFee,
            count: t._count
          })),
          dailyRevenue,
          topVets
        },
        transactions: transactions.slice(0, 20) // Return first 20 transactions
      })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Get system analytics
// @route   GET /api/v1/admin/analytics
// @access  Private (Admin only)
export const getSystemAnalytics = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'ADMIN') {
      throw new ApiError(403, 'Only admins can view system analytics');
    }

    // Get date ranges
    const last30Days = new Date();
    last30Days.setDate(last30Days.getDate() - 30);
    
    const last90Days = new Date();
    last90Days.setDate(last90Days.getDate() - 90);

    // User growth analytics - Using aggregation with date grouping
    const usersLast30Days = await prisma.user.findMany({
      where: {
        createdAt: { gte: last30Days }
      },
      orderBy: { createdAt: 'asc' }
    });

    // Group users by day
    const userGrowth = usersLast30Days.reduce((acc, user) => {
      const date = user.createdAt.toISOString().split('T')[0];
      if (!acc[date]) {
        acc[date] = { date, new_users: 0, total_users: 0 };
      }
      acc[date].new_users += 1;
      return acc;
    }, {} as Record<string, any>);

    // Calculate cumulative totals
    let runningTotal = 0;
    const userGrowthArray = Object.values(userGrowth).map((day: any) => {
      runningTotal += day.new_users;
      return {
        date: day.date,
        new_users: day.new_users,
        total_users: runningTotal
      };
    });

    // Appointment analytics
    const appointmentsLast30Days = await prisma.appointment.findMany({
      where: {
        createdAt: { gte: last30Days }
      },
      orderBy: { createdAt: 'asc' }
    });

    // Group appointments by day and status
    const appointmentTrends = appointmentsLast30Days.reduce((acc, appointment) => {
      const date = appointment.createdAt.toISOString().split('T')[0];
      if (!acc[date]) {
        acc[date] = { 
          date, 
          total_appointments: 0, 
          completed_appointments: 0, 
          cancelled_appointments: 0 
        };
      }
      acc[date].total_appointments += 1;
      if (appointment.status === 'COMPLETED') acc[date].completed_appointments += 1;
      if (appointment.status === 'CANCELLED') acc[date].cancelled_appointments += 1;
      return acc;
    }, {} as Record<string, any>);

    const appointmentTrendsArray = Object.values(appointmentTrends);

    // Revenue analytics
    const transactionsLast30Days = await prisma.transaction.findMany({
      where: {
        paymentStatus: 'COMPLETED',
        createdAt: { gte: last30Days }
      },
      orderBy: { createdAt: 'asc' }
    });

    // Group transactions by day
    const revenueTrends = transactionsLast30Days.reduce((acc, transaction) => {
      const date = transaction.createdAt.toISOString().split('T')[0];
      if (!acc[date]) {
        acc[date] = { 
          date, 
          platform_revenue: 0, 
          total_volume: 0, 
          transaction_count: 0 
        };
      }
      acc[date].platform_revenue += transaction.platformFee;
      acc[date].total_volume += transaction.amount;
      acc[date].transaction_count += 1;
      return acc;
    }, {} as Record<string, any>);

    const revenueTrendsArray = Object.values(revenueTrends);

    // Vet performance analytics - Using multiple queries
    const vets = await prisma.vet.findMany({
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true
          }
        },
        appointments: {
          where: {
            createdAt: { gte: last90Days }
          }
        },
        reviews: true,
        transactions: {
          where: {
            paymentStatus: 'COMPLETED',
            vetEarned: { not: null }
          }
        }
      }
    });

    const vetPerformance = vets.map(vet => {
      const total_appointments = vet.appointments.length;
      const completed_appointments = vet.appointments.filter(a => a.status === 'COMPLETED').length;
      const average_rating = vet.reviews.length > 0 
        ? vet.reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / vet.reviews.length 
        : 0;
      const total_earnings = vet.transactions.reduce((sum, t) => sum + (t.vetEarned || 0), 0);

      return {
        id: vet.id,
        firstName: vet.user?.firstName || 'Unknown',
        lastName: vet.user?.lastName || '',
        total_appointments,
        average_rating: parseFloat(average_rating.toFixed(2)),
        completed_appointments,
        total_earnings
      };
    }).sort((a, b) => b.total_earnings - a.total_earnings).slice(0, 10);

    // Calculate platform metrics directly
    const totalUsers = await prisma.user.count();
    const usersWithAppointments = await prisma.user.count({
      where: {
        appointments: {
          some: {}
        }
      }
    });
    const conversionRate = totalUsers > 0 ? (usersWithAppointments / totalUsers * 100) : 0;

    const avgTransactionResult = await prisma.transaction.aggregate({
      where: { paymentStatus: 'COMPLETED' },
      _avg: { amount: true }
    });
    const averageTransactionValue = avgTransactionResult._avg.amount || 0;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const returningUsers = await prisma.user.count({
      where: {
        appointments: {
          some: {
            createdAt: { gte: thirtyDaysAgo }
          }
        }
      }
    });

    const totalActiveUsers = await prisma.user.count({
      where: {
        appointments: {
          some: {}
        }
      }
    });
    const userRetentionRate = totalActiveUsers > 0 ? (returningUsers / totalActiveUsers * 100) : 0;

    const totalVets = await prisma.vet.count();
    const approvedVets = await prisma.vet.count({
      where: { isApproved: true }
    });
    const vetApprovalRate = totalVets > 0 ? (approvedVets / totalVets * 100) : 0;

    // Geographic distribution
    const usersByType = await prisma.user.groupBy({
      by: ['userType'],
      _count: true
    });

    const vetsByTier = await prisma.vet.groupBy({
      by: ['subscriptionTier', 'isApproved'],
      _count: true
    });

    const userDistribution = usersByType.map(u => ({
      user_count: u._count,
      userType: u.userType
    }));

    const vetDistribution = vetsByTier.map(v => ({
      vet_count: v._count,
      subscriptionTier: v.subscriptionTier,
      isApproved: v.isApproved
    }));

    res.status(200).json(
      new ApiResponse(200, 'System analytics', {
        trends: {
          userGrowth: userGrowthArray,
          appointmentTrends: appointmentTrendsArray,
          revenueTrends: revenueTrendsArray
        },
        performance: {
          topVets: vetPerformance,
          platformMetrics: {
            conversionRate: parseFloat(conversionRate.toFixed(2)),
            averageTransactionValue: parseFloat(averageTransactionValue.toFixed(2)),
            userRetentionRate: parseFloat(userRetentionRate.toFixed(2)),
            vetApprovalRate: parseFloat(vetApprovalRate.toFixed(2))
          }
        },
        distribution: {
          users: userDistribution,
          vets: vetDistribution
        },
        timePeriod: {
          last30Days,
          last90Days
        }
      })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Get recent activities
// @route   GET /api/admin/activities
// @access  Private (Admin only)
export const getRecentActivities = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'ADMIN') {
      throw new ApiError(403, 'Only admins can access this endpoint');
    }

    const activities = await prisma.adminLog.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: {
        admin: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    res.status(200).json(
      new ApiResponse(200, 'Recent activities retrieved', { activities })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Get revenue data for a timeframe
// @route   GET /api/admin/revenue/:timeframe
// @access  Private (Admin only)
export const getRevenueData = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'ADMIN') {
      throw new ApiError(403, 'Only admins can access this endpoint');
    }

    const { timeframe } = req.params;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let startDate = today;

    switch (timeframe) {
      case 'week':
        startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate = new Date(today);
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'year':
        startDate = new Date(today);
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 7);
    }

    const transactions = await prisma.transaction.findMany({
      where: {
        paymentStatus: 'COMPLETED',
        createdAt: {
          gte: startDate,
          lte: today
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    const data = transactions.map((t, index) => ({
      x: index,
      y: t.amount,
      date: t.createdAt
    }));

    res.status(200).json(
      new ApiResponse(200, 'Revenue data retrieved', { data })
    );
  } catch (error: any) {
    next(error);
  }
};