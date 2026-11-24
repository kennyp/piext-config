// piext-config: the shared settings of the TypeScript piext extensions.
// See README.md.
export {
  load,
  readLayers,
  trust,
  sessionTable,
  deepMerge,
  leafKeys,
  hashTable,
  parseFile,
  globalPath,
  localPath,
  stateDir,
  SESSION_ENTRY,
  DIRS_KEY,
  type Scope,
  type Table,
  type Layer,
  type Loaded,
  type LoadOptions,
  type ReadOptions,
  type Sources,
} from "./src/config.ts";
export { set, editText, parseKeyPath, keyPath, quoteKey, type Patch, type SetOptions } from "./src/edit.ts";
export { setSession, clearSession, type EntryWriter } from "./src/session.ts";
export { watch, type WatchOptions } from "./src/watch.ts";
export { glob, globToRegExp, inDir, hasWildcard, specificity, type GlobOptions } from "./src/glob.ts";
