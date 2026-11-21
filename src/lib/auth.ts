import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { admin } from "./supabase";
import type { Role } from "../contracts/actions";

export async function getUser(): Promise<{ id: string; email: string; role: Role } | null> {
  const store = await cookies();
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => store.getAll(), setAll: () => {} },
  });
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const { data: p } = await admin().from("profiles").select("id,email,role").eq("id", data.user.id).single();
  return p as any;
}
export async function requireRole(...roles: Role[]) {
  const u = await getUser();
  if (!u || !roles.includes(u.role)) throw new Error("forbidden");
  return u;
}
