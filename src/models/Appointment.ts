import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IAppointment extends Document {
  ownerId: Types.ObjectId;
  vetId: Types.ObjectId;
  type: 'CHAT' | 'VIDEO' | 'IN_PERSON';
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'REJECTED' | 'EXPIRED';
  scheduledAt?: Date;
  completedAt?: Date;
  consultationFee: number;
  platformFee: number;
  videoCallFee: number;
  totalAmount: number;
  vetEarned: number;
  symptoms?: string[];
  petType?: 'DOG' | 'CAT' | 'BIRD' | 'FISH' | 'RODENT' | 'REPTILE' | 'OTHER';
  petName?: string;
  petAge?: number;
  petBreed?: string;
  diagnosis?: string;
  prescription?: string;
  followUpDate?: Date;
  notes?: string;
  rejectionReason?: string;
  cancellationReason?: string;
  cancelledBy?: 'OWNER' | 'VET' | 'SYSTEM';
  meetingLink?: string;
  meetingPassword?: string;
  reminderSent: boolean;
  completedNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const appointmentSchema = new Schema<IAppointment>({
  ownerId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  vetId: {
    type: Schema.Types.ObjectId,
    ref: 'Vet',
    required: true
  },
  type: {
    type: String,
    enum: ['CHAT', 'VIDEO', 'IN_PERSON'],
    required: true
  },
  status: {
    type: String,
    enum: ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED'],
    default: 'PENDING'
  },
  scheduledAt: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  consultationFee: {
    type: Number,
    required: true,
    min: 0
  },
  platformFee: {
    type: Number,
    required: true,
    min: 0
  },
  videoCallFee: {
    type: Number,
    default: 0,
    min: 0
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  vetEarned: {
    type: Number,
    required: true,
    min: 0
  },
  symptoms: [{
    type: String
  }],
  petType: {
    type: String,
    enum: ['DOG', 'CAT', 'BIRD', 'FISH', 'RODENT', 'REPTILE', 'OTHER']
  },
  petName: {
    type: String,
    trim: true
  },
  petAge: {
    type: Number,
    min: 0
  },
  petBreed: {
    type: String,
    trim: true
  },
  diagnosis: {
    type: String,
    trim: true
  },
  prescription: {
    type: String,
    trim: true
  },
  followUpDate: {
    type: Date
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 500
  },
  rejectionReason: {
    type: String,
    trim: true
  },
  cancellationReason: {
    type: String,
    trim: true
  },
  cancelledBy: {
    type: String,
    enum: ['OWNER', 'VET', 'SYSTEM']
  },
  meetingLink: {
    type: String,
    trim: true
  },
  meetingPassword: {
    type: String,
    trim: true
  },
  reminderSent: {
    type: Boolean,
    default: false
  },
  completedNotes: {
    type: String,
    trim: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
appointmentSchema.index({ ownerId: 1 });
appointmentSchema.index({ vetId: 1 });
appointmentSchema.index({ status: 1 });
appointmentSchema.index({ type: 1 });
appointmentSchema.index({ scheduledAt: 1 });
appointmentSchema.index({ createdAt: -1 });
appointmentSchema.index({ completedAt: -1 });
appointmentSchema.index({ followUpDate: 1 });
appointmentSchema.index({ ownerId: 1, status: 1 });
appointmentSchema.index({ vetId: 1, status: 1 });
appointmentSchema.index({ ownerId: 1, vetId: 1, status: 1 });

// Compound index for common queries
appointmentSchema.index({ vetId: 1, scheduledAt: 1 });
appointmentSchema.index({ ownerId: 1, createdAt: -1 });

// Virtual populate for chat messages
appointmentSchema.virtual('chatMessages', {
  ref: 'ChatMessage',
  localField: '_id',
  foreignField: 'appointmentId'
});

// Virtual populate for transaction
appointmentSchema.virtual('transaction', {
  ref: 'Transaction',
  localField: '_id',
  foreignField: 'appointmentId',
  justOne: true
});

// Virtual populate for review
appointmentSchema.virtual('review', {
  ref: 'Review',
  localField: '_id',
  foreignField: 'appointmentId',
  justOne: true
});

// Virtual for duration (if scheduled and completed)
appointmentSchema.virtual('duration').get(function() {
  if (this.scheduledAt && this.completedAt) {
    return (this.completedAt.getTime() - this.scheduledAt.getTime()) / 60000; // in minutes
  }
  return null;
});

// Method to check if appointment can be cancelled
appointmentSchema.methods.canBeCancelled = function(): boolean {
  if (this.status === 'CANCELLED' || this.status === 'COMPLETED') {
    return false;
  }

  if (this.scheduledAt) {
    const now = new Date();
    const hoursUntilAppointment = (this.scheduledAt.getTime() - now.getTime()) / (1000 * 60 * 60);
    return hoursUntilAppointment > 2; // Can cancel if more than 2 hours before
  }

  return true;
};

// Method to check if appointment can be rescheduled
appointmentSchema.methods.canBeRescheduled = function(): boolean {
  if (this.status === 'CANCELLED' || this.status === 'COMPLETED') {
    return false;
  }

  if (this.scheduledAt) {
    const now = new Date();
    const hoursUntilAppointment = (this.scheduledAt.getTime() - now.getTime()) / (1000 * 60 * 60);
    return hoursUntilAppointment > 24; // Can reschedule if more than 24 hours before
  }

  return true;
};

// Pre-save middleware to set completion date
appointmentSchema.pre('save', function(next) {
  if (this.isModified('status') && this.status === 'COMPLETED' && !this.completedAt) {
    this.completedAt = new Date();
  }
  
  // Set expiry for pending appointments after 24 hours
  if (this.status === 'PENDING' && this.createdAt) {
    const hoursSinceCreation = (new Date().getTime() - this.createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceCreation > 24) {
      this.status = 'EXPIRED';
    }
  }
  
  next();
});

// Static method to get appointments within a date range
appointmentSchema.statics.getAppointmentsByDateRange = async function(
  vetId: Types.ObjectId,
  startDate: Date,
  endDate: Date
) {
  return await this.find({
    vetId,
    status: { $in: ['CONFIRMED', 'COMPLETED'] },
    scheduledAt: { $gte: startDate, $lte: endDate }
  }).sort({ scheduledAt: 1 });
};

// Static method to get vet's earnings by date
appointmentSchema.statics.getVetEarningsByDate = async function(
  vetId: Types.ObjectId,
  startDate: Date,
  endDate: Date
) {
  return await this.aggregate([
    {
      $match: {
        vetId,
        status: 'COMPLETED',
        completedAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$completedAt' },
          month: { $month: '$completedAt' },
          day: { $dayOfMonth: '$completedAt' }
        },
        totalEarnings: { $sum: '$vetEarned' },
        totalAppointments: { $sum: 1 }
      }
    },
    {
      $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
    }
  ]);
};

export default mongoose.model<IAppointment>('Appointment', appointmentSchema);