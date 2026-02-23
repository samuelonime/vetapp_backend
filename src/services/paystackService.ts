import axios from 'axios';
import dotenv from 'dotenv';
import logger from '../utils/logger';

dotenv.config();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;
const PAYSTACK_BASE_URL = process.env.PAYSTACK_BASE_URL!;

const paystack = axios.create({
  baseURL: PAYSTACK_BASE_URL,
  headers: {
    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json'
  },
  timeout: 30000
});

export class PaystackService {
  // Initialize transaction
  static async initializeTransaction(data: {
    email: string;
    amount: number;
    metadata?: any;
    callback_url?: string;
    channels?: string[];
  }): Promise<any> {
    try {
      logger.info('Initializing Paystack transaction', data);
      
      const response = await paystack.post('/transaction/initialize', {
        email: data.email,
        amount: data.amount,
        metadata: data.metadata,
        callback_url: data.callback_url,
        channels: data.channels || ['card', 'bank', 'ussd', 'qr', 'mobile_money']
      });

      logger.info('Paystack transaction initialized', response.data);
      return response.data;
    } catch (error: any) {
      logger.error('Paystack initialization error:', error.response?.data || error.message);
      throw new Error(`Paystack initialization failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // Verify transaction
  static async verifyTransaction(reference: string): Promise<any> {
    try {
      logger.info('Verifying Paystack transaction', { reference });
      
      const response = await paystack.get(`/transaction/verify/${reference}`);
      
      logger.info('Paystack transaction verified', response.data);
      return response.data;
    } catch (error: any) {
      logger.error('Paystack verification error:', error.response?.data || error.message);
      throw new Error(`Paystack verification failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // Create subscription plan
  static async createPlan(data: {
    name: string;
    amount: number;
    interval: 'daily' | 'weekly' | 'monthly' | 'biannually' | 'annually';
    currency?: string;
  }): Promise<any> {
    try {
      logger.info('Creating Paystack plan', data);
      
      const response = await paystack.post('/plan', {
        name: data.name,
        amount: data.amount * 100, // Convert to kobo
        interval: data.interval,
        currency: data.currency || 'NGN'
      });

      logger.info('Paystack plan created', response.data);
      return response.data;
    } catch (error: any) {
      logger.error('Paystack plan creation error:', error.response?.data || error.message);
      throw new Error(`Paystack plan creation failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // Create subscription
  static async createSubscription(data: {
    customer: string;
    plan: string;
    authorization?: string;
  }): Promise<any> {
    try {
      logger.info('Creating Paystack subscription', data);
      
      const response = await paystack.post('/subscription', {
        customer: data.customer,
        plan: data.plan,
        authorization: data.authorization
      });

      logger.info('Paystack subscription created', response.data);
      return response.data;
    } catch (error: any) {
      logger.error('Paystack subscription error:', error.response?.data || error.message);
      throw new Error(`Paystack subscription failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // Create transfer recipient
  static async createTransferRecipient(data: {
    type: string;
    name: string;
    account_number: string;
    bank_code: string;
    currency?: string;
  }): Promise<any> {
    try {
      logger.info('Creating Paystack transfer recipient', data);
      
      const response = await paystack.post('/transferrecipient', {
        type: data.type,
        name: data.name,
        account_number: data.account_number,
        bank_code: data.bank_code,
        currency: data.currency || 'NGN'
      });

      logger.info('Paystack transfer recipient created', response.data);
      return response.data;
    } catch (error: any) {
      logger.error('Paystack transfer recipient error:', error.response?.data || error.message);
      throw new Error(`Paystack transfer recipient failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // Initiate transfer
  static async initiateTransfer(data: {
    source: string;
    amount: number;
    recipient: string;
    reason?: string;
  }): Promise<any> {
    try {
      logger.info('Initiating Paystack transfer', data);
      
      const response = await paystack.post('/transfer', {
        source: data.source,
        amount: data.amount * 100, // Convert to kobo
        recipient: data.recipient,
        reason: data.reason || 'Payout'
      });

      logger.info('Paystack transfer initiated', response.data);
      return response.data;
    } catch (error: any) {
      logger.error('Paystack transfer error:', error.response?.data || error.message);
      throw new Error(`Paystack transfer failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // Resolve account number
  static async resolveAccountNumber(accountNumber: string, bankCode: string): Promise<any> {
    try {
      logger.info('Resolving account number', { accountNumber, bankCode });
      
      const response = await paystack.get(`/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);
      
      logger.info('Account resolved', response.data);
      return response.data;
    } catch (error: any) {
      logger.error('Account resolution error:', error.response?.data || error.message);
      throw new Error(`Account resolution failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // List banks
  static async listBanks(): Promise<any> {
    try {
      logger.info('Fetching banks list');
      
      const response = await paystack.get('/bank');
      
      logger.info('Banks fetched', { count: response.data.data.length });
      return response.data;
    } catch (error: any) {
      logger.error('Banks fetch error:', error.response?.data || error.message);
      throw new Error(`Banks fetch failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // Create customer
  static async createCustomer(data: {
    email: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
  }): Promise<any> {
    try {
      logger.info('Creating Paystack customer', data);
      
      const response = await paystack.post('/customer', {
        email: data.email,
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone
      });

      logger.info('Paystack customer created', response.data);
      return response.data;
    } catch (error: any) {
      logger.error('Paystack customer creation error:', error.response?.data || error.message);
      throw new Error(`Paystack customer creation failed: ${error.response?.data?.message || error.message}`);
    }
  }
}