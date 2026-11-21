// FROZEN CONTRACT (Day 0). B implements the body in src/context/index.ts.
export interface ContextItem { text: string; source_id: string; source_type: string }
export interface ContextPack { facts: ContextItem[]; passages: ContextItem[]; memories: ContextItem[] }
export type GetContext = (caseId: string, purpose: string) => Promise<ContextPack>;
export interface MemoryStore {
  add(text: string, entities: string[], meta: { message_id: string }): Promise<void>;
  search(query: string, entities: string[]): Promise<ContextItem[]>;
  remove(memoryId: string): Promise<void>;
}
