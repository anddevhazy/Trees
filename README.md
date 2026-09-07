# Claude Trees

claude.ai already stores your conversations as a tree — every time you edit a
prompt, the conversation forks — but the UI only exposes it as `< 2/3 >` arrows
on a single message. This extension draws the whole tree and lets you click any
node to jump to that branch.

## Install

```bash
npm install
npm run build
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load
unpacked** → pick the `dist/` folder.

Open a conversation on claude.ai and press **Cmd/Ctrl+Shift+E**, or click the
extension's toolbar icon.

## Reading the tree

- Depth runs left to right; every ending gets its own row.
- Blue dots are your messages, sand dots are Claude's.
- The orange path is the branch currently displayed on the page; the ring marks
  its final message.
- A small number beside a node is its child count — those are the exact points
  where you edited a message.
- Hover for a preview, scroll to zoom, drag to pan, **Fit** to re-centre.

## How it works

| Piece | What it does |
| --- | --- |
| [src/api.ts](src/api.ts) | Fetches `/api/organizations/…/chat_conversations/<id>?tree=True` from the content script, so your session cookies authenticate it. `tree=True` is what returns every branch rather than just the visible path. |
| [src/tree.ts](src/tree.ts) | Turns the flat `chat_messages` array into a tree via `parent_message_uuid`, resolves the current path from `current_leaf_message_uuid`, and lays it out. |
| [src/overlay.ts](src/overlay.ts) | Renders the SVG in a shadow root so claude.ai's CSS can't reach it. |
| [src/dom.ts](src/dom.ts) | Finds rendered messages and their branch arrows. |
| [src/navigate.ts](src/navigate.ts) | Branch switching: finds the shallowest point where the visible path diverges from the one you clicked, then clicks that message's arrows the right number of times — repeating per fork until the target is on screen. |

## The fragile part

`src/api.ts` and `src/dom.ts` both depend on private, undocumented surfaces.
The API shape has been stable for a long time; the DOM is the likelier thing to
break, since branch switching has to locate the real `< 2/3 >` controls.

All the selectors sit at the top of [src/dom.ts](src/dom.ts) in `MESSAGE_SELECTORS`
and `PAGER_TEXT`. If jumping stops working, open the console on claude.ai and run:

```js
__claudeTreesDebug()
```

It logs which elements the current selectors match and which of them have a
pager, so you can re-tune in one place. The overlay's status bar also reports
exactly which step failed rather than failing silently.

Read-only viewing (the tree, previews, stats) only needs the API and keeps
working even if the DOM selectors go stale.
