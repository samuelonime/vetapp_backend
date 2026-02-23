import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  email: string;
  phone: string;
  password: string;
  userType: 'OWNER' | 'VET' | 'ADMIN';
  firstName: string;
  lastName: string;
  avatar?: string;
  location?: {
    type: string;
    coordinates: [number, number]; // [longitude, latitude]
  };
  isVerified: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  fcmToken?: string;
  lastLogin?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  
  // Methods
  comparePassword(candidatePassword: string): Promise<boolean>;
  generateAuthToken(): string;
}

const userSchema = new Schema<IUser>({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
    trim: true
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false
  },
  userType: {
    type: String,
    enum: ['OWNER', 'VET', 'ADMIN'],
    default: 'OWNER'
  },
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    minlength: [2, 'First name must be at least 2 characters']
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
    minlength: [2, 'Last name must be at least 2 characters']
  },
  avatar: {
    type: String,
    default: ''
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      default: [0, 0]
    }
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  phoneVerified: {
    type: Boolean,
    default: false
  },
  fcmToken: {
    type: String
  },
  lastLogin: {
    type: Date
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Create geospatial index
userSchema.index({ location: '2dsphere' });

// Index for common queries
userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ userType: 1 });
userSchema.index({ isVerified: 1 });
userSchema.index({ createdAt: -1 });

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error: any) {
    next(error);
  }
});

// Update timestamp before update
userSchema.pre('findOneAndUpdate', function(next) {
  this.set({ updatedAt: new Date() });
  next();
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword: string): Promise<boolean> {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to generate auth token (simplified)
userSchema.methods.generateAuthToken = function(): string {
  // In practice, use JWT library
  return 'token-placeholder';
};

// Static method to find by email or phone
userSchema.statics.findByEmailOrPhone = async function(identifier: string) {
  return await this.findOne({
    $or: [
      { email: identifier },
      { phone: identifier }
    ]
  });
};

export default mongoose.model<IUser>('User', userSchema);