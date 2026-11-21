/** Split a mail body into the newest message and the quoted chain below it.
 *  The newest part is read as the message. The rest stays as context. */
const MARKERS: RegExp[] = [
  /^\s*On .{5,200}wrote:\s*$/i,                    // Gmail, Apple Mail: "On Thu, Nov 12 ... wrote:"
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i,     // Outlook
  /^\s*-{5,}\s*Forwarded message\s*-{5,}\s*$/i,
  /^\s*From:\s.+$/i,                               // Outlook header block: From / Sent / To / Subject
  /^\s*_{10,}\s*$/,
];

export function splitQuoted(text: string): { latest: string; quoted: string } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isMarker = MARKERS.some(re => re.test(line))
      // "On ... wrote:" often wraps onto two lines
      || (/^\s*On\s.{3,120}$/i.test(line) && i + 1 < lines.length && /wrote:\s*$/i.test(lines[i + 1]));
    // A "From:" line only counts when a Sent/Date line follows, so a normal sentence is safe.
    const fromOk = !/^\s*From:/i.test(line) || lines.slice(i + 1, i + 4).some(l => /^\s*(Sent|Date):/i.test(l));
    const quotedBlock = /^>/.test(line) && lines.slice(i, i + 3).every(l => /^>|^\s*$/.test(l));
    if ((isMarker && fromOk) || quotedBlock) { cut = i; break; }
  }
  return { latest: lines.slice(0, cut).join("\n").trim(), quoted: lines.slice(cut).join("\n").trim() };
}
