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

// @desc    Register user
// @route   POST /api/v1/auth/register
// @access  Public
export const register = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, phone, password, firstName, lastName, userType } = req.body;

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

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        phone,
        password: hashedPassword,
        firstName,
        lastName,
        userType
      },
      select: {
        id: true,
        email: true,
        phone: true,
        userType: true,
        firstName: true,
        lastName: true,
        isVerified: true
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
      new ApiResponse(201, 'Registration successful', {
        user,
        token,
        refreshToken
      })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Login user
// @route   POST /api/v1/auth/login
// @access  Public
export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        password: true,
        userType: true,
        firstName: true,
        lastName: true,
        isVerified: true,
        vetProfile: {
          select: {
            isApproved: true
          }
        }
      }
    });

    if (!user) {
      throw new ApiError(401, 'Invalid credentials');
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new ApiError(401, 'Invalid credentials');
    }

    // Check if vet is approved
    if (user.userType === 'VET' && !user.vetProfile?.isApproved) {
      throw new ApiError(403, 'Your vet account is pending approval');
    }

    // Generate tokens
    const token = generateToken(user.id, user.userType);
    const refreshToken = generateRefreshToken(user.id);

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { updatedAt: new Date() }
    });

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

    // Remove password from response
    const { password: _, vetProfile, ...userData } = user;

    res.status(200).json(
      new ApiResponse(200, 'Login successful', {
        user: userData,
        token,
        refreshToken
      })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Logout user
// @route   POST /api/v1/auth/logout
// @access  Private
export const logout = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Clear cookies
    res.clearCookie('token');
    res.clearCookie('refreshToken');

    // Clear FCM token if exists
    if (req.user?.id) {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { fcmToken: null }
      });
    }

    res.status(200).json(new ApiResponse(200, 'Logout successful'));
  } catch (error: any) {
    next(error);
  }
};

// @desc    Get current user
// @route   GET /api/v1/auth/me
// @access  Private
export const getMe = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        phone: true,
        userType: true,
        firstName: true,
        lastName: true,
        avatar: true,
        location: true,
        isVerified: true,
        createdAt: true,
        vetProfile: req.user.userType === 'VET' ? {
          select: {
            id: true,
            licenseNumber: true,
            specialties: true,
            experienceYears: true,
            consultationFee: true,
            rating: true,
            totalReviews: true,
            subscriptionTier: true,
            subscriptionExpiresAt: true,
            isFeatured: true,
            isApproved: true,
            totalEarnings: true,
            availableEarnings: true,
            onlineStatus: true
          }
        } : false
      }
    });

    if (!user) {
      throw new ApiError(404, 'User not found');
    }

    res.status(200).json(new ApiResponse(200, 'User data', { user }));
  } catch (error: any) {
    next(error);
  }
};

// @desc    Update user profile
// @route   PUT /api/v1/auth/profile
// @access  Private
export const updateProfile = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { firstName, lastName, phone, avatar } = req.body;

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        firstName,
        lastName,
        phone,
        avatar,
        updatedAt: new Date()
      },
      select: {
        id: true,
        email: true,
        phone: true,
        userType: true,
        firstName: true,
        lastName: true,
        avatar: true,
        isVerified: true
      }
    });

    res.status(200).json(new ApiResponse(200, 'Profile updated', { user: updatedUser }));
  } catch (error: any) {
    next(error);
  }
};

// @desc    Refresh token
// @route   POST /api/v1/auth/refresh-token
// @access  Public
export const refreshToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { refreshToken } = req.cookies;

    if (!refreshToken) {
      throw new ApiError(401, 'Refresh token not provided');
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET!) as {
      id: string;
    };

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        userType: true
      }
    });

    if (!user) {
      throw new ApiError(401, 'User not found');
    }

    // Generate new tokens
    const newToken = generateToken(user.id, user.userType);
    const newRefreshToken = generateRefreshToken(user.id);

    // Set cookies
    res.cookie('token', newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

    res.status(200).json(
      new ApiResponse(200, 'Token refreshed', {
        token: newToken,
        refreshToken: newRefreshToken
      })
    );
  } catch (error: any) {
    next(error);
  }
};

// @desc    Verify email
// @route   GET /api/v1/auth/verify-email/:token
// @access  Public
export const verifyEmail = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { token } = req.params;

    // In production, use JWT token verification
    // For MVP, simple token verification
    const user = await prisma.user.findFirst({
      where: {
        email: token // Using email as token for simplicity
      }
    });

    if (!user) {
      throw new ApiError(400, 'Invalid verification token');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { isVerified: true }
    });

    res.status(200).json(new ApiResponse(200, 'Email verified successfully'));
  } catch (error: any) {
    next(error);
  }
};

// @desc    Update location
// @route   PUT /api/v1/auth/location
// @access  Private
export const updateLocation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      throw new ApiError(400, 'Latitude and longitude are required');
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        location: {
          type: 'Point',
          coordinates: [longitude, latitude]
        }
      },
      select: {
        id: true,
        location: true
      }
    });

    res.status(200).json(new ApiResponse(200, 'Location updated', { location: updatedUser.location }));
  } catch (error: any) {
    next(error);
  }
};

// @desc    Update FCM token
// @route   PUT /api/v1/auth/fcm-token
// @access  Private
export const updateFCMToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { fcmToken } = req.body;

    if (!fcmToken) {
      throw new ApiError(400, 'FCM token is required');
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: { fcmToken }
    });

    res.status(200).json(new ApiResponse(200, 'FCM token updated'));
  } catch (error: any) {
    next(error);
  }
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

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { phone }]
      }
    });

    if (existingUser) {
      throw new ApiError(400, 'User with this email or phone already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 12);

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

    const token = generateToken(user.id, user.userType);
    const refreshToken = generateRefreshToken(user.id);

    await sendVerificationEmail(user.email, user.firstName);

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
      consultationFee = 0
    } = req.body;

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { phone }]
      }
    });

    if (existingUser) {
      throw new ApiError(400, 'User with this email or phone already exists');
    }

    const existingLicense = await prisma.vet.findUnique({
      where: { licenseNumber }
    });

    if (existingLicense) {
      throw new ApiError(400, 'License number already registered');
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email,
        phone,
        password: hashedPassword,
        firstName,
        lastName,
        userType: 'VET'
      },
      select: {
        id: true,
        email: true,
        phone: true,
        userType: true,
        firstName: true,
        lastName: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true
      }
    });

    const vet = await prisma.vet.create({
      data: {
        userId: user.id,
        licenseNumber,
        licenseDocument: '',
        specialties: Array.isArray(specialties) ? specialties : [specialties],
        experienceYears: parseInt(experienceYears.toString()),
        consultationFee: parseFloat(consultationFee.toString()),
        isApproved: false
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

    const token = generateToken(user.id, user.userType);
    const refreshToken = generateRefreshToken(user.id);

    await sendVerificationEmail(user.email, user.firstName);

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

    const vetProfile = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vetProfile) {
      throw new ApiError(404, 'Vet profile not found');
    }

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

    const { licenseFileUrl } = req.body;

    if (!licenseFileUrl) {
      throw new ApiError(400, 'License file URL is required');
    }

    const vetProfile = await prisma.vet.findUnique({
      where: { userId: req.user.id }
    });

    if (!vetProfile) {
      throw new ApiError(404, 'Vet profile not found');
    }

    const updatedVet = await prisma.vet.update({
      where: { id: vetProfile.id },
      data: {
        licenseDocument: licenseFileUrl,
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
      res.status(200).json(
        new ApiResponse(200, 'If email exists, password reset link has been sent')
      );
      return;
    }

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

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as {
      id: string;
    };

    const user = await prisma.user.findUnique({
      where: { id: decoded.id }
    });

    if (!user) {
      throw new ApiError(404, 'User not found');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

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

    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new ApiError(400, 'Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

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