import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { ApiError } from '../utils/response';
import logger from '../utils/logger';

const prisma = new PrismaClient();

export interface AuthRequest extends Request {
  user?: any;
}

export const protect = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let token: string | undefined;

    // Get token from header
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    }

    if (!token) {
      throw new ApiError(401, 'Not authorized, no token provided');
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      id: string;
      userType: string;
    };

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        userType: true,
        firstName: true,
        lastName: true,
        isVerified: true,
        vetProfile: {
          select: {
            id: true,
            isApproved: true,
            subscriptionTier: true
          }
        }
      }
    });

    if (!user) {
      throw new ApiError(401, 'User not found');
    }

    // Check if vet is approved
    if (user.userType === 'VET' && !user.vetProfile?.isApproved) {
      throw new ApiError(403, 'Vet account pending approval');
    }

    req.user = user;
    next();
  } catch (error: any) {
    logger.error(`Auth middleware error: ${error.message}`);
    next(new ApiError(401, 'Not authorized, token failed'));
  }
};

export const restrictTo = (...roles: string[]) => {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new ApiError(401, 'Not authenticated'));
    }

    if (!roles.includes(req.user.userType)) {
      return next(
        new ApiError(403, 'You do not have permission to perform this action')
      );
    }

    next();
  };
};

export const vetOnly = restrictTo('VET');
export const ownerOnly = restrictTo('OWNER');
export const adminOnly = restrictTo('ADMIN');

export const checkSubscription = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user?.userType === 'VET') {
      const vet = await prisma.vet.findUnique({
        where: { userId: req.user.id },
        select: {
          subscriptionTier: true,
          subscriptionExpiresAt: true,
          isApproved: true
        }
      });

      if (!vet?.isApproved) {
        throw new ApiError(403, 'Vet account not approved');
      }

      // Check if subscription is active
      if (
        vet.subscriptionTier !== 'FREE' &&
        (!vet.subscriptionExpiresAt || new Date() > vet.subscriptionExpiresAt)
      ) {
        throw new ApiError(403, 'Subscription expired. Please renew.');
      }
    }
    next();
  } catch (error: any) {
    next(error);
  }
};