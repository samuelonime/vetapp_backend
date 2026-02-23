declare module 'hpp';
declare module 'cookie-parser';
declare module 'express-mongo-sanitize';

declare global {
  namespace Express {
    interface Request {
      user?: { id?: string } | any;
    }
  }
}

export {};