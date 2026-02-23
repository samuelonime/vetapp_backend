import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { ApiError, ApiResponse } from '../utils/response';
import logger from '../utils/logger';
import { PaystackService } from '../services/paystackService';
import { CommissionService } from '../services/commissionService';
import { NotificationService } from '../services/notificationService';

const prisma = new PrismaClient();

// @desc    Initialize payment for consultation
// @route   POST /api/v1/payments/initialize
// @access  Private
export const initializePayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { appointmentId, type } = req.body;

    logger.info(`Initializing payment for appointment ${appointmentId} by user ${req.user.id}`);

    // Get appointment details
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        vetProfile: { // FIXED: Use vetProfile for Vet model
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true
              }
            }
          }
        },
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    if (!appointment) {
      throw new ApiError(404, 'Appointment not found');
    }

    if (appointment.ownerId !== req.user.id) {
      throw new ApiError(403, 'Not authorized to pay for this appointment');
    }

    if (appointment.status !== 'PENDING') {
      throw new ApiError(400, 'Appointment already processed');
    }

    // Get vet tier from vetProfile
    const vetTier = appointment.vetProfile?.subscriptionTier || 'FREE';
    const consultationFee = appointment.consultationFee;
    let totalAmount = consultationFee;
    let platformFee = 0;
    let vetEarned = consultationFee;

    // FIXED: Pass vetTier as second argument
    if (type === 'VIDEO') {
      const videoCharges = CommissionService.calculateVideoCallCharges(consultationFee, vetTier);
      totalAmount = videoCharges.totalAmount;
      platformFee = videoCharges.platformEarns + videoCharges.videoCallFee;
      vetEarned = videoCharges.vetEarns;
    } else {
      const earnings = CommissionService.calculateEarnings(consultationFee, vetTier);
      platformFee = earnings.platformEarns;
      vetEarned = earnings.vetEarns;
      totalAmount = consultationFee; // Total amount for non-video is just consultation fee
    }

    // Prepare payment metadata
    const metadata = {
      appointmentId,
      vetId: appointment.vetId,
      ownerId: appointment.ownerId,
      type: appointment.type,
      consultationFee,
      platformFee,
      vetEarned,
      vetTier
    };

    // Initialize Paystack payment
    const paymentData = {
      email: appointment.owner.email,
      amount: Math.round(totalAmount * 100), // Convert to kobo
      metadata,
      callback_url: `${process.env.CLIENT_URL}/payment/callback`
    };

    logger.info(`Initiating Paystack payment for amount: ₦${totalAmount}`);

    const paystackResponse = await PaystackService.initializeTransaction(paymentData);

    // Create transaction record
    const transaction = await prisma.transaction.create({
      data: {
        appointmentId,
        userId: appointment.ownerId,
        vetId: appointment.vetId,
        type: 'consultation',
        amount: totalAmount,
        platformFee,
        vetEarned,
        paymentReference: paystackResponse.data.reference,
        paymentStatus: 'PENDING',
        paystackData: paystackResponse.data
      }
    });

    logger.info(`Payment initialized with reference: ${transaction.paymentReference}`);

    res.status(200).json(
      new ApiResponse(200, 'Payment initialized', {
        authorization_url: paystackResponse.data.authorization_url,
        reference: paystackResponse.data.reference,
        transaction
      })
    );
  } catch (error: any) {
    logger.error('Error initializing payment:', error);
    next(error);
  }
};

// @desc    Verify payment
// @route   GET /api/v1/payments/verify/:reference
// @access  Private
export const verifyPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { reference } = req.params;

    logger.info(`Verifying payment with reference: ${reference}`);

    // Verify with Paystack
    const verification = await PaystackService.verifyTransaction(reference);

    if (verification.data.status !== 'success') {
      throw new ApiError(400, 'Payment failed or pending');
    }

    logger.info(`Paystack verification successful for reference: ${reference}`);

    // Get transaction
    const transaction = await prisma.transaction.findUnique({
      where: { paymentReference: reference },
      include: {
        appointment: true
      }
    });

    if (!transaction) {
      throw new ApiError(404, 'Transaction not found');
    }

    if (transaction.paymentStatus === 'COMPLETED') {
      throw new ApiError(400, 'Payment already verified');
    }

    // Update transaction status
    const updatedTransaction = await prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        paymentStatus: 'COMPLETED',
        paystackData: verification.data
      }
    });

    // Update appointment status
    const updatedAppointment = await prisma.appointment.update({
      where: { id: transaction.appointmentId! },
      data: {
        status: 'CONFIRMED',
        platformFee: transaction.platformFee || 0,
        totalAmount: transaction.amount,
        vetEarned: transaction.vetEarned || 0
      },
      include: {
        vetProfile: { // FIXED: Use vetProfile for Vet model
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true
              }
            }
          }
        },
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    // Update vet earnings
    await prisma.vet.update({
      where: { id: transaction.vetId! },
      data: {
        totalEarnings: { increment: transaction.vetEarned! },
        pendingEarnings: { increment: transaction.vetEarned! }
      }
    });

    // Create vet earning record
    await prisma.vetEarning.create({
      data: {
        vetId: transaction.vetId!,
        appointmentId: transaction.appointmentId,
        amount: transaction.vetEarned!,
        type: 'consultation',
        status: 'pending'
      }
    });

    // Send notifications using NotificationService class
    await NotificationService.sendPaymentNotification(
      updatedAppointment.ownerId,
      transaction.vetId!,
      transaction.amount
    );

    logger.info(`Payment verified successfully for appointment ${transaction.appointmentId}`);

    res.status(200).json(
      new ApiResponse(200, 'Payment verified successfully', {
        transaction: updatedTransaction,
        appointment: updatedAppointment
      })
    );
  } catch (error: any) {
    logger.error('Error verifying payment:', error);
    next(error);
  }
};

// @desc    Process vet payout
// @route   POST /api/v1/payments/payout
// @access  Private (Vet only)
export const processPayout = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only veterinarians can request payouts');
    }

    logger.info(`Processing payout for vet user ${req.user.id}`);

    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet profile not found');
    }

    if (vet.availableEarnings < 1000) {
      throw new ApiError(400, 'Minimum payout amount is ₦1000');
    }

    if (!vet.bankDetails) {
      throw new ApiError(400, 'Bank details not set');
    }

    // Process payout via Paystack Transfer
    // Note: Paystack Transfer API requires additional setup
    const bankDetails = vet.bankDetails as any;
    
    // For MVP, simulate payout
    const payoutAmount = vet.availableEarnings;

    // Update vet earnings
    const updatedVet = await prisma.vet.update({
      where: { id: vet.id },
      data: {
        availableEarnings: 0,
        pendingEarnings: { decrement: payoutAmount }
      }
    });

    // Create payout transaction
    const payoutTransaction = await prisma.transaction.create({
      data: {
        userId: req.user.id,
        vetId: vet.id,
        type: 'payout',
        amount: payoutAmount,
        platformFee: 0,
        paymentReference: `PAYOUT_${Date.now()}_${vet.id}`,
        paymentStatus: 'COMPLETED',
        metadata: {
          bankName: bankDetails.bankName,
          accountNumber: bankDetails.accountNumber,
          accountName: bankDetails.accountName,
          payoutDate: new Date().toISOString()
        }
      }
    });

    // Update vet earnings records
    await prisma.vetEarning.updateMany({
      where: {
        vetId: vet.id,
        status: 'pending'
      },
      data: {
        status: 'paid',
        payoutDate: new Date()
      }
    });

    logger.info(`Payout processed for vet ${vet.id}: ₦${payoutAmount}`);

    res.status(200).json(
      new ApiResponse(200, 'Payout processed successfully', {
        payoutAmount,
        availableEarnings: updatedVet.availableEarnings,
        transaction: payoutTransaction
      })
    );
  } catch (error: any) {
    logger.error('Error processing payout:', error);
    next(error);
  }
};

// @desc    Get payment history
// @route   GET /api/v1/payments/history
// @access  Private
export const getPaymentHistory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { page = 1, limit = 20, type } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    logger.info(`Getting payment history for user ${req.user.id}, page ${page}`);

    const where: any = { userId: req.user.id };
    if (type) {
      where.type = type;
    }

    const transactions = await prisma.transaction.findMany({
      where,
      include: {
        appointment: {
          include: {
            vet: { // This is User model from appointment
              select: {
                firstName: true,
                lastName: true,
                avatar: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take
    });

    // Format the transactions to match the expected structure
    const formattedTransactions = transactions.map(transaction => ({
      ...transaction,
      vet: transaction.appointment?.vet ? {
        firstName: transaction.appointment.vet.firstName,
        lastName: transaction.appointment.vet.lastName,
        avatar: transaction.appointment.vet.avatar
      } : null
    }));

    const total = await prisma.transaction.count({ where });

    logger.info(`Retrieved ${transactions.length} transactions for user ${req.user.id}`);

    res.status(200).json(
      new ApiResponse(200, 'Payment history retrieved', {
        transactions: formattedTransactions,
        pagination: {
          page: parseInt(page as string),
          limit: take,
          total,
          pages: Math.ceil(total / take)
        }
      })
    );
  } catch (error: any) {
    logger.error('Error getting payment history:', error);
    next(error);
  }
};

// @desc    Get vet earnings
// @route   GET /api/v1/payments/earnings
// @access  Private (Vet only)
export const getVetEarnings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only veterinarians can view earnings');
    }

    logger.info(`Getting earnings for vet user ${req.user.id}`);

    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet profile not found');
    }

    const { period = 'month' } = req.query;
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'day':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    // Get earnings for period
    const earnings = await prisma.vetEarning.findMany({
      where: {
        vetId: vet.id,
        createdAt: { gte: startDate },
        status: 'paid'
      },
      include: {
        appointment: {
          select: {
            id: true,
            type: true,
            owner: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Calculate totals
    const totalEarned = earnings.reduce((sum, earning) => sum + earning.amount, 0);

    // Get pending earnings
    const pendingEarnings = await prisma.vetEarning.findMany({
      where: {
        vetId: vet.id,
        status: 'pending'
      }
    });

    const totalPending = pendingEarnings.reduce((sum, earning) => sum + earning.amount, 0);

    logger.info(`Earnings retrieved for vet ${vet.id}: ₦${totalEarned} earned, ₦${totalPending} pending`);

    res.status(200).json(
      new ApiResponse(200, 'Earnings retrieved', {
        summary: {
          totalEarnings: vet.totalEarnings,
          availableEarnings: vet.availableEarnings,
          pendingEarnings: vet.pendingEarnings,
          periodEarnings: totalEarned,
          periodPending: totalPending
        },
        earnings,
        pendingEarnings
      })
    );
  } catch (error: any) {
    logger.error('Error getting vet earnings:', error);
    next(error);
  }
};