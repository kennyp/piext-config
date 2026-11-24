// The session level: overrides kept in the session itself (custom entries),
// so they come back when it's resumed and follow its branches.
import { deepMerge, SESSION_ENTRY, sessionTable, type Table } from "./config.ts";
import type { Patch } from "./edit.ts";

export interface EntryWriter {
  appendEntry(customType: string, data?: unknown): void;
}

const isTable = (v: unknown): v is Table => typeof v === "object" && v !== null && !Array.isArray(v);

/** Remove null leaves (and tables left empty). */
function prune(t: Table): Table {
  const out: Table = {};
  for (const [k, v] of Object.entries(t)) {
    if (v === null || v === undefined) continue;
    if (isTable(v)) {
      const p = prune(v);
      if (Object.keys(p).length) out[k] = p;
    } else out[k] = v;
  }
  return out;
}

/**
 * setSession merges patch (null removes a key) into the session's [ns]
 * overrides and saves the result. Returns the new overrides.
 */
export function setSession(pi: EntryWriter, ns: string, entries: readonly unknown[], patch: Patch): Table {
  const table = prune(deepMerge(sessionTable(ns, entries) ?? {}, patch as Table));
  pi.appendEntry(SESSION_ENTRY, { ns, table });
  return table;
}

/** clearSession drops every session override for ns. */
export function clearSession(pi: EntryWriter, ns: string): void {
  pi.appendEntry(SESSION_ENTRY, { ns, table: {} });
}
