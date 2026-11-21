# WhatsApp service

This service links a WhatsApp phone and reads its chats. It can also send a message. It is separate from the web app. The backend connects to it later through `FORWARD_URL` and the HTTP API.

## Parts

| Part | Use |
| --- | --- |
| `evolution` | Evolution API `v2.3.7`. It links the phone through WhatsApp Web (Baileys) and keeps the chat history in its own Postgres. |
| `evolution-postgres`, `evolution-redis` | Storage for Evolution. They have no host port. |
| `bridge` | This code (`src/`). It gets the Evolution webhook, saves messages and media, and gives a small API. |

One Evolution instance is one linked phone. The default instance name is `vch-main`.

```
phone ──WhatsApp Web──► evolution ──webhook──► bridge ──► data/<instance>/messages.jsonl + media/
                                                  └──► FORWARD_URL (later: the backend)
```

## Risk

Evolution uses the unofficial WhatsApp Web protocol. WhatsApp can ban a number. Use a dedicated SIM for tests. Keep the send volume low. Do not send bulk messages.

## Start

1. Copy the env file: `cp .env.example .env`.
2. Fill the three secrets: `openssl rand -hex 24`.
3. Install the packages: `npm install`.
4. Start the stack: `npm run up`.
5. Check the health: `curl localhost:8091/health`. The result must show `"evolution":true`.

## Link a phone

Use the CLI or the web page.

**CLI with a QR code:**

1. Run `npm run wa -- link`.
2. On the phone, open WhatsApp, then Settings, then Linked devices, then Link a device.
3. Scan the QR code in the terminal.

**CLI with a pairing code:**

1. Run `npm run wa -- link 919812345678`. Use the country code and no `+`.
2. On the phone, open Linked devices, then Link a device, then "Link with phone number instead".
3. Type the 8-character code.

**Web page:** open `http://localhost:8091/link/vch-main#token=<BRIDGE_TOKEN>`. The browser does not send the part after `#` to the server. Without it, the page asks for the token.

The CLI waits until the state is `open`.

## Test the read path

| Command | Result |
| --- | --- |
| `npm run wa -- status` | The link state and the linked number |
| `npm run wa -- chats` | The newest chats from the history sync |
| `npm run wa -- messages <jid>` | The messages of one chat |
| `npm run wa -- inbox` | New messages as they arrive. Press Ctrl+C to stop |
| `npm run wa -- media <messageId> out.pdf` | The file of a media message |
| `npm run wa -- send 919812345678 hello` | Sends one text |
| `npm run wa -- logout` | Unlinks the phone |

Do this test after you link the phone:

1. Run `npm run wa -- inbox`.
2. From a second phone, send a text, a voice note, a photo and a PDF to the linked number.
3. Make sure that each message shows in the inbox with its `kind`.
4. Make sure that each media file is in `data/vch-main/media/`.
5. Run `npm run wa -- chats` and `npm run wa -- messages <jid>` to read the older history.

## HTTP API

Each route except `/health`, `/link/:name` and the webhook needs `Authorization: Bearer <BRIDGE_TOKEN>`. The bridge does not accept the token in the query string. The bridge listens on `127.0.0.1:8091` only.

| Route | Use |
| --- | --- |
| `GET /health` | Bridge and Evolution status |
| `GET /instances` | All instances and their state |
| `POST /instances/:name/link` `{ number? }` | Create the instance if needed and start the link. Returns `qr`, `qrCode` or `pairingCode` |
| `GET /instances/:name/status` | State, linked number, current QR or pairing code |
| `DELETE /instances/:name` | Unlink. Add `?purge=1` to delete the instance |
| `GET /instances/:name/chats` | Direct and group chats from the Evolution database |
| `GET /instances/:name/chats/:jid/messages?page=&limit=` | History of one chat, as `WaMessage` |
| `GET /instances/:name/inbox?since=&chat=&limit=` | Messages that came in by webhook |
| `GET /instances/:name/messages/:id/media` | The media file. The bridge downloads it on the first request. Only images, MP4, PDF and audio show inline. Other types download as `application/octet-stream` |
| `POST /instances/:name/send/text` `{ to, text, quotedId? }` | Send a text |
| `POST /instances/:name/send/media` `{ to, mediatype, media, mimetype?, fileName?, caption? }` | Send a file. `media` is a URL or base64 |

`to` is a number with the country code, or a full JID for a group.

## Message shape

Each message has the type `WaMessage` in `src/normalize.ts`. The `kind` is one of `text`, `voice`, `audio`, `image`, `video`, `document`, `sticker`, `location`, `contact`, `reaction`, `poll` or `other`. For media, `media.path` is the saved file, relative to `data/`. A voice note stays in its original format (`audio/ogg`, Opus). The backend decodes it with `ffmpeg`.

The bridge stores direct and group chats only. It skips status updates and channels.

## Connect the backend later

1. Set `FORWARD_URL` to a backend route. Set `FORWARD_TOKEN` to a shared secret.
2. The bridge sends a POST for each new message: `{ "type": "whatsapp.message", "message": WaMessage }`.
3. The bridge sends a POST for each link change: `{ "type": "whatsapp.connection", "instance", "state", "owner", "reason" }`.
4. The backend gets media from `GET /instances/:name/messages/:id/media`.
5. Set `ALLOW_NUMBERS` to keep only messages from known numbers.

## Settings that protect the user

- `readMessages` is `false`. The service does not send blue ticks.
- `alwaysOnline` is `false`. The phone keeps its normal presence.
- `syncFullHistory` is `false`. WhatsApp sends the recent history only.

## Run the bridge on the host

Use this for quick changes to `src/`.

1. Stop the container: `docker compose stop bridge`.
2. In `.env`, set `EVOLUTION_URL=http://localhost:8080`.
3. Run `npm run dev`.

Evolution must reach the webhook on the host. Set `WEBHOOK_URL=http://host.docker.internal:8091/webhook/evolution` and add `extra_hosts: ["host.docker.internal:host-gateway"]` to the `evolution` service. On Fedora, `firewalld` can block this path. The container setup has no such problem.

## Data

- `data/<instance>/messages.jsonl`: one `WaMessage` on each line.
- `data/<instance>/media/`: the media files.
- `data/<instance>/events.jsonl`: link changes and sends.
- The Docker volume `evolution_instances` holds the WhatsApp session. Do not delete it. If you delete it, you must link the phone again.

## Stop

- `npm run down` stops the stack and keeps the data.
- `docker compose down -v` also deletes the session and the history.
