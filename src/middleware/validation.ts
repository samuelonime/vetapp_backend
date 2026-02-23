import { body, query, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/response';

export const validate = (validations: any[]) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    await Promise.all(validations.map((validation) => validation.run(req)));

    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }

    const extractedErrors: string[] = [];
    errors.array().map((err) => extractedErrors.push(err.msg));

    throw new ApiError(400, extractedErrors[0]);
  };
};

// Auth validations
export const registerValidation = validate([
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('phone')
    .isMobilePhone('any')
    .withMessage('Valid phone number is required'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  body('userType')
    .isIn(['OWNER', 'VET'])
    .withMessage('User type must be OWNER or VET'),
]);

export const loginValidation = validate([
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
]);

// Vet registration validations
export const vetRegistrationValidation = validate([
  body('licenseNumber').notEmpty().withMessage('License number is required'),
  body('specialties')
    .isArray({ min: 1 })
    .withMessage('At least one specialty is required'),
  body('experienceYears')
    .isInt({ min: 0 })
    .withMessage('Experience years must be a positive number'),
  body('consultationFee')
    .isFloat({ min: 1000, max: 50000 })
    .withMessage('Consultation fee must be between ₦1000 and ₦50000'),
  body('bankDetails').optional().isObject(),
]);

// Appointment validations
export const appointmentValidation = validate([
  body('vetId').notEmpty().withMessage('Vet ID is required'),
  body('type')
    .isIn(['CHAT', 'VIDEO', 'IN_PERSON'])
    .withMessage('Invalid appointment type'),
  body('scheduledAt')
    .optional()
    .isISO8601()
    .withMessage('Valid date is required'),
  body('symptoms')
    .optional()
    .isArray()
    .withMessage('Symptoms must be an array'),
  body('notes').optional().isString(),
]);

// Payment validations
export const paymentValidation = validate([
  body('amount')
    .isFloat({ min: 500 })
    .withMessage('Amount must be at least ₦500'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('metadata').optional().isObject(),
]);

// Review validations
export const reviewValidation = validate([
  body('rating')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5'),
  body('comment').optional().isString(),
]);

// Pagination validations
export const paginationValidation = validate([
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('sort').optional().isString(),
  query('search').optional().isString(),
]);