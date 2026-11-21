import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ingestWhatsApp, type WaMessage } from "@/channels/whatsapp/ingest";
import { admin } from "@/lib/supabase";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The bridge posts each new message and each link change here (FORWARD_URL). It must send the shared token. */
export async function POST(req: Request) {
  const secret = process.env.WHATSAPP_FORWARD_TOKEN;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !same(got, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  try {
    if (body?.type === "whatsapp.message" && body.message?.id) return NextResponse.json({ ok: true, ...(await ingestWhatsApp(body.message as WaMessage)) });
    if (body?.type === "whatsapp.connection") {
      await admin().from("agent_steps").insert({ workflow: "whatsapp", step: "connection", status: "done", output: { state: body.state, owner: body.owner ?? null, reason: body.reason ?? null }, finished_at: new Date().toISOString() });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "unknown event" }, { status: 400 });
  } catch (e: any) {
    // A 5xx lets the bridge see the failure in its log. The message row is removed on failure, so a later send can work.
    console.error("[whatsapp webhook]", e?.message ?? e);
    return NextResponse.json({ error: "could not process the message" }, { status: 500 });
  }
}
