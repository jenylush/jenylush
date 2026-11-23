import crypto from "node:crypto";

/**
 * Paystack adapter. The PaymentProvider interface is what the rest of the app depends on,
 * so a Flutterwave adapter can be added later without touching the order logic.
 */
export interface VerifiedTransaction {
  reference: string;
  status: "success" | "failed" | "abandoned" | "pending" | "reversed";
  amount: number; // kobo
  currency: string;
  channel: string | null;
  gatewayResponse: string | null;
  paidAt: string | null;
  raw: unknown;
}

export interface PaymentProvider {
  name: string;
  configured(): boolean;
  initialize(input: {
    email: string;
    amount: number;
    reference: string;
    callbackUrl: string;
    metadata: Record<string, unknown>;
  }): Promise<{ authorizationUrl: string; accessCode: string }>;
  verify(reference: string): Promise<VerifiedTransaction>;
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean;
}

const base = () => (process.env.PAYSTACK_BASE_URL || "https://api.paystack.co").replace(/\/$/, "");
const secret = () => {
  const s = process.env.PAYSTACK_SECRET_KEY;
  if (!s) throw new PaymentNotConfiguredError();
  return s;
};

export class PaymentNotConfiguredError extends Error {
  constructor() {
    super("Online payments are not connected yet. The couple needs to add their Paystack keys.");
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secret()}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as { status: boolean; message: string; data: T } | null;
  if (!res.ok || !body?.status) throw new Error(`Paystack: ${body?.message ?? `HTTP ${res.status}`}`);
  return body.data;
}

function mapStatus(s: string): VerifiedTransaction["status"] {
  if (s === "success") return "success";
  if (s === "failed") return "failed";
  if (s === "abandoned") return "abandoned";
  if (s === "reversed") return "reversed";
  return "pending"; // ongoing | pending | processing | queued
}

export const paystack: PaymentProvider = {
  name: "paystack",
  configured: () => !!process.env.PAYSTACK_SECRET_KEY,
  async initialize({ email, amount, reference, callbackUrl, metadata }) {
    const data = await call<{ authorization_url: string; access_code: string; reference: string }>("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email,
        amount,
        reference,
        currency: "NGN",
        callback_url: callbackUrl,
        channels: ["card", "bank", "bank_transfer", "ussd", "mobile_money", "qr"],
        metadata,
      }),
    });
    return { authorizationUrl: data.authorization_url, accessCode: data.access_code };
  },
  async verify(reference) {
    const d = await call<{
      reference: string;
      status: string;
      amount: number;
      currency: string;
      channel: string | null;
      gateway_response: string | null;
      paid_at: string | null;
    }>(`/transaction/verify/${encodeURIComponent(reference)}`);
    return {
      reference: d.reference,
      status: mapStatus(d.status),
      amount: d.amount,
      currency: d.currency,
      channel: d.channel,
      gatewayResponse: d.gateway_response,
      paidAt: d.paid_at,
      raw: d,
    };
  },
  /** x-paystack-signature = HMAC-SHA512(raw body, secret key) */
  verifyWebhookSignature(rawBody, signature) {
    const key = process.env.PAYSTACK_SECRET_KEY;
    if (!key || !signature) return false;
    const expected = crypto.createHmac("sha512", key).update(rawBody).digest("hex");
    return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  },
};

export const paymentProvider = (): PaymentProvider => paystack;
