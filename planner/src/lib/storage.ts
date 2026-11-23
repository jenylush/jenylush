import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@/db";
import { files } from "@/db/schema";
import { secretToken } from "./ids";

const LOCAL_ROOT = path.resolve(process.cwd(), "uploads");
export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export const MAX_BYTES = 8 * 1024 * 1024;

const driver = () => (process.env.STORAGE_DRIVER ?? "local") as "local" | "supabase";
const sb = () => ({
  url: process.env.SUPABASE_URL!.replace(/\/$/, ""),
  key: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  bucket: process.env.SUPABASE_STORAGE_BUCKET ?? "owambe-files",
});

export class UploadError extends Error {}

export async function storeUpload(
  file: File,
  opts: { weddingId: string; visibility: "public" | "private"; userId?: string | null },
) {
  if (!file || file.size === 0) return null;
  if (!ALLOWED_TYPES.includes(file.type)) throw new UploadError("Only JPG, PNG, WEBP or PDF files can be uploaded.");
  if (file.size > MAX_BYTES) throw new UploadError("Files must be 8 MB or smaller.");
  const ext = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1];
  const key = `${opts.weddingId}/${secretToken(12)}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  if (driver() === "supabase") {
    const { url, key: k, bucket } = sb();
    const res = await fetch(`${url}/storage/v1/object/${bucket}/${key}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${k}`, "Content-Type": file.type, "x-upsert": "false" },
      body: bytes,
    });
    if (!res.ok) throw new UploadError(`Storage upload failed (${res.status})`);
  } else {
    await fs.mkdir(path.join(LOCAL_ROOT, opts.weddingId), { recursive: true });
    await fs.writeFile(path.join(LOCAL_ROOT, key), bytes);
  }

  const [row] = await db
    .insert(files)
    .values({
      weddingId: opts.weddingId,
      storageKey: key,
      filename: file.name.slice(0, 200) || `upload.${ext}`,
      mimeType: file.type,
      size: file.size,
      visibility: opts.visibility,
      uploadedBy: opts.userId ?? null,
    })
    .returning();
  return row;
}

export async function readStored(storageKey: string): Promise<Buffer> {
  if (driver() === "supabase") {
    const { url, key, bucket } = sb();
    const res = await fetch(`${url}/storage/v1/object/${bucket}/${storageKey}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error("not found");
    return Buffer.from(await res.arrayBuffer());
  }
  const p = path.join(LOCAL_ROOT, storageKey);
  if (!p.startsWith(LOCAL_ROOT)) throw new Error("bad key");
  return fs.readFile(p);
}

export const fileUrl = (id: string | null | undefined) => (id ? `/api/files/${id}` : null);
