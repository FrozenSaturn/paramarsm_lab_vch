/**
 * Getting a document's bytes and a link to a page of it.
 * TEMPORARY until A ships signedUrl(documentId) / a download helper in src/lib/storage
 * (issue for-A). Only reads: B never writes documents.
 */
import { admin } from "@/lib/supabase";

export const STORAGE_BUCKET = process.env.STORAGE_BUCKET || "documents";

export interface DocumentRow {
  id: string;
  case_id: string | null;
  filename: string | null;
  mime: string | null;
  storage_path: string;
}

export async function getDocument(documentId: string): Promise<DocumentRow> {
  const { data, error } = await admin().from("documents").select("id,case_id,filename,mime,storage_path").eq("id", documentId).single();
  if (error || !data) throw new Error(`document ${documentId} not found: ${error?.message ?? ""}`);
  return data as DocumentRow;
}

export async function documentBytes(doc: DocumentRow): Promise<Buffer> {
  const { data, error } = await admin().storage.from(STORAGE_BUCKET).download(doc.storage_path);
  if (error || !data) throw new Error(`could not download ${doc.storage_path} from bucket ${STORAGE_BUCKET}: ${error?.message ?? "no data"}`);
  return Buffer.from(await data.arrayBuffer());
}

/** A short-lived link to the PDF, opened at a page (browsers' PDF viewers honour #page=N). */
export async function documentPageUrl(documentId: string, page?: number | null, ttlSeconds = 3600): Promise<string | null> {
  const doc = await getDocument(documentId).catch(() => null);
  if (!doc) return null;
  const { data } = await admin().storage.from(STORAGE_BUCKET).createSignedUrl(doc.storage_path, ttlSeconds);
  if (!data?.signedUrl) return null;
  return page ? `${data.signedUrl}#page=${page}` : data.signedUrl;
}
