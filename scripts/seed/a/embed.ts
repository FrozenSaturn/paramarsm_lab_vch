// Embeds item codes that have no vector yet (needs pgvector). Run once on the demo machine: the first call downloads the model.
import type pg from "pg";
import { embed, toPgVector } from "../../../src/lib/embeddings";

export async function embedItemCodes(db: pg.Client) {
  const { rows } = await db.query(`select id, code, description from item_codes where embedding is null`);
  for (let i = 0; i < rows.length; i += 16) {
    const batch = rows.slice(i, i + 16);
    const vecs = await embed(batch.map(r => `${r.code} ${r.description}`));
    for (let j = 0; j < batch.length; j++) await db.query(`update item_codes set embedding = $1::vector where id = $2`, [toPgVector(vecs[j]), batch[j].id]);
  }
  return rows.length;
}
