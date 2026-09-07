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

export function click(element: HTMLElement): void {
  element.scrollIntoView({ block: 'center', behavior: 'auto' });
  element.click();
}

export function scrollToMessage(index: number): void {
  const elements = findMessageElements();
  const target = elements[index];
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
      return { messages, pagers };
    },
  });
}
