import { buildTree } from '@claude-trees/core';
import type { ConversationTree } from '@claude-trees/core';
import { fetchTreeSource, getConversationId, TreesError } from './api';
import { installDebugHelper } from './dom';
import { NavigationError, switchToNode } from './navigate';
import { TreeOverlay } from './overlay';

let overlay: TreeOverlay | null = null;
let cached: ConversationTree | null = null;
let inFlight: Promise<ConversationTree> | null = null;
let busy = false;

async function loadTree(force: boolean): Promise<ConversationTree> {
  const conversationId = getConversationId();
  if (!conversationId) {
    throw new TreesError('Open a conversation first — this page has no conversation to map.');
  }
  if (!force && cached?.id === conversationId) return cached;
  if (!force && inFlight) return inFlight;

  inFlight = fetchTreeSource(conversationId)
    .then((source) => {
      cached = buildTree(source);
      return cached;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

function getOverlay(): TreeOverlay {
  if (overlay) return overlay;
  overlay = new TreeOverlay({
    onRefresh: () => void refresh(true),
    onSelect: (node) => void select(node.id),
  });
  return overlay;
}

function describe(error: unknown): string {
  if (error instanceof NavigationError || error instanceof TreesError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

async function refresh(force: boolean): Promise<void> {
  const ui = getOverlay();
  ui.setStatus('Loading…');
  try {
    ui.render(await loadTree(force));
    ui.setStatus('Click a node to jump to that branch. Scroll to zoom, drag to pan.');
  } catch (error) {
    ui.setStatus(describe(error), true);
  }
}

async function select(nodeId: string): Promise<void> {
  const ui = getOverlay();
  if (busy) return;
  busy = true;
  try {
    const tree = await switchToNode((force) => loadTree(force), nodeId, (message) =>
      ui.setStatus(message),
    );
    ui.render(tree);
    ui.setStatus('Jumped to that branch.');
  } catch (error) {
    ui.setStatus(describe(error), true);
  } finally {
    busy = false;
  }
}

function toggle(): void {
  const ui = getOverlay();
  ui.toggle();
  if (ui.isOpen) void refresh(true);
}

/** claude.ai is a SPA, so a conversation switch never reloads the page. */
function watchNavigation(): void {
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    cached = null;
    if (overlay?.isOpen) void refresh(true);
  }, 500);
}

chrome.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message?.type === 'claude-trees:toggle') toggle();
});

installDebugHelper();
watchNavigation();
