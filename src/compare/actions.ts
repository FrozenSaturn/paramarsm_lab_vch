"use server";
/**
 * Server actions for the Comparative panel. Each one checks the role in the database;
 * it does not trust the UI.
 */
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { runComparative } from "./run";

/** "Compare now": builds a new comparative version for the case in the form. */
export async function compareNow(form: FormData): Promise<void> {
  const user = await requireRole("contracts_engineer", "hod", "admin");
  const caseId = String(form.get("case_id") ?? "");
  if (!caseId) throw new Error("case_id is missing");
  await runComparative({ caseId, trigger: "button", actor: user.id });
  revalidatePath("/dev/quotes");
  revalidatePath(`/cases/${caseId}`);
}
