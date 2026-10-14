import { countForks, countLeaves, listPrompts } from '@claude-trees/core';
import type { ConversationTree, TreeNode } from '@claude-trees/core';
import { CANVAS_CSS, TreeCanvas } from '@claude-trees/core/canvas';
import { icon, logo, type IconName } from '@claude-trees/core/icons';
import { MARKDOWN_CSS, renderMarkdown } from '@claude-trees/core/markdown';
import { PICKER_CSS, QuestionPicker } from '@claude-trees/core/question-picker';
import { pageIsDark } from './dom';
import { OVERLAY_CSS } from './styles';

export interface OverlayHandlers {
  onRefresh: () => void;
  /** Switches claude.ai to the branch containing this node. */
  onJump: (node: TreeNode) => void;
}

/** Matches the closing animation in styles.ts. */
const CLOSE_MS = 140;

export class TreeOverlay {
  private host: HTMLElement;
  private root: ShadowRoot;
  private backdrop!: HTMLElement;
  private card!: HTMLElement;
  private titleEl!: HTMLElement;
  private statsEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private footer!: HTMLElement;
  private canvasEl!: HTMLElement;
  private emptyEl!: HTMLElement;
  private emptyText!: HTMLElement;
  private tip!: HTMLElement;
  private panel!: HTMLElement;
  private canvas: TreeCanvas;
  private tree: ConversationTree | null = null;
  /** The node whose detail is open, and its jump button, kept in step with the tree. */
  private shown: { id: string; jump: HTMLButtonElement } | null = null;
  private closeTimer = 0;

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
    style.textContent = `${OVERLAY_CSS}\n${CANVAS_CSS}\n${PICKER_CSS}\n${MARKDOWN_CSS}`;

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'backdrop';
    this.backdrop.addEventListener('mousedown', (event) => {
      if (event.target === this.backdrop) this.close();
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
    header.append(
      logo(),
      this.titleEl,
      this.statsEl,
      spacer,
      this.button('Questions', () => this.showQuestions(), 'questions'),
      this.button('Fit', () => this.canvas.fit(), 'fit'),
      this.button('Refresh', () => this.handlers.onRefresh(), 'refresh'),
      this.iconButton('Close', () => this.close()),
    );

    this.canvasEl = document.createElement('div');
    this.canvasEl.className = 'canvas';
    this.tip = document.createElement('div');
    this.tip.className = 'tip';
    this.emptyEl = document.createElement('div');
    this.emptyEl.className = 'empty-state';
    this.emptyText = document.createElement('div');
    this.emptyEl.append(logo(40), this.emptyText);
    this.canvasEl.append(this.canvas.element, this.emptyEl, this.tip);

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
      '<span><i class="swatch fork"></i>fork</span>' +
      '<span><i class="swatch" style="background:var(--accent)"></i>current path</span>';
    this.statusEl = document.createElement('div');
    this.footer.append(legend, this.statusEl);

    this.card.append(header, main, this.footer);
    this.backdrop.append(this.card);
    this.root.append(style, this.backdrop);
  }

  private button(label: string, onClick: () => void, glyph?: IconName): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'tool';
    if (glyph) btn.append(icon(glyph));
    btn.append(label);
    btn.addEventListener('click', onClick);
    return btn;
  }

  private iconButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'tool icon-only';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.append(icon('close', 16));
    btn.addEventListener('click', onClick);
    return btn;
  }

  get isOpen(): boolean {
    return this.host.isConnected && !this.closeTimer;
  }

  open(): void {
    clearTimeout(this.closeTimer);
    this.closeTimer = 0;
    this.backdrop.classList.remove('closing');
    this.card.dataset.theme = pageIsDark() ? 'dark' : 'light';
    if (!this.host.isConnected) document.body.append(this.host);
    document.addEventListener('keydown', this.onKeyDown, true);
  }

  close(): void {
    if (!this.isOpen) return;
    document.removeEventListener('keydown', this.onKeyDown, true);
    this.backdrop.classList.add('closing');
    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = 0;
      this.host.remove();
      this.backdrop.classList.remove('closing');
    }, CLOSE_MS);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!this.panel.hidden) this.closePanel();
      else this.close();
    }
  };

  setStatus(message: string, isError = false): void {
    this.statusEl.textContent = message;
    this.footer.classList.toggle('error', isError);
    // Until a tree is drawn, the canvas is blank, so the message goes there too.
    this.emptyText.textContent = message;
    this.emptyEl.classList.toggle('error', isError);
    if (isError) this.syncJump();
  }

  render(tree: ConversationTree): void {
    // The detail panel belongs to a conversation; a different one closes it.
    if (this.tree && this.tree.id !== tree.id) this.closePanel();
    this.tree = tree;
    this.emptyEl.hidden = true;
    this.titleEl.textContent = tree.name;
    this.statsEl.replaceChildren(
      stat(tree.byId.size, 'messages'),
      stat(countForks(tree), 'forks'),
      stat(countLeaves(tree), 'endings'),
      stat(tree.currentPath.length, 'on current path'),
    );
    this.canvas.render(tree);
    this.syncJump();
  }

  private closePanel(): void {
    this.panel.hidden = true;
    this.shown = null;
    this.canvas.setSelected(null);
  }

  /** A branch you are already on has nowhere to jump to. */
  private syncJump(): void {
    if (!this.shown) return;
    const onPath = this.tree?.currentPathIds.has(this.shown.id) ?? false;
    const { jump } = this.shown;
    jump.disabled = onPath;
    jump.replaceChildren(icon('jump'), onPath ? 'On this branch' : 'Jump to branch');
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
    const jump = this.button('Jump to branch', () => {
      jump.disabled = true;
      jump.replaceChildren(icon('jump'), 'Jumping…');
      this.handlers.onJump(node);
    });
    jump.classList.add('primary');
    head.append(who, spacer, jump, this.iconButton('Close', () => this.closePanel()));

    const body = document.createElement('div');
    body.className = 'panel-body';
    // Prompts are shown as typed; only Claude's replies are Markdown.
    if (!node.text) body.textContent = '(no message text)';
    else if (node.sender === 'assistant') body.append(renderMarkdown(node.text));
    else body.textContent = node.text;

    this.panel.replaceChildren(head, body);
    this.panel.hidden = false;
    this.shown = { id: node.id, jump };
    this.syncJump();
    this.canvas.setSelected(node.id);
  }

  /** claude.ai returns every message in full, so the tree already holds the whole prompt. */
  private showQuestions(): void {
    const tree = this.tree;
    if (!tree) {
      this.setStatus('The tree has not loaded yet.');
      return;
    }
    this.tip.classList.remove('on');
    this.closePanel();

    const head = document.createElement('div');
    head.className = 'panel-head';
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = 'Questions you asked';
    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    head.append(who, spacer, this.iconButton('Close', () => this.closePanel()));

    const prompts = listPrompts(tree);
    const body = document.createElement('div');
    body.className = 'panel-body questions';
    body.append(new QuestionPicker(tree.id, tree.name, prompts).element);

    this.panel.replaceChildren(head, body);
    this.panel.hidden = false;
    this.setStatus(`${prompts.length} prompts across all branches. Tick the real questions, then export.`);
  }
}

function stat(count: number, label: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'stat';
  const number = document.createElement('b');
  number.textContent = String(count);
  el.append(number, ` ${label}`);
  return el;
}

function heading(node: TreeNode): string {
  const version = node.siblingCount > 1 ? ` · version ${node.siblingIndex + 1}/${node.siblingCount}` : '';
  return `${node.sender === 'human' ? 'You' : 'Claude'} · depth ${node.depth + 1}${version}`;
}
