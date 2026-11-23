/**
 * Owambe Ledger — relational schema.
 *
 * Money is always stored as integer kobo (₦1 = 100 kobo) in BIGINT columns, which is
 * what Paystack uses and avoids floating-point errors. Every tenant-owned table carries
 * `wedding_id`, and every query in src/lib goes through a wedding-scoped helper.
 */
import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const money = (name: string) => bigint(name, { mode: "number" });
const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const weddingRef = () =>
  uuid("wedding_id")
    .notNull()
    .references(() => weddings.id, { onDelete: "cascade" });

/* ─── Enums ─────────────────────────────────────────────────────────── */

export const memberRole = pgEnum("member_role", ["owner", "partner", "planner", "viewer"]);
export const eventType = pgEnum("event_type", [
  "introduction",
  "traditional",
  "white",
  "reception",
  "after_party",
  "other",
]);
export const taskPriority = pgEnum("task_priority", ["low", "medium", "high"]);
export const taskAssignee = pgEnum("task_assignee", ["partner_one", "partner_two", "both"]);
export const recurrence = pgEnum("recurrence", ["none", "weekly", "monthly"]);
export const taskKind = pgEnum("task_kind", ["task", "activity"]);
export const orderStatus = pgEnum("order_status", [
  "pending_payment",
  "partially_paid",
  "paid",
  "cancelled",
]);
export const deliveryMethod = pgEnum("delivery_method", ["delivery", "pickup"]);
export const deliveryStatus = pgEnum("delivery_status", [
  "awaiting",
  "processing",
  "ready_for_collection",
  "dispatched",
  "delivered",
  "failed",
]);
export const paymentStatus = pgEnum("payment_status", [
  "initialized",
  "pending",
  "success",
  "failed",
  "abandoned",
  "refunded",
]);
export const notifyChannel = pgEnum("notify_channel", ["email", "whatsapp", "in_app"]);
export const notifyStatus = pgEnum("notify_status", ["queued", "sent", "failed", "skipped"]);
export const fileVisibility = pgEnum("file_visibility", ["public", "private"]);

/* ─── Identity & tenancy ────────────────────────────────────────────── */

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  phone: text("phone"),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the random token held in the cookie — the raw token is never stored. */
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** A wedding is the couple's private workspace (the "tenant"). */
export const weddings = pgTable("weddings", {
  id: id(),
  partnerOneName: text("partner_one_name").notNull(),
  partnerTwoName: text("partner_two_name").notNull(),
  partnerOneEmail: text("partner_one_email"),
  partnerTwoEmail: text("partner_two_email"),
  partnerOnePhone: text("partner_one_phone"),
  partnerTwoPhone: text("partner_two_phone"),
  weddingDate: date("wedding_date"),
  traditionalDate: date("traditional_date"),
  whiteWeddingDate: date("white_wedding_date"),
  venue: text("venue"),
  city: text("city"),
  estimatedGuests: integer("estimated_guests"),
  totalBudget: money("total_budget").notNull().default(0),
  currency: text("currency").notNull().default("NGN"),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  // Notification preferences
  reminderOffsets: integer("reminder_offsets").array().notNull().default(sql`'{7,3,0}'::int[]`),
  overdueRepeatDays: integer("overdue_repeat_days").notNull().default(3),
  notifyEmail: boolean("notify_email").notNull().default(true),
  notifyWhatsapp: boolean("notify_whatsapp").notNull().default(false),
  notifyInApp: boolean("notify_in_app").notNull().default(true),
  guestReminderDays: integer("guest_reminder_days").notNull().default(3),
  /** Secret token for the read-only Google Sheets IMPORTDATA feed. Null = disabled. */
  sheetsFeedToken: text("sheets_feed_token").unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weddingId: weddingRef(),
    role: memberRole("role").notNull().default("owner"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.weddingId] })],
);

export const invites = pgTable("invites", {
  id: id(),
  weddingId: weddingRef(),
  email: text("email").notNull(),
  role: memberRole("role").notNull().default("partner"),
  tokenHash: text("token_hash").notNull().unique(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/* ─── Planning: events, categories, vendors, expenses ───────────────── */

export const events = pgTable(
  "events",
  {
    id: id(),
    weddingId: weddingRef(),
    name: text("name").notNull(),
    type: eventType("type").notNull().default("other"),
    date: date("date"),
    venue: text("venue"),
    budget: money("budget"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("events_wedding_idx").on(t.weddingId)],
);

export const categories = pgTable(
  "categories",
  {
    id: id(),
    weddingId: weddingRef(),
    name: text("name").notNull(),
    color: text("color").notNull().default("#B89B6A"),
    /** Planned allocation of the overall budget for this category. */
    allocated: money("allocated").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("categories_wedding_idx").on(t.weddingId),
    uniqueIndex("categories_wedding_name_uq").on(t.weddingId, t.name),
  ],
);

export const files = pgTable(
  "files",
  {
    id: id(),
    weddingId: weddingRef(),
    storageKey: text("storage_key").notNull().unique(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    visibility: fileVisibility("visibility").notNull().default("private"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("files_wedding_idx").on(t.weddingId)],
);

export const vendors = pgTable(
  "vendors",
  {
    id: id(),
    weddingId: weddingRef(),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    instagram: text("instagram"),
    notes: text("notes"),
    contractFileId: uuid("contract_file_id").references(() => files.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("vendors_wedding_idx").on(t.weddingId)],
);

/**
 * An expense is one cost line. Its outstanding balance and payment status are always
 * derived from (cost − sum of payments) and its instalments — never stored — so they
 * can't drift out of sync when a payment is recorded or deleted.
 */
export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    weddingId: weddingRef(),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    vendorId: uuid("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    estimatedCost: money("estimated_cost").notNull().default(0),
    /** Agreed / invoiced cost. When null the estimate is used as the total. */
    actualCost: money("actual_cost"),
    dueDate: date("due_date"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("expenses_wedding_idx").on(t.weddingId),
    index("expenses_vendor_idx").on(t.vendorId),
  ],
);

/** Scheduled instalments for an expense (e.g. photographer 200k / 150k / 150k). */
export const instalments = pgTable(
  "instalments",
  {
    id: id(),
    weddingId: weddingRef(),
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    amount: money("amount").notNull(),
    dueDate: date("due_date").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("instalments_expense_idx").on(t.expenseId), index("instalments_due_idx").on(t.dueDate)],
);

/** A payment the couple made towards an expense. */
export const expensePayments = pgTable(
  "expense_payments",
  {
    id: id(),
    weddingId: weddingRef(),
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    instalmentId: uuid("instalment_id").references(() => instalments.id, { onDelete: "set null" }),
    amount: money("amount").notNull(),
    paidOn: date("paid_on").notNull(),
    method: text("method").notNull().default("transfer"),
    reference: text("reference"),
    evidenceFileId: uuid("evidence_file_id").references(() => files.id, { onDelete: "set null" }),
    note: text("note"),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("expense_payments_expense_idx").on(t.expenseId)],
);

export const expenseAttachments = pgTable(
  "expense_attachments",
  {
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.fileId] })],
);

/* ─── Checklist & reminders ─────────────────────────────────────────── */

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    weddingId: weddingRef(),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    kind: taskKind("kind").notNull().default("task"),
    dueDate: date("due_date"),
    assignee: taskAssignee("assignee").notNull().default("both"),
    priority: taskPriority("priority").notNull().default("medium"),
    recurrence: recurrence("recurrence").notNull().default("none"),
    /** Days before the due date to send a reminder. Empty = no reminder. */
    remindDaysBefore: integer("remind_days_before").array().notNull().default(sql`'{1}'::int[]`),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("tasks_wedding_idx").on(t.weddingId)],
);

/* ─── Aso Ebi ───────────────────────────────────────────────────────── */

export const campaigns = pgTable(
  "asoebi_campaigns",
  {
    id: id(),
    weddingId: weddingRef(),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    /** Public, unguessable path segment: /asoebi/<slug> */
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    fabricName: text("fabric_name").notNull(),
    colourStory: text("colour_story"),
    description: text("description"),
    instructions: text("instructions"),
    salesOpenAt: date("sales_open_at"),
    salesCloseAt: date("sales_close_at"),
    paymentDeadline: date("payment_deadline"),
    allowInstalments: boolean("allow_instalments").notNull().default(false),
    minDepositPercent: integer("min_deposit_percent").notNull().default(50),
    allowDelivery: boolean("allow_delivery").notNull().default(true),
    allowPickup: boolean("allow_pickup").notNull().default(true),
    deliveryFee: money("delivery_fee").notNull().default(0),
    pickupDetails: text("pickup_details"),
    deliveryDetails: text("delivery_details"),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    accent: text("accent").notNull().default("#8E5B5B"),
    isPublished: boolean("is_published").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("campaigns_wedding_idx").on(t.weddingId)],
);

export const campaignImages = pgTable("asoebi_campaign_images", {
  id: id(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  fileId: uuid("file_id")
    .notNull()
    .references(() => files.id, { onDelete: "cascade" }),
  caption: text("caption"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const packages = pgTable("asoebi_packages", {
  id: id(),
  weddingId: weddingRef(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  price: money("price").notNull(),
  /** Null = unlimited stock. */
  quantityAvailable: integer("quantity_available"),
  maxPerOrder: integer("max_per_order").notNull().default(10),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const guests = pgTable(
  "guests",
  {
    id: id(),
    weddingId: weddingRef(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    category: text("category").notNull().default("Friends"),
    /** Per-guest token appended to the share link (?g=) to track opens. */
    inviteToken: text("invite_token").notNull().unique(),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    linkSentAt: timestamp("link_sent_at", { withTimezone: true }),
    linkOpenedAt: timestamp("link_opened_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    index("guests_wedding_idx").on(t.weddingId),
    index("guests_phone_idx").on(t.weddingId, t.phone),
  ],
);

export const orders = pgTable(
  "asoebi_orders",
  {
    id: id(),
    weddingId: weddingRef(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "restrict" }),
    guestId: uuid("guest_id").references(() => guests.id, { onDelete: "set null" }),
    /** Human-friendly order ID shown to guests, e.g. AE-7K2M9Q */
    code: text("code").notNull().unique(),
    /** Secret that lets the guest reopen their order page (status, pay, edit address). */
    accessToken: text("access_token").notNull().unique(),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    email: text("email").notNull(),
    status: orderStatus("status").notNull().default("pending_payment"),
    deliveryMethod: deliveryMethod("delivery_method").notNull(),
    subtotal: money("subtotal").notNull(),
    deliveryFee: money("delivery_fee").notNull().default(0),
    total: money("total").notNull(),
    /** Sum of VERIFIED successful payments only. */
    amountPaid: money("amount_paid").notNull().default(0),
    paymentPlan: text("payment_plan").notNull().default("full"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("orders_wedding_idx").on(t.weddingId),
    index("orders_campaign_idx").on(t.campaignId),
  ],
);

export const orderItems = pgTable("asoebi_order_items", {
  id: id(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  packageId: uuid("package_id").references(() => packages.id, { onDelete: "set null" }),
  packageName: text("package_name").notNull(),
  unitPrice: money("unit_price").notNull(),
  quantity: integer("quantity").notNull(),
  lineTotal: money("line_total").notNull(),
});

export const deliveryAddresses = pgTable("delivery_addresses", {
  orderId: uuid("order_id")
    .primaryKey()
    .references(() => orders.id, { onDelete: "cascade" }),
  street: text("street").notNull(),
  area: text("area").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  landmark: text("landmark"),
  instructions: text("instructions"),
  source: text("source").notNull().default("web"),
  updatedAt: updatedAt(),
});

export const deliveries = pgTable("deliveries", {
  orderId: uuid("order_id")
    .primaryKey()
    .references(() => orders.id, { onDelete: "cascade" }),
  weddingId: weddingRef(),
  status: deliveryStatus("status").notNull().default("awaiting"),
  riderName: text("rider_name"),
  riderPhone: text("rider_phone"),
  trackingRef: text("tracking_ref"),
  notes: text("notes"),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  updatedAt: updatedAt(),
});

/** Gateway (or manually recorded) payments for Aso Ebi orders. */
export const payments = pgTable(
  "payments",
  {
    id: id(),
    weddingId: weddingRef(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // paystack | flutterwave | manual
    reference: text("reference").notNull().unique(),
    amount: money("amount").notNull(),
    currency: text("currency").notNull().default("NGN"),
    status: paymentStatus("status").notNull().default("initialized"),
    channel: text("channel"),
    gatewayResponse: text("gateway_response"),
    authorizationUrl: text("authorization_url"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** Set once the success has been applied to the order. Guards against double-processing. */
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    raw: jsonb("raw"),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payments_order_idx").on(t.orderId), index("payments_wedding_idx").on(t.weddingId)],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    event: text("event").notNull(),
    /** provider + event + reference — unique so replays are ignored */
    dedupeKey: text("dedupe_key").notNull(),
    signatureValid: boolean("signature_valid").notNull(),
    payload: jsonb("payload").notNull(),
    result: text("result"),
    receivedAt: createdAt(),
  },
  (t) => [uniqueIndex("webhook_events_dedupe_uq").on(t.dedupeKey)],
);

/* ─── Notifications & audit ─────────────────────────────────────────── */

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    weddingId: weddingRef(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_wedding_idx").on(t.weddingId, t.createdAt)],
);

export const notificationLogs = pgTable(
  "notification_logs",
  {
    id: id(),
    weddingId: weddingRef(),
    channel: notifyChannel("channel").notNull(),
    type: text("type").notNull(),
    trigger: text("trigger").notNull(),
    recipient: text("recipient").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    html: text("html"),
    status: notifyStatus("status").notNull().default("queued"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    providerId: text("provider_id"),
    /** Prevents the same reminder being sent twice (e.g. "instalment:<id>:due-3:email"). */
    dedupeKey: text("dedupe_key"),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("notification_logs_wedding_idx").on(t.weddingId, t.createdAt),
    uniqueIndex("notification_logs_dedupe_uq").on(t.dedupeKey),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    weddingId: weddingRef(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    actor: text("actor").notNull().default("user"), // user | system | guest | webhook
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    summary: text("summary").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_wedding_idx").on(t.weddingId, t.createdAt)],
);

/* ─── Relations (for drizzle's relational queries) ──────────────────── */

export const weddingsRelations = relations(weddings, ({ many }) => ({
  events: many(events),
  categories: many(categories),
  memberships: many(memberships),
}));
export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  wedding: one(weddings, { fields: [memberships.weddingId], references: [weddings.id] }),
}));
export const expensesRelations = relations(expenses, ({ one, many }) => ({
  category: one(categories, { fields: [expenses.categoryId], references: [categories.id] }),
  event: one(events, { fields: [expenses.eventId], references: [events.id] }),
  vendor: one(vendors, { fields: [expenses.vendorId], references: [vendors.id] }),
  instalments: many(instalments),
  payments: many(expensePayments),
  attachments: many(expenseAttachments),
}));
export const instalmentsRelations = relations(instalments, ({ one }) => ({
  expense: one(expenses, { fields: [instalments.expenseId], references: [expenses.id] }),
}));
export const expensePaymentsRelations = relations(expensePayments, ({ one }) => ({
  expense: one(expenses, { fields: [expensePayments.expenseId], references: [expenses.id] }),
  evidence: one(files, { fields: [expensePayments.evidenceFileId], references: [files.id] }),
}));
export const expenseAttachmentsRelations = relations(expenseAttachments, ({ one }) => ({
  expense: one(expenses, { fields: [expenseAttachments.expenseId], references: [expenses.id] }),
  file: one(files, { fields: [expenseAttachments.fileId], references: [files.id] }),
}));
export const vendorsRelations = relations(vendors, ({ one, many }) => ({
  category: one(categories, { fields: [vendors.categoryId], references: [categories.id] }),
  contract: one(files, { fields: [vendors.contractFileId], references: [files.id] }),
  expenses: many(expenses),
}));
export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  event: one(events, { fields: [campaigns.eventId], references: [events.id] }),
  packages: many(packages),
  images: many(campaignImages),
  orders: many(orders),
}));
export const campaignImagesRelations = relations(campaignImages, ({ one }) => ({
  campaign: one(campaigns, { fields: [campaignImages.campaignId], references: [campaigns.id] }),
  file: one(files, { fields: [campaignImages.fileId], references: [files.id] }),
}));
export const packagesRelations = relations(packages, ({ one }) => ({
  campaign: one(campaigns, { fields: [packages.campaignId], references: [campaigns.id] }),
}));
export const ordersRelations = relations(orders, ({ one, many }) => ({
  campaign: one(campaigns, { fields: [orders.campaignId], references: [campaigns.id] }),
  guest: one(guests, { fields: [orders.guestId], references: [guests.id] }),
  items: many(orderItems),
  address: one(deliveryAddresses, { fields: [orders.id], references: [deliveryAddresses.orderId] }),
  delivery: one(deliveries, { fields: [orders.id], references: [deliveries.orderId] }),
  payments: many(payments),
}));
export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
}));
export const deliveryAddressesRelations = relations(deliveryAddresses, ({ one }) => ({
  order: one(orders, { fields: [deliveryAddresses.orderId], references: [orders.id] }),
}));
export const deliveriesRelations = relations(deliveries, ({ one }) => ({
  order: one(orders, { fields: [deliveries.orderId], references: [orders.id] }),
}));
export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
}));
export const guestsRelations = relations(guests, ({ many }) => ({
  orders: many(orders),
}));
