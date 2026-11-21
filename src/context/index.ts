import type { GetContext } from "../contracts/context";
// Day-0 stub (B replaces the body, signature stays).
export const getContext: GetContext = async () => ({ facts: [], passages: [], memories: [] });
