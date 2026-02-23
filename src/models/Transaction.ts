import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ITransaction extends Document {
  appointmentId?: Types.ObjectId;
  userId: Types.ObjectId;
  vetId?: Types.ObjectId;
  type: 'CONSULTATION' | 'SUBSCRIPTION' | 'PROMOTION' | 'REFUND' | 'PAYOUT' | 'WITHDRAWAL';
  amount: number;
  platformFee: number;
  vetEarned?: number;
  currency: string;
  paymentReference: string;
  paymentStatus: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
  paymentMethod: 'CARD' | 'BANK_TRANSFER' | 'MOBILE_MONEY' | 'WALLET' | 'OTHER';
  paystackData?: any;
  metadata?: {
    subscriptionTier?: string;
    promotionDuration?: number;
    refundReason?: string;
    payoutMethod?: string;
    bankDetails?: {
      bankName: string;
      accountNumber: string;
      accountName: string;
    };
  };
  description?: string;
  failureReason?: string;
  refundedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<ITransaction>({
  appointmentId: {
    type: Schema.Types.ObjectId,
    ref: 'Appointment'
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  vetId: {
    type: Schema.Types.ObjectId,
    ref: 'Vet'
  },
  type: {
    type: String,
    enum: ['CONSULTATION', 'SUBSCRIPTION', 'PROMOTION', 'REFUND', 'PAYOUT', 'WITHDRAWAL'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  platformFee: {
    type: Number,
    required: true,
    min: 0
  },
  vetEarned: {
    type: Number,
    min: 0
  },
  currency: {
    type: String,
    default: 'NGN',
    uppercase: true
  },
  paymentReference: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  paymentStatus: {
    type: String,
    enum: ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'CANCELLED'],
    default: 'PENDING'
  },
  paymentMethod: {
    type: String,
    enum: ['CARD', 'BANK_TRANSFER', 'MOBILE_MONEY', 'WALLET', 'OTHER'],
    default: 'CARD'
  },
  paystackData: {
    type: Schema.Types.Mixed
  },
  metadata: {
    subscriptionTier: String,
    promotionDuration: Number,
    refundReason: String,
    payoutMethod: String,
    bankDetails: {
      bankName: String,
      accountNumber: String,
      accountName: String
    }
  },
  description: {
    type: String,
    trim: true
  },
  failureReason: {
    type: String,
    trim: true
  },
  refundedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
transactionSchema.index({ userId: 1 });
transactionSchema.index({ vetId: 1 });
transactionSchema.index({ appointmentId: 1 });
transactionSchema.index({ paymentReference: 1 });
transactionSchema.index({ paymentStatus: 1 });
transactionSchema.index({ type: 1 });
transactionSchema.index({ createdAt: -1 });
transactionSchema.index({ completedAt: -1 });
transactionSchema.index({ userId: 1, type: 1 });
transactionSchema.index({ vetId: 1, type: 1 });
transactionSchema.index({ paymentStatus: 1, createdAt: -1 });

// Compound index for financial reporting
transactionSchema.index({ type: 1, paymentStatus: 1, createdAt: -1 });

// Virtual populate for user
transactionSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

// Virtual populate for vet
transactionSchema.virtual('vet', {
  ref: 'Vet',
  localField: 'vetId',
  foreignField: '_id',
  justOne: true
});

// Virtual populate for appointment
transactionSchema.virtual('appointment', {
  ref: 'Appointment',
  localField: 'appointmentId',
  foreignField: '_id',
  justOne: true
});

// Virtual for net amount (amount - platformFee)
transactionSchema.virtual('netAmount').get(function() {
  return this.amount - this.platformFee;
});

// Method to check if transaction can be refunded
transactionSchema.methods.canBeRefunded = function(): boolean {
  if (this.paymentStatus !== 'COMPLETED') return false;
  
  const completedTime = this.completedAt || this.createdAt;
  const hoursSinceCompletion = (new Date().getTime() - completedTime.getTime()) / (1000 * 60 * 60);
  
  return hoursSinceCompletion <= 48; // 48-hour refund window
};

// Method to mark as completed
transactionSchema.methods.markAsCompleted = async function(paystackData?: any) {
  this.paymentStatus = 'COMPLETED';
  this.completedAt = new Date();
  if (paystackData) {
    this.paystackData = paystackData;
  }
  await this.save();
};

// Method to mark as failed
transactionSchema.methods.markAsFailed = async function(reason?: string) {
  this.paymentStatus = 'FAILED';
  if (reason) {
    this.failureReason = reason;
  }
  await this.save();
};

// Method to mark as refunded
transactionSchema.methods.markAsRefunded = async function(reason?: string) {
  this.paymentStatus = 'REFUNDED';
  this.refundedAt = new Date();
  if (reason) {
    this.metadata = this.metadata || {};
    this.metadata.refundReason = reason;
  }
  await this.save();
};

// Static method to get total revenue
transactionSchema.statics.getTotalRevenue = async function(
  startDate?: Date,
  endDate?: Date
) {
  const match: any = {
    paymentStatus: 'COMPLETED'
  };

  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = startDate;
    if (endDate) match.createdAt.$lte = endDate;
  }

  const result = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalAmount: { $sum: '$amount' },
        totalPlatformFee: { $sum: '$platformFee' },
        totalTransactions: { $sum: 1 }
      }
    }
  ]);

  return result[0] || { totalAmount: 0, totalPlatformFee: 0, totalTransactions: 0 };
};

// Static method to get vet earnings
transactionSchema.statics.getVetEarnings = async function(
  vetId: Types.ObjectId,
  startDate?: Date,
  endDate?: Date
) {
  const match: any = {
    vetId,
    paymentStatus: 'COMPLETED',
    type: { $in: ['CONSULTATION', 'SUBSCRIPTION', 'PROMOTION'] }
  };

  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = startDate;
    if (endDate) match.createdAt.$lte = endDate;
  }

  const result = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalEarnings: { $sum: '$vetEarned' },
        totalTransactions: { $sum: 1 },
        consultationCount: {
          $sum: { $cond: [{ $eq: ['$type', 'CONSULTATION'] }, 1, 0] }
        },
        subscriptionCount: {
          $sum: { $cond: [{ $eq: ['$type', 'SUBSCRIPTION'] }, 1, 0] }
        },
        promotionCount: {
          $sum: { $cond: [{ $eq: ['$type', 'PROMOTION'] }, 1, 0] }
        }
      }
    }
  ]);

  return result[0] || {
    totalEarnings: 0,
    totalTransactions: 0,
    consultationCount: 0,
    subscriptionCount: 0,
    promotionCount: 0
  };
};

// Pre-save middleware to generate reference if not provided
transactionSchema.pre('save', function(next) {
  if (!this.paymentReference) {
    this.paymentReference = `TX${Date.now()}${Math.random().toString(36).substr(2, 9)}`.toUpperCase();
  }
  
  next();
});

export default mongoose.model<ITransaction>('Transaction', transactionSchema);