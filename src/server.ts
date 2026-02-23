import 'express-async-errors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import app from './app';
import { connectDB } from './config/database';
import { setupSocket } from './config/socket';
import logger from './utils/logger';
import { env } from './config/env'; 

// Load environment variables
dotenv.config();

const PORT = env.PORT; // Use from env.ts
const HOST = env.HOST; // Use from env.ts

// Create HTTP server
const httpServer = createServer(app);

// Initialize Socket.io
const io = new Server(httpServer, {
  cors: {
    origin: [
      env.CLIENT_URL,
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ],
    credentials: true,
    methods: ['GET', 'POST']
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'] // Add this for better compatibility
});

// Setup socket events
setupSocket(io);

// Connect to database
connectDB();

// Start server
httpServer.listen(PORT, HOST, () => {
  logger.info(`🚀 Server running in ${env.NODE_ENV} mode`);
  logger.info(`📡 Listening on http://${HOST}:${PORT}`);
  logger.info(`🔗 Client URL: ${env.CLIENT_URL}`);
  logger.info(`🔗 Admin URL: ${env.ADMIN_URL}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err: Error) => {
  logger.error(`❌ Unhandled Rejection: ${err.message}`);
  logger.error(err.stack);
  // Close server & exit process
  httpServer.close(() => process.exit(1));
});

// Handle uncaught exceptions
process.on('uncaughtException', (err: Error) => {
  logger.error(`💥 Uncaught Exception: ${err.message}`);
  logger.error(err.stack);
  process.exit(1);
});

// Graceful shutdown
const gracefulShutdown = () => {
  logger.info('🛑 Received shutdown signal, closing server gracefully...');
  httpServer.close(() => {
    logger.info('✅ Server closed');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('❌ Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

export { httpServer, io };