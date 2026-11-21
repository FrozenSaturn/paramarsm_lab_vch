import { MailboxPanel, UsersPanel, ViewAsPanel, PolicyPanel, WhatsAppPanel } from "@/components/settings/SettingsPanels";
import { requirePageUser } from "@/lib/auth";
export const dynamic = "force-dynamic";

export default async function Settings() {
  await requirePageUser();
  return (
    <>
      <h1>Settings</h1>
      <h2>Mailbox</h2><MailboxPanel />
      <h2>Users and roles</h2><UsersPanel />
      <h2>View as</h2><ViewAsPanel />
      <h2>Approval policy and settings</h2><PolicyPanel />
      <h2>WhatsApp</h2><WhatsAppPanel />
    </>
  );
}
