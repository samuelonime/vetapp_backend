import { AppointmentStatus } from "@prisma/client";

export interface TransformedAppointment {
  id: string;
  ownerId: string;
  vetId: string;
  dateTime: string;
  type: string;
  status: string;
  amount: number;
  commission: number;
  vetEarnings: number;
  notes?: string | null;
  diagnosis?: string | null;
  isPaid: boolean;
  userName?: string | null;
  vetName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransformedVet {
  id: string;
  userId: string;
  name: string;
  licenseNumber: string;
  specialties: string[];
  consultationFee: number;
  rating: number;
  totalReviews: number;
  email?: string | null;
  phone?: string | null;
  avatar?: string | null;
  experienceYears: number;
  isApproved: boolean;
  isFeatured: boolean;
  onlineStatus: boolean;
  totalEarnings: number;
  location?: any;
}

export interface TransformedUser {
  id: string;
  email: string;
  phone?: string | null;
  firstName: string;
  lastName: string;
  userType: string;
  avatar?: string | null;
  isVerified: boolean;
  isActive: boolean;
  isAdmin: boolean;
  location?: any;
  createdAt: string;
  updatedAt: string;
}

export class ResponseTransformer {
  // ----------------------------
  // Transform Appointment
  // ----------------------------
  static transformAppointment(appointment: any): TransformedAppointment {
    const status = this.transformStatus(appointment.status);

    return {
      id: appointment.id,
      ownerId: appointment.ownerId,
      vetId: appointment.vetId,
      dateTime: appointment.scheduledAt?.toISOString?.() || new Date().toISOString(),
      type: String(appointment.type || "CHAT").toLowerCase(),
      status,
      amount: appointment.totalAmount ?? appointment.consultationFee ?? 0,
      commission: appointment.platformFee ?? 0,
      vetEarnings: appointment.vetEarned ?? 0,
      notes: appointment.notes,
      diagnosis: appointment.diagnosis,
      isPaid: appointment.transaction?.paymentStatus === "COMPLETED",
      userName: appointment.owner ? `${appointment.owner.firstName} ${appointment.owner.lastName}` : undefined,
      vetName: appointment.vet ? `${appointment.vet.firstName} ${appointment.vet.lastName}` : undefined,
      createdAt: appointment.createdAt?.toISOString?.() || new Date().toISOString(),
      updatedAt: appointment.updatedAt?.toISOString?.() || new Date().toISOString(),
    };
  }

  // ----------------------------
  // Transform Vet
  // ----------------------------
  static transformVet(vet: any): TransformedVet {
    const u = vet.user || {};
    return {
      id: vet.id,
      userId: vet.userId,
      name: `${u.firstName || ""} ${u.lastName || ""}`.trim(),
      licenseNumber: vet.licenseNumber,
      specialties: vet.specialties || [],
      consultationFee: vet.consultationFee || 0,
      rating: vet.rating || 0,
      totalReviews: vet.totalReviews || 0,
      email: u.email,
      phone: u.phone,
      avatar: u.avatar,
      experienceYears: vet.experienceYears || 0,
      isApproved: vet.isApproved || false,
      isFeatured: vet.isFeatured || false,
      onlineStatus: vet.onlineStatus || false,
      totalEarnings: vet.totalEarnings || 0,
      location: u.location,
    };
  }

  // ----------------------------
  // Transform User
  // ----------------------------
  static transformUser(user: any): TransformedUser {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      userType: user.userType,
      avatar: user.avatar,
      isVerified: user.isVerified || false,
      isActive: user.isActive,
      isAdmin: user.userType === "ADMIN",
      location: user.location,
      createdAt: user.createdAt?.toISOString?.() || new Date().toISOString(),
      updatedAt: user.updatedAt?.toISOString?.() || new Date().toISOString(),
    };
  }

  // ----------------------------
  // Transform Subscription (matches schema)
  // ----------------------------
  static transformSubscription(subscription: any): any {
    return {
      id: subscription.id,
      vetId: subscription.vetId,
      tier: subscription.tier,
      status: subscription.status,
      amount: subscription.amount,
      startDate: subscription.startsAt?.toISOString?.(),
      endDate: subscription.expiresAt?.toISOString?.(),
      paymentReference: subscription.paymentReference,
      isActive: subscription.isActive,
      createdAt: subscription.createdAt?.toISOString?.(),
      updatedAt: subscription.updatedAt?.toISOString?.(),
    };
  }

  // ----------------------------
  // Transform Payment / Transaction
  // ----------------------------
  static transformPayment(transaction: any): any {
    return {
      id: transaction.id,
      appointmentId: transaction.appointmentId,
      subscriptionId: transaction.subscriptionId,
      userId: transaction.userId,
      vetId: transaction.vetId,
      amount: transaction.amount,
      commission: transaction.platformFee,
      status: transaction.paymentStatus,
      reference: transaction.paymentReference,
      createdAt: transaction.createdAt?.toISOString?.(),
      updatedAt: transaction.updatedAt?.toISOString?.(),
    };
  }

  // ----------------------------
  // Transform Notification
  // ----------------------------
  static transformNotification(notification: any): any {
    return {
      id: notification.id,
      userId: notification.userId,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      isRead: notification.isRead,
      data: notification.data,
      createdAt: notification.createdAt?.toISOString?.(),
    };
  }

  // ----------------------------
  // Transform Review
  // ----------------------------
  static transformReview(review: any): any {
    return {
      id: review.id,
      appointmentId: review.appointmentId,
      ownerId: review.ownerId,
      vetId: review.vetId,
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt?.toISOString?.(),
      updatedAt: review.updatedAt?.toISOString?.(),
    };
  }

  // ----------------------------
  // Transform Status — FIXED
  // ----------------------------
  private static transformStatus(status: AppointmentStatus | string): string {
    if (!status) return "pending";
    return String(status).toLowerCase();
  }
}