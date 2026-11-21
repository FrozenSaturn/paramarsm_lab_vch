/**
 * Units as vendors print them, mapped to a dimension and a size in base units
 * (square metre, metre, number, lump sum). Plain code: the model never converts.
 */
export type Dim = "area" | "length" | "count" | "lump" | "volume" | "weight" | "unknown";

export interface Unit {
  /** Canonical code shown in the UI, e.g. "SQM", "SQFT", "RMT". */
  code: string;
  dim: Dim;
  /** How many base units one of this unit is (base: SQM, RMT, NOS, LS, CUM, KG). */
  toBase: number;
}

/** 1 sq ft = 0.09290304 sq m exactly, so 1 sq m = 10.7639104... sq ft. */
export const SQM_PER_SQFT = 0.09290304;
export const SQFT_PER_SQM = 1 / SQM_PER_SQFT;
export const M_PER_FT = 0.3048;

const UNITS: Record<string, Unit> = {
  SQM: { code: "SQM", dim: "area", toBase: 1 },
  SQFT: { code: "SQFT", dim: "area", toBase: SQM_PER_SQFT },
  RMT: { code: "RMT", dim: "length", toBase: 1 },
  RFT: { code: "RFT", dim: "length", toBase: M_PER_FT },
  NOS: { code: "NOS", dim: "count", toBase: 1 },
  LS: { code: "LS", dim: "lump", toBase: 1 },
  CUM: { code: "CUM", dim: "volume", toBase: 1 },
  KG: { code: "KG", dim: "weight", toBase: 1 },
};

/** Spellings seen in quotes and site sheets, after uppercasing and removing spaces, dots, slashes and dashes. */
const ALIASES: Record<string, keyof typeof UNITS> = {
  SQM: "SQM", SQMT: "SQM", SQMTR: "SQM", SQMETRE: "SQM", SQMETER: "SQM", M2: "SQM", SM: "SQM",
  SQFT: "SQFT", SFT: "SQFT", SQF: "SQFT", FT2: "SQFT", SQFEET: "SQFT", SQUAREFEET: "SQFT", SF: "SQFT",
  // OCR on scans reads the Q of SQFT as O ("SOFT"), seen on the SK quote.
  SOFT: "SQFT", S0FT: "SQFT",
  RMT: "RMT", RM: "RMT", RMTR: "RMT", RUNNINGMETRE: "RMT", RUNNINGMETER: "RMT", MTR: "RMT", METRE: "RMT", METER: "RMT", LM: "RMT",
  RFT: "RFT", RUNNINGFEET: "RFT", RUNNINGFOOT: "RFT",
  NOS: "NOS", NO: "NOS", NUMBER: "NOS", NUMBERS: "NOS", EACH: "NOS", EA: "NOS", PCS: "NOS", PC: "NOS",
  LS: "LS", LUMPSUM: "LS", JOB: "LS", LOT: "LS",
  CUM: "CUM", M3: "CUM", CUMTR: "CUM",
  KG: "KG", KGS: "KG",
};

export function parseUnit(raw: string | null | undefined): Unit & { raw: string } {
  const r = (raw ?? "").trim();
  const key = r.toUpperCase().replace(/[\s.\-/_]/g, "").replace(/²/g, "2");
  const alias = ALIASES[key];
  if (alias) return { ...UNITS[alias], raw: r };
  return { code: r.toUpperCase() || "?", dim: "unknown", toBase: NaN, raw: r };
}

/** The unit every comparison is shown in for a dimension: square metres for area, running metres for length. */
export function displayUnit(dim: Dim): Unit | null {
  switch (dim) {
    case "area": return UNITS.SQM;
    case "length": return UNITS.RMT;
    case "count": return UNITS.NOS;
    case "lump": return UNITS.LS;
    case "volume": return UNITS.CUM;
    case "weight": return UNITS.KG;
    default: return null;
  }
}

export const sameDim = (a: Unit, b: Unit) => a.dim !== "unknown" && a.dim === b.dim;

/** Rate per `from` unit expressed per `to` unit. Null when the units measure different things. */
export function convertRate(rate: number, from: Unit, to: Unit): number | null {
  if (!sameDim(from, to)) return null;
  return (rate * to.toBase) / from.toBase;
}

/** Quantity in `from` units expressed in `to` units. Null when the units measure different things. */
export function convertQty(qty: number, from: Unit, to: Unit): number | null {
  if (!sameDim(from, to)) return null;
  return (qty * from.toBase) / to.toBase;
}

/** Round money to paise and other figures to a fixed number of places, without float noise like 0.1 + 0.2. */
export const round = (n: number, places = 2) => {
  const f = 10 ** places;
  return Math.round((n + Number.EPSILON) * f) / f;
};
