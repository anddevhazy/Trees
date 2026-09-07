const TOGGLE = { type: 'claude-trees:toggle' } as const;

function send(tabId: number | undefined): void {
  if (tabId === undefined) return;
  // The content script may not be there yet on a cold tab; ignore that.
  chrome.tabs.sendMessage(tabId, TOGGLE).catch(() => undefined);
}

chrome.action.onClicked.addListener((tab) => send(tab.id));

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-tree') send(tab?.id);
});
