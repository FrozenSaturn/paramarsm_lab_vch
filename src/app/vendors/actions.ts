"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { deleteMemory, isUuid } from "@/memory";
import { proposeRatingFromMemory } from "@/agents/b/performance-from-memory";

/** Reads the form fields that every memory button sends. */
function fields(form: FormData) {
  const id = String(form.get("memory_id") ?? "");
  const path = String(form.get("path") ?? "/vendors");
  if (!isUuid(id)) throw new Error("bad memory id");
  return { id, path: path.startsWith("/") ? path : "/vendors" };
}

/** Deletes one memory. The role check runs on the server. */
export async function deleteMemoryAction(form: FormData): Promise<void> {
  const user = await requireRole("contracts_engineer", "hod", "admin");
  const { id, path } = fields(form);
  await deleteMemory(id, user.id);
  revalidatePath(path);
}

/** Asks the model to read one memory and propose a performance_record action. */
export async function proposeRatingAction(form: FormData): Promise<void> {
  const user = await requireRole("contracts_engineer", "hod", "admin");
  const { id, path } = fields(form);
  const out = await proposeRatingFromMemory(id, user.id);
  if (!out.action) console.info(`[vendors] no rating proposed for memory ${id}: ${out.reason ?? "unknown"}`);
  revalidatePath(path);
}
