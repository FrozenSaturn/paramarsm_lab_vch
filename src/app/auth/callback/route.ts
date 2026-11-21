import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { admin } from "@/lib/supabase";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const store = await cookies();
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => store.getAll(), setAll: (all) => all.forEach(c => store.set(c.name, c.value, c.options)) },
  });
  if (code) {
    const { data } = await sb.auth.exchangeCodeForSession(code);
    // Supabase does not keep Google's refresh token; store it server-side for the Gmail poller.
    if (data.session?.provider_refresh_token && data.user) {
      await admin().from("mail_tokens").upsert({ user_id: data.user.id, refresh_token: data.session.provider_refresh_token });
    }
  }
  // Relative redirect: behind the Vercel proxy, url.origin is the laptop's address, not the public domain.
  return new NextResponse(null, { status: 307, headers: { Location: "/cases" } });
}
