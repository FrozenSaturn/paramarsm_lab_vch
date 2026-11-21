// Minimal .env loader so `npm run seed` needs no extra dependency.
import fs from "node:fs";
try {
  for (const line of fs.readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env: rely on the shell */ }
