import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import cookieParser from 'cookie-parser';
import path from 'path';
import logger from './utils/logger';
import errorHandler from './middleware/error';
import routes from './routes';
import { env } from './config/env';

const app: Application = express();

// ====================
// SECURITY MIDDLEWARE
// ====================

// Set security HTTP headers
app.use(helmet());

// Enable CORS
app.use(cors({
  origin: [
    env.CLIENT_URL,
    env.ADMIN_URL,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://0.0.0.0:3000',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'X-Device-Id',
    'X-Platform',
    'X-App-Version',
  ]
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api', limiter);

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Data sanitization against NoSQL query injection
app.use(mongoSanitize());

// Prevent parameter pollution
app.use(hpp());

// Compression
app.use(compression());

// ====================
// LOGGING MIDDLEWARE
// ====================
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const { method, url, ip } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const { statusCode } = res;
    const logMessage = `${method} ${url} ${statusCode} ${duration}ms - ${ip}`;
    
    if (statusCode >= 400) {
      logger.error(logMessage);
    } else {
      logger.info(logMessage);
    }
  });

  next();
});

// ====================
// STATIC FILES
// ====================
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ====================
// HEALTH CHECK
// ====================
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'success',
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ====================
// API ROUTES
// ====================
app.use(`/api/${process.env.API_VERSION}`, routes);

// ====================
// 404 HANDLER
// ====================
app.all('*', (req: Request, res: Response) => {
  res.status(404).json({
    status: 'error',
    message: `Can't find ${req.originalUrl} on this server!`
  });
});

// ====================
// ERROR HANDLER
// ====================
app.use(errorHandler);

export default app;