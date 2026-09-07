# Claude Trees

Conversations with Claude are trees, but you only ever see one path through them.
Every time you edit a prompt on claude.ai, or rewind in Claude Code, the
conversation forks — and the branch you left behind stays on record with no way
to look at it. This repo makes those trees visible.

Two front ends, one renderer:

| | Source | What you can do |
| --- | --- | --- |
| **Chrome extension** | claude.ai's own conversation API | See the tree, **and click a node to switch to that branch** |
| **Local CLI** | `~/.claude/projects/*.jsonl` Claude Code transcripts | See the tree, read any turn in full, compare two branches, see what each turn wrote |

The Claude Code side is deliberately read-only. See [Why the CLI can't jump](#why-the-cli-cant-jump).

## Install

```bash
npm install
npm run build
```

**Chrome extension** — `chrome://extensions` → Developer mode → Load unpacked →
`packages/extension/dist`. Open a conversation on claude.ai and press
**Cmd/Ctrl+Shift+E**, or click the toolbar icon.

**Claude Code viewer**

```bash
npm run trees          # or: node packages/cli/dist/cli.js
```

It serves on `127.0.0.1:4173` (loopback only — your transcripts never leave the
machine) and opens a browser. `--port <n>` and `--no-open` are available.

## Reading a tree

- Depth runs left to right; every ending gets its own row.
- Blue dots are your messages, sand dots are Claude's.
- The orange path is the branch that is currently live; the ring marks its end.
- A number beside a node is its child count — those are the fork points.
- A bar under a node means that turn wrote files or ran commands (CLI only).
- Hover for a preview, scroll to zoom, drag to pan, **Fit** to re-centre.

In the CLI viewer, click any turn to read it in full — message text, files
written, commands run, and every tool call with its arguments and output.
**Compare branches** then lets you pick two turns and see the two paths side by
side from the point where they split.

## Layout

```
packages/
  core/        tree building, layout, and the SVG canvas — shared by both
  extension/   claude.ai content script, DOM branch-switching, overlay shell
  cli/         transcript parser, local server, and the browser viewer
```

## How the claude.ai side works

[`api.ts`](packages/extension/src/api.ts) fetches
`/api/organizations/…/chat_conversations/<id>?tree=True` from the content
script, so your session cookies authenticate it. `tree=True` is the flag that
returns every branch instead of only the visible path; `parent_message_uuid`
gives the edges and `current_leaf_message_uuid` the highlighted path.

Branch jumping ([`navigate.ts`](packages/extension/src/navigate.ts)) has no API
behind it, so it does what you would do by hand: find the shallowest message
where the displayed path diverges from the one you clicked, click that message's
`< 2/3 >` arrows the right number of times, wait for the leaf to actually
change, and repeat once per fork.

**The fragile part.** [`dom.ts`](packages/extension/src/dom.ts) depends on
claude.ai's private markup — the likeliest thing to break. Every selector sits at
the top of that file. If jumping stops working, open the console on claude.ai and
run `__claudeTreesDebug()`: it logs what the selectors currently match and which
elements have a pager. Failures name the step that failed rather than doing
nothing. Viewing only needs the API, so the tree still renders if the DOM drifts.

## How the Claude Code side works

Transcripts live at `~/.claude/projects/<slug>/<session>.jsonl`, one JSON object
per line, each carrying `uuid` and `parentUuid` — the same parent-pointer shape
claude.ai uses. The forks are already there: one session in this author's history
holds 34 of them.

[`parse.ts`](packages/cli/src/node/parse.ts) streams each file rather than
loading it (transcripts reach tens of megabytes) and does three things that took
some care:

- **Collapses turns.** The raw log has a row per assistant message, per tool call
  and per tool result. Rendered literally, the branch structure disappears into
  tool plumbing. Each assistant message plus its tool traffic becomes one node.
- **Ignores non-conversational rows.** Attachments and hook output hang off the
  same parent as the assistant reply, so counting them as children makes every
  ordinary turn look like a fork.
- **Dedupes uuids.** A transcript can repeat one. A duplicate edge makes the walk
  re-enter a subtree and mint a second copy of every turn beneath it.

Full message bodies stay on disk; the tree payload carries only previews, and a
turn's complete text and tool output are fetched when you click it. Session
summaries are cached in `~/.cache/claude-trees` against each file's mtime and
size, with a schema version so a parser change invalidates them.

## Why the CLI can't jump

An abandoned claude.ai branch is inert text, so switching back to it costs
nothing. A Claude Code branch is not: turn 12 wrote a file, turn 15 ran a
migration. Re-entering an old branch would leave the transcript and the
filesystem disagreeing about what happened — which is why Claude Code entangles
rewind with checkpoints, and why parallel branches are git's job rather than the
transcript's.

So the viewer shows you the branches and lets you read them. It does not pretend
you can move back into one.
