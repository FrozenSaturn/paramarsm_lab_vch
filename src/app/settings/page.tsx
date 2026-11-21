import { PageHead, Panel } from "@/components/ui";
import { MailboxPanel, UsersPanel, ViewAsPanel, PolicyPanel, WhatsAppPanel } from "@/components/settings/SettingsPanels";
import { requirePageUser } from "@/lib/auth";
export const dynamic = "force-dynamic";

export default async function Settings() {
  await requirePageUser();
  return (
    <>
      <PageHead title="Settings" sub="Mailbox, users, roles and approval settings." />
      <div className="stack" style={{ maxWidth: 720 }}>
        <Panel title="Mailbox"><MailboxPanel /></Panel>
        <Panel title="Users and roles"><UsersPanel /></Panel>
        <Panel title="View as"><ViewAsPanel /></Panel>
        <Panel title="Approval policy and settings"><PolicyPanel /></Panel>
        <Panel title="WhatsApp"><WhatsAppPanel /></Panel>
      </div>
    </>
  );
}
