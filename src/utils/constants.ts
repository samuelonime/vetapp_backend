// Application constants
export const APP_CONSTANTS = {
  // Commission rates
  COMMISSION_RATES: {
    FREE: 0.25, // 25%
    PRO: 0.10,  // 10%
    ENTERPRISE: 0.08 // 8%
  },
  
  // Subscription prices (in Naira)
  SUBSCRIPTION_PRICES: {
    PRO: 5000, // ₦5,000 per month
    ENTERPRISE: 15000 // ₦15,000 per month
  },
  
  // Fees
  FEES: {
    VIDEO_CALL: 500, // ₦500 per video call
    MIN_CONSULTATION: 1000, // ₦1,000 minimum
    MAX_CONSULTATION: 50000 // ₦50,000 maximum
  },
  
  // Promotion prices
  PROMOTION_PRICES: {
    FEATURED: 3000, // ₦3,000 per month
    TOP_SEARCH: 2000, // ₦2,000 per month
    HOMEPAGE: 5000, // ₦5,000 per month
    CATEGORY_FEATURED: 1500 // ₦1,500 per month
  },
  
  // Limits
  LIMITS: {
    FREE_APPOINTMENTS: 20,
    PRO_APPOINTMENTS: 50,
    FREE_PROMOTIONS: 0,
    PRO_PROMOTIONS: 2,
    ENTERPRISE_PROMOTIONS: 5,
    FREE_VIDEO_MINUTES: 60,
    PRO_VIDEO_MINUTES: 300,
    CHAT_MESSAGE_LENGTH: 2000,
    REVIEW_COMMENT_LENGTH: 1000,
    VET_REPLY_LENGTH: 500
  },
  
  // Time intervals (in milliseconds)
  INTERVALS: {
    DAY: 24 * 60 * 60 * 1000,
    HOUR: 60 * 60 * 1000,
    MINUTE: 60 * 1000,
    SECOND: 1000
  },
  
  // Appointment statuses
  APPOINTMENT_STATUS: {
    PENDING: 'PENDING',
    CONFIRMED: 'CONFIRMED',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    REJECTED: 'REJECTED',
    EXPIRED: 'EXPIRED'
  },
  
  // User types
  USER_TYPES: {
    OWNER: 'OWNER',
    VET: 'VET',
    ADMIN: 'ADMIN'
  },
  
  // Appointment types
  APPOINTMENT_TYPES: {
    CHAT: 'CHAT',
    VIDEO: 'VIDEO',
    IN_PERSON: 'IN_PERSON'
  },
  
  // Payment statuses
  PAYMENT_STATUS: {
    PENDING: 'PENDING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    REFUNDED: 'REFUNDED',
    CANCELLED: 'CANCELLED'
  },
  
  // Transaction types
  TRANSACTION_TYPES: {
    CONSULTATION: 'CONSULTATION',
    SUBSCRIPTION: 'SUBSCRIPTION',
    PROMOTION: 'PROMOTION',
    REFUND: 'REFUND',
    PAYOUT: 'PAYOUT',
    WITHDRAWAL: 'WITHDRAWAL'
  },
  
  // Pet types
  PET_TYPES: {
    DOG: 'DOG',
    CAT: 'CAT',
    BIRD: 'BIRD',
    FISH: 'FISH',
    RODENT: 'RODENT',
    REPTILE: 'REPTILE',
    OTHER: 'OTHER'
  },
  
  // Vet specialties
  SPECIALTIES: [
    'DOGS',
    'CATS',
    'BIRDS',
    'FISH',
    'RODENTS',
    'REPTILES',
    'EXOTIC_ANIMALS',
    'SURGERY',
    'DERMATOLOGY',
    'DENTISTRY',
    'OPHTHALMOLOGY',
    'CARDIOLOGY',
    'NEUROLOGY',
    'ONCOLOGY',
    'ORTHOPEDICS',
    'EMERGENCY_CARE',
    'PREVENTIVE_CARE',
    'NUTRITION',
    'BEHAVIOR',
    'GERIATRIC_CARE'
  ],
  
  // Review categories
  REVIEW_CATEGORIES: [
    'PROFESSIONALISM',
    'KNOWLEDGE',
    'COMMUNICATION',
    'TIMELINESS',
    'BEDISIDE_MANNER'
  ],
  
  // Default working hours
  DEFAULT_WORKING_HOURS: {
    monday: { start: '08:00', end: '20:00' },
    tuesday: { start: '08:00', end: '20:00' },
    wednesday: { start: '08:00', end: '20:00' },
    thursday: { start: '08:00', end: '20:00' },
    friday: { start: '08:00', end: '20:00' },
    saturday: { start: '09:00', end: '18:00' },
    sunday: { start: '10:00', end: '16:00' }
  },
  
  // Time slots for appointments (in minutes)
  TIME_SLOTS: [15, 30, 45, 60, 90, 120],
  
  // File upload limits
  UPLOAD_LIMITS: {
    MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
    ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'],
    ALLOWED_DOCUMENT_TYPES: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  },
  
  // Cache TTL (in seconds)
  CACHE_TTL: {
    SHORT: 60, // 1 minute
    MEDIUM: 300, // 5 minutes
    LONG: 3600, // 1 hour
    VERY_LONG: 86400 // 24 hours
  },
  
  // Rate limiting
  RATE_LIMIT: {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    MAX_REQUESTS: 100 // per window per IP
  },
  
  // JWT
  JWT: {
    EXPIRES_IN: '7d',
    REFRESH_EXPIRES_IN: '30d'
  },
  
  // Password requirements
  PASSWORD: {
    MIN_LENGTH: 8,
    REQUIRE_UPPERCASE: true,
    REQUIRE_LOWERCASE: true,
    REQUIRE_NUMBERS: true,
    REQUIRE_SYMBOLS: false
  }
};

// API response messages
export const MESSAGES = {
  // Success messages
  SUCCESS: {
    REGISTER: 'Registration successful',
    LOGIN: 'Login successful',
    LOGOUT: 'Logout successful',
    UPDATE: 'Update successful',
    DELETE: 'Delete successful',
    CREATE: 'Create successful',
    SUBMIT: 'Submit successful',
    APPROVE: 'Approval successful',
    REJECT: 'Rejection successful',
    CANCEL: 'Cancellation successful',
    COMPLETE: 'Completion successful',
    PAYMENT: 'Payment successful',
    SUBSCRIPTION: 'Subscription successful',
    PROMOTION: 'Promotion successful',
    REVIEW: 'Review submitted successfully',
    MESSAGE: 'Message sent successfully'
  },
  
  // Error messages
  ERROR: {
    UNAUTHORIZED: 'Unauthorized access',
    FORBIDDEN: 'Access forbidden',
    NOT_FOUND: 'Resource not found',
    VALIDATION_FAILED: 'Validation failed',
    INVALID_CREDENTIALS: 'Invalid credentials',
    USER_EXISTS: 'User already exists',
    EMAIL_EXISTS: 'Email already registered',
    PHONE_EXISTS: 'Phone number already registered',
    LICENSE_EXISTS: 'License number already registered',
    INVALID_TOKEN: 'Invalid or expired token',
    PAYMENT_FAILED: 'Payment failed',
    SUBSCRIPTION_REQUIRED: 'Subscription required',
    APPOINTMENT_LIMIT: 'Appointment limit reached',
    PROMOTION_LIMIT: 'Promotion limit reached',
    TIME_SLOT_UNAVAILABLE: 'Time slot not available',
    CANNOT_CANCEL: 'Cannot cancel appointment',
    CANNOT_RESCHEDULE: 'Cannot reschedule appointment',
    FILE_TOO_LARGE: 'File size too large',
    INVALID_FILE_TYPE: 'Invalid file type',
    SERVER_ERROR: 'Internal server error'
  },
  
  // Validation messages
  VALIDATION: {
    REQUIRED: (field: string) => `${field} is required`,
    INVALID: (field: string) => `Invalid ${field}`,
    MIN_LENGTH: (field: string, length: number) => `${field} must be at least ${length} characters`,
    MAX_LENGTH: (field: string, length: number) => `${field} cannot exceed ${length} characters`,
    MIN_VALUE: (field: string, value: number) => `${field} must be at least ${value}`,
    MAX_VALUE: (field: string, value: number) => `${field} cannot exceed ${value}`,
    EMAIL: 'Valid email is required',
    PHONE: 'Valid phone number is required',
    PASSWORD: 'Password must be at least 8 characters with uppercase, lowercase, and numbers'
  }
};

// API status codes
export const STATUS_CODES = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
};