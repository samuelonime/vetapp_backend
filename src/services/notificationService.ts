import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';
import logger from '../utils/logger';

const prisma = new PrismaClient();



// Initialize Firebase Admin conditionally
let admin: any;
let firebaseInitialized = false;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const firebaseAdmin = require('firebase-admin');
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    firebaseAdmin.initializeApp({
      credential: firebaseAdmin.credential.cert(serviceAccount)
    });
    admin = firebaseAdmin;
    firebaseInitialized = true;
    logger.info('Firebase Admin initialized for FCM');
  }
} catch (error) {
  logger.warn('Firebase Admin initialization failed, push notifications disabled:', error);
}

// Email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

export class NotificationService {
  // Send push notification
  static async sendPushNotification(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<void> {
    try {
      if (!firebaseInitialized) {
        logger.warn('Firebase not initialized, skipping push notification');
        return;
      }

      // Get user's FCM token
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { fcmToken: true }
      });

      if (!user?.fcmToken) {
        logger.warn(`No FCM token found for user ${userId}`);
        return;
      }

      const message = {
        token: user.fcmToken,
        notification: {
          title,
          body
        },
        data: data || {},
        android: {
          priority: 'high'
        },
        apns: {
          payload: {
            aps: {
              contentAvailable: true,
              badge: 1
            }
          }
        }
      };

      await admin.messaging().send(message);
      logger.info(`Push notification sent to user ${userId}: ${title}`);
    } catch (error: any) {
      logger.error('Error sending push notification:', error);
      
      // If token is invalid, remove it
      if (error.code === 'messaging/invalid-registration-token' || 
          error.code === 'messaging/registration-token-not-registered') {
        await prisma.user.update({
          where: { id: userId },
          data: { fcmToken: null }
        });
        logger.info(`Removed invalid FCM token for user ${userId}`);
      }
    }
  }

  // Send email notification
  static async sendEmail(
    to: string,
    subject: string,
    html: string,
    text?: string
  ): Promise<void> {
    try {
      await transporter.sendMail({
        from: `"VetConnect" <${process.env.EMAIL_FROM}>`,
        to,
        subject,
        text: text || subject,
        html
      });
      logger.info(`Email sent to ${to}: ${subject}`);
    } catch (error) {
      logger.error('Error sending email:', error);
      throw error;
    }
  }

  // Send SMS notification (using Twilio)
  static async sendSMS(
    to: string,
    body: string
  ): Promise<void> {
    try {
      // For MVP, log SMS instead of actually sending
      logger.info(`SMS would be sent to ${to}: ${body}`);
      
      // Uncomment to enable actual SMS sending with Twilio
      /*
      const twilio = require('twilio');
      const client = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );
      
      await client.messages.create({
        body,
        from: process.env.TWILIO_PHONE_NUMBER,
        to
      });
      */
    } catch (error) {
      logger.error('Error sending SMS:', error);
    }
  }

  // Save notification to database
  static async saveNotification(
    userId: string,
    title: string,
    message: string,
    type: string,
    data?: any
  ): Promise<void> {
    try {
      await prisma.notification.create({
        data: {
          userId,
          title,
          message,
          type,
          data,
          isRead: false
        }
      });
    } catch (error) {
      logger.error('Error saving notification:', error);
    }
  }

  // Send appointment notification
  static async sendAppointmentNotification(
    appointmentId: string,
    type: 'created' | 'confirmed' | 'cancelled' | 'reminder' | 'completed'
  ): Promise<void> {
    try {
      const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          owner: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true
            }
          },
          vetProfile: { // FIXED: Use vetProfile instead of vet
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
          }
        }
      });

      if (!appointment) return;

      // FIXED: Use proper property access
      const owner = appointment.owner;
      const vetUser = appointment.vetProfile?.user;

      if (!owner || !vetUser) {
        logger.error('Missing owner or vet user for appointment notification');
        return;
      }

      let ownerTitle = '';
      let ownerBody = '';
      let vetTitle = '';
      let vetBody = '';
      let data = { appointmentId, type };

      switch (type) {
        case 'created':
          ownerTitle = 'Appointment Requested';
          ownerBody = `Your appointment request with Dr. ${vetUser.lastName} has been submitted.`;
          vetTitle = 'New Appointment Request';
          vetBody = `You have a new appointment request from ${owner.firstName} ${owner.lastName}.`;
          break;
        case 'confirmed':
          ownerTitle = 'Appointment Confirmed';
          ownerBody = `Your appointment with Dr. ${vetUser.lastName} has been confirmed.`;
          vetTitle = 'Appointment Confirmed';
          vetBody = `Appointment with ${owner.firstName} ${owner.lastName} has been confirmed.`;
          break;
        case 'cancelled':
          ownerTitle = 'Appointment Cancelled';
          ownerBody = `Your appointment with Dr. ${vetUser.lastName} has been cancelled.`;
          vetTitle = 'Appointment Cancelled';
          vetBody = `Appointment with ${owner.firstName} ${owner.lastName} has been cancelled.`;
          break;
        case 'reminder':
          ownerTitle = 'Appointment Reminder';
          ownerBody = `Reminder: You have an appointment with Dr. ${vetUser.lastName} soon.`;
          vetTitle = 'Appointment Reminder';
          vetBody = `Reminder: You have an appointment with ${owner.firstName} ${owner.lastName}.`;
          break;
        case 'completed':
          ownerTitle = 'Appointment Completed';
          ownerBody = `Your appointment with Dr. ${vetUser.lastName} has been completed. Please leave a review.`;
          vetTitle = 'Appointment Completed';
          vetBody = `Your appointment with ${owner.firstName} ${owner.lastName} has been completed.`;
          break;
      }

      // Send to owner
      await this.sendPushNotification(owner.id, ownerTitle, ownerBody, data);
      await this.saveNotification(owner.id, ownerTitle, ownerBody, 'appointment', data);

      // Send to vet
      await this.sendPushNotification(vetUser.id, vetTitle, vetBody, data);
      await this.saveNotification(vetUser.id, vetTitle, vetBody, 'appointment', data);

      // Send emails
      await this.sendEmail(
        owner.email,
        ownerTitle,
        `<h2>${ownerTitle}</h2><p>${ownerBody}</p>`
      );

      await this.sendEmail(
        vetUser.email,
        vetTitle,
        `<h2>${vetTitle}</h2><p>${vetBody}</p>`
      );

    } catch (error) {
      logger.error('Error sending appointment notification:', error);
    }
  }

  // Send payment notification
  static async sendPaymentNotification(
    userId: string,
    vetId: string,
    amount: number
  ): Promise<void> {
    try {
      const user = await prisma.user.findUnique({ 
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true
        }
      });
      
      const vet = await prisma.vet.findUnique({
        where: { id: vetId },
        include: { 
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true
            }
          } 
        }
      });

      if (!user || !vet) return;

      const userTitle = 'Payment Successful';
      const userBody = `Your payment of ₦${amount.toLocaleString()} has been processed successfully.`;
      
      const vetTitle = 'Payment Received';
      const vetBody = `You have received ₦${amount.toLocaleString()} from a consultation.`;

      const data = { amount: amount.toString(), type: 'payment' };

      // Send to user
      await this.sendPushNotification(user.id, userTitle, userBody, data);
      await this.saveNotification(user.id, userTitle, userBody, 'payment', data);

      // Send to vet
      await this.sendPushNotification(vet.userId, vetTitle, vetBody, data);
      await this.saveNotification(vet.userId, vetTitle, vetBody, 'payment', data);

      // Send emails
      await this.sendEmail(
        user.email,
        userTitle,
        `<h2>${userTitle}</h2><p>${userBody}</p>`
      );

      await this.sendEmail(
        vet.user.email,
        vetTitle,
        `<h2>${vetTitle}</h2><p>${vetBody}</p>`
      );

    } catch (error) {
      logger.error('Error sending payment notification:', error);
    }
  }

  // Send chat notification
  static async sendChatNotification(
    senderId: string,
    receiverId: string,
    appointmentId: string,
    message: string
  ): Promise<void> {
    try {
      const sender = await prisma.user.findUnique({ 
        where: { id: senderId },
        select: {
          id: true,
          firstName: true,
          lastName: true
        }
      });
      
      const receiver = await prisma.user.findUnique({ 
        where: { id: receiverId },
        select: {
          id: true,
          firstName: true,
          lastName: true
        }
      });
      
      const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: {
          id: true,
          vetId: true,
          ownerId: true
        }
      });

      if (!sender || !receiver || !appointment) return;

      const senderName = `${sender.firstName} ${sender.lastName}`;
      const title = 'New Message';
      const body = `${senderName}: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`;
      
      const data = {
        appointmentId,
        senderId,
        type: 'chat'
      };

      // Send push notification
      await this.sendPushNotification(receiverId, title, body, data);
      
      // Save to database
      await this.saveNotification(receiverId, title, body, 'chat', data);

    } catch (error) {
      logger.error('Error sending chat notification:', error);
    }
  }

  // Send vet approval notification
  static async sendVetApprovalNotification(
    vetUserId: string,
    approved: boolean,
    reason?: string
  ): Promise<void> {
    try {
      const vetUser = await prisma.user.findUnique({
        where: { id: vetUserId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          vetProfile: {
            select: {
              id: true
            }
          }
        }
      });

      if (!vetUser) return;

      const vetName = `${vetUser.firstName} ${vetUser.lastName}`;
      
      let title, body, emailSubject, emailBody;

      if (approved) {
        title = 'Account Approved!';
        body = `Congratulations ${vetName}! Your veterinarian account has been approved.`;
        emailSubject = 'Your VetConnect Account Has Been Approved';
        emailBody = `
          <h2>Welcome to VetConnect, Dr. ${vetUser.lastName}!</h2>
          <p>Your veterinarian account has been approved and is now active.</p>
          <p>You can now start accepting appointments and grow your practice.</p>
          <p><a href="${process.env.CLIENT_URL}/vet/dashboard">Go to your dashboard</a></p>
        `;
      } else {
        title = 'Account Not Approved';
        body = `Your veterinarian account application requires additional information.`;
        emailSubject = 'VetConnect Account Application Update';
        emailBody = `
          <h2>Account Application Update</h2>
          <p>Dear ${vetName},</p>
          <p>Your veterinarian account application requires additional verification.</p>
          ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
          <p>Please review your application and provide the required documents.</p>
          <p><a href="${process.env.CLIENT_URL}/vet/registration">Update your application</a></p>
        `;
      }

      // Send push notification
      await this.sendPushNotification(vetUserId, title, body, { type: 'vet_approval' });
      
      // Save to database
      await this.saveNotification(vetUserId, title, body, 'system', { approved, reason });
      
      // Send email
      await this.sendEmail(vetUser.email, emailSubject, emailBody);

    } catch (error) {
      logger.error('Error sending vet approval notification:', error);
    }
  }

  // Send subscription notification
  static async sendSubscriptionNotification(
    vetUserId: string,
    type: 'active' | 'expiring' | 'expired' | 'cancelled',
    subscriptionTier: string,
    daysRemaining?: number
  ): Promise<void> {
    try {
      const vetUser = await prisma.user.findUnique({
        where: { id: vetUserId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true
        }
      });

      if (!vetUser) return;

      let title, body, emailSubject, emailBody;

      switch (type) {
        case 'active':
          title = 'Subscription Activated';
          body = `Your ${subscriptionTier} subscription is now active.`;
          emailSubject = `Your ${subscriptionTier} Subscription is Active`;
          emailBody = `
            <h2>Subscription Activated</h2>
            <p>Your ${subscriptionTier} subscription is now active.</p>
            <p>You now have access to all ${subscriptionTier} tier features.</p>
          `;
          break;
        case 'expiring':
          title = 'Subscription Expiring Soon';
          body = `Your ${subscriptionTier} subscription expires in ${daysRemaining} days.`;
          emailSubject = `Your ${subscriptionTier} Subscription Expires Soon`;
          emailBody = `
            <h2>Subscription Expiring Soon</h2>
            <p>Your ${subscriptionTier} subscription will expire in ${daysRemaining} days.</p>
            <p><a href="${process.env.CLIENT_URL}/subscriptions">Renew your subscription</a></p>
          `;
          break;
        case 'expired':
          title = 'Subscription Expired';
          body = `Your ${subscriptionTier} subscription has expired.`;
          emailSubject = `Your ${subscriptionTier} Subscription Has Expired`;
          emailBody = `
            <h2>Subscription Expired</h2>
            <p>Your ${subscriptionTier} subscription has expired.</p>
            <p>You have been downgraded to the FREE tier.</p>
            <p><a href="${process.env.CLIENT_URL}/subscriptions">Upgrade your subscription</a></p>
          `;
          break;
        case 'cancelled':
          title = 'Subscription Cancelled';
          body = `Your ${subscriptionTier} subscription has been cancelled.`;
          emailSubject = `Your ${subscriptionTier} Subscription Has Been Cancelled`;
          emailBody = `
            <h2>Subscription Cancelled</h2>
            <p>Your ${subscriptionTier} subscription has been cancelled.</p>
            <p>You will have access to ${subscriptionTier} features until the end of your billing period.</p>
          `;
          break;
      }

      // Send push notification
      await this.sendPushNotification(vetUserId, title, body, { type: 'subscription', tier: subscriptionTier });
      
      // Save to database
      await this.saveNotification(vetUserId, title, body, 'subscription', { type, tier: subscriptionTier, daysRemaining });
      
      // Send email
      await this.sendEmail(vetUser.email, emailSubject, emailBody);

    } catch (error) {
      logger.error('Error sending subscription notification:', error);
    }
  }

  // Get user notifications
  static async getUserNotifications(
    userId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{ notifications: any[]; total: number; unread: number }> {
    try {
      const skip = (page - 1) * limit;

      const [notifications, total, unread] = await Promise.all([
        prisma.notification.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit
        }),
        prisma.notification.count({ where: { userId } }),
        prisma.notification.count({ where: { userId, isRead: false } })
      ]);

      return { notifications, total, unread };
    } catch (error) {
      logger.error('Error getting user notifications:', error);
      return { notifications: [], total: 0, unread: 0 };
    }
  }

  // Mark notifications as read
  static async markNotificationsAsRead(
    userId: string,
    notificationIds?: string[]
  ): Promise<void> {
    try {
      const where: any = { userId, isRead: false };
      if (notificationIds && notificationIds.length > 0) {
        where.id = { in: notificationIds };
      }

      await prisma.notification.updateMany({
        where,
        data: { isRead: true }
      });
    } catch (error) {
      logger.error('Error marking notifications as read:', error);
    }
  }

  // Clear all notifications
  static async clearAllNotifications(userId: string): Promise<void> {
    try {
      await prisma.notification.deleteMany({
        where: { userId, isRead: true }
      });
    } catch (error) {
      logger.error('Error clearing notifications:', error);
    }
  }
}