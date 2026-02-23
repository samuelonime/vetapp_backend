import dotenv from 'dotenv';

dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'NODE_ENV',
  'MONGODB_URI',
  'JWT_SECRET',
  'CLIENT_URL'
] as const;

requiredEnvVars.forEach((envVar) => {
  if (!process.env[envVar]) {
    throw new Error(`❌ Environment variable ${envVar} is not defined`);
  }
});

// Export validated environment variables
export const env = {
  // Server
  NODE_ENV: process.env.NODE_ENV!,
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 5000,
  HOST: process.env.HOST || '0.0.0.0',
  API_VERSION: process.env.API_VERSION || 'v1',
  
  // Client URLs
  CLIENT_URL: process.env.CLIENT_URL!,
  ADMIN_URL: process.env.ADMIN_URL || process.env.CLIENT_URL!,
  
  // Database
  MONGODB_URI: process.env.MONGODB_URI!,
  
  // JWT
  JWT_SECRET: process.env.JWT_SECRET!,
  JWT_EXPIRE: process.env.JWT_EXPIRE || '7d',
  JWT_REFRESH_EXPIRE: process.env.JWT_REFRESH_EXPIRE || '30d',
  
  // Paystack
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY || '',
  PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY || '',
  
  // File Upload
  MAX_FILE_SIZE: process.env.MAX_FILE_SIZE ? parseInt(process.env.MAX_FILE_SIZE, 10) : 10,
  UPLOAD_PATH: process.env.UPLOAD_PATH || './uploads',
  
  // Email (optional)
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : undefined,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
} as const;

// Type for environment variables
export type EnvConfig = typeof env;

// Development mode helper
export const isDevelopment = env.NODE_ENV === 'development';
export const isProduction = env.NODE_ENV === 'production';