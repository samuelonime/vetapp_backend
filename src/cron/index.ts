import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

const prisma = new PrismaClient();

// Initialize cron jobs
export const initCronJobs = (): void => {
  // Update vet subscription status daily at midnight
  cron.schedule('0 0 * * *', async () => {
    try {
      logger.info('Running subscription status update...');
      
      const expiredSubscriptions = await prisma.vet.findMany({
        where: {
          subscriptionTier: { not: 'FREE' },
          subscriptionExpiresAt: { lt: new Date() }
        }
      });

      for (const vet of expiredSubscriptions) {
        await prisma.vet.update({
          where: { id: vet.id },
          data: {
            subscriptionTier: 'FREE',
            subscriptionExpiresAt: null
          }
        });

        logger.info(`Downgraded vet ${vet.id} to FREE tier`);
      }
    } catch (error) {
      logger.error('Subscription cron job error:', error);
    }
  });

  // Update featured vet status daily
  cron.schedule('0 1 * * *', async () => {
    try {
      logger.info('Running featured vet status update...');
      
      const expiredFeatured = await prisma.vet.findMany({
        where: {
          isFeatured: true,
          featuredExpiresAt: { lt: new Date() }
        }
      });

      for (const vet of expiredFeatured) {
        await prisma.vet.update({
          where: { id: vet.id },
          data: {
            isFeatured: false,
            featuredExpiresAt: null
          }
        });

        logger.info(`Removed featured status from vet ${vet.id}`);
      }
    } catch (error) {
      logger.error('Featured vet cron job error:', error);
    }
  });

  // Process pending earnings (weekly on Monday at 2 AM)
  cron.schedule('0 2 * * 1', async () => {
    try {
      logger.info('Processing pending earnings...');
      
      // Move earnings from pending to available after 7 days
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const pendingEarnings = await prisma.vetEarning.findMany({
        where: {
          status: 'pending',
          createdAt: { lt: weekAgo }
        }
      });

      for (const earning of pendingEarnings) {
        await prisma.$transaction([
          prisma.vetEarning.update({
            where: { id: earning.id },
            data: { status: 'available' }
          }),
          prisma.vet.update({
            where: { id: earning.vetId },
            data: {
              pendingEarnings: { decrement: earning.amount },
              availableEarnings: { increment: earning.amount }
            }
          })
        ]);

        logger.info(`Moved earning ${earning.id} to available status`);
      }
    } catch (error) {
      logger.error('Earnings cron job error:', error);
    }
  });

  // Clean up old notifications (monthly)
  cron.schedule('0 3 1 * *', async () => {
    try {
      logger.info('Cleaning up old notifications...');
      
      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);

      await prisma.notification.deleteMany({
        where: {
          createdAt: { lt: monthAgo },
          isRead: true
        }
      });

      logger.info('Old notifications cleaned up');
    } catch (error) {
      logger.error('Notification cleanup error:', error);
    }
  });

  logger.info('✅ Cron jobs initialized');
};