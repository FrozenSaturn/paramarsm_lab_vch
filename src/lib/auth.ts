import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { admin } from "./supabase";
import type { Role } from "../contracts/actions";

export const VIEW_AS_COOKIE = "view_as";
const ROLES: Role[] = ["contracts_engineer", "hod", "site_engineer", "management", "admin"];
export type AppUser = { id: string; email: string; role: Role; realRole: Role };

/** The signed-in user. `role` is what pages use. `realRole` is the stored role.
 *  An admin can pick another role with "view as" to show that role's screens in a demo. This changes what pages
 *  and server actions allow. It never adds rights, and the executor still checks the stored role in the database. */
export async function getUser(): Promise<AppUser | null> {
  const store = await cookies();
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => store.getAll(), setAll: () => {} },
  });
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const { data: p } = await admin().from("profiles").select("id,email,role").eq("id", data.user.id).single();
  if (!p) return null;
  const view = store.get(VIEW_AS_COOKIE)?.value as Role | undefined;
  const role = p.role === "admin" && view && ROLES.includes(view) ? view : (p.role as Role);
  return { id: p.id, email: p.email, role, realRole: p.role as Role };
}
export async function requireRole(...roles: Role[]) {
  const u = await getUser();
  if (!u || !roles.includes(u.role)) throw new Error("forbidden");
  return u;
}

/** For server pages: redirect to /login unless a signed-in, allow-listed user. */
export async function requirePageUser() {
  const { redirect } = await import("next/navigation");
  const u = await getUser();
  if (!u) redirect("/login");
  return u!;
}
