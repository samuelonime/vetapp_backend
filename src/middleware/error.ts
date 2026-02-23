import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import { ApiError } from '../utils/response';

// Extend Express Request type globally
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
        role?: string;
      };
    }
  }
}

// Error handling middleware
const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  let error: any = { ...err };
  error.message = err.message;

  // Log error
  logger.error('Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
    user: (req as any).user?.id || 'anonymous'
  });

  // Mongoose/ObjectId error
  if (err.name === 'CastError') {
    error = new ApiError(404, 'Resource not found');
  }

  // Mongoose duplicate key
  if ((err as any).code === 11000) {
    const field = Object.keys((err as any).keyPattern)[0];
    error = new ApiError(400, `Duplicate field value: ${field}`);
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values((err as any).errors).map((val: any) => val.message);
    error = new ApiError(400, `Validation failed: ${messages.join(', ')}`);
  }

  // Prisma errors - check by name instead of instanceof
  if ((err as any).name === 'PrismaClientKnownRequestError') {
    const e = err as any;
    if (e.code === 'P2002') {
      error = new ApiError(409, `Duplicate field: ${e.meta?.target}`);
    } else if (e.code === 'P2025') {
      error = new ApiError(404, 'Record not found');
    } else if (e.code === 'P2003') {
      error = new ApiError(400, 'Foreign key constraint failed');
    } else {
      error = new ApiError(500, `Database error: ${e.code}`);
    }
  }

  if ((err as any).name === 'PrismaClientUnknownRequestError') {
    error = new ApiError(500, 'Unknown database error');
  }

  if ((err as any).name === 'PrismaClientValidationError') {
    error = new ApiError(400, 'Database validation error');
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = new ApiError(401, 'Invalid token. Please log in again.');
  }

  if (err.name === 'TokenExpiredError') {
    error = new ApiError(401, 'Token expired. Please log in again.');
  }

  // Multer errors
  if (err.name === 'MulterError') {
    if (err.message === 'File too large') {
      error = new ApiError(400, 'File size too large. Maximum size is 5MB.');
    } else if (err.message === 'Unexpected field') {
      error = new ApiError(400, 'Invalid file field name.');
    } else {
      error = new ApiError(400, `File upload error: ${err.message}`);
    }
  }

  // Paystack errors
  if (err.message && err.message.includes('Paystack')) {
    error = new ApiError(400, err.message.replace('Paystack', 'Payment'));
  }

  // Default to 500 server error
  const statusCode = (error as ApiError).statusCode || 500;
  const message = error.message || 'Server Error';

  const response: any = {
    success: false,
    message,
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  };

  if ((err as any).errors) {
    response.errors = (err as any).errors;
  }

  res.status(statusCode).json(response);

  if (statusCode >= 500) {
    logger.error('CRITICAL ERROR:', {
      statusCode,
      message,
      path: req.path,
      user: (req as any).user?.id,
      timestamp: new Date().toISOString()
    });
  }
};

// 404 handler
export const notFound = (req: Request, _res: Response, next: NextFunction) => {
  const error = new ApiError(404, `Cannot find ${req.originalUrl} on this server!`);
  next(error);
};

// Async handler wrapper
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export default errorHandler;