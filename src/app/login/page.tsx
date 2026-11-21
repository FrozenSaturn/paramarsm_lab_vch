"use client";
import { createBrowserClient } from "@supabase/ssr";

export default function Login() {
  const go = async () => {
    const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    await sb.auth.signInWithOAuth({ provider: "google", options: {
      redirectTo: `${location.origin}/auth/callback`, queryParams: { access_type: "offline", prompt: "consent" },
      scopes: "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send" } });
  };
  return (
    <div className="login">
      <div className="card login-card">
        <span className="brand-mark" style={{ width: 32, height: 32, display: "grid" }}>V</span>
        <h1>Sign in to Vinayak</h1>
        <p>Take a work package from site requirement to approved vendor. Agents draft the work. A person approves it.</p>
        <button className="btn btn-primary btn-lg" onClick={go}>Continue with Google</button>
        <div className="login-foot">Access is limited to approved team members.</div>
      </div>
    </div>
  );
}
