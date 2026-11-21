"use client";
import { createBrowserClient } from "@supabase/ssr";
export default function Login() {
  const go = async () => {
    const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    await sb.auth.signInWithOAuth({ provider: "google", options: {
      redirectTo: `${location.origin}/auth/callback`, queryParams: { access_type: "offline", prompt: "consent" },
      scopes: "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send" } });
  };
  return <button onClick={go}>Sign in with Google</button>;
}
