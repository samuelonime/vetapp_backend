import dotenv from 'dotenv';

dotenv.config();


export class CommissionService {
  private static platformCommission = parseFloat(process.env.PLATFORM_COMMISSION || '0.15');
  private static videoCallFee = parseFloat(process.env.VIDEO_CALL_FEE || '500');
  private static minimumConsultationFee = parseFloat(process.env.MINIMUM_CONSULTATION_FEE || '1000');
  private static maximumConsultationFee = parseFloat(process.env.MAXIMUM_CONSULTATION_FEE || '50000');

  // Calculate earnings with commission - UPDATED
  static calculateEarnings(amount: number, vetTier: string): {
    totalAmount: number; // ✅ Added
    vetEarns: number;
    platformEarns: number;
    commissionRate: number;
  } {
    // Validate amount
    if (amount < this.minimumConsultationFee) {
      throw new Error(`Amount must be at least ₦${this.minimumConsultationFee}`);
    }

    if (amount > this.maximumConsultationFee) {
      throw new Error(`Amount cannot exceed ₦${this.maximumConsultationFee}`);
    }

    let commissionRate = this.platformCommission;
    
    // Apply tier-based commission rates
    switch(vetTier) {
      case 'PRO':
        commissionRate = 0.10; // 10%
        break;
      case 'ENTERPRISE':
        commissionRate = 0.08; // 8%
        break;
      case 'FREE':
        commissionRate = 0.25; // 25%
        break;
      default:
        commissionRate = this.platformCommission;
    }

    const platformEarns = amount * commissionRate;
    const vetEarns = amount - platformEarns;

    return {
      totalAmount: amount, // ✅ Added
      vetEarns: parseFloat(vetEarns.toFixed(2)),
      platformEarns: parseFloat(platformEarns.toFixed(2)),
      commissionRate
    };
  }

  // Calculate video call charges - FIXED
  static calculateVideoCallCharges(vetFee: number, vetTier: string): {
    totalAmount: number;
    vetEarns: number;
    platformEarns: number;
    videoCallFee: number;
    consultationEarnings: any; // Added for reference
  } {
    // Calculate base consultation earnings with actual tier
    const consultationEarnings = this.calculateEarnings(vetFee, vetTier);
    
    // Video call fee is an additional charge
    // Platform should get commission from video call fee too
    const videoCallCommissionRate = this.getCommissionRateForTier(vetTier);
    const videoCallPlatformEarns = this.videoCallFee * videoCallCommissionRate;
    const videoCallVetEarns = this.videoCallFee - videoCallPlatformEarns;
    
    const totalAmount = vetFee + this.videoCallFee;
    const totalVetEarns = consultationEarnings.vetEarns + videoCallVetEarns;
    const totalPlatformEarns = consultationEarnings.platformEarns + videoCallPlatformEarns;

    return {
      totalAmount: parseFloat(totalAmount.toFixed(2)),
      vetEarns: parseFloat(totalVetEarns.toFixed(2)),
      platformEarns: parseFloat(totalPlatformEarns.toFixed(2)),
      videoCallFee: this.videoCallFee,
      consultationEarnings // For reference
    };
  }

  // Helper method to get commission rate for tier
  private static getCommissionRateForTier(vetTier: string): number {
    switch(vetTier) {
      case 'PRO':
        return 0.10;
      case 'ENTERPRISE':
        return 0.08;
      case 'FREE':
        return 0.25;
      default:
        return this.platformCommission;
    }
  }

  // Calculate subscription commission - FIXED
  static calculateSubscriptionCommission(amount: number): {
    totalAmount: number; // ✅ Added
    platformEarns: number;
    vetEarns: number;
  } {
    // Platform takes 20% of subscription fee
    const platformCommission = 0.20;
    const platformEarns = amount * platformCommission;
    const vetEarns = amount - platformEarns;

    return {
      totalAmount: amount, // ✅ Added
      platformEarns: parseFloat(platformEarns.toFixed(2)),
      vetEarns: parseFloat(vetEarns.toFixed(2))
    };
  }


  // Calculate promotion fee
  static calculatePromotionFee(durationDays: number): number {
    const dailyRate = parseFloat(process.env.FEATURED_PROMOTION_AMOUNT || '3000') / 30;
    return parseFloat((dailyRate * durationDays).toFixed(2));
  }

  // Get tier pricing
  static getTierPricing(tier: string): number {
    switch(tier) {
      case 'PRO':
        return parseFloat(process.env.PRO_PLAN_AMOUNT || '5000');
      case 'ENTERPRISE':
        return parseFloat(process.env.ENTERPRISE_PLAN_AMOUNT || '15000');
      default:
        return 0;
    }
  }

  // Validate consultation fee
  static validateConsultationFee(fee: number): boolean {
    return fee >= this.minimumConsultationFee && fee <= this.maximumConsultationFee;
  }

  // Get commission rates for display
  static getCommissionRates(): {
    free: number;
    pro: number;
    enterprise: number;
    videoCallFee: number;
  } {
    return {
      free: 0.25,
      pro: 0.10,
      enterprise: 0.08,
      videoCallFee: this.videoCallFee
    };
  }

  // Calculate total appointment amount
  static calculateTotalAmount(consultationFee: number, type: string): number {
    const baseAmount = consultationFee;
    
    if (type === 'VIDEO') {
      return baseAmount + this.videoCallFee;
    }
    
    return baseAmount;
  }
}