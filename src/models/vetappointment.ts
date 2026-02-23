import { Schema, model, Document } from 'mongoose';

interface IVetAppointment extends Document {
  vetId: string;
  userId: string;
  appointmentDate: Date;
  appointmentTime: string;
  duration: number;
  status: 'scheduled' | 'completed' | 'cancelled' | 'no-show';
  reason: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const vetAppointmentSchema = new Schema<IVetAppointment>(
  {
    vetId: {
      type: String,
      required: true,
      ref: 'Vet',
    },
    userId: {
      type: String,
      required: true,
      ref: 'User',
    },
    appointmentDate: {
      type: Date,
      required: true,
    },
    appointmentTime: {
      type: String,
      required: true,
    },
    duration: {
      type: Number,
      default: 30,
    },
    status: {
      type: String,
      enum: ['scheduled', 'completed', 'cancelled', 'no-show'],
      default: 'scheduled',
    },
    reason: {
      type: String,
      required: true,
    },
    notes: {
      type: String,
    },
  },
  { timestamps: true }
);

export default model<IVetAppointment>('VetAppointment', vetAppointmentSchema);