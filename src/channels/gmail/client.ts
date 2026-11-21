import { gmail, type gmail_v1 } from "@googleapis/gmail";
import { OAuth2Client } from "google-auth-library";
import { admin } from "../../lib/supabase";

/** Gmail client for one user. Supabase keeps no Google refresh token for us, so we use the one saved in `mail_tokens`.
 *  googleapis gets a new access token from it when needed. */
export async function gmailFor(userId: string): Promise<gmail_v1.Gmail> {
  const { data, error } = await admin().from("mail_tokens").select("refresh_token").eq("user_id", userId).single();
  if (error || !data) throw new Error("No Gmail token for this user. Sign in again with Google.");
  const auth = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: data.refresh_token });
  return gmail({ version: "v1", auth });
}
