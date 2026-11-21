import { connect } from "./db";
import { seedUsers, seedProjects, seedVendors, seedItemCodes, seedAmaraBoq, seedPastCases, seedPhones } from "./a/master";
import { embedItemCodes } from "./a/embed";

const db = await connect();
try {
  console.log("A: users", await seedUsers(db));
  const projects = await seedProjects(db);
  console.log("A: projects", Object.keys(projects).length);
  const v = await seedVendors(db);
  console.log(`A: vendors ${v.quoting} quoting + ${v.aquina} from Aquina list`);
  console.log("A: item codes", await seedItemCodes(db));
  console.log("A: Amara BOQ", await seedAmaraBoq(db, projects["Vinayak Amara"]));
  await seedPastCases(db, projects, v.ids);
  console.log("A: past cases seeded");
  console.log("A: phone numbers set", await seedPhones(db));
  if (process.env.SKIP_EMBED === "true") console.log("A: embeddings skipped");
  else console.log("A: embedded", await embedItemCodes(db), "item codes");
  // B's seed (vendor performance, memories) is added by B in scripts/seed/b/index.ts
  const bPath = "./b/index"; // B adds this file; absent until then
  try { await (await import(bPath)).seedB(db); } catch (e: any) { if (e.code !== "ERR_MODULE_NOT_FOUND" && !String(e.message).includes("Cannot find")) throw e; }
} finally { await db.end(); }
