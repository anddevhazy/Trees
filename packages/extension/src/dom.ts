/**
 * Everything in this file depends on claude.ai's private markup, which is the
 * one part of the extension Anthropic can break at any time. All the selectors
 * live at the top so there is a single place to re-tune, and
 * `window.__claudeTreesDebug()` reports what they currently match.
 */

/** Selectors that identify one rendered turn, in preference order. */
const MESSAGE_SELECTORS = [
  '[data-test-render-count]',
  '[data-testid="user-message"], .font-claude-message',
  '[data-testid="chat-message"]',
];

/** A branch pager reads "2 / 3". */
const PAGER_TEXT = /^\s*(\d+)\s*\/\s*(\d+)\s*$/;

/** How far up from a message we look for its pager before giving up. */
const PAGER_ANCESTOR_DEPTH = 6;

export interface Pager {
  container: HTMLElement;
  /** 1-based, as displayed. */
  current: number;
  total: number;
  prev: HTMLElement | null;
  next: HTMLElement | null;
}

function inDocumentOrder(elements: HTMLElement[]): HTMLElement[] {
  return elements.sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
}

/** Drops elements that are nested inside another element in the same set. */
function outermostOnly(elements: HTMLElement[]): HTMLElement[] {
  return elements.filter((el) => !elements.some((other) => other !== el && other.contains(el)));
}

/**
 * The rendered turns, in order. This lines up 1:1 with the tree's current path,
 * which is what lets us address a message by its position rather than by
 * matching its text.
 */
export function findMessageElements(): HTMLElement[] {
  for (const selector of MESSAGE_SELECTORS) {
    const found = [...document.querySelectorAll<HTMLElement>(selector)];
    if (found.length > 1) return inDocumentOrder(outermostOnly(found));
  }
  return [];
}

function readPager(container: HTMLElement): Pager | null {
  const counter = [...container.querySelectorAll<HTMLElement>('*')].find(
    (el) => el.children.length === 0 && PAGER_TEXT.test(el.textContent ?? ''),
  );
  if (!counter) return null;

  const match = PAGER_TEXT.exec(counter.textContent ?? '')!;
  const scope = counter.parentElement ?? container;
  const buttons = [...scope.querySelectorAll<HTMLElement>('button, [role="button"]')];
  if (buttons.length < 2) return null;

  // The two controls flanking the counter are prev and next.
  const before = buttons.filter(
    (btn) => counter.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_PRECEDING,
  );
  const after = buttons.filter(
    (btn) => counter.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING,
  );

  return {
    container: scope,
    current: Number(match[1]),
    total: Number(match[2]),
    prev: before.length ? before[before.length - 1] : null,
    next: after.length ? after[0] : null,
  };
}

/** Finds the `< 2/3 >` control belonging to a message, searching its ancestors. */
export function findPagerFor(message: HTMLElement): Pager | null {
  let scope: HTMLElement | null = message;
  for (let i = 0; i <= PAGER_ANCESTOR_DEPTH && scope; i += 1) {
    const pager = readPager(scope);
    if (pager) return pager;
    scope = scope.parentElement;
  }
  return null;
}

/** How long claude.ai gets to re-render after we scroll. */
const SCROLL_SETTLE_MS = 200;
/** How long to wait for claude.ai to fetch older turns once we hit the top or bottom. */
const EDGE_LOAD_TIMEOUT_MS = 3_000;
const EDGE_LOAD_POLL_MS = 100;
const MAX_SCROLL_STEPS = 80;
/** Characters of a message's text used to recognise it on screen. */
const FINGERPRINT_LENGTH = 32;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function scrollContainerOf(element: HTMLElement): HTMLElement {
  for (let el = element.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) return el;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** Letters and digits only, so markdown source and rendered text compare equal. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function fingerprint(markdown: string): string {
  const visible = markdown
    .replace(/\]\([^)]*\)/g, ']') // link targets are not rendered
    .replace(/^```\S*/gm, ''); // nor are code fence languages
  return normalise(visible).slice(0, FINGERPRINT_LENGTH);
}

/**
 * Which path index the first mounted turn sits at. claude.ai only keeps a
 * window of turns mounted, so we recognise them by text: every turn votes for
 * the offsets its text is consistent with, and the window lands where most
 * agree. Returns null when nothing matches.
 */
function alignToPath(elements: HTMLElement[], prints: string[]): number | null {
  const votes = new Map<number, number>();
  elements.forEach((element, i) => {
    const rendered = normalise(element.textContent ?? '');
    prints.forEach((print, j) => {
      if (print && j >= i && rendered.includes(print)) votes.set(j - i, (votes.get(j - i) ?? 0) + 1);
    });
  });
  let best: number | null = null;
  let bestVotes = 0;
  for (const [offset, count] of votes) {
    if (count > bestVotes && offset + elements.length <= prints.length) [best, bestVotes] = [offset, count];
  }
  return best;
}

function sameMessages(a: HTMLElement[], b: HTMLElement[]): boolean {
  return a.length === b.length && a.every((el, i) => el === b[i]);
}

async function waitForNewMessages(previous: HTMLElement[]): Promise<HTMLElement[]> {
  const deadline = Date.now() + EDGE_LOAD_TIMEOUT_MS;
  let elements = findMessageElements();
  while (sameMessages(elements, previous) && Date.now() < deadline) {
    await sleep(EDGE_LOAD_POLL_MS);
    elements = findMessageElements();
  }
  return elements;
}

/** The path last looked up, kept for `__claudeTreesDebug()`. */
let lastPrints: string[] = [];

function inView(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

/**
 * The rendered turn at `index` of `path`, scrolling the conversation until it
 * is mounted. Returns null if it never appears.
 */
export async function messageElementAt(path: readonly { text: string }[], index: number): Promise<HTMLElement | null> {
  const prints = path.map((node) => fingerprint(node.text));
  lastPrints = prints;
  let elements = findMessageElements();

  for (let step = 0; step < MAX_SCROLL_STEPS && elements.length; step += 1) {
    if (elements.length === path.length) return elements[index];
    const offset = alignToPath(elements, prints);
    if (offset === null) return null;
    if (index >= offset && index < offset + elements.length) {
      const element = elements[index - offset];
      if (inView(element)) return element;
      // Turns just off screen can be rendered without their controls, so bring
      // the target into view and look it up again once it has re-rendered.
      element.scrollIntoView({ block: 'center', behavior: 'auto' });
      await sleep(SCROLL_SETTLE_MS);
      elements = findMessageElements();
      continue;
    }

    // Leap most of the way when the target is far off, but never by less than
    // most of a viewport so we keep moving.
    const container = scrollContainerOf(elements[0]);
    const nearest = index < offset ? offset : offset + elements.length - 1;
    const estimate = ((index - nearest) * container.scrollHeight) / path.length;
    const minimum = container.clientHeight * 0.8;
    const before = container.scrollTop;
    container.scrollTop += Math.sign(estimate) * Math.max(minimum, Math.abs(estimate) * 0.8);

    if (container.scrollTop === before) {
      // At the edge: claude.ai may still be fetching more turns.
      const next = await waitForNewMessages(elements);
      if (sameMessages(next, elements)) return null;
      elements = next;
    } else {
      await sleep(SCROLL_SETTLE_MS);
      elements = findMessageElements();
    }
  }
  return null;
}

/** Why a looked-up turn might be the wrong one, for error messages. */
export function describeMatch(element: HTMLElement, path: readonly { text: string }[], index: number): string {
  const expected = fingerprint(path[index]?.text ?? '');
  const rendered = normalise(element.textContent ?? '');
  const verdict = expected && rendered.includes(expected) ? 'text matches' : 'TEXT MISMATCH';
  return `${verdict}; expected "${expected}", on screen "${rendered.slice(0, FINGERPRINT_LENGTH)}"`;
}

export function click(element: HTMLElement): void {
  element.scrollIntoView({ block: 'center', behavior: 'auto' });
  element.click();
}

export async function scrollToMessage(path: readonly { text: string }[], index: number): Promise<void> {
  const target = await messageElementAt(path, index);
  if (!target) return;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.animate(
    [{ outline: '2px solid #d97757', outlineOffset: '6px' }, { outline: '2px solid transparent', outlineOffset: '6px' }],
    { duration: 1600, easing: 'ease-out' },
  );
}

export function installDebugHelper(): void {
  Object.defineProperty(window, '__claudeTreesDebug', {
    configurable: true,
    value: () => {
      const messages = findMessageElements();
      const pagers = messages.map((el, i) => ({ index: i, pager: findPagerFor(el) }));
      // eslint-disable-next-line no-console
      console.log('[claude-trees] messages:', messages.length, messages);
      // eslint-disable-next-line no-console
      console.log('[claude-trees] pagers:', pagers.filter((p) => p.pager));
      const offset = alignToPath(messages, lastPrints);
      const alignment = messages.map((el, i) => ({
        pathIndex: offset === null ? null : offset + i,
        expected: offset === null ? null : lastPrints[offset + i],
        matches: offset !== null && normalise(el.textContent ?? '').includes(lastPrints[offset + i]),
        onScreen: normalise(el.textContent ?? '').slice(0, 60),
      }));
      // eslint-disable-next-line no-console
      console.table(alignment);
      return { messages, pagers, alignment };
    },
  });
}

/**
 * Whether claude.ai is showing its dark theme, which is a setting of its own
 * and need not match the OS. Falls back to the page background, then the OS.
 */
export function pageIsDark(): boolean {
  const mode = document.documentElement.dataset.mode;
  if (mode === 'dark' || mode === 'light') return mode === 'dark';

  for (const el of [document.body, document.documentElement]) {
    const colour = getComputedStyle(el).backgroundColor;
    if (!colour.startsWith('rgb')) continue;
    const [r, g, b, alpha = 1] = (colour.match(/[\d.]+/g) ?? []).map(Number);
    if (alpha > 0.5) return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
  }
  return matchMedia('(prefers-color-scheme: dark)').matches;
}
