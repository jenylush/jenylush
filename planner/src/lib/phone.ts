/**
 * Nigerian phone numbers. Accepts 0803…, 803…, +234803…, 234803… and
 * normalises to E.164 (+234XXXXXXXXXX). Mobile numbers have 10 digits after the country code.
 */
export function normaliseNgPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = input.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("234")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  if (!/^[789][01]\d{8}$/.test(d)) return null;
  return `+234${d}`;
}

export const isNgPhone = (v: string) => normaliseNgPhone(v) !== null;

export function displayPhone(e164: string | null | undefined) {
  if (!e164) return "—";
  const m = e164.match(/^\+234(\d{3})(\d{3})(\d{4})$/);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : e164;
}

/** wa.me wants digits only, no plus. */
export const waNumber = (e164: string) => e164.replace(/\D/g, "");

export const NG_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River",
  "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT - Abuja", "Gombe", "Imo", "Jigawa", "Kaduna",
  "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun",
  "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara",
] as const;
