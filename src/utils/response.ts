export class ApiResponse {
  success: boolean;
  message: string;
  data?: any;
  error?: any;

  constructor(statusCode: number, message: string, data?: any, error?: any) {
    this.success = statusCode >= 200 && statusCode < 300;
    this.message = message;
    this.data = data;
    this.error = error;
  }
}

export class ApiError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(statusCode: number, message: string, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    Error.captureStackTrace(this, this.constructor);
  }
}