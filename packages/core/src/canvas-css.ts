/** Styles for the tree marks themselves. Hosts supply the surrounding chrome. */
export const CANVAS_CSS = `
.trees-svg { display: block; width: 100%; height: 100%; cursor: grab; }
.trees-svg.dragging { cursor: grabbing; }

.edge { fill: none; stroke: var(--line); stroke-width: 1.5; }
.edge.active { stroke: var(--accent); stroke-width: 2.5; }
.edge.dim { opacity: .25; }
.edge.left { stroke: var(--diff-left); stroke-width: 2.5; }
.edge.right { stroke: var(--diff-right); stroke-width: 2.5; }

.node { cursor: pointer; }
.node .hit { fill: transparent; }
.dot { stroke: var(--panel); stroke-width: 2; }
.dot.human { fill: var(--human); }
.dot.assistant { fill: var(--assistant); }
.node.off .dot { opacity: .45; }
.node.dim { opacity: .3; }
.node:hover .dot { stroke: var(--accent); }
.leaf-ring { fill: none; stroke: var(--accent); stroke-width: 2; }
.pick-ring { fill: none; stroke-width: 2.5; }
.pick-ring.left { stroke: var(--diff-left); }
.pick-ring.right { stroke: var(--diff-right); }
.fork-count { font-size: 9px; fill: var(--muted); }
.touch-mark { fill: var(--muted); opacity: .8; }
`;
