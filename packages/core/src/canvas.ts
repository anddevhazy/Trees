import { CANVAS_CSS } from './canvas-css.js';
import { MARGIN } from './tree.js';
import type { ConversationTree, TreeNode } from './types.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

export { CANVAS_CSS };

export interface CanvasHandlers {
  onSelect?: (node: TreeNode, event: MouseEvent | KeyboardEvent) => void;
  onHover?: (node: TreeNode | null, screen: { x: number; y: number }) => void;
}

/** Marks a node as one side of a branch comparison. */
export type Pick = { id: string; side: 'left' | 'right' };

type View = { x: number; y: number; scale: number };

interface NodeEls {
  group: SVGGElement;
  dot: SVGCircleElement;
  /** Rings, drawn behind the dot. */
  under: SVGGElement;
  /** Fork count and touch mark, drawn over it. */
  over: SVGGElement;
  label: SVGTextElement | null;
}

const LABEL_CHARS = 40;
const LABEL_OFFSET = 19;
/** Rough advance of a 12.5px sans glyph, for reserving room without measuring. */
const LABEL_CHAR_WIDTH = 7;
const FORK_RADIUS = 10;
/** Below this zoom, labels and the grid are noise. */
const FAR_SCALE = 0.45;
const GRID = 22;
const MIN_SCALE = 0.04;

const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * What tells this ending apart: the first prompt after the last fork on the way
 * to it, or the ending's own text when the branch has no prompt of its own.
 */
function branchLabel(tree: ConversationTree, leaf: TreeNode): string {
  let pick: TreeNode = leaf;
  let found = false;
  for (let node: TreeNode | undefined = leaf; node; ) {
    if (node.sender === 'human') {
      pick = node;
      found = true;
    }
    if (node.siblingCount > 1 || !node.parentId) break;
    node = tree.byId.get(node.parentId);
  }
  // A reply used as a label would otherwise show its Markdown syntax.
  const text = (found ? pick : leaf).text
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/[*`]|__/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS).trimEnd()}…` : text;
}

/**
 * Renders a ConversationTree as a pannable, zoomable SVG. Knows nothing about
 * where the tree came from, so both the extension overlay and the local CLI
 * viewer draw with the same code.
 *
 * Marks are keyed by node id and kept between renders of the same tree, so a
 * branch switch animates rather than redraws.
 */
export class TreeCanvas {
  readonly element: SVGSVGElement;
  private viewport: SVGGElement;
  private edgeLayer = svgEl('g');
  private markerLayer = svgEl('g');
  private nodeLayer = svgEl('g');
  private marker: SVGGElement | null = null;
  private focusRing = svgEl('circle', { class: 'focus-ring' });
  /** The node the keyboard is on; null until an arrow key (or a tab in) picks one. */
  private focusedId: string | null = null;
  private nodeEls = new Map<string, NodeEls>();
  /** Keyed by the child's id. */
  private edgeEls = new Map<string, SVGPathElement>();
  private tree: ConversationTree | null = null;
  private drawnId: string | null = null;
  private lastPath: string[] | null = null;
  private extent = { width: 0, height: 0 };
  private view: View = { x: 0, y: 0, scale: 1 };
  private picks: Pick[] = [];
  private selectedId: string | null = null;
  private lit: Element[] = [];
  private raf = 0;
  private delayTimer = 0;
  private introTimer = 0;
  private dragged = false;
  /** True until the person pans or zooms, so a resize can keep the tree framed. */
  private fitted = false;

  constructor(private handlers: CanvasHandlers = {}) {
    this.element = svgEl('svg');
    this.element.classList.add('trees-svg');
    this.element.setAttribute('tabindex', '0');
    this.element.setAttribute('role', 'application');
    this.element.setAttribute(
      'aria-label',
      'Conversation tree. Arrow keys move between turns, Enter opens one.',
    );
    this.viewport = svgEl('g');
    this.viewport.append(this.edgeLayer, this.markerLayer, this.nodeLayer);
    this.element.append(this.viewport);
    this.installPanZoom();
    this.installKeyboard();
    // Covers a host panel opening beside the canvas, and a first render before attach.
    new ResizeObserver(() => {
      if (this.fitted) this.fit();
    }).observe(this.element);
  }

  get currentTree(): ConversationTree | null {
    return this.tree;
  }

  render(tree: ConversationTree): void {
    const sameTree = this.tree?.id === tree.id;
    this.tree = tree;
    const moved = this.draw();
    if (!sameTree) this.fit(false);
    else if (moved) this.reveal(moved);
    else this.applyView();
  }

  /** Highlights the two compared branches and fades everything else. */
  setPicks(picks: Pick[]): void {
    this.picks = picks;
    if (this.tree) this.draw();
  }

  /** Rings the node whose detail is open, and brings it into view. */
  setSelected(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    if (!this.tree) return;
    this.draw();
    // The host's panel opens in the same tick and narrows the canvas.
    if (id) requestAnimationFrame(() => !this.fitted && this.reveal(id));
  }

  private pickSide(id: string): 'left' | 'right' | null {
    return this.picks.find((pick) => pick.id === id)?.side ?? null;
  }

  private reset(treeId: string): void {
    this.edgeLayer.replaceChildren();
    this.nodeLayer.replaceChildren();
    this.nodeEls.clear();
    this.edgeEls.clear();
    this.lit = [];
    this.lastPath = null;
    this.drawnId = treeId;

    // A new marker starts at its final position instead of gliding in from the origin.
    this.marker = svgEl('g', { class: 'leaf-marker' });
    this.marker.append(
      svgEl('circle', { class: 'leaf-pulse', r: 12.5 }),
      svgEl('circle', { class: 'leaf-ring', r: 12.5 }),
    );
    this.markerLayer.replaceChildren(this.marker, this.focusRing);
  }

  /** Returns the new leaf's id when the current path moved, so the caller can follow it. */
  private draw(): string | null {
    const tree = this.tree;
    if (!tree) return null;
    const fresh = this.drawnId !== tree.id;
    if (fresh) this.reset(tree.id);

    for (const [id, els] of this.nodeEls) {
      if (tree.byId.has(id)) continue;
      els.group.remove();
      this.nodeEls.delete(id);
    }
    for (const [id, edge] of this.edgeEls) {
      const parentId = tree.byId.get(id)?.parentId;
      if (parentId && tree.byId.has(parentId)) continue;
      edge.remove();
      this.edgeEls.delete(id);
    }

    // Nodes on a compared branch, so the rest can be faded out.
    const emphasised = new Set<string>();
    for (const pick of this.picks) {
      let node: TreeNode | undefined = tree.byId.get(pick.id);
      while (node) {
        emphasised.add(node.id);
        node = node.parentId ? tree.byId.get(node.parentId) : undefined;
      }
    }
    const comparing = this.picks.length > 0;

    const delays = this.pathDelays(tree);
    let maxDepth = 1;
    if (fresh) for (const node of tree.byId.values()) maxDepth = Math.max(maxDepth, node.depth);
    // On first draw the tree grows outwards: each edge draws in over one step,
    // and the turn at its end pops in as the line arrives.
    const introStep = Math.min(70, 1100 / maxDepth);

    let right = tree.width;
    for (const node of tree.byId.values()) {
      const dim = comparing && !emphasised.has(node.id);
      const parent = node.parentId ? tree.byId.get(node.parentId) : undefined;
      if (parent) {
        let edge = this.edgeEls.get(node.id);
        if (!edge) {
          edge = svgEl('path', { class: 'edge' });
          edge.setAttribute('pathLength', '1');
          if (fresh) edge.style.setProperty('--i', `${(node.depth - 1) * introStep}ms`);
          this.edgeLayer.append(edge);
          this.edgeEls.set(node.id, edge);
        }
        const midX = (parent.x + node.x) / 2;
        edge.setAttribute(
          'd',
          `M ${parent.x} ${parent.y} C ${midX} ${parent.y}, ${midX} ${node.y}, ${node.x} ${node.y}`,
        );
        const side = comparing && !dim ? this.edgeSide(node, emphasised) : null;
        edge.classList.toggle(
          'active',
          comparing ? side === 'active' : node.onCurrentPath && parent.onCurrentPath,
        );
        edge.classList.toggle('left', side === 'left');
        edge.classList.toggle('right', side === 'right');
        edge.classList.toggle('dim', dim);
        setDelay(edge, delays.get(node.id));
      }

      const els = this.syncNode(tree, node, dim, fresh ? node.depth * introStep : null);
      setDelay(els.group, delays.get(node.id));
      if (els.label) {
        const width = (els.label.textContent?.length ?? 0) * LABEL_CHAR_WIDTH;
        right = Math.max(right, node.x + LABEL_OFFSET + width + MARGIN / 2);
      }
    }
    this.extent = { width: right, height: tree.height };

    const leaf = tree.currentPath[tree.currentPath.length - 1];
    if (this.marker) {
      this.marker.style.display = leaf ? '' : 'none';
      if (leaf) this.marker.style.transform = `translate(${leaf.x}px, ${leaf.y}px)`;
      this.marker.classList.toggle('dim', comparing && !!leaf && !emphasised.has(leaf.id));
      if (fresh && leaf) this.marker.style.setProperty('--i', `${leaf.depth * introStep}ms`);
    }
    this.placeFocusRing();

    if (fresh && !reducedMotion()) {
      this.element.style.setProperty('--step', `${introStep}ms`);
      this.element.classList.add('intro');
      clearTimeout(this.introTimer);
      this.introTimer = window.setTimeout(
        () => this.element.classList.remove('intro'),
        maxDepth * introStep + 700,
      );
    }

    if (!delays.size) return null;
    // Left in place, the stagger would also delay every later hover transition.
    clearTimeout(this.delayTimer);
    this.delayTimer = window.setTimeout(() => {
      for (const id of delays.keys()) {
        this.nodeEls.get(id)?.group.style.removeProperty('--d');
        this.edgeEls.get(id)?.style.removeProperty('--d');
      }
    }, 1400);
    return leaf?.id ?? null;
  }

  /**
   * When the current path moves to another branch, the new part lights up one
   * turn after another from the fork outwards. Maps node id -> delay in ms.
   */
  private pathDelays(tree: ConversationTree): Map<string, number> {
    const delays = new Map<string, number>();
    const previous = this.lastPath;
    const next = tree.currentPath.map((node) => node.id);
    this.lastPath = next;
    if (!previous || previous[previous.length - 1] === next[next.length - 1]) return delays;

    const was = new Set(previous);
    const first = next.findIndex((id) => !was.has(id));
    if (first < 0) return delays;
    const step = Math.min(45, 700 / (next.length - first));
    for (let index = first; index < next.length; index += 1) {
      delays.set(next[index], (index - first) * step);
    }
    return delays;
  }

  /** An edge belongs to whichever compared branch still contains it below the split. */
  private edgeSide(node: TreeNode, emphasised: Set<string>): string {
    const tree = this.tree!;
    for (const pick of this.picks) {
      let cursor: TreeNode | undefined = tree.byId.get(pick.id);
      while (cursor) {
        if (cursor.id === node.id) {
          // Shared prefix stays neutral; only the diverging tails get a colour.
          const shared = this.picks.filter((other) => {
            let walk: TreeNode | undefined = tree.byId.get(other.id);
            while (walk) {
              if (walk.id === node.id) return true;
              walk = walk.parentId ? tree.byId.get(walk.parentId) : undefined;
            }
            return false;
          });
          return shared.length > 1 ? 'active' : pick.side;
        }
        cursor = cursor.parentId ? tree.byId.get(cursor.parentId) : undefined;
      }
    }
    return emphasised.has(node.id) ? 'active' : 'dim';
  }

  private createNode(id: string): NodeEls {
    const group = svgEl('g', { class: 'node' });
    const dot = svgEl('circle', { class: 'dot' });
    const under = svgEl('g');
    const over = svgEl('g');
    group.append(svgEl('circle', { class: 'hit', r: 16 }), under, dot, over);

    // The tree is rebuilt on every fetch, so listeners look the node up afresh.
    const current = (): TreeNode | undefined => this.tree?.byId.get(id);
    group.addEventListener('mouseenter', () => {
      const node = current();
      if (!node) return;
      this.highlight(node);
      this.handlers.onHover?.(node, this.toScreen(node));
    });
    group.addEventListener('mouseleave', () => {
      this.highlight(null);
      this.handlers.onHover?.(null, { x: 0, y: 0 });
    });
    group.addEventListener('click', (event) => {
      const node = current();
      // A pan that happened to start on a node is not a selection.
      if (node && !this.dragged) this.handlers.onSelect?.(node, event);
    });

    this.nodeLayer.append(group);
    const els: NodeEls = { group, dot, under, over, label: null };
    this.nodeEls.set(id, els);
    return els;
  }

  private syncNode(tree: ConversationTree, node: TreeNode, dim: boolean, intro: number | null): NodeEls {
    let els = this.nodeEls.get(node.id);
    if (!els) {
      els = this.createNode(node.id);
      if (intro !== null) els.group.style.setProperty('--i', `${intro}ms`);
    }
    const { group, dot, under, over } = els;

    const fork = node.children.length > 1;
    const radius = fork ? FORK_RADIUS : node.onCurrentPath ? 7 : 5.5;
    group.setAttribute('transform', `translate(${node.x} ${node.y})`);
    group.classList.toggle('on', node.onCurrentPath);
    group.classList.toggle('off', !node.onCurrentPath);
    group.classList.toggle('fork', fork);
    group.classList.toggle('dim', dim);
    dot.setAttribute('class', `dot ${node.sender}`);
    dot.setAttribute('r', String(radius));

    under.replaceChildren();
    const side = this.pickSide(node.id);
    if (side) under.append(svgEl('circle', { class: `pick-ring ${side}`, r: radius + 5 }));
    else if (node.id === this.selectedId) {
      under.append(svgEl('circle', { class: 'select-ring', r: node.isCurrentLeaf ? 16.5 : radius + 4.5 }));
    }

    over.replaceChildren();
    if (fork) {
      const count = svgEl('text', { class: 'fork-count' });
      count.textContent = String(node.children.length);
      over.append(count);
    }

    // A turn that wrote files or ran commands gets a bar under the dot.
    const touched = (node.meta?.filesTouched?.length ?? 0) + (node.meta?.commands?.length ?? 0);
    if (touched) {
      over.append(
        svgEl('rect', {
          class: 'touch-mark',
          x: -Math.min(9, 2 + touched) / 2,
          y: radius + 2,
          width: Math.min(9, 2 + touched),
          height: 2,
          rx: 1,
        }),
      );
    }

    const text = node.children.length ? '' : branchLabel(tree, node);
    if (text && !els.label) {
      els.label = svgEl('text', { class: 'leaf-label', x: LABEL_OFFSET });
      group.append(els.label);
    } else if (!text && els.label) {
      els.label.remove();
      els.label = null;
    }
    if (els.label && els.label.textContent !== text) els.label.textContent = text;
    return els;
  }

  /** Lights the path from the root to the hovered node. */
  private highlight(node: TreeNode | null): void {
    for (const el of this.lit) el.classList.remove('hl');
    this.lit = [];
    this.element.classList.toggle('hovering', !!node);
    const tree = this.tree;
    for (let cursor = node ?? undefined; cursor && tree; ) {
      const group = this.nodeEls.get(cursor.id)?.group;
      const edge = this.edgeEls.get(cursor.id);
      for (const el of [group, edge]) {
        if (!el) continue;
        el.classList.add('hl');
        this.lit.push(el);
      }
      cursor = cursor.parentId ? tree.byId.get(cursor.parentId) : undefined;
    }
  }

  private toScreen(node: TreeNode): { x: number; y: number } {
    return {
      x: node.x * this.view.scale + this.view.x,
      y: node.y * this.view.scale + this.view.y,
    };
  }

  private applyView(): void {
    const { x, y, scale } = this.view;
    this.viewport.setAttribute('transform', `translate(${x} ${y}) scale(${scale})`);
    this.element.classList.toggle('far', scale < FAR_SCALE);
    this.element.style.backgroundSize = `${GRID * scale}px ${GRID * scale}px`;
    this.element.style.backgroundPosition = `${x}px ${y}px`;
  }

  private moveTo(target: View, animate: boolean, done?: () => void): void {
    cancelAnimationFrame(this.raf);
    if (!animate || reducedMotion()) {
      this.view = target;
      this.applyView();
      done?.();
      return;
    }
    const from = { ...this.view };
    // Timed from the first frame: a frame's timestamp can predate a clock read taken now.
    let started: number | null = null;
    const tick = (now: number): void => {
      started ??= now;
      const t = Math.min(1, (now - started) / 340);
      const eased = 1 - (1 - t) ** 3;
      this.view = {
        x: from.x + (target.x - from.x) * eased,
        y: from.y + (target.y - from.y) * eased,
        scale: from.scale + (target.scale - from.scale) * eased,
      };
      this.applyView();
      if (t < 1) this.raf = requestAnimationFrame(tick);
      else done?.();
    };
    this.raf = requestAnimationFrame(tick);
  }

  fit(animate = true): void {
    const tree = this.tree;
    if (!tree) return;
    const rect = this.element.getBoundingClientRect();
    this.fitted = true;
    if (!rect.width || !rect.height) return;
    const pad = 24;
    // Wider than the tree itself: branch labels hang off the right-hand endings.
    const { width, height } = this.extent;
    const scale = Math.max(
      Math.min((rect.width - pad * 2) / (width || 1), (rect.height - pad * 2) / (height || 1), 1.4),
      MIN_SCALE,
    );
    this.moveTo(
      { scale, x: (rect.width - width * scale) / 2, y: (rect.height - height * scale) / 2 },
      animate,
    );
  }

  /** Pans so a node sits in the middle, without changing zoom. */
  centreOn(id: string, done?: () => void): void {
    const node = this.tree?.byId.get(id);
    if (!node) return;
    const rect = this.element.getBoundingClientRect();
    this.fitted = false;
    this.moveTo(
      {
        scale: this.view.scale,
        x: rect.width / 2 - node.x * this.view.scale,
        y: rect.height / 2 - node.y * this.view.scale,
      },
      true,
      done,
    );
  }

  /** Like centreOn, but leaves the view alone when the node is already comfortably visible. */
  reveal(id: string, done?: () => void): void {
    const node = this.tree?.byId.get(id);
    if (!node) return;
    const rect = this.element.getBoundingClientRect();
    const { x, y } = this.toScreen(node);
    const inset = 40;
    if (x < inset || y < inset || x > rect.width - inset || y > rect.height - inset) this.centreOn(id, done);
    else done?.();
  }

  private placeFocusRing(): void {
    const node = this.focusedId ? this.tree?.byId.get(this.focusedId) : undefined;
    if (!node) this.focusedId = null;
    this.focusRing.style.display = node ? '' : 'none';
    if (!node) return;
    const radius = node.children.length > 1 ? FORK_RADIUS : node.onCurrentPath ? 7 : 5.5;
    this.focusRing.setAttribute('r', String(radius + 6));
    this.focusRing.setAttribute('transform', `translate(${node.x} ${node.y})`);
  }

  private focusNode(node: TreeNode): void {
    this.focusedId = node.id;
    this.placeFocusRing();
    this.highlight(node);
    this.handlers.onHover?.(null, { x: 0, y: 0 });
    // The preview is placed once the view has settled, or it would point at where the node was.
    this.reveal(node.id, () => {
      if (this.focusedId === node.id) this.handlers.onHover?.(node, this.toScreen(node));
    });
  }

  /** Left/right walk along a branch, up/down step to the nearest turn at the same depth. */
  private neighbour(node: TreeNode, key: string): TreeNode | undefined {
    const tree = this.tree!;
    if (key === 'ArrowLeft') return node.parentId ? tree.byId.get(node.parentId) : undefined;
    if (key === 'ArrowRight') {
      return node.children.find((child) => child.onCurrentPath) ?? node.children[0];
    }
    const down = key === 'ArrowDown';
    let best: TreeNode | undefined;
    for (const other of tree.byId.values()) {
      if (other.depth !== node.depth || other === node) continue;
      if (down ? other.y <= node.y : other.y >= node.y) continue;
      if (!best || Math.abs(other.y - node.y) < Math.abs(best.y - node.y)) best = other;
    }
    return best;
  }

  private installKeyboard(): void {
    const start = (): TreeNode | undefined => {
      const tree = this.tree;
      if (!tree) return undefined;
      return (
        (this.selectedId ? tree.byId.get(this.selectedId) : undefined) ??
        tree.currentPath[tree.currentPath.length - 1]
      );
    };

    // Tabbing in lands on a node straight away; a click that focuses the canvas does not.
    this.element.addEventListener('focus', () => {
      if (this.focusedId || !this.element.matches(':focus-visible')) return;
      const node = start();
      if (node) this.focusNode(node);
    });
    this.element.addEventListener('blur', () => {
      this.focusedId = null;
      this.placeFocusRing();
      this.highlight(null);
      this.handlers.onHover?.(null, { x: 0, y: 0 });
    });

    this.element.addEventListener('keydown', (event) => {
      const tree = this.tree;
      if (!tree || event.metaKey || event.ctrlKey || event.altKey) return;
      const current = this.focusedId ? tree.byId.get(this.focusedId) : undefined;
      if (event.key.startsWith('Arrow')) {
        event.preventDefault();
        event.stopPropagation();
        const next = current ? this.neighbour(current, event.key) : start();
        if (next) this.focusNode(next);
      } else if ((event.key === 'Enter' || event.key === ' ') && current) {
        event.preventDefault();
        event.stopPropagation();
        this.handlers.onSelect?.(current, event);
      }
    });
  }

  private installPanZoom(): void {
    let dragging = false;
    let originX = 0;
    let originY = 0;
    let startX = 0;
    let startY = 0;

    this.element.addEventListener('mousedown', (event) => {
      cancelAnimationFrame(this.raf);
      dragging = true;
      this.dragged = false;
      startX = event.clientX;
      startY = event.clientY;
      originX = event.clientX - this.view.x;
      originY = event.clientY - this.view.y;
      this.element.classList.add('dragging');
    });
    window.addEventListener('mousemove', (event) => {
      if (!dragging) return;
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > 4) this.dragged = true;
      this.fitted = false;
      this.view.x = event.clientX - originX;
      this.view.y = event.clientY - originY;
      this.applyView();
    });
    window.addEventListener('mouseup', () => {
      dragging = false;
      this.element.classList.remove('dragging');
    });

    this.element.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        cancelAnimationFrame(this.raf);
        this.fitted = false;
        const rect = this.element.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;
        const factor = Math.exp(-event.deltaY * 0.0015);
        const next = Math.min(3, Math.max(MIN_SCALE, this.view.scale * factor));
        const ratio = next / this.view.scale;
        this.view.x = pointerX - (pointerX - this.view.x) * ratio;
        this.view.y = pointerY - (pointerY - this.view.y) * ratio;
        this.view.scale = next;
        this.applyView();
      },
      { passive: false },
    );
  }
}

/** Beside the node, flipping to its left near the right edge and kept inside the canvas. */
export function placeTip(tip: HTMLElement, canvas: HTMLElement, screen: { x: number; y: number }): void {
  // Measured at the far left, so the right edge doesn't squeeze its width.
  tip.style.left = '0px';
  tip.style.top = '0px';
  const { width, height } = canvas.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  let left = screen.x + 18;
  if (left + w > width - 8) left = screen.x - 18 - w;
  tip.style.left = `${Math.max(8, Math.min(left, width - w - 8))}px`;
  tip.style.top = `${Math.max(8, Math.min(screen.y - 20, height - h - 8))}px`;
  tip.classList.add('on');
}

function setDelay(el: SVGElement, ms: number | undefined): void {
  if (ms !== undefined) el.style.setProperty('--d', `${ms}ms`);
  else if (el.style.getPropertyValue('--d')) el.style.removeProperty('--d');
}
