/**
 * Demo workspace: Adaeze & Tunde, ₦15m budget. Dates are relative to today so the
 * dashboard always has something due soon, something overdue and orders in every state.
 *
 * Login: demo@owambe.ng / demo-wedding
 *
 * Aso Ebi payments are bank transfers: guests tap "I have sent the money", then the couple
 * confirms. The demo includes confirmed, reported-awaiting-confirmation and unpaid orders.
 */
import "./load-env";
import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as s from "../src/db/schema";
import { DEFAULT_CATEGORIES } from "../src/lib/defaults";
import { addDays, todayISO } from "../src/lib/dates";
import crypto from "node:crypto";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema: s });
const N = (naira: number) => naira * 100;
const T = todayISO();
const d = (n: number) => addDays(T, n);
const tok = (n = 18) => crypto.randomBytes(n).toString("base64url");
const code = () => "AE-" + Array.from(crypto.randomBytes(6), (b) => "23456789ABCDEFGHJKMNPQRSTUVWXYZ"[b % 31]).join("");

const existing = await db.select().from(s.users).where(eq(s.users.email, "demo@owambe.ng"));
if (existing.length) {
  console.log("Demo data already present — run `npm run db:reset` to start fresh.");
  await pool.end();
  process.exit(0);
}

const [user] = await db.insert(s.users).values({ email: "demo@owambe.ng", name: "Adaeze Okafor", phone: "+2348031234567", passwordHash: await bcrypt.hash("demo-wedding", 12) }).returning();
await db.insert(s.users).values({ email: "tunde@owambe.ng", name: "Tunde Bakare", phone: "+2348059876543", passwordHash: await bcrypt.hash("demo-wedding", 12) });

const [w] = await db
  .insert(s.weddings)
  .values({
    partnerOneName: "Adaeze",
    partnerTwoName: "Tunde",
    partnerOneEmail: "demo@owambe.ng",
    partnerTwoEmail: "tunde@owambe.ng",
    partnerOnePhone: "+2348031234567",
    partnerTwoPhone: "+2348059876543",
    weddingDate: d(82),
    traditionalDate: d(80),
    whiteWeddingDate: d(82),
    venue: "Harbour Point, Victoria Island",
    city: "Lagos",
    estimatedGuests: 450,
    totalBudget: N(15_000_000),
    onboardedAt: new Date(),
  })
  .returning();
const [tunde] = await db.select().from(s.users).where(eq(s.users.email, "tunde@owambe.ng"));
await db.insert(s.memberships).values([{ userId: user.id, weddingId: w.id, role: "owner" }, { userId: tunde.id, weddingId: w.id, role: "partner" }]);

const cats = await db.insert(s.categories).values(DEFAULT_CATEGORIES.map((c, i) => ({ weddingId: w.id, name: c.name, color: c.color, sortOrder: i, allocated: Math.round((N(15_000_000) * c.share) / 100) }))).returning();
const cat = (name: string) => cats.find((c) => c.name === name)!.id;

const evs = await db
  .insert(s.events)
  .values([
    { weddingId: w.id, name: "Introduction", type: "introduction" as const, date: d(27), venue: "Family house, Enugu", budget: N(1_200_000), sortOrder: 0 },
    { weddingId: w.id, name: "Traditional wedding", type: "traditional" as const, date: d(80), venue: "Eko Hotel Gardens", budget: N(5_000_000), sortOrder: 1 },
    { weddingId: w.id, name: "White wedding", type: "white" as const, date: d(82), venue: "Our Saviour's Church, Ikoyi", budget: N(1_500_000), sortOrder: 2 },
    { weddingId: w.id, name: "Reception", type: "reception" as const, date: d(82), venue: "Harbour Point, Victoria Island", budget: N(7_300_000), sortOrder: 3 },
  ])
  .returning();
const ev = (name: string) => evs.find((e) => e.name === name)!.id;

type V = { name: string; category: string; contact: string; phone: string; email?: string; address?: string; event: string; price: number; plan: Array<[string, number, number, boolean]>; notes?: string };
const vendorSpecs: V[] = [
  { name: "Harbour Point", category: "Venue", contact: "Mrs. Folake Adeyemi", phone: "+2348023456789", email: "events@harbourpoint.ng", address: "4 Wilmot Point Rd, Victoria Island, Lagos", event: "Reception", price: 3_500_000, plan: [["Booking deposit", 1_750_000, -120, true], ["Balance", 1_750_000, -10, true]] },
  { name: "Lens & Lace Studio", category: "Photography", contact: "Kunle Ajayi", phone: "+2348091112233", email: "hello@lensandlace.ng", address: "12 Admiralty Way, Lekki Phase 1", event: "Reception", price: 500_000, plan: [["First instalment", 200_000, -30, true], ["Second instalment", 150_000, 3, false], ["Final payment", 150_000, 40, false]], notes: "Includes pre-wedding shoot and 2 photo albums." },
  { name: "Mama Cass Events Catering", category: "Catering & food", contact: "Chioma Nwosu", phone: "+2348034445566", email: "bookings@mamacass.ng", event: "Reception", price: 2_850_000, plan: [["Deposit", 950_000, -60, true], ["Second", 950_000, -14, true], ["Final", 950_000, 20, false]], notes: "450 guests · jollof, fried rice, small chops, pepper soup." },
  { name: "Petals & Gold Décor", category: "Decoration", contact: "Ifeoma Eze", phone: "+2348067778899", event: "Reception", price: 1_800_000, plan: [["Deposit", 600_000, -45, true], ["Second instalment", 600_000, -2, false], ["Balance", 600_000, 30, false]] },
  { name: "DJ Spinall-esque Sounds", category: "Entertainment / DJ", contact: "Femi Lawal", phone: "+2348120001122", event: "Reception", price: 450_000, plan: [["Full payment", 450_000, 45, false]] },
  { name: "MC Bovi-ish", category: "MC", contact: "Seyi Ogun", phone: "+2347031239876", event: "Reception", price: 300_000, plan: [["Deposit", 150_000, -20, true], ["Balance", 150_000, 60, false]] },
  { name: "Glam by Temi", category: "Makeup", contact: "Temi Alade", phone: "+2348145556677", event: "Traditional wedding", price: 250_000, plan: [["Deposit", 100_000, -15, true], ["Balance", 150_000, 75, false]] },
  { name: "Sugar Rush Cakes", category: "Cake", contact: "Bisi Coker", phone: "+2348056667788", event: "Reception", price: 180_000, plan: [["Full payment", 180_000, 7, false]] },
  { name: "Royal Rides Lagos", category: "Transportation", contact: "Emeka Obi", phone: "+2349012223344", event: "White wedding", price: 220_000, plan: [] },
];

for (const v of vendorSpecs) {
  const [row] = await db.insert(s.vendors).values({ weddingId: w.id, categoryId: cat(v.category), name: v.name, contactName: v.contact, phone: v.phone, email: v.email ?? null, address: v.address ?? null, notes: v.notes ?? null }).returning();
  const [e] = await db
    .insert(s.expenses)
    .values({ weddingId: w.id, vendorId: row.id, categoryId: cat(v.category), eventId: ev(v.event), name: `${v.name} — contract`, estimatedCost: N(v.price), actualCost: N(v.price), dueDate: v.plan.length ? null : d(50) })
    .returning();
  for (const [i, [label, amt, due, paid]] of v.plan.entries()) {
    const [inst] = await db.insert(s.instalments).values({ weddingId: w.id, expenseId: e.id, label, amount: N(amt), dueDate: d(due), sortOrder: i }).returning();
    if (paid) await db.insert(s.expensePayments).values({ weddingId: w.id, expenseId: e.id, instalmentId: inst.id, amount: N(amt), paidOn: d(due - 1), method: "transfer", reference: `TRF${Math.floor(Math.random() * 1e8)}`, recordedBy: user.id });
  }
}

// Non-vendor expenses
const loose: Array<[string, string, string, number, number | null, number, number | null]> = [
  // name, category, event, estimate, actual, paid, dueInDays
  ["Drinks — Chapman, Zobo, champagne", "Drinks", "Reception", 1_200_000, null, 0, 70],
  ["Bride's reception gown", "Wedding outfits", "Reception", 900_000, 950_000, 500_000, 35],
  ["Groom's agbada & cap", "Wedding outfits", "Traditional wedding", 350_000, 380_000, 380_000, null],
  ["Couple's Aso Ebi (own)", "Aso Ebi", "Traditional wedding", 140_000, 140_000, 140_000, null],
  ["Printed invitations (400)", "Invitations", "Reception", 120_000, 115_000, 115_000, null],
  ["Souvenirs — branded fans & mugs", "Gifts & souvenirs", "Reception", 450_000, null, 0, 50],
  ["Hotel rooms for family (6 nights)", "Accommodation", "Traditional wedding", 420_000, null, 0, 60],
  ["Introduction — kola, drinks & food", "Logistics", "Introduction", 600_000, null, 250_000, 25],
];
for (const [name, c, e, est, act, paid, due] of loose) {
  const [x] = await db.insert(s.expenses).values({ weddingId: w.id, name, categoryId: cat(c), eventId: ev(e), estimatedCost: N(est), actualCost: act ? N(act) : null, dueDate: due != null ? d(due) : null }).returning();
  if (paid) await db.insert(s.expensePayments).values({ weddingId: w.id, expenseId: x.id, amount: N(paid), paidOn: d(-Math.floor(Math.random() * 60) - 5), method: "transfer", recordedBy: user.id });
}
await db.insert(s.expenses).values({ weddingId: w.id, name: "Live band (cancelled)", categoryId: cat("Entertainment / DJ"), eventId: ev("Reception"), estimatedCost: N(600_000), cancelledAt: new Date(), notes: "Went with the DJ instead." });

// Checklist
await db.insert(s.tasks).values([
  { weddingId: w.id, title: "Send digital invitations", kind: "activity", dueDate: d(4), assignee: "partner_one", priority: "high", remindDaysBefore: [3, 1] },
  { weddingId: w.id, title: "Meet decorator for colour palette", kind: "activity", dueDate: d(6), assignee: "both", priority: "medium", description: "Bring the gold & wine swatches.", remindDaysBefore: [2] },
  { weddingId: w.id, title: "First fitting — reception gown", kind: "activity", dueDate: d(12), assignee: "partner_one", priority: "high", remindDaysBefore: [3, 1] },
  { weddingId: w.id, title: "Confirm final guest count with caterer", dueDate: d(68), assignee: "both", priority: "high", remindDaysBefore: [7, 3] },
  { weddingId: w.id, title: "Collect agbada from tailor", kind: "activity", dueDate: d(70), assignee: "partner_two", priority: "medium", remindDaysBefore: [2] },
  { weddingId: w.id, title: "Final vendor confirmations", dueDate: d(75), assignee: "both", priority: "high", remindDaysBefore: [5, 2] },
  { weddingId: w.id, title: "Book marriage registry appointment", dueDate: d(-3), assignee: "partner_two", priority: "high", remindDaysBefore: [3] },
  { weddingId: w.id, title: "Weekly budget check-in", dueDate: d(2), assignee: "both", priority: "low", recurrence: "weekly", remindDaysBefore: [0] },
  { weddingId: w.id, title: "Choose bridesmaids' gele styles", dueDate: d(-10), assignee: "partner_one", priority: "medium", completedAt: new Date() },
  { weddingId: w.id, title: "Pay church wedding fee", dueDate: d(-25), assignee: "partner_two", priority: "medium", completedAt: new Date() },
]);

// Aso Ebi
const assetDir = path.join(process.cwd(), "scripts", "demo-assets");
const uploadDir = path.join(process.cwd(), "uploads", w.id);
await fs.mkdir(uploadDir, { recursive: true });
const imgs = [];
for (const f of ["aso-oke-gold-wine.jpg", "lace-champagne.jpg", "sequin-wine.jpg"]) {
  const key = `${w.id}/${tok(9)}.jpeg`;
  const bytes = await fs.readFile(path.join(assetDir, f));
  await fs.writeFile(path.join(process.cwd(), "uploads", key), bytes);
  const [row] = await db.insert(s.files).values({ weddingId: w.id, storageKey: key, filename: f, mimeType: "image/jpeg", size: bytes.length, visibility: "public", uploadedBy: user.id }).returning();
  imgs.push(row);
}
const [camp] = await db
  .insert(s.campaigns)
  .values({
    weddingId: w.id,
    eventId: ev("Traditional wedding"),
    slug: "adaeze-tunde-gold",
    name: "Traditional wedding Aso Ebi",
    fabricName: "Gold & Wine Aso-Oke with champagne lace",
    colourStory: "Wine, antique gold and champagne",
    description: "Hand-woven aso-oke from Iseyin in deep wine with antique-gold stripes, paired with champagne French lace. Ladies' package includes a matching gele; men's package includes a fila.",
    instructions: "Choose your package, tell us where to send it, and pay securely online. You'll get a receipt by email immediately. Prefer to collect? Choose pickup and we'll message you when it's ready.",
    salesOpenAt: d(-21),
    salesCloseAt: d(35),
    paymentDeadline: d(2),
    bankName: "GTBank",
    accountNumber: "0123456789",
    accountName: "Adaeze Okafor",
    allowDelivery: true,
    allowPickup: true,
    deliveryFee: N(5_000),
    pickupDetails: "Pickup from Adaeze's family home, 15 Bode Thomas St, Surulere, Lagos — weekends 10am–4pm.",
    deliveryDetails: "Delivery within Lagos in 3–5 working days. Outside Lagos via GIG Logistics, 5–7 days.",
    contactName: "Ngozi (Adaeze's sister)",
    contactPhone: "+2348087654321",
    accent: "#7A2634",
    isPublished: true,
  })
  .returning();
await db.insert(s.campaignImages).values(imgs.map((f, i) => ({ campaignId: camp.id, fileId: f.id, sortOrder: i, caption: ["Aso-oke, gold & wine", "Champagne lace", "Wine sequin trim"][i] })));
const pk = await db
  .insert(s.packages)
  .values([
    { weddingId: w.id, campaignId: camp.id, name: "Female package", description: "5 yards lace + aso-oke gele & ipele", price: N(85_000), quantityAvailable: 150, maxPerOrder: 6, sortOrder: 0 },
    { weddingId: w.id, campaignId: camp.id, name: "Male package", description: "4 yards aso-oke + fila", price: N(65_000), quantityAvailable: 120, maxPerOrder: 6, sortOrder: 1 },
    { weddingId: w.id, campaignId: camp.id, name: "Couple package", description: "Female + male package together", price: N(140_000), quantityAvailable: 40, maxPerOrder: 3, sortOrder: 2 },
  ])
  .returning();

const people: Array<[string, string, string, string]> = [
  ["Chiamaka Obi", "08031112222", "chiamaka.obi@gmail.com", "Bride's side"],
  ["Babatunde Ade", "08052223333", "baba.ade@yahoo.com", "Groom's side"],
  ["Ngozi Okafor", "08087654321", "ngozi.okafor@gmail.com", "Family"],
  ["Funmilayo Bello", "07034445555", "funmi.bello@outlook.com", "Friends"],
  ["Emeka & Ada Nwankwo", "09015556666", "emeka.nwankwo@gmail.com", "Friends"],
  ["Halima Musa", "08166667777", "halima.musa@gmail.com", "Colleagues"],
  ["Tobi Adeleke", "08127778888", "tobi.adeleke@gmail.com", "Groom's side"],
  ["Kemi Oladipo", "08098889999", "kemi.oladipo@gmail.com", "Church"],
  ["Uche Eze", "08039990000", "uche.eze@gmail.com", "Bride's side"],
  ["Yetunde Afolabi", "08061231234", "yetunde.afo@gmail.com", "Family"],
  ["Ifeanyi Okonkwo", "07062342345", "ifeanyi.ok@gmail.com", "Friends"],
  ["Zainab Lawal", "08143453456", "zainab.lawal@gmail.com", "Colleagues"],
  ["Segun Olatunji", "08024564567", "segun.ola@gmail.com", "Groom's side"],
  ["Blessing Udoh", "08075675678", "blessing.udoh@gmail.com", "Church"],
  ["Ronke Williams", "09086786789", "ronke.w@gmail.com", "Friends"],
  ["Obinna Chukwu", "08137897890", "obinna.c@gmail.com", "Bride's side"],
  ["Aisha Garba", "08068908901", "aisha.garba@gmail.com", "Friends"],
  ["Tolu Fashola", "08019019012", "tolu.fashola@gmail.com", "Family"],
];
const places: Array<[string, string, string, string, string]> = [
  ["12 Adeola Odeku St", "Victoria Island", "Lagos", "Lagos", "Zenith Bank, Adeola Odeku"],
  ["7 Ogunlana Drive", "Surulere", "Lagos", "Lagos", "Ojuelegba bridge"],
  ["22 Ajose Adeogun St", "Victoria Island", "Lagos", "Lagos", "Mega Plaza"],
  ["Plot 5, Admiralty Way", "Lekki Phase 1", "Lagos", "Lagos", "Mega Chicken"],
  ["14 Allen Avenue", "Ikeja", "Lagos", "Lagos", "Cafe Neo"],
  ["3 Aminu Kano Crescent", "Wuse 2", "Abuja", "FCT - Abuja", "Banex Plaza"],
  ["18 Trans-Amadi Road", "Trans-Amadi", "Port Harcourt", "Rivers", "Total filling station"],
  ["9 Independence Layout", "Independence Layout", "Enugu", "Enugu", "Polo Park Mall"],
];
const pick = <X,>(a: X[], i: number) => a[i % a.length];

for (const [i, [name, phone, email, category]] of people.entries()) {
  const e164 = "+234" + phone.slice(1);
  const [g] = await db.insert(s.guests).values({ weddingId: w.id, name, phone: e164, email, category, inviteToken: tok(9), invitedAt: new Date(Date.now() - 20 * 86400000), linkSentAt: i < 16 ? new Date(Date.now() - 18 * 86400000) : null, linkOpenedAt: i < 14 ? new Date(Date.now() - 15 * 86400000) : null }).returning();
  if (i >= 14) continue; // invited but no order yet
  const p = pick(pk, i);
  const qty = i % 5 === 0 ? 2 : 1;
  const method = i % 4 === 3 ? ("pickup" as const) : ("delivery" as const);
  const fee = method === "delivery" ? N(5_000) : 0;
  const total = p.price * qty + fee;
  // states: 0-7 confirmed paid, 8-10 guest says sent (to confirm), 11-12 not paid yet, 13 cancelled
  const paid = i <= 7 ? total : 0;
  const status = i === 13 ? "cancelled" : i <= 7 ? "paid" : i <= 10 ? "transfer_reported" : "pending_payment";
  const [o] = await db
    .insert(s.orders)
    .values({ weddingId: w.id, campaignId: camp.id, guestId: g.id, code: code(), accessToken: tok(24), fullName: name, phone: e164, email, status: status as "paid", deliveryMethod: method, subtotal: p.price * qty, deliveryFee: fee, total, amountPaid: paid, cancelledAt: i === 13 ? new Date() : null, createdAt: new Date(Date.now() - (16 - i) * 86400000) })
    .returning();
  await db.insert(s.orderItems).values({ orderId: o.id, packageId: p.id, packageName: p.name, unitPrice: p.price, quantity: qty, lineTotal: p.price * qty });
  if (method === "delivery" && i !== 11) {
    const [street, area, city, state, landmark] = pick(places, i);
    await db.insert(s.deliveryAddresses).values({ orderId: o.id, street, area, city, state, landmark });
  }
  const dstatus = i <= 2 ? "delivered" : i <= 4 ? "dispatched" : i <= 5 ? "processing" : "awaiting";
  await db.insert(s.deliveries).values({ orderId: o.id, weddingId: w.id, status: dstatus as "awaiting", riderName: i <= 4 ? "Musa (Kwik Delivery)" : null, riderPhone: i <= 4 ? "+2348100000001" : null, trackingRef: i <= 4 ? `KWK-${1000 + i}` : null, dispatchedAt: i <= 4 ? new Date(Date.now() - 3 * 86400000) : null, deliveredAt: i <= 2 ? new Date(Date.now() - 86400000) : null });
  if (i <= 10) {
    const when = new Date(Date.now() - (14 - i) * 86400000);
    await db.insert(s.payments).values({ weddingId: w.id, orderId: o.id, amount: total, status: i <= 7 ? "confirmed" : "reported", senderName: i === 9 ? "Okonkwo Ifeanyi C." : name, reportedAt: when, confirmedAt: i <= 7 ? new Date(when.getTime() + 3600_000) : null, confirmedBy: i <= 7 ? user.id : null });
  }
}

await db.insert(s.notifications).values([
  { weddingId: w.id, kind: "welcome", title: "Your demo ledger is ready", body: "Explore freely — this is sample data. Three guests are waiting for you to confirm their transfers under Orders & Payments.", href: "/app" },
]);

console.log(`✓ Demo data seeded for ${w.partnerOneName} & ${w.partnerTwoName}\n  Login: demo@owambe.ng / demo-wedding\n  Aso Ebi page: /asoebi/${camp.slug}`);
await pool.end();
