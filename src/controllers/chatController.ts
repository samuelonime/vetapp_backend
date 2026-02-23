import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { ApiError, ApiResponse } from '../utils/response';
import logger from '../utils/logger';
import { uploadToCloudinary } from '../middleware/upload';

const prisma = new PrismaClient();

// @desc    Get chat messages for appointment
// @route   GET /api/v1/chats/:appointmentId
// @access  Private
export const getChatMessages = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { appointmentId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    logger.info(`Getting chat messages for appointment ${appointmentId} by user ${req.user.id}`);

    // Verify user has access to this appointment
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        ownerId: true,
        vetId: true
      }
    });

    if (!appointment) {
      throw new ApiError(404, 'Appointment not found');
    }

    if (
      req.user.userType === 'OWNER' && appointment.ownerId !== req.user.id ||
      req.user.userType === 'VET' && appointment.vetId !== req.user.id
    ) {
      throw new ApiError(403, 'Not authorized to access this chat');
    }

    // Get messages
    const messages = await prisma.chatMessage.findMany({
      where: { appointmentId },
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
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take
    });

    // Mark messages as read
    const updateResult = await prisma.chatMessage.updateMany({
      where: {
        appointmentId,
        receiverId: req.user.id,
        isRead: false
      },
      data: { isRead: true }
    });

    if (updateResult.count > 0) {
      logger.info(`Marked ${updateResult.count} messages as read for user ${req.user.id}`);
    }

    const total = await prisma.chatMessage.count({ where: { appointmentId } });

    res.status(200).json(
      new ApiResponse(200, 'Chat messages retrieved', {
        messages: messages.reverse(), // Reverse to show oldest first
        pagination: {
          page: parseInt(page as string),
          limit: take,
          total,
          pages: Math.ceil(total / take),
          hasMore: total > skip + take
        }
      })
    );
  } catch (error: any) {
    logger.error('Error getting chat messages:', error);
    next(error);
  }
};

// @desc    Send chat message
// @route   POST /api/v1/chats/:appointmentId/send
// @access  Private
export const sendMessage = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { appointmentId } = req.params;
    const { message } = req.body;

    logger.info(`Sending message to appointment ${appointmentId} by user ${req.user.id}`);

    // Verify appointment exists and user has access
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
        vetProfile: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true
              }
            }
          }
        }
      }
    });

    if (!appointment) {
      throw new ApiError(404, 'Appointment not found');
    }

    // Determine sender and receiver
    let receiverId: string;
    let canSendMessage = false;

    if (req.user.userType === 'OWNER') {
      if (appointment.ownerId !== req.user.id) {
        throw new ApiError(403, 'Not authorized to send message');
      }
      // Get vet user ID from vetProfile
      if (!appointment.vetProfile?.user?.id) {
        throw new ApiError(400, 'Veterinarian not found for this appointment');
      }
      receiverId = appointment.vetProfile.user.id;
      canSendMessage = true;
    } else if (req.user.userType === 'VET') {
      // Check if vet owns this appointment
      const vet = await prisma.vet.findUnique({
        where: { userId: req.user.id }
      });
      
      if (!vet || appointment.vetId !== vet.id) {
        throw new ApiError(403, 'Not authorized to send message');
      }
      receiverId = appointment.ownerId;
      canSendMessage = true;
    } else {
      throw new ApiError(403, 'Invalid user type');
    }

    if (!canSendMessage) {
      throw new ApiError(403, 'Not authorized to send message');
    }

    // Check if appointment is active
    if (!['PENDING', 'CONFIRMED', 'COMPLETED'].includes(appointment.status)) {
      throw new ApiError(400, 'Cannot send message for this appointment');
    }

    // Handle file upload if present
    let mediaUrl: string | undefined;
    let mediaType: string | undefined;

    if (req.file) {
      try {
        const uploadResult = await uploadToCloudinary(req.file, 'chat');
        mediaUrl = uploadResult.url;
        mediaType = req.file.mimetype.split('/')[0]; // image, video, etc.
        logger.info(`File uploaded for chat message: ${mediaUrl}`);
      } catch (uploadError) {
        logger.error('Error uploading file:', uploadError);
        throw new ApiError(500, 'Failed to upload file');
      }
    }

    // Create message
    const chatMessage = await prisma.chatMessage.create({
      data: {
        appointmentId,
        senderId: req.user.id,
        receiverId,
        message: message || '',
        mediaUrl,
        mediaType,
        isRead: false
      },
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
    });

    // Update appointment last activity
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { updatedAt: new Date() }
    });

    logger.info(`Message sent successfully: ${chatMessage.id}`);

    res.status(201).json(
      new ApiResponse(201, 'Message sent', { message: chatMessage })
    );
  } catch (error: any) {
    logger.error('Error sending message:', error);
    next(error);
  }
};

// @desc    Get user conversations
// @route   GET /api/v1/chats/conversations
// @access  Private
export const getConversations = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user.id;
    const userType = req.user.userType;

    logger.info(`Getting conversations for user ${userId} (${userType})`);

    // Get all appointments for user
    let appointments: any[];

    if (userType === 'OWNER') {
      appointments = await prisma.appointment.findMany({
        where: { ownerId: userId },
        include: {
          vetProfile: { // FIXED: Use vetProfile for Vet model
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
          },
          chatMessages: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        },
        orderBy: { updatedAt: 'desc' }
      });
    } else if (userType === 'VET') {
      // First get the vet's profile
      const vet = await prisma.vet.findUnique({
        where: { userId: userId }
      });

      if (!vet) {
        throw new ApiError(404, 'Vet profile not found');
      }

      appointments = await prisma.appointment.findMany({
        where: { vetId: vet.id },
        include: {
          owner: {
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
          }
        },
        orderBy: { updatedAt: 'desc' }
      });
    } else {
      throw new ApiError(403, 'Invalid user type');
    }

    // Format conversations
    const conversations = appointments.map(appointment => {
      const lastMessage = appointment.chatMessages[0];
      const unreadCount = appointment.chatMessages.filter(
        (msg: any) => !msg.isRead && msg.receiverId === userId
      ).length;

      let otherUser: any;
      if (userType === 'OWNER') {
        otherUser = appointment.vetProfile?.user;
      } else {
        otherUser = appointment.owner;
      }

      return {
        appointmentId: appointment.id,
        otherUser,
        lastMessage: lastMessage ? {
          message: lastMessage.message,
          mediaUrl: lastMessage.mediaUrl,
          createdAt: lastMessage.createdAt,
          senderId: lastMessage.senderId
        } : null,
        unreadCount,
        appointmentStatus: appointment.status,
        updatedAt: appointment.updatedAt
      };
    }).filter(conv => conv.otherUser); // Filter out conversations without other user

    logger.info(`Found ${conversations.length} conversations for user ${userId}`);

    res.status(200).json(
      new ApiResponse(200, 'Conversations retrieved', { conversations })
    );
  } catch (error: any) {
    logger.error('Error getting conversations:', error);
    next(error);
  }
};

// @desc    Mark messages as read
// @route   PUT /api/v1/chats/mark-read
// @access  Private
export const markMessagesAsRead = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { appointmentId, messageIds } = req.body;

    logger.info(`Marking messages as read for appointment ${appointmentId} by user ${req.user.id}`);

    // Verify user has access to appointment
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        ownerId: true,
        vetId: true
      }
    });

    if (!appointment) {
      throw new ApiError(404, 'Appointment not found');
    }

    if (
      req.user.userType === 'OWNER' && appointment.ownerId !== req.user.id ||
      req.user.userType === 'VET' && appointment.vetId !== req.user.id
    ) {
      throw new ApiError(403, 'Not authorized');
    }

    // Mark messages as read
    const updateResult = await prisma.chatMessage.updateMany({
      where: {
        id: { in: messageIds },
        receiverId: req.user.id
      },
      data: { isRead: true }
    });

    logger.info(`Marked ${updateResult.count} messages as read for user ${req.user.id}`);

    res.status(200).json(new ApiResponse(200, 'Messages marked as read'));
  } catch (error: any) {
    logger.error('Error marking messages as read:', error);
    next(error);
  }
};

// @desc    Get unread message count
// @route   GET /api/v1/chats/unread-count
// @access  Private
export const getUnreadCount = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user.id;

    const unreadCount = await prisma.chatMessage.count({
      where: {
        receiverId: userId,
        isRead: false
      }
    });

    logger.info(`User ${userId} has ${unreadCount} unread messages`);

    res.status(200).json(
      new ApiResponse(200, 'Unread count retrieved', { unreadCount })
    );
  } catch (error: any) {
    logger.error('Error getting unread count:', error);
    next(error);
  }
};