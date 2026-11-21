export default function Settings() {
  return <><h1>Settings</h1><p>Outbound mode: {process.env.OUTBOUND_MODE ?? "sandbox"}</p></>;
}
