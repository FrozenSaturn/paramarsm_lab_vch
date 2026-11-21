import path from 'node:path';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}. Copy .env.example to .env.`);
  return value;
}

function list(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((s) => s.replace(/\D/g, ''))
    .filter(Boolean);
}

export const config = {
  port: Number(process.env.BRIDGE_PORT ?? 8091),
  /** Bearer token for every bridge route except /health and the webhook. */
  bridgeToken: required('BRIDGE_TOKEN'),
  evolutionUrl: (process.env.EVOLUTION_URL ?? 'http://localhost:8080').replace(/\/$/, ''),
  evolutionApiKey: required('EVOLUTION_API_KEY'),
  /** The URL Evolution uses to reach this bridge. In Docker it is the service name. */
  webhookUrl: process.env.WEBHOOK_URL ?? 'http://bridge:8091/webhook/evolution',
  /** Evolution sends this value in the x-webhook-secret header. */
  webhookSecret: required('WEBHOOK_SECRET'),
  dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
  defaultInstance: process.env.INSTANCE_NAME ?? 'vch-main',
  /** Optional. When set, each new message is POSTed here as a WaMessage. */
  forwardUrl: process.env.FORWARD_URL || undefined,
  forwardToken: process.env.FORWARD_TOKEN || undefined,
  /** Optional digits-only numbers. When set, only these senders are stored and forwarded. */
  allowNumbers: list('ALLOW_NUMBERS'),
};
