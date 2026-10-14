import { promptsToMarkdown, questionsFileName, type Prompt } from './questions.js';

/** Styles for the picker. Hosts supply the colour tokens, as for the canvas. */
export const PICKER_CSS = `
.qp { display: flex; flex-direction: column; gap: 10px; }
.qp-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; position: sticky; top: 0; background: var(--panel); padding-bottom: 8px; border-bottom: 1px solid var(--line); z-index: 1; }
.qp-count { font-size: 12px; color: var(--muted); flex: 1; white-space: nowrap; }
.qp-item { display: flex; gap: 10px; align-items: flex-start; padding: 9px 10px; border: 1px solid var(--line); border-radius: 9px; background: var(--bg); }
.qp-item.on { border-color: var(--accent); }
.qp-item input { margin-top: 3px; accent-color: var(--accent); cursor: pointer; flex: none; }
.qp-main { min-width: 0; flex: 1; }
.qp-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 3px; }
.qp-meta { flex: 1; min-width: 0; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Collapsed, every card is the same couple of lines whatever the prompt's length or line breaks. */
.qp-text {
  font-size: 13px; line-height: 1.5; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden;
}
.qp-text.open { display: block; white-space: pre-wrap; }
.qp-more { flex: none; font: inherit; font-size: 11px; background: none; border: 0; padding: 0; color: var(--accent); cursor: pointer; }
.qp-more[hidden] { display: none; }
.qp-empty { color: var(--muted); padding: 24px 4px; }
`;

const storageKey = (treeId: string): string => `claude-trees:questions:${treeId}`;

function loadTicked(treeId: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(treeId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveTicked(treeId: string, ticked: Set<string>): void {
  try {
    localStorage.setItem(storageKey(treeId), JSON.stringify([...ticked]));
  } catch {
    // Storage can be blocked; the selection just won't survive a reload.
  }
}

/**
 * Lists every prompt with a checkbox, so the person marks which ones were real
 * questions, then exports those in full as Markdown. Ticks are remembered per
 * conversation in the host page's localStorage.
 */
export class QuestionPicker {
  readonly element: HTMLElement;
  private ticked: Set<string>;
  private countEl!: HTMLElement;
  private exportBtn!: HTMLButtonElement;
  private items = new Map<string, { row: HTMLElement; box: HTMLInputElement }>();

  constructor(
    private treeId: string,
    private title: string,
    private prompts: Prompt[],
  ) {
    const known = new Set(prompts.map((prompt) => prompt.id));
    this.ticked = new Set([...loadTicked(treeId)].filter((id) => known.has(id)));
    this.element = document.createElement('div');
    this.element.className = 'qp';
    this.build();
  }

  private build(): void {
    const bar = document.createElement('div');
    bar.className = 'qp-bar';
    this.countEl = document.createElement('div');
    this.countEl.className = 'qp-count';
    this.exportBtn = this.button('Export .md', () => this.download());
    bar.append(
      this.countEl,
      this.button('All', () => this.setAll(true)),
      this.button('None', () => this.setAll(false)),
      this.exportBtn,
    );
    this.element.append(bar);

    if (!this.prompts.length) {
      const empty = document.createElement('div');
      empty.className = 'qp-empty';
      empty.textContent = 'No prompts in this conversation.';
      this.element.append(empty);
    }

    this.prompts.forEach((prompt, index) => this.element.append(this.item(prompt, index)));
    this.refresh();
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'tool';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private item(prompt: Prompt, index: number): HTMLElement {
    const row = document.createElement('label');
    row.className = 'qp-item';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.ticked.has(prompt.id);
    box.addEventListener('change', () => {
      if (box.checked) this.ticked.add(prompt.id);
      else this.ticked.delete(prompt.id);
      this.persist();
    });

    const main = document.createElement('div');
    main.className = 'qp-main';
    const meta = document.createElement('div');
    meta.className = 'qp-meta';
    const when = prompt.createdAt ? new Date(prompt.createdAt).toLocaleString() : '';
    meta.textContent = [`#${index + 1}`, when, prompt.onCurrentPath ? '' : 'other branch']
      .filter(Boolean)
      .join(' · ');

    const text = document.createElement('div');
    text.className = 'qp-text';
    const flat = prompt.text.replace(/\s+/g, ' ').trim();
    text.textContent = flat;

    let expanded = false;
    const more = document.createElement('button');
    more.className = 'qp-more';
    more.textContent = 'Read more';
    more.hidden = true;
    more.addEventListener('click', (event) => {
      // Inside a <label>, a click would also toggle the checkbox.
      event.preventDefault();
      expanded = !expanded;
      text.classList.toggle('open', expanded);
      text.textContent = expanded ? prompt.text : flat;
      more.textContent = expanded ? 'Show less' : 'Read more';
    });
    // Only offer "Read more" when the clamp actually cut something, which depends on panel width.
    new ResizeObserver(() => {
      if (!expanded) more.hidden = text.scrollHeight <= text.clientHeight + 1;
    }).observe(text);

    const head = document.createElement('div');
    head.className = 'qp-head';
    head.append(meta, more);
    main.append(head, text);

    row.append(box, main);
    this.items.set(prompt.id, { row, box });
    return row;
  }

  private setAll(on: boolean): void {
    this.ticked = new Set(on ? this.prompts.map((prompt) => prompt.id) : []);
    for (const { box } of this.items.values()) box.checked = on;
    this.persist();
  }

  private persist(): void {
    saveTicked(this.treeId, this.ticked);
    this.refresh();
  }

  private refresh(): void {
    for (const [id, { row }] of this.items) row.classList.toggle('on', this.ticked.has(id));
    this.countEl.textContent = `${this.ticked.size} of ${this.prompts.length} selected`;
    this.exportBtn.disabled = this.ticked.size === 0;
  }

  private download(): void {
    const selected = this.prompts.filter((prompt) => this.ticked.has(prompt.id));
    if (!selected.length) return;
    const markdown = promptsToMarkdown(this.title, selected, this.prompts.length);
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = questionsFileName(this.title);
    // Content scripts render inside a shadow root, so the link goes on the page body.
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
