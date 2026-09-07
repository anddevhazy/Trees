import { OVERLAY_CSS } from './styles';
import { countForks, countLeaves } from './tree';
import type { ConversationTree, TreeNode } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

export interface OverlayHandlers {
  onRefresh: () => void;
  onSelect: (node: TreeNode) => void;
}

export class TreeOverlay {
  private host: HTMLElement;
  private root: ShadowRoot;
  private card!: HTMLElement;
  private titleEl!: HTMLElement;
  private statsEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private canvas!: HTMLElement;
  private tip!: HTMLElement;
  private svgEl!: SVGSVGElement;
  private viewport!: SVGGElement;
  private tree: ConversationTree | null = null;
  private view = { x: 0, y: 0, scale: 1 };

  constructor(private handlers: OverlayHandlers) {
    this.host = document.createElement('div');
    this.host.id = 'claude-trees-root';
    this.root = this.host.attachShadow({ mode: 'open' });
    this.build();
  }

  private build(): void {
    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;

    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) this.close();
    });

    this.card = document.createElement('div');
    this.card.className = 'card';

    const header = document.createElement('header');
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'title';
    this.titleEl.textContent = 'Conversation tree';
    this.statsEl = document.createElement('div');
    this.statsEl.className = 'stats';

    const spacer = document.createElement('div');
    spacer.className = 'spacer';

    const fitBtn = this.button('Fit', () => this.fit());
    const refreshBtn = this.button('Refresh', () => this.handlers.onRefresh());
    const closeBtn = this.button('Close', () => this.close());

    header.append(this.titleEl, this.statsEl, spacer, fitBtn, refreshBtn, closeBtn);

    this.canvas = document.createElement('div');
    this.canvas.className = 'canvas';
    this.svgEl = svg('svg');
    this.viewport = svg('g');
    this.svgEl.append(this.viewport);
    this.tip = document.createElement('div');
    this.tip.className = 'tip';
    this.canvas.append(this.svgEl, this.tip);
    this.installPanZoom();

    const footer = document.createElement('footer');
    const legend = document.createElement('div');
    legend.className = 'legend';
    legend.innerHTML =
      '<span><i class="swatch" style="background:var(--human)"></i>you</span>' +
      '<span><i class="swatch" style="background:var(--assistant)"></i>Claude</span>' +
      '<span><i class="swatch" style="background:var(--accent)"></i>current path</span>';
    this.statusEl = document.createElement('div');
    footer.append(legend, this.statusEl);

    this.card.append(header, this.canvas, footer);
    backdrop.append(this.card);
    this.root.append(style, backdrop);
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'tool';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  get isOpen(): boolean {
    return this.host.isConnected;
  }

  open(): void {
    if (!this.host.isConnected) document.body.append(this.host);
    document.addEventListener('keydown', this.onKeyDown, true);
  }

  close(): void {
    this.host.remove();
    document.removeEventListener('keydown', this.onKeyDown, true);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.close();
    }
  };

  setStatus(message: string, isError = false): void {
    this.statusEl.textContent = message;
    this.statusEl.parentElement?.classList.toggle('error', isError);
  }

  render(tree: ConversationTree): void {
    const isSameConversation = this.tree?.conversationId === tree.conversationId;
    this.tree = tree;
    this.titleEl.textContent = tree.name;
    this.statsEl.textContent =
      `${tree.byId.size} messages · ${countForks(tree)} forks · ${countLeaves(tree)} endings · ` +
      `${tree.currentPath.length} on current path`;

    this.viewport.replaceChildren();
    for (const node of tree.byId.values()) {
      if (!node.parentId) continue;
      const parent = tree.byId.get(node.parentId)!;
      const active = node.onCurrentPath && parent.onCurrentPath;
      const midX = (parent.x + node.x) / 2;
      const path = svg('path', {
        class: `edge${active ? ' active' : ''}`,
        d: `M ${parent.x} ${parent.y} C ${midX} ${parent.y}, ${midX} ${node.y}, ${node.x} ${node.y}`,
      });
      this.viewport.append(path);
    }

    for (const node of tree.byId.values()) this.viewport.append(this.renderNode(node));

    if (!isSameConversation) this.fit();
    else this.applyView();
  }

  private renderNode(node: TreeNode): SVGGElement {
    const group = svg('g', {
      class: `node${node.onCurrentPath ? '' : ' off'}`,
      transform: `translate(${node.x} ${node.y})`,
    });
    group.append(svg('circle', { class: 'hit', r: 16 }));
    if (node.isCurrentLeaf) group.append(svg('circle', { class: 'leaf-ring', r: 11 }));
    group.append(svg('circle', { class: `dot ${node.sender}`, r: node.onCurrentPath ? 7 : 5.5 }));

    if (node.children.length > 1) {
      const label = svg('text', { class: 'fork-count', x: 2, y: -11 });
      label.textContent = `${node.children.length}`;
      group.append(label);
    }

    group.addEventListener('mouseenter', () => this.showTip(node));
    group.addEventListener('mouseleave', () => this.tip.classList.remove('on'));
    group.addEventListener('click', () => this.handlers.onSelect(node));
    return group;
  }

  private showTip(node: TreeNode): void {
    const snippet = node.text.length > 320 ? `${node.text.slice(0, 320)}…` : node.text;
    this.tip.replaceChildren();
    const who = document.createElement('div');
    who.className = 'who';
    const position = node.siblingCount > 1 ? ` · version ${node.siblingIndex + 1}/${node.siblingCount}` : '';
    who.textContent = `${node.sender === 'human' ? 'You' : 'Claude'} · depth ${node.depth + 1}${position}`;
    const body = document.createElement('div');
    body.textContent = snippet;
    this.tip.append(who, body);

    const rect = this.canvas.getBoundingClientRect();
    const screenX = node.x * this.view.scale + this.view.x;
    const screenY = node.y * this.view.scale + this.view.y;
    const left = Math.min(Math.max(8, screenX + 18), rect.width - 356);
    const top = Math.min(Math.max(8, screenY - 20), rect.height - 120);
    this.tip.style.left = `${left}px`;
    this.tip.style.top = `${top}px`;
    this.tip.classList.add('on');
  }

  private applyView(): void {
    this.viewport.setAttribute(
      'transform',
      `translate(${this.view.x} ${this.view.y}) scale(${this.view.scale})`,
    );
  }

  fit(): void {
    if (!this.tree) return;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const pad = 24;
    const scale = Math.min(
      (rect.width - pad * 2) / (this.tree.width || 1),
      (rect.height - pad * 2) / (this.tree.height || 1),
      1.4,
    );
    this.view.scale = Math.max(scale, 0.1);
    this.view.x = (rect.width - this.tree.width * this.view.scale) / 2;
    this.view.y = (rect.height - this.tree.height * this.view.scale) / 2;
    this.applyView();
  }

  private installPanZoom(): void {
    let dragging = false;
    let originX = 0;
    let originY = 0;

    this.svgEl.addEventListener('mousedown', (event) => {
      dragging = true;
      originX = event.clientX - this.view.x;
      originY = event.clientY - this.view.y;
      this.svgEl.classList.add('dragging');
    });
    window.addEventListener('mousemove', (event) => {
      if (!dragging) return;
      this.view.x = event.clientX - originX;
      this.view.y = event.clientY - originY;
      this.applyView();
    });
    window.addEventListener('mouseup', () => {
      dragging = false;
      this.svgEl.classList.remove('dragging');
    });

    this.svgEl.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;
        const factor = Math.exp(-event.deltaY * 0.0015);
        const next = Math.min(3, Math.max(0.1, this.view.scale * factor));
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
