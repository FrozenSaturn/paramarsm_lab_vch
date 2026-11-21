import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePageUser } from "@/lib/auth";
import { admin } from "@/lib/supabase";
import { confirmValue, type ConfirmKey } from "@/quotes/review";
import { QuoteReview } from "@/components/case/b/QuoteReview";
export const dynamic = "force-dynamic";

/** Confirm or correct one value. confirmValue checks the role against the database, not the UI. */
async function confirm(form: FormData) {
  "use server";
  const quoteId = String(form.get("quote_id"));
  const key = String(form.get("key")) as ConfirmKey;
  const raw = String(form.get("value") ?? "").trim();
  const numeric = /:(rate|quantity)$/.test(key);
  const value = raw === "" ? null : numeric ? Number(raw) : raw;
  if (numeric && value != null && !Number.isFinite(value)) throw new Error("not a number");
  await confirmValue(quoteId, key, value);
  revalidatePath(`/dev/quotes/${quoteId}`);
  redirect(`/dev/quotes/${quoteId}`);
}

// Lives under /dev until the case workspace mounts it at /cases/[id]/quotes/[quoteId] (route in A's folder; see for-A issue).
export default async function QuoteReviewPage({ params, searchParams }: { params: Promise<{ quoteId: string }>; searchParams: Promise<{ page?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  await requirePageUser();
  const { quoteId } = await params;
  const { page } = await searchParams;
  const { data: q } = await admin().from("quotes").select("case_id").eq("id", quoteId).single();
  if (!q) notFound();
  return (
    <div>
      <p><Link href={`/dev/quotes?case=${q.case_id}`}>← Quotes on this case</Link></p>
      <QuoteReview quoteId={quoteId} page={page ? Number(page) : undefined} pageHref={(p) => `/dev/quotes/${quoteId}?page=${p}`} confirmAction={confirm} />
    </div>
  );
}
