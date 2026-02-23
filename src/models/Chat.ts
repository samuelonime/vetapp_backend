import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IChatMessage extends Document {
  appointmentId: Types.ObjectId;
  senderId: Types.ObjectId;
  receiverId: Types.ObjectId;
  message: string;
  mediaUrl?: string;
  mediaType?: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'AUDIO';
  fileName?: string;
  fileSize?: number;
  isRead: boolean;
  readAt?: Date;
  delivered: boolean;
  deliveredAt?: Date;
  messageType: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'AUDIO' | 'SYSTEM';
  metadata?: {
    appointmentStatus?: string;
    paymentStatus?: string;
    amount?: number;
  };
  replyTo?: Types.ObjectId;
  reactions?: Array<{
    userId: Types.ObjectId;
    emoji: string;
    createdAt: Date;
  }>;
  deletedFor?: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const chatMessageSchema = new Schema<IChatMessage>({
  appointmentId: {
    type: Schema.Types.ObjectId,
    ref: 'Appointment',
    required: true,
    index: true
  },
  senderId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  receiverId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  message: {
    type: String,
    trim: true,
    maxlength: [2000, 'Message cannot exceed 2000 characters']
  },
  mediaUrl: {
    type: String,
    trim: true
  },
  mediaType: {
    type: String,
    enum: ['IMAGE', 'VIDEO', 'DOCUMENT', 'AUDIO']
  },
  fileName: {
    type: String,
    trim: true
  },
  fileSize: {
    type: Number,
    min: 0
  },
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date
  },
  delivered: {
    type: Boolean,
    default: false
  },
  deliveredAt: {
    type: Date
  },
  messageType: {
    type: String,
    enum: ['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'AUDIO', 'SYSTEM'],
    default: 'TEXT'
  },
  metadata: {
    appointmentStatus: String,
    paymentStatus: String,
    amount: Number
  },
  replyTo: {
    type: Schema.Types.ObjectId,
    ref: 'ChatMessage'
  },
  reactions: [{
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    emoji: String,
    createdAt: { type: Date, default: Date.now }
  }],
  deletedFor: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
chatMessageSchema.index({ appointmentId: 1, createdAt: -1 });
chatMessageSchema.index({ senderId: 1, createdAt: -1 });
chatMessageSchema.index({ receiverId: 1, createdAt: -1 });
chatMessageSchema.index({ isRead: 1 });
chatMessageSchema.index({ delivered: 1 });
chatMessageSchema.index({ appointmentId: 1, isRead: 1 });
chatMessageSchema.index({ appointmentId: 1, receiverId: 1, isRead: 1 });
chatMessageSchema.index({ createdAt: -1 });

// Compound index for unread messages query
chatMessageSchema.index({ receiverId: 1, isRead: 1, appointmentId: 1 });

// Virtual populate for sender
chatMessageSchema.virtual('sender', {
  ref: 'User',
  localField: 'senderId',
  foreignField: '_id',
  justOne: true
});

// Virtual populate for receiver
chatMessageSchema.virtual('receiver', {
  ref: 'User',
  localField: 'receiverId',
  foreignField: '_id',
  justOne: true
});

// Virtual populate for appointment
chatMessageSchema.virtual('appointment', {
  ref: 'Appointment',
  localField: 'appointmentId',
  foreignField: '_id',
  justOne: true
});

// Virtual populate for replied message
chatMessageSchema.virtual('repliedMessage', {
  ref: 'ChatMessage',
  localField: 'replyTo',
  foreignField: '_id',
  justOne: true
});

// Method to check if message is visible to user
chatMessageSchema.methods.isVisibleTo = function(userId: Types.ObjectId): boolean {
  return !this.deletedFor?.includes(userId);
};

// Method to mark as delivered
chatMessageSchema.methods.markAsDelivered = async function() {
  this.delivered = true;
  this.deliveredAt = new Date();
  await this.save();
};

// Method to mark as read
chatMessageSchema.methods.markAsRead = async function() {
  this.isRead = true;
  this.readAt = new Date();
  await this.save();
};

// Static method to get unread count
chatMessageSchema.statics.getUnreadCount = async function(
  userId: Types.ObjectId,
  appointmentId?: Types.ObjectId
) {
  const match: any = {
    receiverId: userId,
    isRead: false
  };

  if (appointmentId) {
    match.appointmentId = appointmentId;
  }

  return await this.countDocuments(match);
};

// Static method to get conversation between users
chatMessageSchema.statics.getConversation = async function(
  appointmentId: Types.ObjectId,
  userId: Types.ObjectId,
  limit: number = 50,
  before?: Date
) {
  const query: any = {
    appointmentId,
    deletedFor: { $ne: userId }
  };

  if (before) {
    query.createdAt = { $lt: before };
  }

  return await this.find(query)
    .populate('sender', 'firstName lastName avatar userType')
    .populate('receiver', 'firstName lastName avatar userType')
    .populate({
      path: 'repliedMessage',
      select: 'message senderId messageType mediaUrl',
      populate: {
        path: 'sender',
        select: 'firstName lastName'
      }
    })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

// Pre-save middleware to set message type
chatMessageSchema.pre('save', function(next) {
  if (this.mediaUrl) {
    if (!this.messageType || this.messageType === 'TEXT') {
      this.messageType = this.mediaType || 'IMAGE';
    }
  }
  
  if (this.metadata) {
    this.messageType = 'SYSTEM';
  }
  
  next();
});

export default mongoose.model<IChatMessage>('ChatMessage', chatMessageSchema);