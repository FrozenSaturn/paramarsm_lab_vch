// Run the pipeline on a local file without WhatsApp:  npm run cli -- path/to/file.(txt|pdf|ogg|mp3|jpg|png)
import { readFile } from "node:fs/promises";
import { extname, basename } from "node:path";
import { handle } from "./pipeline.js";

const f = process.argv[2]; if (!f) { console.error("usage: npm run cli -- <file>"); process.exit(1); }
const ext = extname(f).toLowerCase(); const buf = await readFile(f);
const base = { id: `cli-${Date.now()}`, from: "cli", name: basename(f) };
const m =
  ext === ".txt" ? { ...base, kind: "text" as const, text: buf.toString("utf8") } :
  ext === ".pdf" ? { ...base, kind: "document" as const, mimetype: "application/pdf", fileName: basename(f) } :
  [".ogg", ".opus", ".mp3", ".m4a", ".wav"].includes(ext) ? { ...base, kind: "audio" as const } :
  { ...base, kind: "image" as const, mimetype: ext === ".png" ? "image/png" : "image/jpeg" };
console.log(JSON.stringify(await handle(m, m.kind === "text" ? undefined : buf), null, 2));
