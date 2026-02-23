// Additional auth controller functions to add to authController.ts

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { ApiError, ApiResponse } from '../utils/response';
import { sendVerificationEmail, sendPasswordResetEmail } from '../services/emailService';

const prisma = new PrismaClient();

// Generate JWT Token
const generateToken = (id: string, userType: string): string => {
  return jwt.sign({ id, userType }, process.env.JWT_SECRET || 'secret', {
    expiresIn: '7d'
  });
};

// Generate Refresh Token
const generateRefreshToken = (id: string): string => {
  return jwt.sign({ id }, process.env.REFRESH_TOKEN_SECRET || 'refresh-secret', {
    expiresIn: '30d'
  });
};

// @desc    Register as owner
// @route   POST /api/auth/register/owner
// @access  Public
export const registerOwner = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, phone, password, firstName, lastName } = req.body;

    // Check if user exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { phone }]
      }
    });

    if (existingUser) {
      throw new ApiError(400, 'User with this email or phone already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user as OWNER
    const user = await prisma.user.create({
      data: {
        email,
        phone,
        password: hashedPassword,
        firstName,
        lastName,
        userType: 'OWNER'
      },
      select: {
        id: true,
        email: true,
        phone: true,
        userType: true,
        firstName: true,
        lastName: true,
        isVerified: true,
        avatar: true,
        createdAt: true,
        updatedAt: true
      }
    });

    // Generate tokens
    const token = generateToken(user.id, user.userType);
    const refreshToken = generateRefreshToken(user.id);

    // Send verification email
    await sendVerificationEmail(user.email, user.firstName);

    // Set cookies
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    res.status(201).json(
      new ApiResponse(201, 'Owner registration successful', {
        user,
        token,
        refreshToken
      })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Register as veterinarian
// @route   POST /api/auth/register/vet
// @access  Public
export const registerVet = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      email,
      phone,
      password,
      firstName,
      lastName,
      licenseNumber,
      specialties,
      experienceYears = 0,
      consultationFee = 0,
      avatar
    } = req.body;

    // Check if user exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { phone }]
      }
    });

    if (existingUser) {
      throw new ApiError(400, 'User with this email or phone already exists');
    }

    // Check if license number exists
    const existingLicense = await prisma.vet.findUnique({
      where: { licenseNumber }
    });

    if (existingLicense) {
      throw new ApiError(400, 'License number already registered');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user as VET
    const user = await prisma.user.create({
      data: {
        email,
        phone,
        password: hashedPassword,
        firstName,
        lastName,
        userType: 'VET',
        avatar
      },
      select: {
        id: true,
        email: true,
        phone: true,
        userType: true,
        firstName: true,
        lastName: true,
        avatar: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true
      }
    });

    // Create vet profile
    const vet = await prisma.vet.create({
      data: {
        userId: user.id,
        licenseNumber,
        licenseDocument: '', // Will be updated with file upload
        specialties: Array.isArray(specialties) ? specialties : [specialties],
        experienceYears: parseInt(experienceYears.toString()),
        consultationFee: parseFloat(consultationFee.toString()),
        isApproved: false // Require admin approval
      },
      select: {
        id: true,
        userId: true,
        licenseNumber: true,
        specialties: true,
        experienceYears: true,
        consultationFee: true,
        isApproved: true,
        createdAt: true
      }
    });

    // Generate tokens
    const token = generateToken(user.id, user.userType);
    const refreshToken = generateRefreshToken(user.id);

    // Send verification email
    await sendVerificationEmail(user.email, user.firstName);

    // Set cookies
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

    res.status(201).json(
      new ApiResponse(201, 'Vet registration successful. Awaiting admin approval.', {
        user,
        vet,
        token,
        refreshToken
      })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Update vet profile
// @route   PUT /api/auth/vet/profile
// @access  Private (Vet only)
export const updateVetProfile = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only vets can update vet profile');
    }

    const {
      specialties,
      experienceYears,
      consultationFee
    } = req.body;

    // Get vet profile
    const vetProfile = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vetProfile) {
      throw new ApiError(404, 'Vet profile not found');
    }

    // Update vet profile
    const updatedVet = await prisma.vet.update({
      where: { id: vetProfile.id },
      data: {
        specialties: specialties ? (Array.isArray(specialties) ? specialties : [specialties]) : undefined,
        experienceYears: experienceYears ? parseInt(experienceYears.toString()) : undefined,
        consultationFee: consultationFee ? parseFloat(consultationFee.toString()) : undefined
      },
      select: {
        id: true,
        userId: true,
        licenseNumber: true,
        specialties: true,
        experienceYears: true,
        consultationFee: true,
        rating: true,
        totalReviews: true,
        isApproved: true,
        createdAt: true,
        updatedAt: true
      }
    });



    res.status(200).json(
      new ApiResponse(200, 'Vet profile updated', { vet: updatedVet })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Verify vet license
// @route   POST /api/auth/vet/verify
// @access  Private (Vet only)
export const verifyVetLicense = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user.userType !== 'VET') {
      throw new ApiError(403, 'Only vets can verify license');
    }

    const { licenseFileUrl, licenseNumber } = req.body;

    if (!licenseFileUrl) {
      throw new ApiError(400, 'License file URL is required');
    }

    // Get vet profile
    const vetProfile = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vetProfile) {
      throw new ApiError(404, 'Vet profile not found');
    }

    // Update license document
    const updatedVet = await prisma.vet.update({
      where: { id: vetProfile.id },
      data: {
        licenseDocument: licenseFileUrl,
        licenseNumber: licenseNumber || vetProfile.licenseNumber,
        licenseVerified: true
      }
    });

    res.status(200).json(
      new ApiResponse(200, 'License verified successfully', {
        vet: updatedVet
      })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @access  Public
export const forgotPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new ApiError(400, 'Email is required');
    }

    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      // Don't reveal if user exists
      res.status(200).json(
        new ApiResponse(200, 'If email exists, password reset link has been sent')
      );
      return;
    }

    // Generate reset token (valid for 1 hour)
    const resetToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'secret', {
      expiresIn: '1h'
    });

    // Send email with reset link
    await sendPasswordResetEmail(user.email, resetToken);

    res.status(200).json(
      new ApiResponse(200, 'Password reset link has been sent to your email')
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Reset password
// @route   POST /api/auth/reset-password
// @access  Public
export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      throw new ApiError(400, 'Token and new password are required');
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as {
      id: string;
    };

    const user = await prisma.user.findUnique({
      where: { id: decoded.id }
    });

    if (!user) {
      throw new ApiError(404, 'User not found');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword }
    });

    res.status(200).json(
      new ApiResponse(200, 'Password reset successfully')
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Change password
// @route   POST /api/auth/change-password
// @access  Private
export const changePassword = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      throw new ApiError(400, 'Current password and new password are required');
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    if (!user) {
      throw new ApiError(404, 'User not found');
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new ApiError(400, 'Current password is incorrect');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    await prisma.user.update({
      where: { id: req.user.id },
      data: { password: hashedPassword }
    });

    res.status(200).json(
      new ApiResponse(200, 'Password changed successfully')
    );
  } catch (error: any) {
    next(error);
  }
};
