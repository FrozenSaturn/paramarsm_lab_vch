// SERVER_ACTIONS_ALLOWED_ORIGINS: extra hosts allowed to post server actions (comma-separated),
// e.g. the Vercel domain that proxies to this machine. "*.vercel.app" is always allowed.
const extra = (process.env.SERVER_ACTIONS_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
export default {
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: "15mb", allowedOrigins: ["*.vercel.app", "*.ts.net", ...extra] } },
};
