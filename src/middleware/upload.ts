import multer from 'multer';
import path from 'path';
import { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ApiError } from '../utils/response';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

// Install missing types:
// npm install --save-dev @types/uuid
// npm install --save-dev @types/multer

// Configure storage
const storage = multer.diskStorage({
  destination: (
    _req: Request,  // Changed from req to _req to indicate unused
    file: Express.Multer.File,
    cb: (error: Error | null, destination: string) => void
  ) => {
    let uploadPath = 'uploads/';
    
    if (file.fieldname === 'licenseDocument') {
      uploadPath = 'uploads/licenses/';
    } else if (file.fieldname === 'avatar') {
      uploadPath = 'uploads/avatars/';
    } else if (file.fieldname === 'chatMedia') {
      uploadPath = 'uploads/chat/';
    }
    
    cb(null, uploadPath);
  },
  filename: (
    _req: Request,  // Changed from req to _req
    file: Express.Multer.File,
    cb: (error: Error | null, filename: string) => void
  ) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

// File filter
const fileFilter = (
  _req: Request,  // Changed from req to _req
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedTypes = {
    'image/jpeg': true,
    'image/jpg': true,
    'image/png': true,
    'image/gif': true,
    'application/pdf': true,
    'application/msword': true,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true
  };

  if (allowedTypes[file.mimetype as keyof typeof allowedTypes]) {
    cb(null, true);
  } else {
    cb(new ApiError(400, 'Invalid file type') as any);
  }
};

// Configure multer
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
    files: 5 // Max 5 files
  }
});

// Specific upload configurations
export const uploadLicense = upload.single('licenseDocument');
export const uploadAvatar = upload.single('avatar');
export const uploadChatMedia = upload.single('chatMedia');
export const uploadMultiple = upload.array('files', 5);

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || ''
});

// Streamifier replacement using Node.js built-in Readable
const bufferToStream = (buffer: Buffer): Readable => {
  const readable = new Readable();
  readable.push(buffer);
  readable.push(null);
  return readable;
};

export const uploadToCloudinary = (
  file: Express.Multer.File,
  folder: string = 'vetconnect'
): Promise<{ url: string; public_id: string }> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'auto'
      },
      (error, result) => {
        if (result) {
          resolve({
            url: result.secure_url || result.url || '',
            public_id: result.public_id || ''
          });
        } else {
          reject(error || new Error('Cloudinary upload failed'));
        }
      }
    );

    // Convert buffer to stream and pipe to Cloudinary
    const stream = bufferToStream(file.buffer);
    stream.pipe(uploadStream);
  });
};