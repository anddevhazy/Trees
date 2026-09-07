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
