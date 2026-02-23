import { Response, NextFunction } from 'express';
import { PrismaClient, AppointmentType, AppointmentStatus} from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { ApiError, ApiResponse } from '../utils/response';
import logger from '../utils/logger';
import { NotificationService } from '../services/notificationService';
import { CommissionService } from '../services/commissionService';
import { ResponseTransformer } from '../utils/transformer'; 

const prisma = new PrismaClient();

// Define working hours types
interface DaySchedule {
  start: string;
  end: string;
  isAvailable: boolean;
}

interface WorkingHours {
  monday?: DaySchedule;
  tuesday?: DaySchedule;
  wednesday?: DaySchedule;
  thursday?: DaySchedule;
  friday?: DaySchedule;
  saturday?: DaySchedule;
  sunday?: DaySchedule;
}

interface AppointmentWithDetails {
  id: string;
  ownerId: string;
  vetId: string;
  type: AppointmentType;
  status: AppointmentStatus;
  scheduledAt: Date | null;
  consultationFee: number;
  platformFee: number;
  videoCallFee: number;
  totalAmount: number;
  vetEarned: number;
  symptoms: string[];
  notes: string | null;
  diagnosis: string | null;
  prescription: string | null;
  followUpDate: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  vet?: any;
  owner?: any;
  chatMessages?: any[];
  transaction?: any;
  review?: any;
}


// Helper function to check if appointment can be cancelled
const canBeCancelled = (appointment: AppointmentWithDetails): boolean => {
  if (appointment.status === 'CANCELLED' || appointment.status === 'COMPLETED') {
    return false;
  }
  
  if (appointment.scheduledAt) {
    const scheduledTime = new Date(appointment.scheduledAt);
    const now = new Date();
    const hoursDifference = (scheduledTime.getTime() - now.getTime()) / (1000 * 60 * 60);
    
    // Can cancel up to 2 hours before appointment
    return hoursDifference >= 2;
  }
  
  return true;
};

// Helper function to check if appointment can be rescheduled
const canBeRescheduled = (appointment: AppointmentWithDetails): boolean => {
  if (appointment.status === 'CANCELLED' || appointment.status === 'COMPLETED') {
    return false;
  }
  
  if (appointment.scheduledAt) {
    const scheduledTime = new Date(appointment.scheduledAt);
    const now = new Date();
    const hoursDifference = (scheduledTime.getTime() - now.getTime()) / (1000 * 60 * 60);
    
    // Can reschedule up to 1 hour before appointment
    return hoursDifference >= 1;
  }
  
  return true;
};

// Helper to get vet working hours with defaults
const getVetWorkingHours = (vet: any): WorkingHours => {
  const defaultHours: WorkingHours = {
    monday: { start: '09:00', end: '17:00', isAvailable: true },
    tuesday: { start: '09:00', end: '17:00', isAvailable: true },
    wednesday: { start: '09:00', end: '17:00', isAvailable: true },
    thursday: { start: '09:00', end: '17:00', isAvailable: true },
    friday: { start: '09:00', end: '17:00', isAvailable: true },
    saturday: { start: '10:00', end: '14:00', isAvailable: false },
    sunday: { start: '10:00', end: '14:00', isAvailable: false }
  };

  if (vet.workingHours && typeof vet.workingHours === 'object') {
    return { ...defaultHours, ...vet.workingHours };
  }
  
  return defaultHours;
};

// Validate appointment type
const validateAppointmentType = (type: string): AppointmentType => {
  const validTypes: AppointmentType[] = ['CHAT', 'VIDEO', 'IN_PERSON'];
  if (!validTypes.includes(type as AppointmentType)) {
    throw new ApiError(400, `Invalid appointment type. Must be one of: ${validTypes.join(', ')}`);
  }
  return type as AppointmentType;
};

// Validate consultation fee
const validateConsultationFee = (fee: number): void => {
  if (fee < 0) {
    throw new ApiError(400, 'Consultation fee cannot be negative');
  }
  
  const minFee = parseFloat(process.env.MINIMUM_CONSULTATION_FEE || '1000');
  const maxFee = parseFloat(process.env.MAXIMUM_CONSULTATION_FEE || '50000');
  
  if (fee < minFee) {
    throw new ApiError(400, `Consultation fee must be at least ₦${minFee}`);
  }
  
  if (fee > maxFee) {
    throw new ApiError(400, `Consultation fee cannot exceed ₦${maxFee}`);
  }
};


// @desc    Create new appointment
// @route   POST /api/v1/appointments
// @access  Private (Owner only)
export const createAppointment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    logger.info(`Creating appointment request from user: ${req.user.id}`);
    
    if (req.user.userType !== 'OWNER') {
      throw new ApiError(403, 'Only pet owners can create appointments');
    }

    const {
      vetId,
      type,
      scheduledAt,
      symptoms,
      notes
    } = req.body;

    // Validate appointment type
    const appointmentType = validateAppointmentType(type);

    // Validate vet
    const vet = await prisma.vet.findUnique({
      where: { id: vetId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true
          }
        },
        subscriptions: {
          where: {
            isActive: true,
            expiresAt: { gt: new Date() }
          }
        }
      }
    });

    if (!vet) {
      logger.warn(`Vet not found: ${vetId}`);
      throw new ApiError(404, 'Veterinarian not found');
    }

    if (!vet.isApproved) {
      throw new ApiError(400, 'This veterinarian is not approved yet');
    }

    // Validate consultation fee
    validateConsultationFee(vet.consultationFee);

    // Check if vet is online (for immediate consultations)
    if (type === 'CHAT' && !scheduledAt && !vet.onlineStatus) {
      throw new ApiError(400, 'Veterinarian is currently offline');
    }

    // Validate scheduled time if provided
    let scheduledTime: Date | null = null;
    if (scheduledAt) {
      scheduledTime = new Date(scheduledAt);
      const now = new Date();
      
      if (scheduledTime < now) {
        throw new ApiError(400, 'Cannot schedule appointment in the past');
      }

      // Check if time slot is available (with 15-minute buffer)
      const bufferStart = new Date(scheduledTime.getTime() - 15 * 60 * 1000);
      const bufferEnd = new Date(scheduledTime.getTime() + 15 * 60 * 1000);

      const existingAppointment = await prisma.appointment.findFirst({
        where: {
          vetId,
          scheduledAt: {
            gte: bufferStart,
            lte: bufferEnd
          },
          status: { in: ['PENDING', 'CONFIRMED'] }
        }
      });

      if (existingAppointment) {
        throw new ApiError(400, 'This time slot is already booked or too close to another appointment');
      }

      // Check vet's working hours
      const workingHours = getVetWorkingHours(vet);
      const dayOfWeek = scheduledTime.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      const daySchedule = workingHours[dayOfWeek as keyof WorkingHours];
      
      if (daySchedule) {
        // Check if vet is available on this day
        if (!daySchedule.isAvailable) {
          throw new ApiError(400, 'Veterinarian is not available on this day');
        }

        // Check if time is within working hours
        const appointmentHour = scheduledTime.getHours();
        const appointmentMinute = scheduledTime.getMinutes();
        const [startHour, startMinute] = daySchedule.start.split(':').map(Number);
        const [endHour, endMinute] = daySchedule.end.split(':').map(Number);
        
        const appointmentTime = appointmentHour * 60 + appointmentMinute;
        const startTime = startHour * 60 + startMinute;
        const endTime = endHour * 60 + endMinute;
        
        if (appointmentTime < startTime || appointmentTime >= endTime) {
          throw new ApiError(400, 'Appointment time is outside veterinarian working hours');
        }
      }
    }

    // Calculate fees using CommissionService
    const consultationFee = vet.consultationFee;
    const vetTier = vet.subscriptionTier;
    
    let feeCalculation;
    let totalAmount;
    let videoCallFee = 0;
    let platformFee = 0;
    let vetEarned = 0;

    if (type === 'VIDEO') {
      // Use the fixed video call calculation with correct tier
      feeCalculation = CommissionService.calculateVideoCallCharges(consultationFee, vetTier);
      totalAmount = feeCalculation.totalAmount;
      videoCallFee = feeCalculation.videoCallFee;
      platformFee = feeCalculation.platformEarns;
      vetEarned = feeCalculation.vetEarns;
    } else {
      // Regular appointment
      feeCalculation = CommissionService.calculateEarnings(consultationFee, vetTier);
      totalAmount = feeCalculation.totalAmount;
      platformFee = feeCalculation.platformEarns;
      vetEarned = feeCalculation.vetEarns;
    }
    
    // Log commission calculation
    logger.info(`Commission calculated for vet ${vetId}:`, {
      consultationFee,
      vetTier,
      appointmentType: type,
      totalAmount,
      platformFee,
      vetEarned,
      videoCallFee
    });

    // Check subscription limits for vets on FREE tier
    if (vet.subscriptionTier === 'FREE') {
      const freeAppointmentsLimit = 20; // Monthly limit for FREE tier
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      
      const appointmentsThisMonth = await prisma.appointment.count({
        where: {
          vetId,
          createdAt: { gte: monthStart },
          status: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] }
        }
      });

      if (appointmentsThisMonth >= freeAppointmentsLimit) {
        throw new ApiError(400, 'Veterinarian has reached their monthly appointment limit. Please try another veterinarian or check back next month.');
      }
    }

    // Create appointment with transaction for data consistency
    const appointment = await prisma.$transaction(async (tx) => {
      // Create appointment
      const newAppointment = await tx.appointment.create({
        data: {
          ownerId: req.user.id,
          vetId,
          type: appointmentType,
          status: 'PENDING',
          scheduledAt: scheduledTime,
          consultationFee,
          platformFee,
          videoCallFee,
          totalAmount,
          vetEarned,
          symptoms: symptoms || [],
          notes: notes || null
        },
        include: {
          vet: { // This is the User (vet)
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true
            }
          },
          vetProfile: { // This is the Vet profile
            include: {
              user: { // This is the Vet's user
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  phone: true
                }
              }
            }
          },
          owner: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true
            }
          }
        }
      });

      // Create initial chat message
      await tx.chatMessage.create({
        data: {
          appointmentId: newAppointment.id,
          senderId: req.user.id,
          receiverId: vet.userId,
          message: `Appointment requested for ${type.toLowerCase()} consultation.`
        }
      });

      // Create vet earning record - FIXED: Added type field
      await tx.vetEarning.create({
        data: {
          vetId,
          appointmentId: newAppointment.id,
          amount: vetEarned,
          type: 'CONSULTATION', // Added this required field
          status: 'pending'
        }
      });

      return newAppointment;
    });

    logger.info(`Appointment created: ${appointment.id}`);

    // Send notification to vet (outside transaction)
    try {
      await NotificationService.sendAppointmentNotification(appointment.id, 'created');
    } catch (notificationError) {
      logger.error('Failed to send notification:', notificationError);
      // Don't fail the appointment creation if notification fails
    }

    res.status(201).json(
      new ApiResponse(201, 'Appointment created successfully', { 
        appointment: ResponseTransformer.transformAppointment(appointment) 
      })
    );
  } catch (error: any) {
    logger.error('Error creating appointment:', error);
    next(error);
  }
};

// @desc    Get all appointments (filtered by user type)
// @route   GET /api/v1/appointments
// @access  Private
export const getAppointments = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    logger.info(`Getting appointments for user: ${req.user.id}`);
    
    const {
      page = 1,
      limit = 20,
      status,
      type,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    // Build where clause based on user type
    const where: any = {};

    if (req.user.userType === 'OWNER') {
      where.ownerId = req.user.id;
    } else if (req.user.userType === 'VET') {
      const vet = await prisma.vet.findUnique({
        where: { userId: req.user.id }
      });
      if (vet) {
        where.vetId = vet.id;
      } else {
        throw new ApiError(404, 'Vet profile not found');
      }
    } else if (req.user.userType === 'ADMIN') {
      // Admin can see all appointments
    } else {
      throw new ApiError(403, 'Invalid user type');
    }

    // Apply filters
    if (status) {
      // Validate status is a valid AppointmentStatus
      const validStatuses: AppointmentStatus[] = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'];
      if (validStatuses.includes(status as AppointmentStatus)) {
        where.status = status;
      }
    }
    
    if (type) {
      // Validate type is a valid AppointmentType
      const validTypes: AppointmentType[] = ['CHAT', 'VIDEO', 'IN_PERSON'];
      if (validTypes.includes(type as AppointmentType)) {
        where.type = type;
      }
    }
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        const start = new Date(startDate as string);
        start.setHours(0, 0, 0, 0);
        where.createdAt.gte = start;
      }
      if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    // Validate sort parameters
    const validSortFields = ['createdAt', 'scheduledAt', 'updatedAt', 'consultationFee'];
    const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'createdAt';
    const sortDirection = sortOrder === 'asc' ? 'asc' : 'desc';

    const orderBy: any = {};
    orderBy[sortField] = sortDirection;

    // Fix: Correct the Prisma query structure
    const appointments = await prisma.appointment.findMany({
      where,
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
            phone: true
          }
        },
        vet: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true
          }
        },
        chatMessages: {
          orderBy: { createdAt: 'desc' },
          take: 1
        },
        transaction: {
          select: {
            paymentStatus: true,
            paymentReference: true
          }
        },
        review: {
          select: {
            id: true,
            rating: true
          }
        }
      },
      orderBy,
      skip,
      take
    });

    const total = await prisma.appointment.count({ where });

    // Get appointment statistics
    const statusCounts = await prisma.appointment.groupBy({
      by: ['status'],
      where,
      _count: true
    });

    const typeCounts = await prisma.appointment.groupBy({
      by: ['type'],
      where,
      _count: true
    });

    logger.info(`Retrieved ${appointments.length} appointments for user: ${req.user.id}`);

    res.status(200).json(
      new ApiResponse(200, 'Appointments retrieved', {
        appointments: appointments.map(apt => ResponseTransformer.transformAppointment(apt)),
        statistics: {
          status: statusCounts.reduce((acc, item) => {
            acc[item.status?.toLowerCase() || 'unknown'] = item._count;
            return acc;
          }, {} as Record<string, number>),
          type: typeCounts.reduce((acc, item) => {
            acc[item.type?.toLowerCase() || 'unknown'] = item._count;
            return acc;
          }, {} as Record<string, number>),
          total
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
    logger.error('Error getting appointments:', error);
    next(error);
  }
};

// @desc    Get appointment by ID
// @route   GET /api/v1/appointments/:id
// @access  Private
export const getAppointmentById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    logger.info(`Getting appointment: ${id} for user: ${req.user.id}`);

    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
            email: true,
            phone: true,
            location: true
          }
        },
        vet: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
            email: true,
            phone: true
          }
        },
        chatMessages: {
          orderBy: { createdAt: 'asc' },
          take: 50,
          include: {
            sender: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                avatar: true,
                userType: true
              }
            },
            receiver: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                avatar: true,
                userType: true
              }
            }
          }
        },
        transaction: true, // Changed to include all transaction fields
        review: {
          include: {
            owner: {
              select: {
                firstName: true,
                lastName: true,
                avatar: true
              }
            }
          }
        }
      }
    });

    if (!appointment) {
      throw new ApiError(404, 'Appointment not found');
    }

    // Check authorization
    const isOwner = appointment.ownerId === req.user.id;
    const isVet = req.user.userType === 'VET';
    let vetId: string | null = null;
    
    if (isVet) {
      const vet = await prisma.vet.findUnique({
        where: { userId: req.user.id }
      });
      vetId = vet?.id || null;
    }
    
    const isAppointmentVet = vetId === appointment.vetId;
    const isAdmin = req.user.userType === 'ADMIN';

    if (!isOwner && !isAppointmentVet && !isAdmin) {
      throw new ApiError(403, 'Not authorized to view this appointment');
    }

    // Get unread message count for current user
    const unreadCount = await prisma.chatMessage.count({
      where: {
        appointmentId: id,
        receiverId: req.user.id,
        isRead: false
      }
    });

    // Check if appointment has review - FIXED: Remove duplicate declaration
    const hasReview = appointment.review ? true : false;

    res.status(200).json(
      new ApiResponse(200, 'Appointment details', {
        appointment: ResponseTransformer.transformAppointment(appointment),
        unreadCount,
        canCancel: canBeCancelled(appointment as AppointmentWithDetails),
        canReschedule: canBeRescheduled(appointment as AppointmentWithDetails),
        permissions: {
          canChat: ['PENDING', 'CONFIRMED', 'COMPLETED'].includes(appointment.status),
          canReview: appointment.status === 'COMPLETED' && isOwner && !hasReview,
          canComplete: appointment.status === 'CONFIRMED' && isAppointmentVet,
          canCancel: (isOwner || isAppointmentVet || isAdmin) && canBeCancelled(appointment as AppointmentWithDetails),
          canReschedule: (isOwner || isAppointmentVet) && canBeRescheduled(appointment as AppointmentWithDetails)
        }
      })
    );
  } catch (error: any) {
    logger.error('Error getting appointment by ID:', error);
    next(error);
  }
};

// @desc    Update appointment
// @route   PUT /api/v1/appointments/:id
// @access  Private
export const updateAppointment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { symptoms, notes, diagnosis, prescription, followUpDate } = req.body;

    logger.info(`Updating appointment: ${id} by user: ${req.user.id}`);

    const appointment = await prisma.appointment.findUnique({
      where: { id }
    });

    if (!appointment) {
      throw new ApiError(404, 'Appointment not found');
    }

    // Check authorization
    const isOwner = appointment.ownerId === req.user.id;
    const isVet = req.user.userType === 'VET';
    let vetId: string | null = null;
    
    if (isVet) {
      const vet = await prisma.vet.findUnique({
        where: { userId: req.user.id }
      });
      vetId = vet?.id || null;
    }
    
    const isAppointmentVet = vetId === appointment.vetId;
    const isAdmin = req.user.userType === 'ADMIN';

    if (!isOwner && !isAppointmentVet && !isAdmin) {
      throw new ApiError(403, 'Not authorized to update this appointment');
    }

    // Check if appointment can be updated
    if (appointment.status === 'COMPLETED' || appointment.status === 'CANCELLED') {
      throw new ApiError(400, 'Cannot update completed or cancelled appointment');
    }

    // Prepare update data
    const updateData: any = {
      updatedAt: new Date()
    };

    if (isAppointmentVet) {
      // Vet can update diagnosis, prescription, and follow-up date
      if (diagnosis !== undefined) updateData.diagnosis = diagnosis;
      if (prescription !== undefined) updateData.prescription = prescription;
      if (followUpDate !== undefined) updateData.followUpDate = followUpDate ? new Date(followUpDate) : null;
      
      // Validate follow-up date if provided
      if (followUpDate) {
        const followUp = new Date(followUpDate);
        if (followUp < new Date()) {
          throw new ApiError(400, 'Follow-up date cannot be in the past');
        }
      }
    }

    if (isOwner) {
      // Owner can update symptoms and notes
      if (symptoms !== undefined) {
        updateData.symptoms = Array.isArray(symptoms) ? symptoms : [symptoms];
      }
      if (notes !== undefined) updateData.notes = notes;
    }

    const updatedAppointment = await prisma.appointment.update({
      where: { id },
      data: updateData,
      include: {
        owner: {
          select: {
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    // Send notifications
    if (isAppointmentVet && (diagnosis || prescription || followUpDate)) {
      await NotificationService.sendPushNotification(
        appointment.ownerId,
        'Appointment Updated',
        'Your veterinarian has updated your appointment details.',
        { appointmentId: id, type: 'appointment_update' }
      );
    }

    logger.info(`Appointment updated: ${id} by ${isVet ? 'vet' : 'owner'}`);
    
    res.status(200).json(
      new ApiResponse(200, 'Appointment updated successfully', { appointment: updatedAppointment })
    );
  } catch (error: any) {
    logger.error('Error updating appointment:', error);
    next(error);
  }
};

// @desc    Cancel appointment - FIXED: Changed route to POST
// @route   POST /api/v1/appointments/:id/cancel
// @access  Private
export const cancelAppointment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    logger.info(`Cancelling appointment: ${id} by user: ${req.user.id}`);

    // FIXED: Use vetProfile instead of vet for Vet model
    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: {
        owner: true,
        vetProfile: { // Use vetProfile for Vet model
          include: { 
            user: true 
          }
        },
        transaction: true
      }
    });

    if (!appointment) {
      throw new ApiError(404, 'Appointment not found');
    }

    // Check authorization
    const isOwner = appointment.ownerId === req.user.id;
    const isVet = req.user.userType === 'VET';
    let vetId: string | null = null;
    
    if (isVet) {
      const vet = await prisma.vet.findUnique({
        where: { userId: req.user.id }
      });
      vetId = vet?.id || null;
    }
    
    const isAppointmentVet = vetId === appointment.vetId;
    const isAdmin = req.user.userType === 'ADMIN';

    if (!isOwner && !isAppointmentVet && !isAdmin) {
      throw new ApiError(403, 'Not authorized to cancel this appointment');
    }

    // Check if appointment can be cancelled
    if (!canBeCancelled(appointment as AppointmentWithDetails)) {
      throw new ApiError(400, 'Appointment cannot be cancelled at this time');
    }

    // Determine who cancelled
    let cancelledBy: 'OWNER' | 'VET' | 'SYSTEM' = 'SYSTEM';
    if (isOwner) cancelledBy = 'OWNER';
    if (isAppointmentVet) cancelledBy = 'VET';
    if (isAdmin) cancelledBy = 'SYSTEM';

    // Process cancellation with transaction
    const updatedAppointment = await prisma.$transaction(async (tx) => {
      // Update appointment
      const cancelledAppointment = await tx.appointment.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          updatedAt: new Date()
        }
      });

      // Refund payment if already paid
      if (appointment.transaction && appointment.transaction.paymentStatus === 'COMPLETED') {
        const refundReference = `REFUND_${Date.now()}_${id}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Create refund transaction
        await tx.transaction.create({
          data: {
            appointmentId: id,
            userId: appointment.ownerId,
            vetId: appointment.vetId,
            type: 'REFUND',
            amount: appointment.transaction.amount,
            platformFee: 0,
            paymentReference: refundReference,
            paymentStatus: 'COMPLETED',
            metadata: {
              originalTransactionId: appointment.transaction.id,
              reason: 'Appointment cancellation',
              cancelledBy,
              refundReason: reason || 'No reason provided'
            }
          }
        });

        // Update original transaction
        await tx.transaction.update({
          where: { id: appointment.transaction.id },
          data: { paymentStatus: 'REFUNDED' }
        });

        // Update vet earnings
        await tx.vet.update({
          where: { id: appointment.vetId },
          data: {
            totalEarnings: { decrement: appointment.vetEarned },
            pendingEarnings: { decrement: appointment.vetEarned }
          }
        });

        // Update vet earning record
        await tx.vetEarning.updateMany({
          where: {
            vetId: appointment.vetId,
            appointmentId: id,
            status: 'pending'
          },
          data: {
            status: 'cancelled'
          }
        });
      }

      // Add system message to chat
      // FIXED: Access vet user ID from vetProfile
      const vetUserId = appointment.vetProfile?.userId || appointment.ownerId;
      await tx.chatMessage.create({
        data: {
          appointmentId: id,
          senderId: req.user.id,
          receiverId: cancelledBy === 'OWNER' ? vetUserId : appointment.ownerId,
          message: `Appointment has been cancelled. ${reason ? `Reason: ${reason}` : ''}`
        }
      });

      return cancelledAppointment;
    });

    // Send notifications (outside transaction)
    try {
      await NotificationService.sendAppointmentNotification(id, 'cancelled');
    } catch (notificationError) {
      logger.error('Failed to send cancellation notification:', notificationError);
    }

    res.status(200).json(
      new ApiResponse(200, 'Appointment cancelled successfully', { appointment: updatedAppointment })
    );
  } catch (error: any) {
    logger.error('Error cancelling appointment:', error);
    next(error);
  }
};

// @desc    Complete appointment
// @route   POST /api/v1/appointments/:id/complete
// @access  Private (Vet only)
export const completeAppointment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only veterinarians can complete appointments');
    }

    const { id } = req.params;
    const { completedNotes } = req.body;

    // FIXED: Use vetProfile for Vet model
    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: {
        vetProfile: { // Use vetProfile for Vet model
          include: { user: true }
        },
        transaction: true
      }
    });

    if (!appointment) {
      throw new ApiError(404, 'Appointment not found');
    }

    // Verify vet owns this appointment
    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vet || appointment.vetId !== vet.id) {
      throw new ApiError(403, 'Not authorized to complete this appointment');
    }

    if (appointment.status !== 'CONFIRMED') {
      throw new ApiError(400, 'Only confirmed appointments can be completed');
    }

    // Process completion with transaction
    const updatedAppointment = await prisma.$transaction(async (tx) => {
      // Update appointment
      const completedAppointment = await tx.appointment.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          updatedAt: new Date(),
          ...(completedNotes && { notes: completedNotes })
        },
        include: {
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

      // Update vet earnings from pending to available
      await tx.vet.update({
        where: { id: vet.id },
        data: {
          pendingEarnings: { decrement: appointment.vetEarned },
          availableEarnings: { increment: appointment.vetEarned }
        }
      });

      // Update vet earnings record
      await tx.vetEarning.updateMany({
        where: {
          vetId: vet.id,
          appointmentId: id,
          status: 'pending'
        },
        data: {
          status: 'available'
        }
      });

      // Add system message to chat
      await tx.chatMessage.create({
        data: {
          appointmentId: id,
          senderId: req.user.id,
          receiverId: appointment.ownerId,
          message: 'Appointment has been marked as completed. Thank you for your consultation!'
        }
      });

      return completedAppointment;
    });

    // Send notifications (outside transaction)
    try {
      await NotificationService.sendAppointmentNotification(id, 'completed');
    } catch (notificationError) {
      logger.error('Failed to send completion notification:', notificationError);
    }

    res.status(200).json(
      new ApiResponse(200, 'Appointment completed successfully', { appointment: updatedAppointment })
    );
  } catch (error: any) {
    logger.error('Error completing appointment:', error);
    next(error);
  }
};

// @desc    Get vet's appointments
// @route   GET /api/v1/appointments/vet/appointments
// @access  Private (Vet only)
export const getVetAppointments = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only veterinarians can view their appointments');
    }

    const {
      page = 1,
      limit = 20,
      status,
      date,
      type,
      sortBy = 'scheduledAt',
      sortOrder = 'asc'
    } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    // Get vet profile
    const vet = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vet) {
      throw new ApiError(404, 'Vet profile not found');
    }

    // Build where clause
    const where: any = { vetId: vet.id };

    if (status) {
      where.status = status;
    } else {
      // Default to upcoming appointments
      where.OR = [
        { status: 'PENDING' },
        { status: 'CONFIRMED' }
      ];
    }
    
    if (type) {
      where.type = type;
    }
    
    if (date) {
      const dateObj = new Date(date as string);
      const nextDay = new Date(dateObj);
      nextDay.setDate(nextDay.getDate() + 1);
      
      where.scheduledAt = {
        gte: dateObj,
        lt: nextDay
      };
    } else if (status === 'PENDING' || status === 'CONFIRMED') {
      // For upcoming appointments, only show future dates
      where.scheduledAt = { gte: new Date() };
    }

    // Build sort order
    const orderBy: any = {};
    orderBy[sortBy as string] = sortOrder;

    const appointments = await prisma.appointment.findMany({
      where,
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
            phone: true
          }
        },
        chatMessages: {
          orderBy: { createdAt: 'desc' },
          take: 1
        },
        transaction: {
          select: {
            paymentStatus: true
          }
        }
      },
      orderBy,
      skip,
      take
    });

    const total = await prisma.appointment.count({ where });

    // Get today's appointments count
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayAppointments = await prisma.appointment.count({
      where: {
        vetId: vet.id,
        scheduledAt: {
          gte: today,
          lt: tomorrow
        },
        status: { in: ['PENDING', 'CONFIRMED'] }
      }
    });

    // Get pending appointments count
    const pendingAppointments = await prisma.appointment.count({
      where: {
        vetId: vet.id,
        status: 'PENDING'
      }
    });

    res.status(200).json(
      new ApiResponse(200, 'Vet appointments retrieved', {
        appointments,
        summary: {
          totalAppointments: total,
          todayAppointments,
          pendingAppointments,
          vetEarnings: vet.totalEarnings,
          availableEarnings: vet.availableEarnings
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
    logger.error('Error getting vet appointments:', error);
    next(error);
  }
};

// @desc    Get owner's appointments
// @route   GET /api/v1/appointments/owner/appointments
// @access  Private (Owner only)
export const getOwnerAppointments = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'OWNER') {
      throw new ApiError(403, 'Only pet owners can view their appointments');
    }

    const {
      page = 1,
      limit = 20,
      status,
      vetId,
      type,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    // Build where clause
    const where: any = { ownerId: req.user.id };

    if (status) {
      where.status = status;
    }
    
    if (vetId) {
      where.vetId = vetId as string;
    }
    
    if (type) {
      where.type = type;
    }

    // Build sort order
    const orderBy: any = {};
    orderBy[sortBy as string] = sortOrder;

    const appointments = await prisma.appointment.findMany({
      where,
      include: {
        vet: {
          select: { // Fixed: Use select instead of include for vet (User)
            id: true,
            firstName: true,
            lastName: true,
            avatar: true
          }
        },
        chatMessages: {
          orderBy: { createdAt: 'desc' },
          take: 1
        },
        transaction: {
          select: {
            paymentStatus: true,
            paymentReference: true
          }
        },
        review: {
          select: {
            id: true,
            rating: true
          }
        }
      },
      orderBy,
      skip,
      take
    });

    const total = await prisma.appointment.count({ where });

    // Get appointment statistics
    const upcomingAppointments = await prisma.appointment.count({
      where: {
        ownerId: req.user.id,
        status: { in: ['PENDING', 'CONFIRMED'] },
        scheduledAt: { gte: new Date() }
      }
    });

    const completedAppointments = await prisma.appointment.count({
      where: {
        ownerId: req.user.id,
        status: 'COMPLETED'
      }
    });

    const pendingReviews = await prisma.appointment.count({
      where: {
        ownerId: req.user.id,
        status: 'COMPLETED',
        review: null
      }
    });

    res.status(200).json(
      new ApiResponse(200, 'Owner appointments retrieved', {
        appointments,
        summary: {
          totalAppointments: total,
          upcomingAppointments,
          completedAppointments,
          pendingReviews
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
    logger.error('Error getting owner appointments:', error);
    next(error);
  }
};

// @desc    Get available time slots for vet
// @route   GET /api/v1/appointments/slots/:vetId
// @access  Private
export const getAvailableSlots = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { vetId } = req.params;
    const { date, duration = 30 } = req.query;

    const selectedDate = date ? new Date(date as string) : new Date();
    selectedDate.setHours(0, 0, 0, 0);

    // Get vet profile with working hours
    const vet = await prisma.vet.findUnique({
      where: { id: vetId },
      include: {
        user: true
      }
    });

    if (!vet) {
      throw new ApiError(404, 'Veterinarian not found');
    }

    if (!vet.isApproved) {
      throw new ApiError(400, 'Veterinarian is not approved yet');
    }

    // Get vet's working hours
    const workingHours = getVetWorkingHours(vet);
    const dayOfWeek = selectedDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const daySchedule = workingHours[dayOfWeek as keyof WorkingHours];

    if (!daySchedule || !daySchedule.isAvailable) {
      res.status(200).json(
        new ApiResponse(200, 'Veterinarian is not available on this day', {
          vet: {
            id: vet.id,
            name: `${vet.user.firstName} ${vet.user.lastName}`,
            onlineStatus: vet.onlineStatus,
            consultationFee: vet.consultationFee
          },
          selectedDate: selectedDate.toISOString().split('T')[0],
          workingHours: daySchedule,
          slots: [],
          slotDuration: parseInt(duration as string),
          message: 'Veterinarian is not available on this day'
        })
      );
      return;
    }

    const [startHour, startMinute] = daySchedule.start.split(':').map(Number);
    const [endHour, endMinute] = daySchedule.end.split(':').map(Number);

    // Get booked appointments for the selected date
    const startOfDay = new Date(selectedDate);
    startOfDay.setHours(startHour, startMinute, 0, 0);
    
    const endOfDay = new Date(selectedDate);
    endOfDay.setHours(endHour, endMinute, 0, 0);

    const bookedAppointments = await prisma.appointment.findMany({
      where: {
        vetId,
        scheduledAt: {
          gte: startOfDay,
          lt: endOfDay
        },
        status: { in: ['PENDING', 'CONFIRMED'] }
      },
      select: {
        scheduledAt: true
      }
    });

    // Generate available time slots
    const slots: Array<{
      time: string;
      available: boolean;
    }> = [];

    const slotDuration = parseInt(duration as string); // in minutes
    const currentTime = new Date(startOfDay);

    while (currentTime < endOfDay) {
      const timeString = currentTime.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });

      // Check if slot is booked
      const isBooked = bookedAppointments.some(appointment => {
        const appointmentTime = new Date(appointment.scheduledAt!);
        return appointmentTime.getTime() === currentTime.getTime();
      });

      // Check if slot is in the past (for current day)
      const now = new Date();
      const isPast = selectedDate.toDateString() === now.toDateString() && 
                    currentTime < now;

      slots.push({
        time: timeString,
        available: !isBooked && !isPast
      });

      // Move to next slot
      currentTime.setMinutes(currentTime.getMinutes() + slotDuration);
    }

    // Get vet's availability for the week
    const weekAvailability: Record<string, { available: boolean; hours?: string }> = {};
    const daysOfWeek = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    for (const day of daysOfWeek) {
      const dayWorkingHours = workingHours[day as keyof WorkingHours];
      if (dayWorkingHours) {
        weekAvailability[day] = {
          available: dayWorkingHours.isAvailable,
          hours: dayWorkingHours.isAvailable ? `${dayWorkingHours.start} - ${dayWorkingHours.end}` : 'Not available'
        };
      }
    }

    res.status(200).json(
      new ApiResponse(200, 'Available time slots', {
        vet: {
          id: vet.id,
          name: `${vet.user.firstName} ${vet.user.lastName}`,
          onlineStatus: vet.onlineStatus,
          consultationFee: vet.consultationFee
        },
        selectedDate: selectedDate.toISOString().split('T')[0],
        workingHours: daySchedule,
        slots,
        weekAvailability,
        slotDuration
      })
    );
  } catch (error: any) {
    logger.error('Error getting available slots:', error);
    next(error);
  }
};

// @desc    Reschedule appointment
// @route   POST /api/v1/appointments/:id/reschedule
// @access  Private
export const rescheduleAppointment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { newTime } = req.body;

    if (!newTime) {
      throw new ApiError(400, 'New appointment time is required');
    }

    // FIXED: Use vetProfile for Vet model
    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: {
        vetProfile: { // Use vetProfile for Vet model
          include: { 
            user: true 
          }
        },
        owner: true
      }
    });

    if (!appointment) {
      throw new ApiError(404, 'Appointment not found');
    }

    // Check authorization
    const isOwner = appointment.ownerId === req.user.id;
    const isVet = req.user.userType === 'VET';
    let vetId: string | null = null;
    
    if (isVet) {
      const vet = await prisma.vet.findUnique({
        where: { userId: req.user.id }
      });
      vetId = vet?.id || null;
    }
    
    const isAppointmentVet = vetId === appointment.vetId;

    if (!isOwner && !isAppointmentVet) {
      throw new ApiError(403, 'Not authorized to reschedule this appointment');
    }

    // Check if appointment can be rescheduled
    if (!canBeRescheduled(appointment as AppointmentWithDetails)) {
      throw new ApiError(400, 'Appointment cannot be rescheduled at this time');
    }

    const newScheduledTime = new Date(newTime);
    const now = new Date();

    if (newScheduledTime < now) {
      throw new ApiError(400, 'Cannot reschedule to a past time');
    }

    // Check vet working hours for new time
    const vet = await prisma.vet.findUnique({
      where: { id: appointment.vetId },
      select: { workingHours: true }
    });

    if (vet?.workingHours) {
      const workingHours = getVetWorkingHours(vet);
      const dayOfWeek = newScheduledTime.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      const daySchedule = workingHours[dayOfWeek as keyof WorkingHours];
      
      if (daySchedule && daySchedule.isAvailable) {
        const appointmentHour = newScheduledTime.getHours();
        const appointmentMinute = newScheduledTime.getMinutes();
        const [startHour, startMinute] = daySchedule.start.split(':').map(Number);
        const [endHour, endMinute] = daySchedule.end.split(':').map(Number);
        
        const appointmentTime = appointmentHour * 60 + appointmentMinute;
        const startTime = startHour * 60 + startMinute;
        const endTime = endHour * 60 + endMinute;
        
        if (appointmentTime < startTime || appointmentTime >= endTime) {
          throw new ApiError(400, 'New appointment time is outside veterinarian working hours');
        }
      } else if (!daySchedule?.isAvailable) {
        throw new ApiError(400, 'Veterinarian is not available on this day');
      }
    }

    // Check if new time slot is available
    const existingAppointment = await prisma.appointment.findFirst({
      where: {
        vetId: appointment.vetId,
        scheduledAt: newScheduledTime,
        status: { in: ['PENDING', 'CONFIRMED'] },
        id: { not: id }
      }
    });

    if (existingAppointment) {
      throw new ApiError(400, 'This time slot is already booked');
    }

    // Update appointment
    const updatedAppointment = await prisma.appointment.update({
      where: { id },
      data: {
        scheduledAt: newScheduledTime,
        updatedAt: new Date()
      }
    });

    // Send notifications
    const notificationTitle = 'Appointment Rescheduled';
    const notificationBody = `Your appointment has been rescheduled to ${newScheduledTime.toLocaleString()}`;
    
    // FIXED: Access vet user ID from vetProfile
    const vetUserId = appointment.vetProfile?.userId || appointment.ownerId;
    
    await NotificationService.sendPushNotification(
      appointment.ownerId,
      notificationTitle,
      notificationBody,
      { appointmentId: id, type: 'appointment_rescheduled' }
    );

    await NotificationService.sendPushNotification(
      vetUserId,
      notificationTitle,
      notificationBody,
      { appointmentId: id, type: 'appointment_rescheduled' }
    );

    // Add system message to chat
    await prisma.chatMessage.create({
      data: {
        appointmentId: id,
        senderId: req.user.id,
        receiverId: isOwner ? vetUserId : appointment.ownerId,
        message: `Appointment has been rescheduled to ${newScheduledTime.toLocaleString()}`
      }
    });

    res.status(200).json(
      new ApiResponse(200, 'Appointment rescheduled successfully', { appointment: updatedAppointment })
    );
  } catch (error: any) {
    logger.error('Error rescheduling appointment:', error);
    next(error);
  }
};