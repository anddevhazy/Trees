/** Styles for the tree marks themselves. Hosts supply the surrounding chrome. */
export const CANVAS_CSS = `
.trees-svg {
  display: block; width: 100%; height: 100%; cursor: grab; user-select: none;
  background-image: radial-gradient(circle, var(--line) 1px, transparent 1.3px);
}
.trees-svg.dragging { cursor: grabbing; }
.trees-svg.far { background-image: none; }

.edge {
  fill: none; stroke: var(--line); stroke-width: 1.5; stroke-linecap: round;
  transition: stroke .35s ease, stroke-width .35s ease, opacity .25s ease;
  transition-delay: var(--d, 0ms);
}
.trees-svg.hovering .edge { opacity: .5; }
.edge.hl { stroke: var(--muted); stroke-width: 2.25; }
.trees-svg.hovering .edge.hl, .trees-svg.hovering .edge.active { opacity: 1; }
.edge.active { stroke: var(--accent); stroke-width: 2.5; }
.edge.active.hl { stroke-width: 3.25; }
.edge.left { stroke: var(--diff-left); stroke-width: 2.5; }
.edge.right { stroke: var(--diff-right); stroke-width: 2.5; }
.edge.dim, .trees-svg.hovering .edge.dim { opacity: .25; }

.node { cursor: pointer; transition: opacity .25s ease; }
.node .hit { fill: transparent; }
.dot {
  stroke: var(--panel); stroke-width: 2; r: 5.5px;
  transition: r .3s ease, opacity .3s ease, stroke .15s ease;
  transition-delay: var(--d, 0ms);
}
.dot.human { fill: var(--human); }
.dot.assistant { fill: var(--assistant); }
.node.on .dot { r: 7px; }
.node.off .dot { opacity: .45; }
.node.hl .dot { opacity: 1; }
.node:hover .dot { stroke: var(--accent); r: 8.5px; }

/* Fork points are the story, so they get a hollow badge with the child count. */
.node.fork .dot { r: 9px; fill: var(--panel); stroke-width: 2.5; opacity: 1; }
.node.fork .dot.human { stroke: var(--human); }
.node.fork .dot.assistant { stroke: var(--assistant); }
.node.fork:hover .dot { r: 10.5px; stroke: var(--accent); }
.fork-count {
  font-size: 9.5px; font-weight: 700; fill: var(--ink);
  text-anchor: middle; dominant-baseline: central; pointer-events: none;
}
.node.dim { opacity: .3; }

.leaf-label {
  font-size: 11px; fill: var(--muted); dominant-baseline: central; pointer-events: none;
  transition: fill .3s ease, opacity .2s ease; transition-delay: var(--d, 0ms);
}
.node.on .leaf-label { fill: var(--ink); font-weight: 600; }
.node.hl .leaf-label { fill: var(--ink); }
.trees-svg.far .leaf-label { opacity: 0; }

.leaf-marker { pointer-events: none; transition: transform .5s cubic-bezier(.2, .8, .2, 1), opacity .25s ease; }
.leaf-marker.dim { opacity: .3; }
.leaf-ring { fill: none; stroke: var(--accent); stroke-width: 2; }
.leaf-pulse {
  fill: none; stroke: var(--accent); stroke-width: 2;
  transform-box: fill-box; transform-origin: center;
  animation: trees-pulse 2.4s ease-out infinite;
}
.select-ring { fill: none; stroke: var(--ink); stroke-width: 2; }
.pick-ring { fill: none; stroke-width: 2.5; }
.pick-ring.left { stroke: var(--diff-left); }
.pick-ring.right { stroke: var(--diff-right); }
.touch-mark { fill: var(--muted); opacity: .8; }

.trees-svg.intro .node, .trees-svg.intro .edge, .trees-svg.intro .leaf-marker {
  animation: trees-in .32s ease both; animation-delay: var(--i, 0ms);
}
@keyframes trees-in { from { opacity: 0; } }
@keyframes trees-pulse {
  from { transform: scale(1); opacity: .7; }
  to { transform: scale(2.1); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .trees-svg *, .trees-svg.intro * { transition: none !important; animation: none !important; }
}
`;
