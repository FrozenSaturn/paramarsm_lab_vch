import { s } from "./ui";

/**
 * A small search form for case and vendor pages. It sends a GET to /search, with the case
 * or vendor as a hidden filter, so the results page is a plain link that a person can share.
 */
export function SearchBox({ caseId, vendorId, defaultValue, placeholder }: { caseId?: string; vendorId?: string; defaultValue?: string; placeholder?: string }) {
  const scope = caseId ? "this case" : vendorId ? "this vendor" : "all documents";
  return (
    <form action="/search" method="get" role="search" style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
      {caseId && <input type="hidden" name="case" value={caseId} />}
      {vendorId && <input type="hidden" name="vendor" value={vendorId} />}
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        required
        aria-label={`Search ${scope}`}
        placeholder={placeholder ?? `Search ${scope} (English, বাংলা, हिन्दी)`}
        style={{ flex: 1, minWidth: 0, padding: "6px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 }}
      />
      <button type="submit" style={s.primary}>Search</button>
    </form>
  );
}
