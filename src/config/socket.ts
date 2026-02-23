import { Server, Socket } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

const prisma = new PrismaClient();

interface SocketUser {
  socketId: string;
  userId: string;
  userType: string;
  online: boolean;
}

// Store users globally
const users: Map<string, SocketUser> = new Map();

// We need to store the io instance for helper functions
let ioInstance: Server | null = null;

export const setupSocket = (io: Server): void => {
  ioInstance = io; // Store for use in helper functions
  
  io.on('connection', (socket: Socket) => {
    logger.info(`New socket connection: ${socket.id}`);

    // User authentication
    socket.on('authenticate', async (_data: { token: string }) => {
      try {
        // Verify token and get user
        // For MVP, using simple userId from query
        const userId = socket.handshake.query.userId as string;
        const userType = socket.handshake.query.userType as string;

        if (!userId) {
          socket.disconnect();
          return;
        }

        // Store user connection
        users.set(userId, {
          socketId: socket.id,
          userId,
          userType,
          online: true
        });

        // Update vet online status
        if (userType === 'VET') {
          await prisma.vet.update({
            where: { userId },
            data: {
              onlineStatus: true,
              lastSeen: new Date()
            }
          });

          // Notify all connected users about vet's online status
          io.emit('vet-online', { vetId: userId, online: true });
        }

        // Join user to their room
        socket.join(`user_${userId}`);

        logger.info(`User authenticated via socket: ${userId}`);
      } catch (error) {
        logger.error('Socket authentication error:', error);
        socket.disconnect();
      }
    });

    // Join chat room
    socket.on('join-chat', (appointmentId: string) => {
      socket.join(`chat_${appointmentId}`);
      logger.info(`Socket ${socket.id} joined chat: ${appointmentId}`);
    });

    // Leave chat room
    socket.on('leave-chat', (appointmentId: string) => {
      socket.leave(`chat_${appointmentId}`);
      logger.info(`Socket ${socket.id} left chat: ${appointmentId}`);
    });

    // Send message
    socket.on('send-message', async (data: {
      appointmentId: string;
      message: string;
      senderId: string;
      receiverId: string;
      mediaUrl?: string;
      mediaType?: string;
    }) => {
      try {
        // Save message to database
        const chatMessage = await prisma.chatMessage.create({
          data: {
            appointmentId: data.appointmentId,
            senderId: data.senderId,
            receiverId: data.receiverId,
            message: data.message,
            mediaUrl: data.mediaUrl,
            mediaType: data.mediaType,
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
            }
          }
        });

        // Update appointment last activity
        await prisma.appointment.update({
          where: { id: data.appointmentId },
          data: { updatedAt: new Date() }
        });

        // Emit to chat room
        io.to(`chat_${data.appointmentId}`).emit('new-message', {
          message: chatMessage,
          appointmentId: data.appointmentId
        });

        // Emit to receiver's personal room for notifications
        io.to(`user_${data.receiverId}`).emit('message-received', {
          message: chatMessage,
          appointmentId: data.appointmentId
        });

        logger.info(`Message sent via socket: ${data.appointmentId}`);
      } catch (error) {
        logger.error('Socket send message error:', error);
        socket.emit('message-error', { error: 'Failed to send message' });
      }
    });

    // Typing indicator
    socket.on('typing', (data: { appointmentId: string; userId: string; isTyping: boolean }) => {
      socket.to(`chat_${data.appointmentId}`).emit('user-typing', {
        userId: data.userId,
        isTyping: data.isTyping,
        appointmentId: data.appointmentId
      });
    });

    // Read receipt
    socket.on('mark-read', async (data: { messageIds: string[]; appointmentId: string; userId: string }) => {
      try {
        await prisma.chatMessage.updateMany({
          where: {
            id: { in: data.messageIds },
            receiverId: data.userId
          },
          data: { isRead: true }
        });

        socket.to(`chat_${data.appointmentId}`).emit('messages-read', {
          messageIds: data.messageIds,
          userId: data.userId
        });
      } catch (error) {
        logger.error('Socket mark read error:', error);
      }
    });

    // Appointment status updates
    socket.on('appointment-update', (data: {
      appointmentId: string;
      status: string;
      vetId?: string;
      ownerId?: string;
    }) => {
      if (data.vetId) {
        io.to(`user_${data.vetId}`).emit('appointment-changed', data);
      }
      if (data.ownerId) {
        io.to(`user_${data.ownerId}`).emit('appointment-changed', data);
      }
      io.to(`chat_${data.appointmentId}`).emit('appointment-updated', data);
    });

    // Call notifications (for video consultations)
    socket.on('call-request', (data: {
      appointmentId: string;
      callerId: string;
      receiverId: string;
      type: 'audio' | 'video';
    }) => {
      io.to(`user_${data.receiverId}`).emit('incoming-call', {
        appointmentId: data.appointmentId,
        callerId: data.callerId,
        type: data.type,
        timestamp: new Date()
      });
    });

    socket.on('call-accepted', (data: { appointmentId: string; userId: string }) => {
      io.to(`chat_${data.appointmentId}`).emit('call-accepted', {
        appointmentId: data.appointmentId,
        userId: data.userId
      });
    });

    socket.on('call-ended', (data: { appointmentId: string; userId: string }) => {
      io.to(`chat_${data.appointmentId}`).emit('call-ended', {
        appointmentId: data.appointmentId,
        userId: data.userId
      });
    });

    // Disconnection
    socket.on('disconnect', async () => {
      // Find user by socket ID
      let disconnectedUser: SocketUser | undefined;
      for (const [userId, user] of users.entries()) {
        if (user.socketId === socket.id) {
          disconnectedUser = user;
          users.delete(userId);
          break;
        }
      }

      if (disconnectedUser) {
        // Update vet online status
        if (disconnectedUser.userType === 'VET') {
          await prisma.vet.update({
            where: { userId: disconnectedUser.userId },
            data: {
              onlineStatus: false,
              lastSeen: new Date()
            }
          });

          // Notify about vet going offline
          io.emit('vet-offline', { vetId: disconnectedUser.userId, online: false });
        }

        logger.info(`User disconnected: ${disconnectedUser.userId}`);
      }
    });
  });

  // Heartbeat to check connection
  setInterval(() => {
    io.emit('heartbeat', { timestamp: Date.now() });
  }, 30000);
};

// Get online users
export const getOnlineUsers = (): SocketUser[] => {
  return Array.from(users.values()).filter(user => user.online);
};

// Get user socket
export const getUserSocket = (userId: string): Socket | undefined => {
  const user = users.get(userId);
  if (user && ioInstance) {
    return ioInstance.sockets.sockets.get(user.socketId);
  }
  return undefined;
};

// Broadcast to specific user
export const sendToUser = (userId: string, event: string, data: any): void => {
  const user = users.get(userId);
  if (user && ioInstance) {
    ioInstance.to(user.socketId).emit(event, data);
  }
};

// Initialize socket.io (alternative function if you need to create the server)
export const initializeSocket = (httpServer: any): Server => {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:3000',
      credentials: true
    }
  });
  
  setupSocket(io);
  return io;
};