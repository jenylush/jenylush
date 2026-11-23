/** Central place to read integration settings. Secrets are only ever read on the server. */
export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

export const integrations = {
  email: () => !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM,
  storage: () => (process.env.STORAGE_DRIVER ?? "local") as "local" | "supabase",
};

export function integrationStatus() {
  return [
    {
      key: "email",
      name: "Resend (email)",
      purpose: "Payment reminders, receipts and confirmations",
      connected: integrations.email(),
      env: ["RESEND_API_KEY", "EMAIL_FROM"],
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
