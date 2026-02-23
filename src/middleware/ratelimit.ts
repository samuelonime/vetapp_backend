import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import logger from '../utils/logger';
import { ApiError } from '../utils/response';

// Store blocked IPs with timestamp
const blockedIPs = new Map<string, number>();

// Custom rate limit handler
const rateLimitHandler = (req: Request, _res: Response) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  
  // Log suspicious activity
  logger.warn(`Rate limit exceeded for IP: ${ip}, Path: ${req.path}`);
  
  // Track blocked IPs
  if (!blockedIPs.has(ip)) {
    blockedIPs.set(ip, Date.now());
  }
  
  throw new ApiError(429, 'Too many requests. Please try again later.');
};

// Custom key generator to group by IP and user ID
const keyGenerator = (req: Request): string => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const userId = req.user?.id || 'anonymous';
  return `${ip}-${userId}-${req.path}`;
};

// Global rate limiter (stricter for public endpoints)
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  handler: rateLimitHandler,
  keyGenerator,
  skip: (req: Request) => {
    // Skip rate limiting for health checks and static files
    if (req.path === '/health' || req.path.startsWith('/uploads/')) {
      return true;
    }
    return false;
  }
});

// Stricter limiter for auth endpoints
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 minutes
  message: 'Too many login attempts. Please try again later.',
  handler: rateLimitHandler,
  keyGenerator,
  skipSuccessfulRequests: true // Don't count successful attempts
});

// Payment endpoint limiter
export const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 payment attempts per hour
  message: 'Too many payment attempts. Please contact support.',
  handler: rateLimitHandler,
  keyGenerator
});

// API endpoint limiter (for specific routes)
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  message: 'Too many API requests. Please slow down.',
  handler: rateLimitHandler,
  keyGenerator
});

// Webhook limiter (more generous)
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // 120 requests per minute
  message: 'Too many webhook requests.',
  handler: rateLimitHandler,
  keyGenerator
});

// Function to check if IP is blocked
export const isIPBlocked = (ip: string): boolean => {
  const blockTime = blockedIPs.get(ip);
  if (!blockTime) return false;
  
  // Block for 1 hour
  const blockDuration = 60 * 60 * 1000; // 1 hour in milliseconds
  if (Date.now() - blockTime < blockDuration) {
    return true;
  }
  
  // Remove from blocked list after block duration
  blockedIPs.delete(ip);
  return false;
};

// Middleware to check blocked IPs
export const checkBlockedIP = (req: Request, _res: Response, next: Function) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  
  if (isIPBlocked(ip)) {
    logger.warn(`Blocked IP attempted access: ${ip}`);
    throw new ApiError(403, 'Your IP has been temporarily blocked due to excessive requests.');
  }
  
  next();
};

// Clean up old blocked IPs periodically
export const cleanupBlockedIPs = () => {
  const now = Date.now();
  const hourAgo = now - (60 * 60 * 1000);
  
  for (const [ip, blockTime] of blockedIPs.entries()) {
    if (blockTime < hourAgo) {
      blockedIPs.delete(ip);
    }
  }
};

// Run cleanup every hour
setInterval(cleanupBlockedIPs, 60 * 60 * 1000);