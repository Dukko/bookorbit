# @bookorbit/obsidian-sync

Export BookOrbit reading stats and highlights into an Obsidian vault as
Dataview-friendly Markdown. Runs on demand or on a schedule (cron, systemd
timer); a single-file build means the scheduler only needs `node`.

- Pulls reading statistics, dashboard widgets, session timelines, and library
  statistics through the existing `/api/v1` API. No server or schema changes.
- Exports the annotation hub (paginated `/annotations`) as one Markdown note
  per book, plus a highlights index. Stale generated notes are pruned each run.
- Writes YAML frontmatter and Dataview inline fields (`key:: value`), so every
  headline figure is queryable in Obsidian.
- Reuses a login session across runs via the native refresh-token flow, so an
  hourly schedule keeps a single auth session instead of logging in each time.

## Generated notes

Inside the vault output folder (default `BookOrbit`):

```
BookOrbit/
├── BookOrbit Dashboard.md       stats summary, goal, streak, challenge
├── Reading Heatmap.md           daily minutes, monthly rollup, text grid
├── Reading Log.md               currently reading, recent sessions, finishes
├── Library Stats.md             formats, genres, top authors
├── Highlights.md                index of annotated books
└── Highlights/<book>-<bookId>.md  one note per book (with aliases)
```

## Usage

```bash
pnpm --filter @bookorbit/obsidian-sync build     # bundle dist/sync.mjs
```

Configure via `.env` (see `.env.example`):

```ini
BOOKORBIT_URL=http://192.168.1.10:3000
BOOKORBIT_USERNAME=you
BOOKORBIT_PASSWORD=secret
OBSIDIAN_VAULT_PATH=/path/to/your/vault
OBSIDIAN_OUTPUT_DIR=BookOrbit
```

Run:

```bash
pnpm --filter @bookorbit/obsidian-sync run sync
```

Flags: `--only=overview,heatmap,books,library,highlights`, `--days=N`,
`--no-highlights`, `--no-want-to-read`, `--quiet`, `--vault=<dir>`,
`--out=<dir>`, `--session-file=<path>`.

The first run logs in once and persists the session (`.bookorbit-session.json`,
mode 0600). Later runs reuse the refresh token, so the Sessions list in
BookOrbit keeps one entry. Delete the session file to force a fresh login.

### Scheduling

`bin/bookorbit-sync.sh` is a cron-ready wrapper: it sources `.env`, runs the
bundled script with `--quiet`, guards against overlapping runs, appends a
timestamped trace to `logs/bookorbit-sync.log`, and exits nonzero on failure.

```cron
0 * * * * /path/to/repo/packages/obsidian-sync/bin/bookorbit-sync.sh
```

The script must run on the machine that has the vault; it reaches BookOrbit
over HTTP and writes into the vault folder directly.

## Development

```bash
pnpm --filter @bookorbit/obsidian-sync typecheck
pnpm --filter @bookorbit/obsidian-sync test
pnpm --filter @bookorbit/obsidian-sync run sample   # preview notes with synthetic data
```

License: AGPL-3.0-only. Copyright (C) 2026 Dukko.
