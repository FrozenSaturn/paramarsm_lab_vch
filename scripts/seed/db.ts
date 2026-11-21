import pg from "pg";
import "../../scripts/seed/env";

export const connect = async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  return c;
};

/** Find a row by its natural key; update it if present, insert it if not. Names come from code, never from input. */
export async function upsert(db: pg.Client, table: string, key: Record<string, unknown>, data: Record<string, unknown> = {}): Promise<string> {
  const kc = Object.keys(key);
  const found = await db.query(`select id from ${table} where ${kc.map((k, i) => `${k} = $${i + 1}`).join(" and ")}`, kc.map(k => key[k]));
  const dc = Object.keys(data);
  if (found.rows[0]) {
    if (dc.length) await db.query(`update ${table} set ${dc.map((k, i) => `${k} = $${i + 1}`).join(", ")} where id = $${dc.length + 1}`, [...dc.map(k => data[k]), found.rows[0].id]);
    return found.rows[0].id;
  }
  const all = { ...key, ...data };
  const cols = Object.keys(all);
  const ins = await db.query(`insert into ${table} (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id`, cols.map(c => all[c]));
  return ins.rows[0].id;
}
