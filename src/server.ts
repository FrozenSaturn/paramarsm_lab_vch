import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import { cfg } from "./config.js";
import { parseWebhook, senderAllowed } from "./evolution.js";
import { handle } from "./pipeline.js";
import { list } from "./store.js";

if (!cfg.webhookSecret) throw new Error("Set WEBHOOK_SECRET in .env");
const app = Fastify({ logger: true });

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

app.post("/webhook", async (req, reply) => {
  const token = String(req.headers["x-webhook-token"] ?? "");
  if (!safeEq(token, cfg.webhookSecret)) return reply.code(401).send();
  const m = parseWebhook(req.body);
  reply.send({ ok: true }); // ack fast; Evolution retries on slow responses
  if (!m || !senderAllowed(m.from)) return;
  handle(m).then(q => q && app.log.info({ from: m.from, items: q.items.length, review: q.needs_review }, "quote saved"))
           .catch(e => app.log.error(e, "pipeline failed"));
});

// Quotes contain vendor pricing: disabled unless ADMIN_TOKEN is set.
app.get("/quotes", async (req, reply) => {
  const auth = String(req.headers.authorization ?? "");
  if (!cfg.adminToken || !safeEq(auth, `Bearer ${cfg.adminToken}`)) return reply.code(401).send();
  return list();
});

app.listen({ port: cfg.port, host: cfg.host });
