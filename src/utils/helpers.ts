import crypto from 'crypto';
import { Request } from 'express';

// Generate random string
export const generateRandomString = (length: number = 8): string => {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
};

// Generate unique ID
export const generateUniqueId = (prefix: string = ''): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 9);
  return `${prefix}${timestamp}${random}`.toUpperCase();
};

// Format currency
export const formatCurrency = (amount: number, currency: string = 'NGN'): string => {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency
  }).format(amount);
};

// Format date
export const formatDate = (date: Date | string, format: string = 'dd/MM/yyyy'): string => {
  const d = new Date(date);
  
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear();
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const seconds = d.getSeconds().toString().padStart(2, '0');

  switch (format) {
    case 'dd/MM/yyyy':
      return `${day}/${month}/${year}`;
    case 'yyyy-MM-dd':
      return `${year}-${month}-${day}`;
    case 'dd MMM yyyy':
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${day} ${monthNames[d.getMonth()]} ${year}`;
    case 'dd/MM/yyyy HH:mm':
      return `${day}/${month}/${year} ${hours}:${minutes}`;
    case 'yyyy-MM-dd HH:mm:ss':
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    default:
      return d.toISOString();
  }
};

// Calculate distance between two coordinates (in km)
export const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const toRad = (value: number): number => {
  return value * Math.PI / 180;
};

// Validate Nigerian phone number
export const validateNigerianPhone = (phone: string): boolean => {
  const regex = /^(\+234|0)[789][01]\d{8}$/;
  return regex.test(phone.replace(/\s/g, ''));
};

// Format Nigerian phone number
export const formatNigerianPhone = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, '');
  
  if (cleaned.startsWith('234')) {
    return `+${cleaned}`;
  } else if (cleaned.startsWith('0')) {
    return `+234${cleaned.substring(1)}`;
  } else if (cleaned.length === 10) {
    return `+234${cleaned}`;
  }
  
  return phone;
};

// Generate appointment reference
export const generateAppointmentReference = (): string => {
  const date = new Date();
  const year = date.getFullYear().toString().substr(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const random = Math.random().toString(36).substr(2, 6).toUpperCase();
  
  return `APT${year}${month}${day}${random}`;
};

// Generate transaction reference
export const generateTransactionReference = (): string => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substr(2, 6).toUpperCase();
  
  return `TX${timestamp}${random}`;
};

// Pagination helper
export const paginate = <T>(
  items: T[],
  page: number = 1,
  limit: number = 20
): {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
} => {
  const total = items.length;
  const pages = Math.ceil(total / limit);
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  
  return {
    data: items.slice(startIndex, endIndex),
    meta: {
      page,
      limit,
      total,
      pages,
      hasNext: page < pages,
      hasPrev: page > 1
    }
  };
};

// Get client IP address
export const getClientIP = (req: Request): string => {
  return req.ip || 
    req.connection.remoteAddress || 
    req.socket.remoteAddress || 
    (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 
    'unknown';
};

// Delay function
export const delay = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// Deep clone object
export const deepClone = <T>(obj: T): T => {
  return JSON.parse(JSON.stringify(obj));
};

// Remove undefined/null values from object
export const cleanObject = <T extends Record<string, any>>(obj: T): Partial<T> => {
  const cleaned: Partial<T> = {};
  
  for (const key in obj) {
    if (obj[key] !== undefined && obj[key] !== null) {
      cleaned[key] = obj[key];
    }
  }
  
  return cleaned;
};

// Convert object to query string
export const objectToQueryString = (obj: Record<string, any>): string => {
  const params = new URLSearchParams();
  
  for (const key in obj) {
    if (obj[key] !== undefined && obj[key] !== null) {
      params.append(key, obj[key].toString());
    }
  }
  
  return params.toString();
};

// Calculate age from date
export const calculateAge = (birthDate: Date | string): number => {
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  
  return age;
};

// Generate verification code
export const generateVerificationCode = (length: number = 6): string => {
  const digits = '0123456789';
  let code = '';
  
  for (let i = 0; i < length; i++) {
    code += digits.charAt(Math.floor(Math.random() * digits.length));
  }
  
  return code;
};

// Check if date is valid
export const isValidDate = (date: any): boolean => {
  return date instanceof Date && !isNaN(date.getTime());
};

// Slugify string
export const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

// Capitalize first letter
export const capitalize = (text: string): string => {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
};

// Truncate text
export const truncate = (text: string, length: number, suffix: string = '...'): string => {
  if (text.length <= length) return text;
  return text.substring(0, length - suffix.length) + suffix;
};