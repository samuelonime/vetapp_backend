import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IPromotion extends Document {
  vetId: Types.ObjectId;
  type: 'FEATURED' | 'TOP_SEARCH' | 'HOMEPAGE' | 'CATEGORY_FEATURED';
  amount: number;
  currency: string;
  duration: number; // in days
  startDate: Date;
  endDate: Date;
  status: 'ACTIVE' | 'PENDING' | 'EXPIRED' | 'CANCELLED';
  paymentStatus: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';
  paymentReference?: string;
  impressions: number;
  clicks: number;
  conversions: number; // Appointments booked
  metadata: {
    position?: number;
    category?: string;
    customText?: string;
    imageUrl?: string;
  };
  autoRenew: boolean;
  cancellationReason?: string;
  cancelledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const promotionSchema = new Schema<IPromotion>({
  vetId: {
    type: Schema.Types.ObjectId,
    ref: 'Vet',
    required: true
  },
  type: {
    type: String,
    enum: ['FEATURED', 'TOP_SEARCH', 'HOMEPAGE', 'CATEGORY_FEATURED'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'NGN',
    uppercase: true
  },
  duration: {
    type: Number,
    required: true,
    min: 1,
    max: 30 // Maximum 30 days per promotion
  },
  startDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  endDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'PENDING', 'EXPIRED', 'CANCELLED'],
    default: 'PENDING'
  },
  paymentStatus: {
    type: String,
    enum: ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'],
    default: 'PENDING'
  },
  paymentReference: {
    type: String,
    unique: true,
    sparse: true,
    trim: true
  },
  impressions: {
    type: Number,
    default: 0,
    min: 0
  },
  clicks: {
    type: Number,
    default: 0,
    min: 0
  },
  conversions: {
    type: Number,
    default: 0,
    min: 0
  },
  metadata: {
    position: Number,
    category: String,
    customText: String,
    imageUrl: String
  },
  autoRenew: {
    type: Boolean,
    default: false
  },
  cancellationReason: {
    type: String,
    trim: true
  },
  cancelledAt: {
    type: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
promotionSchema.index({ vetId: 1 });
promotionSchema.index({ type: 1 });
promotionSchema.index({ status: 1 });
promotionSchema.index({ endDate: 1 });
promotionSchema.index({ startDate: -1 });
promotionSchema.index({ paymentStatus: 1 });
promotionSchema.index({ vetId: 1, status: 1 });
promotionSchema.index({ type: 1, status: 1, endDate: 1 });



// Virtual populate for vet
promotionSchema.virtual('vet', {
  ref: 'Vet',
  localField: 'vetId',
  foreignField: '_id',
  justOne: true
});

// Virtual to check if promotion is active
promotionSchema.virtual('isActive').get(function() {
  if (this.status !== 'ACTIVE') return false;
  return this.endDate > new Date();
});

// Virtual for CTR (Click-through rate)
promotionSchema.virtual('ctr').get(function() {
  if (this.impressions === 0) return 0;
  return (this.clicks / this.impressions) * 100;
});

// Virtual for conversion rate
promotionSchema.virtual('conversionRate').get(function() {
  if (this.clicks === 0) return 0;
  return (this.conversions / this.clicks) * 100;
});

// Virtual for cost per click
promotionSchema.virtual('costPerClick').get(function() {
  if (this.clicks === 0) return this.amount;
  return this.amount / this.clicks;
});

// Virtual for days remaining
promotionSchema.virtual('daysRemaining').get(function() {
  // Calculate isActive directly instead of using the virtual property
  const isActive = this.status === 'ACTIVE' && this.endDate > new Date();
  if (!isActive) return 0;
  
  const now = new Date();
  const end = new Date(this.endDate);
  const diffTime = Math.abs(end.getTime() - now.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Method to activate promotion
promotionSchema.methods.activate = async function() {
  this.status = 'ACTIVE';
  this.startDate = new Date();
  
  // Calculate end date based on duration
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + this.duration);
  this.endDate = endDate;
  
  await this.save();
};

// Method to cancel promotion
promotionSchema.methods.cancel = async function(reason?: string) {
  this.status = 'CANCELLED';
  this.cancellationReason = reason;
  this.cancelledAt = new Date();
  await this.save();
};

// Method to record impression
promotionSchema.methods.recordImpression = async function() {
  this.impressions += 1;
  await this.save();
};

// Method to record click
promotionSchema.methods.recordClick = async function() {
  this.clicks += 1;
  await this.save();
};

// Method to record conversion
promotionSchema.methods.recordConversion = async function() {
  this.conversions += 1;
  await this.save();
};

// Static method to get active promotions by type
promotionSchema.statics.getActivePromotions = async function(
  type?: string,
  limit: number = 10
) {
  const query: any = {
    status: 'ACTIVE',
    endDate: { $gt: new Date() }
  };

  if (type) {
    query.type = type;
  }

  return await this.find(query)
    .populate({
      path: 'vet',
      select: 'userId consultationFee rating specialties',
      populate: {
        path: 'userId',
        select: 'firstName lastName avatar'
      }
    })
    .sort({ 'metadata.position': 1, createdAt: -1 })
    .limit(limit);
};

// Static method to get expiring promotions
promotionSchema.statics.getExpiringPromotions = async function(days: number = 3) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  
  return await this.find({
    status: 'ACTIVE',
    endDate: { $lte: date, $gt: new Date() }
  }).populate('vet', 'userId')
    .populate({
      path: 'vet',
      populate: {
        path: 'userId',
        select: 'firstName lastName email'
      }
    });
};

// Static method to calculate promotion metrics
promotionSchema.statics.getPromotionMetrics = async function(
  startDate: Date,
  endDate: Date
) {
  const result = await this.aggregate([
    {
      $match: {
        startDate: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: {
          type: '$type',
          status: '$status'
        },
        totalAmount: { $sum: '$amount' },
        totalImpressions: { $sum: '$impressions' },
        totalClicks: { $sum: '$clicks' },
        totalConversions: { $sum: '$conversions' },
        count: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: '$_id.type',
        totalRevenue: { $sum: '$totalAmount' },
        totalImpressions: { $sum: '$totalImpressions' },
        totalClicks: { $sum: '$totalClicks' },
        totalConversions: { $sum: '$totalConversions' },
        activeCount: {
          $sum: {
            $cond: [{ $eq: ['$_id.status', 'ACTIVE'] }, '$count', 0]
          }
        },
        totalCount: { $sum: '$count' }
      }
    },
    {
      $project: {
        type: '$_id',
        totalRevenue: 1,
        totalImpressions: 1,
        totalClicks: 1,
        totalConversions: 1,
        activeCount: 1,
        totalCount: 1,
        ctr: {
          $cond: [
            { $eq: ['$totalImpressions', 0] },
            0,
            { $multiply: [{ $divide: ['$totalClicks', '$totalImpressions'] }, 100] }
          ]
        },
        conversionRate: {
          $cond: [
            { $eq: ['$totalClicks', 0] },
            0,
            { $multiply: [{ $divide: ['$totalConversions', '$totalClicks'] }, 100] }
          ]
        },
        costPerClick: {
          $cond: [
            { $eq: ['$totalClicks', 0] },
            '$totalRevenue',
            { $divide: ['$totalRevenue', '$totalClicks'] }
          ]
        }
      }
    }
  ]);

  return result;
};

// Pre-save middleware to set end date
promotionSchema.pre('save', function(next) {
  if (this.startDate && this.duration && !this.endDate) {
    const endDate = new Date(this.startDate);
    endDate.setDate(endDate.getDate() + this.duration);
    this.endDate = endDate;
  }

  // Auto-expire if end date passed
  if (this.endDate && this.endDate < new Date() && this.status === 'ACTIVE') {
    this.status = 'EXPIRED';
  }

  next();
});

export default mongoose.model<IPromotion>('Promotion', promotionSchema);