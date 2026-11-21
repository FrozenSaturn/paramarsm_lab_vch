/** Enforced inside the executor: in sandbox mode mail may only go to the demo allow-list. */
export function assertRecipientsAllowed(recipients: string[]) {
  if ((process.env.OUTBOUND_MODE ?? "sandbox") !== "sandbox") return;
  const allowed = (process.env.SANDBOX_ALLOWED_EMAILS ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const bad = recipients.filter(r => !allowed.includes(r.toLowerCase()));
  if (bad.length) throw new Error(`sandbox: recipient not on demo list: ${bad.join(", ")}`);
}
