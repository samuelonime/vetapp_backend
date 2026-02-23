import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ISubscription extends Document {
  vetId: Types.ObjectId;
  tier: 'PRO' | 'ENTERPRISE';
  amount: number;
  currency: string;
  paystackPlanCode: string;
  paystackSubscriptionCode: string;
  status: 'ACTIVE' | 'INACTIVE' | 'CANCELLED' | 'EXPIRED';
  startDate: Date;
  endDate: Date;
  nextPaymentDate?: Date;
  autoRenew: boolean;
  paymentMethod: string;
  transactions: Types.ObjectId[];
  cancellationReason?: string;
  cancelledAt?: Date;
  trialUsed: boolean;
  features: {
    maxAppointments: number;
    maxPromotions: number;
    commissionRate: number;
    featuredPriority: boolean;
    analyticsAccess: boolean;
    customBranding: boolean;
    dedicatedSupport: boolean;
    videoCallMinutes: number;
  };
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionSchema = new Schema<ISubscription>({
  vetId: {
    type: Schema.Types.ObjectId,
    ref: 'Vet',
    required: true
  },
  tier: {
    type: String,
    enum: ['PRO', 'ENTERPRISE'],
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
  paystackPlanCode: {
    type: String,
    required: true,
    trim: true
  },
  paystackSubscriptionCode: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'INACTIVE', 'CANCELLED', 'EXPIRED'],
    default: 'ACTIVE'
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
  nextPaymentDate: {
    type: Date
  },
  autoRenew: {
    type: Boolean,
    default: true
  },
  paymentMethod: {
    type: String,
    default: 'CARD'
  },
  transactions: [{
    type: Schema.Types.ObjectId,
    ref: 'Transaction'
  }],
  cancellationReason: {
    type: String,
    trim: true
  },
  cancelledAt: {
    type: Date
  },
  trialUsed: {
    type: Boolean,
    default: false
  },
  features: {
    maxAppointments: { type: Number, default: 0 }, // 0 = unlimited
    maxPromotions: { type: Number, default: 0 }, // 0 = unlimited
    commissionRate: { type: Number, default: 0.15 },
    featuredPriority: { type: Boolean, default: false },
    analyticsAccess: { type: Boolean, default: false },
    customBranding: { type: Boolean, default: false },
    dedicatedSupport: { type: Boolean, default: false },
    videoCallMinutes: { type: Number, default: 0 } // 0 = unlimited
  },
  metadata: {
    type: Schema.Types.Mixed
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
subscriptionSchema.index({ vetId: 1 });
subscriptionSchema.index({ status: 1 });
subscriptionSchema.index({ tier: 1 });
subscriptionSchema.index({ endDate: 1 });
subscriptionSchema.index({ paystackSubscriptionCode: 1 });
subscriptionSchema.index({ startDate: -1 });
subscriptionSchema.index({ vetId: 1, status: 1 });
subscriptionSchema.index({ status: 1, endDate: 1 });

// Compound index for active subscriptions query
subscriptionSchema.index({ vetId: 1, status: 1, endDate: 1 });

// Virtual populate for vet
subscriptionSchema.virtual('vet', {
  ref: 'Vet',
  localField: 'vetId',
  foreignField: '_id',
  justOne: true
});

// Virtual populate for subscription transactions
subscriptionSchema.virtual('subscriptionTransactions', {
  ref: 'Transaction',
  localField: 'transactions',
  foreignField: '_id'
});

// Virtual to check if subscription is active
subscriptionSchema.virtual('isActive').get(function() {
  if (this.status !== 'ACTIVE') return false;
  return this.endDate > new Date();
});

// Virtual for days remaining
subscriptionSchema.virtual('daysRemaining').get(function() {
  // Calculate isActive directly instead of using the virtual property
  const isActive = this.status === 'ACTIVE' && this.endDate > new Date();
  if (!isActive) return 0;
  
  const now = new Date();
  const end = new Date(this.endDate);
  const diffTime = Math.abs(end.getTime() - now.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Method to cancel subscription
subscriptionSchema.methods.cancel = async function(reason?: string) {
  this.status = 'CANCELLED';
  this.cancellationReason = reason;
  this.cancelledAt = new Date();
  this.autoRenew = false;
  await this.save();
};

// Method to renew subscription
subscriptionSchema.methods.renew = async function(durationMonths: number = 1) {
  if (this.status === 'CANCELLED') {
    throw new Error('Cannot renew cancelled subscription');
  }

  const newEndDate = new Date(this.endDate);
  newEndDate.setMonth(newEndDate.getMonth() + durationMonths);
  
  this.endDate = newEndDate;
  this.status = 'ACTIVE';
  await this.save();
};

// Method to upgrade/downgrade tier
subscriptionSchema.methods.changeTier = async function(
  newTier: 'PRO' | 'ENTERPRISE',
  newAmount: number,
  newFeatures: any
) {
  this.tier = newTier;
  this.amount = newAmount;
  this.features = { ...this.features, ...newFeatures };
  await this.save();
};

// Static method to get active subscriptions count
subscriptionSchema.statics.getActiveSubscriptionsCount = async function() {
  return await this.countDocuments({
    status: 'ACTIVE',
    endDate: { $gt: new Date() }
  });
};

// Static method to get expiring subscriptions
subscriptionSchema.statics.getExpiringSubscriptions = async function(days: number = 7) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  
  return await this.find({
    status: 'ACTIVE',
    endDate: { $lte: date, $gt: new Date() }
  }).populate('vet', 'userId consultationFee rating')
    .populate({
      path: 'vet',
      populate: {
        path: 'userId',
        select: 'firstName lastName email phone'
      }
    });
};

// Static method to calculate monthly revenue
subscriptionSchema.statics.getMonthlyRevenue = async function(year: number, month: number) {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 1);
  
  const result = await this.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lt: endDate }
      }
    },
    {
      $group: {
        _id: {
          tier: '$tier',
          status: '$status'
        },
        totalAmount: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: '$_id.tier',
        totalRevenue: { $sum: '$totalAmount' },
        activeCount: {
          $sum: {
            $cond: [{ $eq: ['$_id.status', 'ACTIVE'] }, '$count', 0]
          }
        },
        totalCount: { $sum: '$count' }
      }
    }
  ]);

  return result;
};

// Pre-save middleware to set end date if not provided
subscriptionSchema.pre('save', function(next) {
  if (!this.endDate) {
    const endDate = new Date(this.startDate);
    endDate.setMonth(endDate.getMonth() + 1); // Default 1 month subscription
    this.endDate = endDate;
  }

  // Set next payment date (7 days before end date)
  if (!this.nextPaymentDate && this.autoRenew) {
    const nextPayment = new Date(this.endDate);
    nextPayment.setDate(nextPayment.getDate() - 7);
    this.nextPaymentDate = nextPayment;
  }

  // Set features based on tier
  if (this.tier && !this.features) {
    const tierFeatures = {
      PRO: {
        maxAppointments: 50,
        maxPromotions: 2,
        commissionRate: 0.10,
        featuredPriority: true,
        analyticsAccess: true,
        customBranding: false,
        dedicatedSupport: false,
        videoCallMinutes: 300
      },
      ENTERPRISE: {
        maxAppointments: 0, // unlimited
        maxPromotions: 5,
        commissionRate: 0.08,
        featuredPriority: true,
        analyticsAccess: true,
        customBranding: true,
        dedicatedSupport: true,
        videoCallMinutes: 0 // unlimited
      }
    };

    this.features = tierFeatures[this.tier];
  }

  next();
});

export default mongoose.model<ISubscription>('Subscription', subscriptionSchema);