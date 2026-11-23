/** Central place to read integration settings. Secrets are only ever read on the server. */
export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

export const integrations = {
  paystack: () => !!process.env.PAYSTACK_SECRET_KEY,
  email: () => !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM,
  whatsapp: () => !!process.env.WHATSAPP_ACCESS_TOKEN && !!process.env.WHATSAPP_PHONE_NUMBER_ID,
  whatsappWebhook: () => !!process.env.WHATSAPP_VERIFY_TOKEN && !!process.env.WHATSAPP_APP_SECRET,
  storage: () => (process.env.STORAGE_DRIVER ?? "local") as "local" | "supabase",
};

export function integrationStatus() {
  return [
    {
      key: "paystack",
      name: "Paystack",
      purpose: "Guest card, bank transfer and USSD payments for Aso Ebi",
      connected: integrations.paystack(),
      env: ["PAYSTACK_SECRET_KEY", "PAYSTACK_PUBLIC_KEY"],
      webhook: `${appUrl()}/api/webhooks/paystack`,
    },
    {
      key: "email",
      name: "Resend (email)",
      purpose: "Payment reminders, receipts and confirmations",
      connected: integrations.email(),
      env: ["RESEND_API_KEY", "EMAIL_FROM"],
    },
    {
      key: "whatsapp",
      name: "WhatsApp Business Cloud API",
      purpose: "Template reminders, confirmations and delivery updates",
      connected: integrations.whatsapp(),
      env: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_TEMPLATE_REMINDER", "WHATSAPP_TEMPLATE_CONFIRMATION"],
      webhook: `${appUrl()}/api/webhooks/whatsapp`,
    },
    {
      key: "storage",
      name: integrations.storage() === "supabase" ? "Supabase Storage" : "Local file storage",
      purpose: "Receipts, contracts and fabric photos",
      connected: integrations.storage() === "local" || (!!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY),
      env: ["STORAGE_DRIVER", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_STORAGE_BUCKET"],
    },
  ];
}
