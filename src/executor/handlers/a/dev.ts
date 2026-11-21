import { registerHandler } from "../..";
// Test-only kind used by /dev/actions: pretend to send a WhatsApp message.
registerHandler("send_whatsapp", async (a) => ({ provider_id: "dev-" + a.id.slice(0, 8), result: { echoed: a.payload } }));
