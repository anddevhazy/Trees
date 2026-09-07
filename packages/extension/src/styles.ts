export const OVERLAY_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif; }

.backdrop {
  position: fixed; inset: 0; z-index: 2147483647;
  background: rgba(20, 18, 16, 0.55);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 32px;
}

.card {
  --bg: #faf9f5; --panel: #ffffff; --ink: #1f1e1c; --muted: #6f6a62;
  --line: #e3ded3; --accent: #d97757; --human: #6b8f9c; --assistant: #b8a68a;
  --diff-left: #3f7f6f; --diff-right: #9a6fb0;
  display: flex; flex-direction: column;
  width: min(1100px, 100%); height: min(760px, 100%);
  background: var(--bg); color: var(--ink);
  border: 1px solid var(--line); border-radius: 14px;
  box-shadow: 0 24px 64px rgba(0,0,0,.32);
  overflow: hidden;
}
@media (prefers-color-scheme: dark) {
  .card {
    --bg: #1f1e1c; --panel: #262523; --ink: #f2efe7; --muted: #9a938a;
    --line: #38352f; --accent: #d97757; --human: #7fa8b6; --assistant: #c4b294;
    --diff-left: #5fae98; --diff-right: #b894cd;
  }
}

header { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
.title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stats { font-size: 12px; color: var(--muted); white-space: nowrap; }
.spacer { flex: 1; }

button.tool {
  font-size: 12px; padding: 5px 10px; border-radius: 7px; cursor: pointer;
  border: 1px solid var(--line); background: var(--panel); color: var(--ink);
}
button.tool:hover { border-color: var(--accent); color: var(--accent); }
button.tool:disabled { opacity: .5; cursor: default; }

.canvas { position: relative; flex: 1; overflow: hidden; background: var(--panel); }
.tip {
  position: absolute; max-width: 340px; pointer-events: none; opacity: 0;
  transition: opacity .12s; padding: 9px 11px; border-radius: 9px;
  background: var(--bg); border: 1px solid var(--line); color: var(--ink);
  font-size: 12px; line-height: 1.45; box-shadow: 0 8px 24px rgba(0,0,0,.22);
  white-space: pre-wrap; z-index: 2;
}
.tip.on { opacity: 1; }
.tip .who { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-bottom: 4px; }

footer { display: flex; align-items: center; gap: 10px; padding: 9px 16px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted); min-height: 38px; }
footer.error { color: var(--accent); }
.legend { display: flex; gap: 12px; align-items: center; }
.legend span { display: flex; gap: 5px; align-items: center; }
.swatch { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
`;
