# Vercel proxy

This Vercel project has no code. It forwards every request to the app on the demo laptop,
which Tailscale Funnel publishes at `https://fedora.tail475933.ts.net`.

1. On the laptop, start the app: `npm run build && npm run start` (port 3000).
2. Publish it: `tailscale funnel --bg 3000`.
3. Deploy this folder: `cd deploy/vercel && npx vercel deploy --prod`.
4. In Supabase (Authentication, URL Configuration), add `https://<vercel-domain>/auth/callback`.

The site is down when the laptop is off or Funnel is stopped.
