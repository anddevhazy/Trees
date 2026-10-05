import type { ConversationTree, TreeNode } from './types.js';

/** How much of a prompt the picker shows before "read more". */
export const PROMPT_PREVIEW_CHARS = 320;

export interface Prompt {
  id: string;
  /** Full text. Sources that only carry previews in the tree must supply this separately. */
  text: string;
  createdAt: string;
  onCurrentPath: boolean;
}

/** Every prompt the person sent, on every branch, oldest first. */
export function listPrompts(tree: ConversationTree, fullText?: Map<string, string>): Prompt[] {
  const prompts: TreeNode[] = [];
  for (const node of tree.byId.values()) if (node.sender === 'human') prompts.push(node);
  prompts.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
  return prompts.map((node) => ({
    id: node.id,
    text: fullText?.get(node.id) ?? node.text,
    createdAt: node.createdAt,
    onCurrentPath: node.onCurrentPath,
  }));
}

export function previewOf(text: string, max = PROMPT_PREVIEW_CHARS): { text: string; clipped: boolean } {
  return text.length > max ? { text: `${text.slice(0, max)}…`, clipped: true } : { text, clipped: false };
}

/** The export: each selected prompt in full, numbered, ready to paste into a new thread. */
export function promptsToMarkdown(title: string, selected: Prompt[], total: number): string {
  const lines = [
    `# Questions: ${title}`,
    '',
    `${selected.length} of ${total} prompts, exported from Claude Trees on ${new Date().toISOString().slice(0, 10)}.`,
    '',
  ];
  selected.forEach((prompt, index) => {
    lines.push(`## Question ${index + 1}`, '', prompt.text.trim(), '');
  });
  return lines.join('\n');
}

export function questionsFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'conversation'}-questions.md`;
}
