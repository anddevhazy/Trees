import { click, findMessageElements, findPagerFor, scrollToMessage } from './dom';
import { pathTo } from './tree';
import type { ConversationTree } from './types';

export class NavigationError extends Error {}

const MAX_STEPS = 40;
const SETTLE_TIMEOUT_MS = 10_000;
const POLL_MS = 150;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type TreeLoader = (force: boolean) => Promise<ConversationTree>;

async function waitForLeafChange(load: TreeLoader, previousLeafId: string): Promise<ConversationTree> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let tree = await load(true);
  while (leafId(tree) === previousLeafId && Date.now() < deadline) {
    await sleep(POLL_MS);
    tree = await load(true);
  }
  if (leafId(tree) === previousLeafId) {
    throw new NavigationError(
      'Clicked a branch arrow but the conversation never changed. The pager selectors in src/dom.ts probably need re-tuning.',
    );
  }
  return tree;
}

function leafId(tree: ConversationTree): string {
  const path = tree.currentPath;
  return path.length ? path[path.length - 1].id : '';
}

/**
 * Walks the conversation onto the branch containing `targetId`.
 *
 * claude.ai offers no way to select a branch directly, so we do what a person
 * would: find the shallowest point where the displayed path diverges from the
 * one we want, and click that message's `< 2/3 >` arrows the right number of
 * times. Repeat until the target is on the visible path — deep targets need one
 * pass per fork.
 */
export async function switchToNode(
  load: TreeLoader,
  targetId: string,
  onProgress?: (message: string) => void,
): Promise<ConversationTree> {
  let tree = await load(true);

  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (tree.currentPathIds.has(targetId)) {
      const index = tree.currentPath.findIndex((node) => node.id === targetId);
      if (index >= 0) scrollToMessage(index);
      return tree;
    }

    const path = pathTo(tree, targetId);
    if (!path.length) throw new NavigationError('That message is no longer in this conversation.');

    const divergeIndex = path.findIndex((node) => !tree.currentPathIds.has(node.id));
    if (divergeIndex < 0) throw new NavigationError('Could not work out where the branches split.');

    const wanted = path[divergeIndex];
    const shown = tree.currentPath[divergeIndex];
    if (!shown) {
      throw new NavigationError('The visible conversation is shorter than the branch point.');
    }

    const elements = findMessageElements();
    if (elements.length !== tree.currentPath.length) {
      throw new NavigationError(
        `Found ${elements.length} messages on screen but ${tree.currentPath.length} in the API response. ` +
          'Scroll the conversation to the top so every turn is mounted, or re-tune MESSAGE_SELECTORS in src/dom.ts.',
      );
    }

    const element = elements[divergeIndex];
    const pager = findPagerFor(element);
    if (!pager) {
      throw new NavigationError(
        `No branch arrows found on message ${divergeIndex + 1}. Run __claudeTreesDebug() in the console to inspect.`,
      );
    }

    const delta = wanted.siblingIndex - shown.siblingIndex;
    const button = delta > 0 ? pager.next : pager.prev;
    if (!button) throw new NavigationError('Branch arrows found, but the direction we need is missing.');

    onProgress?.(`Switching branch at message ${divergeIndex + 1} (${Math.abs(delta)} step${Math.abs(delta) === 1 ? '' : 's'})…`);

    const before = leafId(tree);
    click(button);
    tree = await waitForLeafChange(load, before);
  }

  throw new NavigationError('Gave up after too many branch switches.');
}
