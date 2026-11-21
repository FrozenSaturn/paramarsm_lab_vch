/**
 * Script and language detection for search. Pure code.
 * The detection uses the Unicode block of the letters. It does not use a model.
 */

const BENGALI = /[ঀ-৿]/g;
const DEVANAGARI = /[ऀ-ॿ]/g;
const LATIN = /[A-Za-z]/g;
/** Any letter that is not Latin: Bengali, Devanagari and other Indian scripts, and more. */
const NON_LATIN_LETTER = /[ऀ-෿؀-ۿЀ-ӿ一-鿿]/;

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

/** True when the text has letters from a non-Latin script (for example a Bengali question). */
export function hasNonLatinScript(text: string): boolean {
  return NON_LATIN_LETTER.test(text ?? "");
}

/** 'bn', 'hi' or 'en' from the most common script in the text. 'en' also covers other Latin text. */
export function detectLanguage(text: string): "bn" | "hi" | "en" {
  const t = text ?? "";
  const bn = count(t, BENGALI);
  const hi = count(t, DEVANAGARI);
  const en = count(t, LATIN);
  if (bn > hi && bn >= en * 0.3 && bn > 0) return "bn";
  if (hi > bn && hi >= en * 0.3 && hi > 0) return "hi";
  return "en";
}
