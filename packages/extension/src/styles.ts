export const OVERLAY_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif; }

.backdrop {
  position: fixed; inset: 0; z-index: 2147483647;
  background: rgba(20, 18, 16, 0.55);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 32px;
  animation: fade-in .18s ease-out;
}
.backdrop.closing { animation: fade-out .14s ease-in forwards; }

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
  animation: card-in .22s cubic-bezier(.2, .8, .2, 1);
}
.backdrop.closing .card { animation: card-out .14s ease-in forwards; }
/* Set from claude.ai's own theme, which need not match the OS. */
.card[data-theme="dark"] {
  --bg: #1f1e1c; --panel: #262523; --ink: #f2efe7; --muted: #9a938a;
  --line: #38352f; --accent: #d97757; --human: #7fa8b6; --assistant: #c4b294;
  --diff-left: #5fae98; --diff-right: #b894cd;
}

header { display: flex; align-items: center; gap: 12px; padding: 12px 14px 12px 16px; border-bottom: 1px solid var(--line); }
.logo { flex: none; }
.title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stats { display: flex; gap: 6px; font-size: 11px; color: var(--muted); white-space: nowrap; }
.stat { padding: 2px 8px; border-radius: 999px; background: var(--panel); border: 1px solid var(--line); }
.stat b { color: var(--ink); font-weight: 600; }
.spacer { flex: 1; }

button.tool {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; padding: 5px 10px; border-radius: 7px; cursor: pointer;
  border: 1px solid var(--line); background: var(--panel); color: var(--ink);
  white-space: nowrap; transition: border-color .15s, color .15s, background .15s;
}
button.tool:hover { border-color: var(--accent); color: var(--accent); }
button.tool:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
button.tool:disabled { opacity: .5; cursor: default; border-color: var(--line); color: var(--ink); }
button.tool.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.tool.primary:hover { filter: brightness(1.06); color: #fff; }
button.tool.primary:disabled { background: var(--panel); border-color: var(--line); color: var(--muted); filter: none; opacity: 1; }
button.tool.icon-only { padding: 6px; border-color: transparent; background: none; color: var(--muted); }
button.tool.icon-only:hover { background: var(--panel); border-color: var(--line); color: var(--ink); }

.main { display: flex; flex: 1; min-height: 0; }
.canvas { position: relative; flex: 1; min-width: 0; overflow: hidden; background: var(--panel); }
.empty-state {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 24px; text-align: center; font-size: 13px; color: var(--muted); pointer-events: none;
}
.empty-state[hidden] { display: none; }
.empty-state.error { color: var(--accent); }
.empty-state .logo { opacity: .9; }

.panel {
  width: 400px; border-left: 1px solid var(--line); background: var(--panel);
  display: flex; flex-direction: column; min-height: 0; overflow: hidden;
  animation: panel-in .2s cubic-bezier(.2, .8, .2, 1);
}
.panel[hidden] { display: none; }
.panel-head { display: flex; align-items: center; gap: 8px; padding: 10px 10px 10px 14px; border-bottom: 1px solid var(--line); }
.panel-head .who { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); white-space: nowrap; }
.panel-body {
  overflow: auto; padding: 14px; min-height: 0; flex: 1;
  font-size: 13px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere;
}
.tip {
  position: absolute; max-width: 340px; pointer-events: none; opacity: 0;
  transform: translateY(3px); transition: opacity .12s, transform .12s;
  padding: 9px 11px; border-radius: 9px;
  background: var(--bg); border: 1px solid var(--line); color: var(--ink);
  font-size: 12px; line-height: 1.45; box-shadow: 0 8px 24px rgba(0,0,0,.22);
  white-space: pre-wrap; z-index: 2;
}
.tip.on { opacity: 1; transform: none; }
.tip .who { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-bottom: 4px; }

footer { display: flex; align-items: center; gap: 14px; padding: 9px 16px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted); min-height: 38px; }
footer.error { color: var(--accent); }
.legend { display: flex; gap: 12px; align-items: center; white-space: nowrap; }
.legend span { display: flex; gap: 5px; align-items: center; }
.swatch { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.swatch.fork { width: 10px; height: 10px; background: var(--panel); border: 2px solid var(--human); }

@keyframes fade-in { from { opacity: 0; } }
@keyframes fade-out { to { opacity: 0; } }
@keyframes card-in { from { opacity: 0; transform: translateY(8px) scale(.98); } }
@keyframes card-out { to { opacity: 0; transform: scale(.98); } }
@keyframes panel-in { from { opacity: 0; transform: translateX(14px); } }
@media (prefers-reduced-motion: reduce) {
  .backdrop, .card, .panel, .tip { animation: none !important; transition: none !important; }
}
`;
