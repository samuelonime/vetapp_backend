import mongoose from 'mongoose';
import logger from '../utils/logger';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://PrimeAlpha:prime1@vetconnect.pifvrzk.mongodb.net/?appName=vetconnect';

const connectDB = async (): Promise<void> => {
  try {
    const conn = await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: parseInt(process.env.DATABASE_MAX_POOL || '10'),
      socketTimeoutMS: 45000,
    });

    logger.info(`✅ MongoDB Connected: ${conn.connection.host}`);
    logger.info(`📊 Database: ${conn.connection.name}`);

    // Connection events
    mongoose.connection.on('error', (err) => {
      logger.error(`❌ MongoDB connection error: ${err}`);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('⚠️ MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('🔁 MongoDB reconnected');
    });

  } catch (error: any) {
    logger.error(`❌ MongoDB connection failed: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
  }
};

const disconnectDB = async (): Promise<void> => {
  try {
    await mongoose.disconnect();
    logger.info('✅ MongoDB disconnected');
  } catch (error: any) {
    logger.error(`❌ Error disconnecting MongoDB: ${error.message}`);
  }
};

export { connectDB, disconnectDB };