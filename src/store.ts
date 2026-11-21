import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
const DIR = "data/quotes";
export async function save(rec: { message_id: string } & Record<string, unknown>) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(rec.message_id)) throw new Error("bad message id");
  await mkdir(DIR, { recursive: true });
  await writeFile(`${DIR}/${rec.message_id}.json`, JSON.stringify(rec, null, 2));
}
export async function list() {
  await mkdir(DIR, { recursive: true });
  return Promise.all((await readdir(DIR)).map(async f => JSON.parse(await readFile(`${DIR}/${f}`, "utf8"))));
}
