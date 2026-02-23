import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IReview extends Document {
  appointmentId: Types.ObjectId;
  ownerId: Types.ObjectId;
  vetId: Types.ObjectId;
  rating: number;
  comment?: string;
  categories: Array<{
    category: string;
    rating: number;
  }>;
  anonymous: boolean;
  vetReply?: string;
  vetReplyAt?: Date;
  helpful: Types.ObjectId[];
  reported: boolean;
  reportReason?: string;
  reportedBy?: Types.ObjectId;
  reportResolved: boolean;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const reviewSchema = new Schema<IReview>({
  appointmentId: {
    type: Schema.Types.ObjectId,
    ref: 'Appointment',
    required: true,
    unique: true
  },
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
  rating: {
    type: Number,
    required: true,
    min: [1, 'Rating must be at least 1'],
    max: [5, 'Rating cannot exceed 5']
  },
  comment: {
    type: String,
    trim: true,
    maxlength: [1000, 'Comment cannot exceed 1000 characters']
  },
  categories: [{
    category: {
      type: String,
      enum: ['PROFESSIONALISM', 'KNOWLEDGE', 'COMMUNICATION', 'TIMELINESS', 'BEDISIDE_MANNER']
    },
    rating: {
      type: Number,
      min: 1,
      max: 5
    }
  }],
  anonymous: {
    type: Boolean,
    default: false
  },
  vetReply: {
    type: String,
    trim: true,
    maxlength: [500, 'Reply cannot exceed 500 characters']
  },
  vetReplyAt: {
    type: Date
  },
  helpful: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  reported: {
    type: Boolean,
    default: false
  },
  reportReason: {
    type: String,
    trim: true
  },
  reportedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  reportResolved: {
    type: Boolean,
    default: false
  },
  isVerified: {
    type: Boolean,
    default: false // Verified if from completed appointment
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
reviewSchema.index({ vetId: 1 });
reviewSchema.index({ ownerId: 1 });
reviewSchema.index({ appointmentId: 1 });
reviewSchema.index({ rating: 1 });
reviewSchema.index({ createdAt: -1 });
reviewSchema.index({ vetId: 1, rating: 1 });
reviewSchema.index({ vetId: 1, createdAt: -1 });
reviewSchema.index({ isVerified: 1 });
reviewSchema.index({ reported: 1, reportResolved: 1 });

// Virtual populate for owner (with conditional anonymity)
reviewSchema.virtual('owner', {
  ref: 'User',
  localField: 'ownerId',
  foreignField: '_id',
  justOne: true,
  options: {
    transform: function(doc: any, ret: any) {
      if (doc.anonymous) {
        return {
          _id: ret._id,
          firstName: 'Anonymous',
          lastName: 'User',
          avatar: null
        };
      }
      return ret;
    }
  }
});

// Virtual populate for vet
reviewSchema.virtual('vet', {
  ref: 'Vet',
  localField: 'vetId',
  foreignField: '_id',
  justOne: true
});

// Virtual populate for appointment
reviewSchema.virtual('appointment', {
  ref: 'Appointment',
  localField: 'appointmentId',
  foreignField: '_id',
  justOne: true
});

// Virtual for helpful count
reviewSchema.virtual('helpfulCount').get(function() {
  return this.helpful?.length || 0;
});

/// Virtual to check if user found it helpful
reviewSchema.methods.isHelpfulBy = function(userId: Types.ObjectId): boolean {
  const userIdStr = userId.toString();
  return (this.helpful as any[])?.some((id: any) => {
    if (typeof id === 'string') {
      return id === userIdStr;
    } else if (id && typeof id.toString === 'function') {
      return id.toString() === userIdStr;
    }
    return false;
  }) || false;
};

// Method to toggle helpful
reviewSchema.methods.toggleHelpful = async function(userId: Types.ObjectId) {
  const userIdStr = userId.toString();
  const helpfulArray = (this.helpful || []) as any[];
  
  const index = helpfulArray.findIndex((id: any) => {
    if (typeof id === 'string') {
      return id === userIdStr;
    } else if (id && typeof id.toString === 'function') {
      return id.toString() === userIdStr;
    }
    return false;
  });
  
  if (index > -1) {
    // Remove if already marked helpful
    helpfulArray.splice(index, 1);
  } else {
    // Add if not marked helpful
    helpfulArray.push(userId);
  }
  
  this.helpful = helpfulArray;
  await this.save();
  return helpfulArray.length;
};
// Method to add vet reply
reviewSchema.methods.addVetReply = async function(reply: string) {
  this.vetReply = reply;
  this.vetReplyAt = new Date();
  await this.save();
};

// Method to report review
reviewSchema.methods.report = async function(userId: Types.ObjectId, reason: string) {
  this.reported = true;
  this.reportReason = reason;
  this.reportedBy = userId;
  await this.save();
};

// Method to resolve report
reviewSchema.methods.resolveReport = async function() {
  this.reportResolved = true;
  await this.save();
};

// Static method to calculate average rating for vet
reviewSchema.statics.calculateVetRating = async function(vetId: Types.ObjectId) {
  const result = await this.aggregate([
    {
      $match: {
        vetId,
        reported: false // Exclude reported reviews
      }
    },
    {
      $group: {
        _id: '$vetId',
        averageRating: { $avg: '$rating' },
        totalReviews: { $sum: 1 },
        ratingDistribution: {
          $push: '$rating'
        }
      }
    },
    {
      $project: {
        averageRating: { $round: ['$averageRating', 1] },
        totalReviews: 1,
        ratingDistribution: {
          1: { $size: { $filter: { input: '$ratingDistribution', as: 'rating', cond: { $eq: ['$$rating', 1] } } } },
          2: { $size: { $filter: { input: '$ratingDistribution', as: 'rating', cond: { $eq: ['$$rating', 2] } } } },
          3: { $size: { $filter: { input: '$ratingDistribution', as: 'rating', cond: { $eq: ['$$rating', 3] } } } },
          4: { $size: { $filter: { input: '$ratingDistribution', as: 'rating', cond: { $eq: ['$$rating', 4] } } } },
          5: { $size: { $filter: { input: '$ratingDistribution', as: 'rating', cond: { $eq: ['$$rating', 5] } } } }
        }
      }
    }
  ]);

  return result[0] || {
    averageRating: 0,
    totalReviews: 0,
    ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  };
};

// Pre-save middleware to ensure rating is integer
reviewSchema.pre('save', function(next) {
  if (this.rating) {
    this.rating = Math.round(this.rating);
  }
  
  // Auto-verify if from appointment
  if (this.appointmentId && !this.isVerified) {
    this.isVerified = true;
  }
  
  next();
});

export default mongoose.model<IReview>('Review', reviewSchema);