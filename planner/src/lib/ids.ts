import crypto from "node:crypto";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O/1/I/L — easy to read over the phone

export function shortCode(len = 6) {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export const orderCode = () => `AE-${shortCode(6)}`;
export const paymentReference = (orderCode: string) => `${orderCode}-${shortCode(5)}`.replace(/[^A-Z0-9-]/g, "");
export const secretToken = (bytes = 24) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}
