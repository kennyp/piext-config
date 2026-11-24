# piext-config

Shared settings for the TypeScript piext extensions: one file per level,
one table per extension.

| Level | Lives in | Applies to |
|---|---|---|
| **global** | `~/.config/piext/config.toml` | every session (a table with `dirs` only in those folders) |
| **local** | `<dir>/.pi/piext.toml` | sessions in that folder |
| **session** | the session's own entries | one session, again when it's resumed, following its branches |

Later levels win: defaults, then global, then local, then session.

```toml
# ~/.config/piext/config.toml
[guard]
mode = "warn"

[nudge]
delay = "2m"

[handoff]
dirs = ["~/Projects/**"]   # global only: this table applies just here
threshold = 0.75

[handoff.models.opus]
name = "*opus*"
threshold = 0.6
```

## Using it

Extensions include it as a git submodule and import it by path:

```sh
git submodule add https://github.com/kennyp/piext-config.git vendor/piext-config
```

```ts
import { load, set, setSession, watch, trust } from "./vendor/piext-config/index.ts";

const r = load("handoff", { cwd, defaults, entries: ctx.sessionManager.getBranch() });
r.value;    // merged settings
r.sources;  // "models.opus.threshold" → "global" | "local" | "session" | "default"
r.layers;   // each level's raw table, path, trust
r.errors;   // files that didn't parse, validate() failures

set("handoff", "local", { threshold: 0.6 }, { cwd });          // keeps comments
setSession(pi, "handoff", ctx.sessionManager.getBranch(), { enabled: false }); // null removes a key
const stop = watch(() => reload(), { cwd });
```

The extension needs `smol-toml` among its own dependencies (a peer
dependency here).

### Merging

By default tables merge and everything else (values, arrays) replaces. An
`apply(acc, table, layer)` option takes over, for settings where the order
or the source matters (piext-guard lets an untrusted local file only make
things stricter).

### Trust

A local file comes with the folder (a cloned repo, say), so each table in
it is untrusted until `trust(ns, cwd)` records its contents
(`~/.local/state/piext/trust.json`). Changing that table needs trust again;
changing another one doesn't. `untrusted: "skip"` leaves untrusted tables
out; by default they apply, and `layer.trusted` says which they were.

### Editing

`set` (and `editText`) change values on their own lines, add keys at the end
of their table and new tables at the end of the file, and refuse to write
anything that doesn't parse. Arrays of tables (`[[x]]`) are left to you.

## Develop

```sh
npm install && npm test
```

After a change here, update every extension's submodule:

```sh
for d in ../piext-*/vendor/piext-config; do git -C "$d" pull --ff-only; done
```
