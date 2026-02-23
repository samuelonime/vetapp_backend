import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IVet extends Document {
  userId: Types.ObjectId;
  licenseNumber: string;
  licenseDocument: string;
  licenseVerified: boolean;
  specialties: string[];
  experienceYears: number;
  consultationFee: number;
  rating: number;
  totalReviews: number;
  subscriptionTier: 'FREE' | 'PRO' | 'ENTERPRISE';
  subscriptionExpiresAt?: Date;
  isFeatured: boolean;
  featuredExpiresAt?: Date;
  isApproved: boolean;
  approvalDate?: Date;
  bankDetails?: {
    bankName: string;
    accountNumber: string;
    accountName: string;
    bankCode: string;
  };
  totalEarnings: number;
  pendingEarnings: number;
  availableEarnings: number;
  onlineStatus: boolean;
  lastSeen: Date;
  workingHours?: {
    monday: { start: string; end: string };
    tuesday: { start: string; end: string };
    wednesday: { start: string; end: string };
    thursday: { start: string; end: string };
    friday: { start: string; end: string };
    saturday: { start: string; end: string };
    sunday: { start: string; end: string };
  };
  emergencyAvailable: boolean;
  languages: string[];
  about: string;
  education: Array<{
    institution: string;
    degree: string;
    year: number;
  }>;
  certifications: Array<{
    name: string;
    issuer: string;
    year: number;
    document?: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const vetSchema = new Schema<IVet>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  licenseNumber: {
    type: String,
    required: [true, 'License number is required'],
    unique: true,
    uppercase: true,
    trim: true
  },
  licenseDocument: {
    type: String,
    required: [true, 'License document is required']
  },
  licenseVerified: {
    type: Boolean,
    default: false
  },
  specialties: [{
    type: String,
    required: [true, 'At least one specialty is required']
  }],
  experienceYears: {
    type: Number,
    required: [true, 'Experience is required'],
    min: [0, 'Experience cannot be negative'],
    max: [60, 'Experience seems unrealistic']
  },
  consultationFee: {
    type: Number,
    required: [true, 'Consultation fee is required'],
    min: [1000, 'Minimum consultation fee is ₦1000'],
    max: [50000, 'Maximum consultation fee is ₦50000']
  },
  rating: {
    type: Number,
    default: 0,
    min: [0, 'Rating cannot be less than 0'],
    max: [5, 'Rating cannot exceed 5']
  },
  totalReviews: {
    type: Number,
    default: 0,
    min: 0
  },
  subscriptionTier: {
    type: String,
    enum: ['FREE', 'PRO', 'ENTERPRISE'],
    default: 'FREE'
  },
  subscriptionExpiresAt: {
    type: Date
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  featuredExpiresAt: {
    type: Date
  },
  isApproved: {
    type: Boolean,
    default: false
  },
  approvalDate: {
    type: Date
  },
  bankDetails: {
    bankName: String,
    accountNumber: String,
    accountName: String,
    bankCode: String
  },
  totalEarnings: {
    type: Number,
    default: 0,
    min: 0
  },
  pendingEarnings: {
    type: Number,
    default: 0,
    min: 0
  },
  availableEarnings: {
    type: Number,
    default: 0,
    min: 0
  },
  onlineStatus: {
    type: Boolean,
    default: false
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  workingHours: {
    monday: { start: String, end: String },
    tuesday: { start: String, end: String },
    wednesday: { start: String, end: String },
    thursday: { start: String, end: String },
    friday: { start: String, end: String },
    saturday: { start: String, end: String },
    sunday: { start: String, end: String }
  },
  emergencyAvailable: {
    type: Boolean,
    default: false
  },
  languages: [{
    type: String,
    default: ['English']
  }],
  about: {
    type: String,
    maxlength: [1000, 'About section cannot exceed 1000 characters']
  },
  education: [{
    institution: String,
    degree: String,
    year: Number
  }],
  certifications: [{
    name: String,
    issuer: String,
    year: Number,
    document: String
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
vetSchema.index({ userId: 1 });
vetSchema.index({ licenseNumber: 1 });
vetSchema.index({ isApproved: 1 });
vetSchema.index({ subscriptionTier: 1 });
vetSchema.index({ isFeatured: 1 });
vetSchema.index({ rating: -1 });
vetSchema.index({ consultationFee: 1 });
vetSchema.index({ specialties: 1 });
vetSchema.index({ onlineStatus: 1 });
vetSchema.index({ subscriptionExpiresAt: 1 });
vetSchema.index({ featuredExpiresAt: 1 });
vetSchema.index({ totalEarnings: -1 });

// Virtual populate for appointments
vetSchema.virtual('appointments', {
  ref: 'Appointment',
  localField: '_id',
  foreignField: 'vetId'
});

// Virtual populate for reviews
vetSchema.virtual('reviews', {
  ref: 'Review',
  localField: '_id',
  foreignField: 'vetId'
});

// Virtual populate for subscriptions
vetSchema.virtual('subscriptions', {
  ref: 'Subscription',
  localField: '_id',
  foreignField: 'vetId'
});

// Method to check if subscription is active
vetSchema.methods.isSubscriptionActive = function(): boolean {
  if (this.subscriptionTier === 'FREE') return true;
  
  return this.subscriptionExpiresAt && this.subscriptionExpiresAt > new Date();
};

// Method to check if featured status is active
vetSchema.methods.isFeaturedActive = function(): boolean {
  return this.isFeatured && this.featuredExpiresAt && this.featuredExpiresAt > new Date();
};

// Method to calculate average rating
vetSchema.statics.calculateAverageRating = async function(vetId: Types.ObjectId) {
  const result = await this.aggregate([
    {
      $match: { _id: vetId }
    },
    {
      $lookup: {
        from: 'reviews',
        localField: '_id',
        foreignField: 'vetId',
        as: 'reviews'
      }
    },
    {
      $unwind: '$reviews'
    },
    {
      $group: {
        _id: '$_id',
        averageRating: { $avg: '$reviews.rating' },
        totalReviews: { $sum: 1 }
      }
    }
  ]);

  if (result.length > 0) {
    await this.findByIdAndUpdate(vetId, {
      rating: result[0].averageRating.toFixed(1),
      totalReviews: result[0].totalReviews
    });
  }
};

// Pre-save middleware
vetSchema.pre('save', function(next) {
  // Ensure subscription expires date is set for paid tiers
  if (this.subscriptionTier !== 'FREE' && !this.subscriptionExpiresAt) {
    const expires = new Date();
    expires.setDate(expires.getDate() + 30); // Default 30 days
    this.subscriptionExpiresAt = expires;
  }
  
  next();
});

export default mongoose.model<IVet>('Vet', vetSchema);