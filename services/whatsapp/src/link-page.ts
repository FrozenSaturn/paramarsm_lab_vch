// A small page to link a phone. It reads the token from #token= in its own URL, or asks for it.
export function linkPage(instance: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link WhatsApp</title>
<style>
  :root { color-scheme: light dark; --fg:#1b1f24; --bg:#f6f7f9; --card:#fff; --muted:#5b6470; --ok:#13795b; --line:#d9dde3; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e8eaed; --bg:#14171a; --card:#1d2125; --muted:#9aa3ad; --ok:#3fb68b; --line:#30363d; } }
  body { margin:0; font:15px/1.5 system-ui, sans-serif; color:var(--fg); background:var(--bg); }
  main { max-width:440px; margin:40px auto; padding:0 16px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:20px; }
  h1 { font-size:20px; margin:0 0 4px; } p { margin:6px 0; color:var(--muted); }
  form { display:flex; gap:8px; margin:16px 0; }
  input { flex:1; padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:transparent; color:inherit; font:inherit; }
  button { padding:8px 14px; border:0; border-radius:8px; background:#175197; color:#fff; font:inherit; cursor:pointer; }
  #qr img { width:100%; max-width:300px; display:block; margin:12px auto; background:#fff; border-radius:8px; }
  #code { font:600 28px/1.2 ui-monospace, monospace; letter-spacing:4px; text-align:center; margin:16px 0; }
  #state { font-weight:600; } .ok { color:var(--ok); }
  ol { padding-left:20px; color:var(--muted); }
</style>
</head>
<body>
<main>
  <div class="card">
    <h1>Link WhatsApp</h1>
    <p>Instance <code>${instance}</code>. State: <span id="state">checking</span></p>
    <form id="f">
      <input id="num" placeholder="Phone with country code (optional)" inputmode="numeric">
      <button>Start</button>
    </form>
    <p>Leave the number empty to scan a QR code. Type the number to get a pairing code.</p>
    <div id="code"></div>
    <div id="qr"></div>
    <ol>
      <li>Open WhatsApp on the phone.</li>
      <li>Go to Settings, then Linked devices, then Link a device.</li>
      <li>Scan the QR code. Or tap "Link with phone number" and type the code.</li>
    </ol>
  </div>
</main>
<script>
  const instance = ${JSON.stringify(instance)};
  // The token comes from #token=... The fragment never reaches the server. Remove it from the address bar.
  let token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  if (location.hash) history.replaceState(null, '', location.pathname);
  if (!token) token = prompt('Bridge token') || '';
  const h = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
  const $ = (id) => document.getElementById(id);

  function render(s) {
    if (s.error) { $('state').textContent = s.error; return; }
    const open = s.state === 'open';
    $('state').textContent = open ? 'linked as ' + (s.profileName || '') + ' +' + (s.number || '') : s.state;
    $('state').className = open ? 'ok' : '';
    $('code').textContent = !open && s.pairingCode ? s.pairingCode.replace(/(.{4})(.{4})/, '$1-$2') : '';
    $('qr').replaceChildren();
    if (!open && s.qr && !s.pairingCode && s.qr.startsWith('data:image/')) {
      const img = document.createElement('img');
      img.alt = 'QR code';
      img.src = s.qr;
      $('qr').append(img);
    }
  }

  async function poll() {
    try {
      const r = await fetch('/instances/' + instance + '/status', { headers: h });
      render(await r.json());
    } catch (e) { $('state').textContent = 'bridge not reachable'; }
  }

  $('f').onsubmit = async (e) => {
    e.preventDefault();
    $('state').textContent = 'starting';
    const r = await fetch('/instances/' + instance + '/link', { method: 'POST', headers: h, body: JSON.stringify({ number: $('num').value }) });
    render(await r.json());
  };

  poll();
  setInterval(poll, 2500);
</script>
</body>
</html>`;
}
