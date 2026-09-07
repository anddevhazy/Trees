import { CANVAS_CSS } from './canvas-css.js';
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
  onSelect?: (node: TreeNode, event: MouseEvent) => void;
  onHover?: (node: TreeNode | null, screen: { x: number; y: number }) => void;
}

/** Marks a node as one side of a branch comparison. */
export type Pick = { id: string; side: 'left' | 'right' };

/**
 * Renders a ConversationTree as a pannable, zoomable SVG. Knows nothing about
 * where the tree came from, so both the extension overlay and the local CLI
 * viewer draw with the same code.
 */
export class TreeCanvas {
  readonly element: SVGSVGElement;
  private viewport: SVGGElement;
  private tree: ConversationTree | null = null;
  private view = { x: 0, y: 0, scale: 1 };
  private picks: Pick[] = [];

  constructor(private handlers: CanvasHandlers = {}) {
    this.element = svgEl('svg');
    this.element.classList.add('trees-svg');
    this.viewport = svgEl('g');
    this.element.append(this.viewport);
    this.installPanZoom();
  }

  get currentTree(): ConversationTree | null {
    return this.tree;
  }

  render(tree: ConversationTree): void {
    const sameTree = this.tree?.id === tree.id;
    this.tree = tree;
    this.draw();
    if (sameTree) this.applyView();
    else this.fit();
  }

  /** Highlights the two compared branches and fades everything else. */
  setPicks(picks: Pick[]): void {
    this.picks = picks;
    if (this.tree) this.draw();
  }

  private pickSide(id: string): 'left' | 'right' | null {
    return this.picks.find((pick) => pick.id === id)?.side ?? null;
  }

  private draw(): void {
    const tree = this.tree;
    if (!tree) return;
    this.viewport.replaceChildren();

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

    for (const node of tree.byId.values()) {
      if (!node.parentId) continue;
      const parent = tree.byId.get(node.parentId);
      if (!parent) continue;
      const midX = (parent.x + node.x) / 2;
      const classes = ['edge'];
      if (comparing) {
        if (emphasised.has(node.id)) classes.push(this.edgeSide(node, emphasised));
        else classes.push('dim');
      } else if (node.onCurrentPath && parent.onCurrentPath) {
        classes.push('active');
      }
      this.viewport.append(
        svgEl('path', {
          class: classes.join(' '),
          d: `M ${parent.x} ${parent.y} C ${midX} ${parent.y}, ${midX} ${node.y}, ${node.x} ${node.y}`,
        }),
      );
    }

    for (const node of tree.byId.values()) {
      this.viewport.append(this.renderNode(node, comparing && !emphasised.has(node.id)));
    }
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

  private renderNode(node: TreeNode, dim: boolean): SVGGElement {
    const classes = ['node'];
    if (!node.onCurrentPath) classes.push('off');
    if (dim) classes.push('dim');

    const group = svgEl('g', {
      class: classes.join(' '),
      transform: `translate(${node.x} ${node.y})`,
    });
    group.append(svgEl('circle', { class: 'hit', r: 16 }));

    const side = this.pickSide(node.id);
    if (side) group.append(svgEl('circle', { class: `pick-ring ${side}`, r: 12 }));
    else if (node.isCurrentLeaf) group.append(svgEl('circle', { class: 'leaf-ring', r: 11 }));

    group.append(svgEl('circle', { class: `dot ${node.sender}`, r: node.onCurrentPath ? 7 : 5.5 }));

    if (node.children.length > 1) {
      const label = svgEl('text', { class: 'fork-count', x: 2, y: -11 });
      label.textContent = String(node.children.length);
      group.append(label);
    }

    // A turn that wrote files or ran commands gets a bar under the dot.
    const touched = (node.meta?.filesTouched?.length ?? 0) + (node.meta?.commands?.length ?? 0);
    if (touched) {
      group.append(
        svgEl('rect', {
          class: 'touch-mark',
          x: -Math.min(9, 2 + touched) / 2,
          y: 9,
          width: Math.min(9, 2 + touched),
          height: 2,
          rx: 1,
        }),
      );
    }

    group.addEventListener('mouseenter', (event) =>
      this.handlers.onHover?.(node, this.toScreen(node, event)),
    );
    group.addEventListener('mouseleave', () => this.handlers.onHover?.(null, { x: 0, y: 0 }));
    group.addEventListener('click', (event) => this.handlers.onSelect?.(node, event));
    return group;
  }

  private toScreen(node: TreeNode, _event: MouseEvent): { x: number; y: number } {
    return {
      x: node.x * this.view.scale + this.view.x,
      y: node.y * this.view.scale + this.view.y,
    };
  }

  private applyView(): void {
    this.viewport.setAttribute(
      'transform',
      `translate(${this.view.x} ${this.view.y}) scale(${this.view.scale})`,
    );
  }

  fit(): void {
    const tree = this.tree;
    if (!tree) return;
    const rect = this.element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const pad = 24;
    const scale = Math.min(
      (rect.width - pad * 2) / (tree.width || 1),
      (rect.height - pad * 2) / (tree.height || 1),
      1.4,
    );
    this.view.scale = Math.max(scale, 0.04);
    this.view.x = (rect.width - tree.width * this.view.scale) / 2;
    this.view.y = (rect.height - tree.height * this.view.scale) / 2;
    this.applyView();
  }

  /** Pans so a node sits in the middle, without changing zoom. */
  centreOn(id: string): void {
    const node = this.tree?.byId.get(id);
    if (!node) return;
    const rect = this.element.getBoundingClientRect();
    this.view.x = rect.width / 2 - node.x * this.view.scale;
    this.view.y = rect.height / 2 - node.y * this.view.scale;
    this.applyView();
  }

  private installPanZoom(): void {
    let dragging = false;
    let originX = 0;
    let originY = 0;

    this.element.addEventListener('mousedown', (event) => {
      dragging = true;
      originX = event.clientX - this.view.x;
      originY = event.clientY - this.view.y;
      this.element.classList.add('dragging');
    });
    window.addEventListener('mousemove', (event) => {
      if (!dragging) return;
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
        const rect = this.element.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;
        const factor = Math.exp(-event.deltaY * 0.0015);
        const next = Math.min(3, Math.max(0.04, this.view.scale * factor));
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
