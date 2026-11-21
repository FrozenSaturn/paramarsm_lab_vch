/** Attributes read from a work description by plain rules. The judge compares these between a site line and a master code. */
import { normDesc, similarity } from "../erp/hygiene";

const TYPOS: [RegExp, string][] = [[/\bHIGHT\b/g, "HEIGHT"], [/\bEXPENSION\b/g, "EXPANSION"], [/WATERPROOFINWORKS/g, "WATERPROOFING WORKS"], [/\bW C\b/g, "WC"]];
export const cleanDesc = (d: string) => TYPOS.reduce((s, [re, to]) => s.replace(re, to), normDesc(d));
export const descSimilarity = (a: string, b: string) => similarity(cleanDesc(a), cleanDesc(b));

const LOCATIONS: [string, RegExp][] = [
  ["toilet", /\b(TOILET|WC|BATHROOM)\b/], ["kitchen", /\bKITCHEN\b/], ["wash", /\b(WASH|UTILITY)\b/], ["balcony", /\b(BALCONY|SKY TERRACE)\b/],
  ["open_terrace", /\b(OT|OPEN TERRACE)\b/], ["roof", /\b(ROOF|MUMPTY)\b/], ["lift_pit", /\bLIFT PIT\b/], ["ugr", /\bUGR\b/], ["stp", /\bSTP\b/],
  ["tank", /\b(OWHT|TANK)\b/], ["expansion_joint", /\bEXPANSION JOINT\b/], ["screed", /\bSCREED\b/], ["pumping", /\bPUMP/], ["scaffolding", /\bSCAFFOLD/],
  ["depression", /\bDEPRESSION\b/],
];
export interface Attrs { locations: Set<string>; surface: "floor" | "wall" | null; grouting: "nozzle" | "pressure" | null; heightMm: number | null; variant: "A" | "B" | null }

export function attrsOf(description: string, code = ""): Attrs {
  const d = cleanDesc(description);
  const locations = new Set(LOCATIONS.filter(([, re]) => re.test(d)).map(([n]) => n));
  const floor = /\bFLOOR\b/.test(d), wall = /\bWALL\b/.test(d);
  const surface = floor && !wall ? "floor" : wall && !floor ? "wall" : null; // "FLOOR & WALL" is both: no single surface
  const grouting = /\bNOZZLE\b/.test(d) ? "nozzle" : /\bPRESSURE\b/.test(d) ? "pressure" : null;
  const h = d.match(/\b(\d{2,4}) MM\b/);
  const v = (d.match(/\b([AB])$/) ?? code.toUpperCase().match(/\.([AB])_?$/))?.[1] as "A" | "B" | undefined;
  return { locations, surface, grouting, heightMm: h ? Number(h[1]) : null, variant: v ?? null };
}

/** What agrees and what differs between a site line and a master code. A conflict is a hard "no". */
export function compareAttrs(site: Attrs, master: Attrs) {
  const agree: string[] = [], differ: string[] = [], conflicts: string[] = [];
  const shared = [...site.locations].filter(l => master.locations.has(l));
  if (site.locations.size && master.locations.size) {
    if (!shared.length) conflicts.push(`place: site says ${[...site.locations].join("/")}, master says ${[...master.locations].join("/")}`);
    else {
      agree.push(`place: ${shared.join(", ")}`);
      const extra = [...site.locations].filter(l => !master.locations.has(l));
      if (extra.length) differ.push(`site also names ${extra.join(", ")}`);
    }
  }
  if (site.surface && master.surface) (site.surface === master.surface ? agree : conflicts).push(`surface: site ${site.surface}, master ${master.surface}`);
  if (site.grouting && master.grouting) (site.grouting === master.grouting ? agree : conflicts).push(`grouting: site ${site.grouting}, master ${master.grouting}`);
  if (site.heightMm && master.heightMm) (site.heightMm === master.heightMm ? agree : conflicts).push(`height: site ${site.heightMm} mm, master ${master.heightMm} mm`);
  if (!site.variant && master.variant) differ.push(`master variant ${master.variant} is not named by site`);
  const considered = agree.length + conflicts.length;
  return { agree, differ, conflicts, agreement: considered ? agree.length / considered : 0.5 };
}
