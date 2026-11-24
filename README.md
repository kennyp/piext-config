# piext-config

Shared configuration for the TypeScript piext extensions. One file per level,
one table per extension:

| Level | File |
|---|---|
| global | `~/.config/piext/config.toml` |
| local | `<dir>/.pi/piext.toml` |
| session | the session's entries (`pi.appendEntry`) |

```toml
[handoff]
enabled = true
```

Extensions include it as a git submodule at `vendor/piext-config`.
