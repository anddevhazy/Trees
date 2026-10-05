import { countForks, countLeaves, listPrompts } from '@claude-trees/core';
import type { ConversationTree, TreeNode } from '@claude-trees/core';
import { CANVAS_CSS, TreeCanvas } from '@claude-trees/core/canvas';
import { PICKER_CSS, QuestionPicker } from '@claude-trees/core/question-picker';
import { OVERLAY_CSS } from './styles';

export interface OverlayHandlers {
  onRefresh: () => void;
  /** Switches claude.ai to the branch containing this node. */
  onJump: (node: TreeNode) => void;
}

export class TreeOverlay {
  private host: HTMLElement;
  private root: ShadowRoot;
  private titleEl!: HTMLElement;
  private statsEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private footer!: HTMLElement;
  private canvasEl!: HTMLElement;
  private tip!: HTMLElement;
  private panel!: HTMLElement;
  private canvas: TreeCanvas;
  private tree: ConversationTree | null = null;

  constructor(private handlers: OverlayHandlers) {
    this.host = document.createElement('div');
    this.host.id = 'claude-trees-root';
    this.root = this.host.attachShadow({ mode: 'open' });
    this.canvas = new TreeCanvas({
      onSelect: (node) => this.showPanel(node),
      onHover: (node, screen) => this.showTip(node, screen),
    });
    this.build();
  }

  private build(): void {
    const style = document.createElement('style');
    style.textContent = `${OVERLAY_CSS}\n${CANVAS_CSS}\n${PICKER_CSS}`;

    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) this.close();
    });

    const card = document.createElement('div');
    card.className = 'card';

    const header = document.createElement('header');
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'title';
    this.titleEl.textContent = 'Conversation tree';
    this.statsEl = document.createElement('div');
    this.statsEl.className = 'stats';
    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    header.append(
      this.titleEl,
      this.statsEl,
      spacer,
      this.button('Questions', () => this.showQuestions()),
      this.button('Fit', () => this.canvas.fit()),
      this.button('Refresh', () => this.handlers.onRefresh()),
      this.button('Close', () => this.close()),
    );

    this.canvasEl = document.createElement('div');
    this.canvasEl.className = 'canvas';
    this.tip = document.createElement('div');
    this.tip.className = 'tip';
    this.canvasEl.append(this.canvas.element, this.tip);

    this.panel = document.createElement('aside');
    this.panel.className = 'panel';
    this.panel.hidden = true;

    const main = document.createElement('div');
    main.className = 'main';
    main.append(this.canvasEl, this.panel);

    this.footer = document.createElement('footer');
    const legend = document.createElement('div');
    legend.className = 'legend';
    legend.innerHTML =
      '<span><i class="swatch" style="background:var(--human)"></i>you</span>' +
      '<span><i class="swatch" style="background:var(--assistant)"></i>Claude</span>' +
      '<span><i class="swatch" style="background:var(--accent)"></i>current path</span>';
    this.statusEl = document.createElement('div');
    this.footer.append(legend, this.statusEl);

    card.append(header, main, this.footer);
    backdrop.append(card);
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
      if (!this.panel.hidden) this.panel.hidden = true;
      else this.close();
    }
  };

  setStatus(message: string, isError = false): void {
    this.statusEl.textContent = message;
    this.footer.classList.toggle('error', isError);
  }

  render(tree: ConversationTree): void {
    this.tree = tree;
    this.titleEl.textContent = tree.name;
    this.statsEl.textContent =
      `${tree.byId.size} messages · ${countForks(tree)} forks · ${countLeaves(tree)} endings · ` +
      `${tree.currentPath.length} on current path`;
    this.canvas.render(tree);
  }

  private showTip(node: TreeNode | null, screen: { x: number; y: number }): void {
    if (!node) {
      this.tip.classList.remove('on');
      return;
    }
    const snippet = node.text.length > 320 ? `${node.text.slice(0, 320)}…` : node.text;
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = heading(node);
    const body = document.createElement('div');
    body.textContent = snippet;
    this.tip.replaceChildren(who, body);

    const rect = this.canvasEl.getBoundingClientRect();
    this.tip.style.left = `${Math.min(Math.max(8, screen.x + 18), rect.width - 356)}px`;
    this.tip.style.top = `${Math.min(Math.max(8, screen.y - 20), rect.height - 120)}px`;
    this.tip.classList.add('on');
  }

  private showPanel(node: TreeNode): void {
    this.tip.classList.remove('on');

    const head = document.createElement('div');
    head.className = 'panel-head';
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = heading(node);
    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    head.append(
      who,
      spacer,
      this.button('Jump to branch', () => this.handlers.onJump(node)),
      this.button('Close', () => (this.panel.hidden = true)),
    );

    const body = document.createElement('div');
    body.className = 'panel-body';
    body.textContent = node.text || '(no message text)';

    this.panel.replaceChildren(head, body);
    this.panel.hidden = false;
  }

  /** claude.ai returns every message in full, so the tree already holds the whole prompt. */
  private showQuestions(): void {
    const tree = this.tree;
    if (!tree) {
      this.setStatus('The tree has not loaded yet.');
      return;
    }
    this.tip.classList.remove('on');

    const head = document.createElement('div');
    head.className = 'panel-head';
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = 'Questions you asked';
    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    head.append(who, spacer, this.button('Close', () => (this.panel.hidden = true)));

    const prompts = listPrompts(tree);
    const body = document.createElement('div');
    body.className = 'panel-body questions';
    body.append(new QuestionPicker(tree.id, tree.name, prompts).element);

    this.panel.replaceChildren(head, body);
    this.panel.hidden = false;
    this.setStatus(`${prompts.length} prompts across all branches. Tick the real questions, then export.`);
  }
}

function heading(node: TreeNode): string {
  const version = node.siblingCount > 1 ? ` · version ${node.siblingIndex + 1}/${node.siblingCount}` : '';
  return `${node.sender === 'human' ? 'You' : 'Claude'} · depth ${node.depth + 1}${version}`;
}
