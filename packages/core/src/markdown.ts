/** Styles for rendered replies. Hosts supply the colour tokens, as for the canvas. */
export const MARKDOWN_CSS = `
.md { white-space: normal; overflow-wrap: anywhere; }
.md > :first-child { margin-top: 0; }
.md > :last-child { margin-bottom: 0; }
.md p, .md ul, .md ol, .md pre, .md blockquote, .md table { margin: 0 0 10px; }
.md h1, .md h2, .md h3, .md h4, .md h5, .md h6 { margin: 16px 0 6px; line-height: 1.3; font-weight: 650; }
.md h1 { font-size: 1.3em; } .md h2 { font-size: 1.18em; } .md h3 { font-size: 1.08em; }
.md h4, .md h5, .md h6 { font-size: 1em; }
.md ul, .md ol { padding-left: 20px; }
.md li { margin: 2px 0; }
.md li > ul, .md li > ol, .md li > pre { margin: 4px 0; }
.md code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .92em;
  padding: 1px 4px; border-radius: 4px; background: var(--bg); border: 1px solid var(--line);
}
.md pre {
  padding: 10px 12px; border-radius: 8px; background: var(--bg); border: 1px solid var(--line);
  overflow-x: auto; white-space: pre; overflow-wrap: normal; line-height: 1.45;
}
.md pre code { padding: 0; border: 0; background: none; font-size: 12px; }
.md blockquote { padding: 2px 0 2px 12px; border-left: 3px solid var(--line); color: var(--muted); }
.md hr { border: 0; border-top: 1px solid var(--line); margin: 14px 0; }
.md a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.md table { border-collapse: collapse; display: block; overflow-x: auto; max-width: 100%; }
.md th, .md td { border: 1px solid var(--line); padding: 4px 8px; text-align: left; vertical-align: top; }
.md th { background: var(--bg); font-weight: 600; }
`;

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

// Escape | code | link | bold | bold | strike | italic | italic | bare URL.
const INLINE =
  /\\([\\`*_{}[\]()#+\-.!~|>])|(`+)([\s\S]+?)\2|\[([^\]]+)\]\(([^)\s]+)\)|\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*(?!\*)|__(?!\s)([\s\S]+?)(?<!\s)__|~~([\s\S]+?)~~|\*(?!\s)([^*]+?)(?<!\s)\*|(?<!\w)_(?!\s)([^_]+?)(?<!\s)_(?!\w)|(https?:\/\/[^\s<>)\]]+)/g;

const SAFE_LINK = /^(https?:|mailto:)/i;

function link(href: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function wrap(tag: string, inner: string): HTMLElement {
  const el = document.createElement(tag);
  inline(el, inner);
  return el;
}

/** Appends `text` to `parent` as DOM nodes; nothing is ever parsed as HTML. */
function inline(parent: Node, text: string): void {
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) plain(parent, text.slice(last, at));
    last = at + match[0].length;

    const [whole, escaped, , code, label, href, bold, bold2, strike, italic, italic2, url] = match;
    if (escaped !== undefined) plain(parent, escaped);
    else if (code !== undefined) {
      const el = document.createElement('code');
      el.textContent = code.trim() || code;
      parent.appendChild(el);
    } else if (label !== undefined) {
      if (SAFE_LINK.test(href)) {
        const a = link(href);
        inline(a, label);
        parent.appendChild(a);
      } else plain(parent, whole);
    } else if (bold !== undefined || bold2 !== undefined) parent.appendChild(wrap('strong', bold ?? bold2));
    else if (strike !== undefined) parent.appendChild(wrap('del', strike));
    else if (italic !== undefined || italic2 !== undefined) parent.appendChild(wrap('em', italic ?? italic2));
    else if (url !== undefined) {
      // Sentence punctuation after a bare URL is not part of it.
      const clean = url.replace(/[.,;:!?'"]+$/, '');
      const a = link(clean);
      a.textContent = clean;
      parent.appendChild(a);
      if (clean.length < url.length) plain(parent, url.slice(clean.length));
    }
  }
  if (last < text.length) plain(parent, text.slice(last));
}

/** Text with its line breaks kept, the way chat UIs show them. */
function plain(parent: Node, text: string): void {
  text.split('\n').forEach((line, index) => {
    if (index) parent.appendChild(document.createElement('br'));
    if (line) parent.appendChild(document.createTextNode(line));
  });
}

type Block = { el: HTMLElement; next: number };

function fence(lines: string[], start: number): Block {
  const [, indent, marker, lang] = FENCE.exec(lines[start])!;
  const body: string[] = [];
  let i = start + 1;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().startsWith(marker) && !line.trim().replace(/[`~]/g, '')) break;
    body.push(line.startsWith(indent) ? line.slice(indent.length) : line.trimStart());
  }
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  if (lang) code.dataset.lang = lang;
  code.textContent = body.join('\n');
  pre.append(code);
  return { el: pre, next: i + 1 };
}

const indentOf = (space: string): number => space.replace(/\t/g, '    ').length;

function list(lines: string[], start: number, indent: number): Block {
  const marker = ITEM.exec(lines[start])![2];
  const ordered = /\d/.test(marker);
  const el = document.createElement(ordered ? 'ol' : 'ul');
  if (ordered && parseInt(marker, 10) !== 1) (el as HTMLOListElement).start = parseInt(marker, 10);

  let i = start;
  let item: HTMLLIElement | null = null;
  while (i < lines.length) {
    const match = ITEM.exec(lines[i]);
    if (!match) break;
    const depth = indentOf(match[1]);
    if (depth < indent) break;
    if (depth > indent + 1 && item) {
      const nested = list(lines, i, depth);
      item.append(nested.el);
      i = nested.next;
    } else {
      item = document.createElement('li');
      const text = [match[3]];
      i += 1;
      // Indented lines under an item belong to it, code fences included.
      const blocks: HTMLElement[] = [];
      while (i < lines.length && /^\s+\S/.test(lines[i]) && !ITEM.test(lines[i])) {
        if (FENCE.test(lines[i])) {
          const block = fence(lines, i);
          blocks.push(block.el);
          i = block.next;
        } else {
          text.push(lines[i].trim());
          i += 1;
        }
      }
      inline(item, text.join('\n'));
      item.append(...blocks);
      el.append(item);
    }
    // A blank line between items does not end the list.
    const after = lines[i] !== undefined && !lines[i].trim() ? ITEM.exec(lines[i + 1] ?? '') : null;
    if (after && indentOf(after[1]) >= indent) i += 1;
  }
  return { el, next: i };
}

const cells = (row: string): string[] =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));

function table(lines: string[], start: number): Block {
  const el = document.createElement('table');
  const head = el.createTHead().insertRow();
  for (const cell of cells(lines[start])) head.append(wrap('th', cell));
  const body = el.createTBody();
  let i = start + 2;
  for (; i < lines.length && lines[i].includes('|') && lines[i].trim(); i += 1) {
    const row = body.insertRow();
    for (const cell of cells(lines[i])) row.append(wrap('td', cell));
  }
  return { el, next: i };
}

const startsBlock = (lines: string[], i: number): boolean =>
  FENCE.test(lines[i]) ||
  HEADING.test(lines[i]) ||
  RULE.test(lines[i]) ||
  ITEM.test(lines[i]) ||
  QUOTE.test(lines[i]) ||
  (lines[i].includes('|') && TABLE_DIVIDER.test(lines[i + 1] ?? ''));

function blocks(parent: HTMLElement, lines: string[]): void {
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    let block: Block;
    const heading = HEADING.exec(line);
    if (FENCE.test(line)) block = fence(lines, i);
    else if (heading) block = { el: wrap(`h${heading[1].length}`, heading[2]), next: i + 1 };
    else if (RULE.test(line)) block = { el: document.createElement('hr'), next: i + 1 };
    else if (ITEM.test(line)) block = list(lines, i, indentOf(ITEM.exec(line)![1]));
    else if (QUOTE.test(line)) {
      const quoted: string[] = [];
      let j = i;
      for (; j < lines.length && QUOTE.test(lines[j]); j += 1) quoted.push(lines[j].replace(QUOTE, ''));
      const el = document.createElement('blockquote');
      blocks(el, quoted);
      block = { el, next: j };
    } else if (line.includes('|') && TABLE_DIVIDER.test(lines[i + 1] ?? '')) block = table(lines, i);
    else {
      const text = [line.trim()];
      let j = i + 1;
      for (; j < lines.length && lines[j].trim() && !startsBlock(lines, j); j += 1) text.push(lines[j].trim());
      block = { el: wrap('p', text.join('\n')), next: j };
    }

    parent.append(block.el);
    i = block.next;
  }
}

/**
 * Renders the Markdown Claude writes: headings, lists, tables, quotes, code
 * and inline emphasis. Built node by node, so message text can never inject markup.
 */
export function renderMarkdown(source: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'md';
  blocks(root, source.replace(/\r\n?/g, '\n').split('\n'));
  return root;
}
