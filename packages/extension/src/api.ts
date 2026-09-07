import type { Sender, TreeInput, TreeSource } from '@claude-trees/core';

/**
 * claude.ai uses this all-zero UUID as the parent of the first message in a
 * conversation, rather than null.
 */
export const ROOT_SENTINEL = '00000000-0000-4000-8000-000000000000';

export class TreesError extends Error {}

interface RawContentBlock {
  type: string;
  text?: string;
  name?: string;
}

interface RawMessage {
  uuid: string;
  parent_message_uuid: string;
  sender: Sender;
  index: number;
  created_at: string;
  content?: RawContentBlock[];
  text?: string;
}

interface RawConversation {
  uuid: string;
  name: string;
  current_leaf_message_uuid: string | null;
  chat_messages: RawMessage[];
}

/** Extracts the conversation UUID from /chat/<uuid> (with or without a locale prefix). */
export function getConversationId(pathname = location.pathname): string | null {
  const match = pathname.match(
    /\/chat\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  return match ? match[1] : null;
}

interface RawOrg {
  uuid: string;
  name?: string;
  capabilities?: string[];
}

let cachedOrgId: string | null = null;

async function getJson<T>(url: string): Promise<T> {
  // Same-origin fetch from the content script, so the session cookies ride along.
  const res = await fetch(url, {
    credentials: 'include',
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new TreesError(`${res.status} ${res.statusText} from ${url}`);
  return (await res.json()) as T;
}

export async function getOrgId(): Promise<string> {
  if (cachedOrgId) return cachedOrgId;

  const orgs = await getJson<RawOrg[]>('/api/organizations');
  if (!Array.isArray(orgs) || orgs.length === 0) {
    throw new TreesError('No organizations returned — are you signed in to claude.ai?');
  }

  // An account can carry several orgs (personal, team, an API-only one). Prefer
  // one that actually advertises chat, and fall back to the first.
  const chatOrg = orgs.find((org) => org.capabilities?.includes('chat'));
  cachedOrgId = (chatOrg ?? orgs[0]).uuid;
  return cachedOrgId;
}

function messageText(message: RawMessage): string {
  const blocks = message.content ?? [];
  const text = blocks
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text!.trim())
    .join('\n\n')
    .trim();
  if (text) return text;
  if (message.text?.trim()) return message.text.trim();

  // Turns that are pure tool use still deserve a node and a label.
  const kinds = [...new Set(blocks.map((block) => block.name ?? block.type))];
  return kinds.length ? `[${kinds.join(', ')}]` : '[empty]';
}

/**
 * Fetches the full message graph. `tree=True` is what makes the endpoint return
 * every branch instead of only the currently selected path.
 */
export async function fetchTreeSource(conversationId: string): Promise<TreeSource> {
  const orgId = await getOrgId();
  const url =
    `/api/organizations/${orgId}/chat_conversations/${conversationId}` +
    `?tree=True&rendering_mode=messages&render_all_tools=false`;
  const conversation = await getJson<RawConversation>(url);

  if (!Array.isArray(conversation.chat_messages)) {
    throw new TreesError('Conversation payload had no chat_messages array.');
  }

  const nodes: TreeInput[] = conversation.chat_messages.map((message) => ({
    id: message.uuid,
    parentId:
      message.parent_message_uuid && message.parent_message_uuid !== ROOT_SENTINEL
        ? message.parent_message_uuid
        : null,
    sender: message.sender,
    text: messageText(message),
    createdAt: message.created_at,
  }));

  return {
    id: conversation.uuid,
    name: conversation.name || 'Untitled',
    nodes,
    currentLeafId: conversation.current_leaf_message_uuid,
  };
}
