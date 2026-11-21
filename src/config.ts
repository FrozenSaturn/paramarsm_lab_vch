import "node:process";
const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`Missing env ${k}`); return v; };
export const cfg = {
  evoUrl: process.env.EVO_URL ?? "http://localhost:8080",
  evoKey: process.env.EVO_API_KEY ?? "",
  instance: process.env.EVO_INSTANCE ?? "vinayak",
  allowed: (process.env.ALLOWED_SENDERS ?? "").split(",").map(s => s.replace(/\D/g, "")).filter(Boolean),
  model: process.env.CLAUDE_MODEL ?? "claude-sonnet-5-5",
  whisper: process.env.WHISPER_MODEL ?? "Xenova/whisper-small",
  host: process.env.HOST ?? "127.0.0.1",
  webhookSecret: process.env.WEBHOOK_SECRET ?? "",
  adminToken: process.env.ADMIN_TOKEN ?? "",
  port: Number(process.env.PORT ?? 3000),
  anthropicKey: () => need("ANTHROPIC_API_KEY"),
};
