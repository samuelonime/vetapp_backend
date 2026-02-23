import axios from "axios";

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY as string;
const PAYSTACK_BASE_URL = "https://api.paystack.co";

if (!PAYSTACK_SECRET) {
  throw new Error("PAYSTACK_SECRET_KEY is missing in environment variables");
}

export const paystack = axios.create({
  baseURL: PAYSTACK_BASE_URL,
  headers: {
    Authorization: `Bearer ${PAYSTACK_SECRET}`,
    "Content-Type": "application/json",
  },
});

// Initialize payment
export const initializePayment = async (data: {
  email: string;
  amount: number;
  metadata?: any;
}) => {
  return await paystack.post("/transaction/initialize", data);
};

// Verify payment
export const verifyPayment = async (reference: string) => {
  return await paystack.get(`/transaction/verify/${reference}`);
};
