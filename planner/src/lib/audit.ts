import { db, type Tx } from "@/db";
import { auditLogs } from "@/db/schema";

type Actor = "user" | "system" | "guest" | "webhook";

/** Append-only record of important (mostly financial) changes. */
export async function audit(
  entry: {
    weddingId: string;
    userId?: string | null;
    actor?: Actor;
    action: string;
    entityType: string;
    entityId?: string | null;
    summary: string;
    before?: unknown;
    after?: unknown;
  },
  tx: Tx | typeof db = db,
) {
  await tx.insert(auditLogs).values({
    weddingId: entry.weddingId,
    userId: entry.userId ?? null,
    actor: entry.actor ?? "user",
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    summary: entry.summary,
    before: entry.before === undefined ? null : JSON.parse(JSON.stringify(entry.before)),
    after: entry.after === undefined ? null : JSON.parse(JSON.stringify(entry.after)),
  });
}
