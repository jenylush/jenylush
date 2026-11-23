import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Owambe Ledger — wedding budgets & Aso Ebi, beautifully kept", template: "%s · Owambe Ledger" },
  description: "Plan your Nigerian wedding budget, track vendor instalments, and collect Aso Ebi orders and payments in one private workspace.",
};
export const viewport: Viewport = { themeColor: "#2A2725", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NG">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
