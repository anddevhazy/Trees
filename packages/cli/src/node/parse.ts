import fs from 'node:fs';
import readline from 'node:readline';
import type { NodeMeta, TreeInput, ToolCall } from '@claude-trees/core';
import type { NodeDetail, SessionSummary } from './types.js';

const PREVIEW_CHARS = 400;
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

interface RawRow {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  cwd?: string;
  gitBranch?: string;
  aiTitle?: string;
  customTitle?: string;
  lastPrompt?: string;
  leafUuid?: string;
  message?: {
    role?: string;
    model?: string;
    content?: string | ContentBlock[];
  };
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  tool_use_id?: string;
  is_error?: boolean;
  input?: Record<string, unknown>;
  content?: unknown;
}

async function* readRows(file: string): AsyncGenerator<RawRow> {
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as RawRow;
    } catch {
      // A session being written right now can end in a half-flushed line.
    }
  }
}

function blocks(row: RawRow): ContentBlock[] {
  const content = row.message?.content;
  if (Array.isArray(content)) return content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return [];
}

function textOf(row: RawRow): string {
  return blocks(row)
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text!.trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * A real prompt from the person, as opposed to a `user` row that only carries
 * tool results back to the model. Both share type "user" in the transcript.
 */
function isPrompt(row: RawRow): boolean {
  if (row.type !== 'user' || row.isMeta) return false;
  const content = blocks(row);
  if (content.some((block) => block.type === 'tool_result')) return false;
  return content.some((block) => block.type === 'text' && block.text?.trim());
}

/**
 * A `user` row that is not something the person typed: tool output coming back,
 * or context the harness injected. Both belong to the turn already in progress.
 */
function isMachinery(row: RawRow): boolean {
  return row.type === 'user' && !isPrompt(row);
}

function toolTarget(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  for (const key of ['file_path', 'path', 'notebook_path', 'command', 'pattern', 'url', 'query']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function clip(text: string, max = PREVIEW_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

interface Turn {
  id: string;
  parentId: string | null;
  sender: 'human' | 'assistant';
  createdAt: string;
  texts: string[];
  tools: ToolCall[];
  files: Set<string>;
  commands: string[];
  model?: string;
  rawUuids: string[];
}

export interface SessionScan {
  id: string;
  title: string;
  nodes: TreeInput[];
  currentLeafId: string | null;
  summary: SessionSummary;
  /** Display node id -> the raw transcript rows it was collapsed from. */
  rawByNode: Map<string, string[]>;
}

/**
 * Identifies a conversation by its opening prompt. Forking a session on
 * claude.ai copies the shared prefix into a new file with fresh uuids but the
 * original timestamps, so this is what links the copies back together.
 */
export async function readOpeningKey(file: string): Promise<string | null> {
  for await (const row of readRows(file)) {
    if (!isPrompt(row)) continue;
    return `${row.timestamp ?? ''}|${clip(textOf(row), 200)}`;
  }
  return null;
}

/** Matches the same turn across forked copies of one conversation. */
export function turnSignature(node: TreeInput): string {
  return `${node.sender}|${node.createdAt}|${node.text.slice(0, 120)}`;
}

/** Reads just far enough into a transcript to find the directory it ran in. */
export async function readCwd(file: string): Promise<string | null> {
  let scanned = 0;
  for await (const row of readRows(file)) {
    if (row.cwd) return row.cwd;
    if ((scanned += 1) > 50) break;
  }
  return null;
}

/**
 * Streams a transcript and collapses it into readable turns.
 *
 * The raw file is fine-grained: one row per assistant message, per tool call
 * batch, and per tool result. Rendering that literally buries the branch
 * structure in tool plumbing, so every assistant message plus its tool traffic
 * becomes one node, and only real prompts start a new human node. Full bodies
 * are left on disk and fetched per node by `loadDetail`.
 */
export async function scanSession(file: string, sessionId: string): Promise<SessionScan> {
  const rows: RawRow[] = [];
  let aiTitle = '';
  let customTitle = '';
  let leafUuid: string | null = null;
  let cwd: string | null = null;
  let gitBranch: string | null = null;
  let firstPrompt = '';
  let startedAt: string | null = null;
  let endedAt: string | null = null;

  for await (const row of readRows(file)) {
    if (row.aiTitle) aiTitle = row.aiTitle;
    if (row.customTitle) customTitle = row.customTitle;
    // `last-prompt` rows repeat; the final one names the live leaf.
    if (row.leafUuid) leafUuid = row.leafUuid;
    if (row.cwd) cwd = row.cwd;
    if (row.gitBranch) gitBranch = row.gitBranch;
    if (row.timestamp) {
      startedAt ??= row.timestamp;
      endedAt = row.timestamp;
    }
    if (!firstPrompt && isPrompt(row)) firstPrompt = clip(textOf(row), 160);

    if (!row.uuid) continue;
    // Keep only what the tree needs; tool bodies and thinking stay on disk.
    rows.push({
      type: row.type,
      uuid: row.uuid,
      parentUuid: row.parentUuid ?? null,
      timestamp: row.timestamp,
      isMeta: row.isMeta,
      message: row.message
        ? {
            role: row.message.role,
            model: row.message.model,
            content: blocks(row).map((block) =>
              block.type === 'text'
                ? { type: 'text', text: clip(block.text ?? '', PREVIEW_CHARS * 3) }
                : { type: block.type, name: block.name, input: block.input },
            ),
          }
        : undefined,
    });
  }

  const { nodes, rawByNode, turns } = collapse(rows);
  const leafNodeId = leafUuid ? findNodeForRaw(rawByNode, leafUuid) : null;

  const title = customTitle || aiTitle || firstPrompt || 'Untitled session';
  const summary: SessionSummary = {
    id: sessionId,
    title,
    firstPrompt,
    messages: turns.length,
    forks: countForks(nodes),
    abandoned: countAbandoned(nodes, leafNodeId),
    startedAt,
    endedAt,
    cwd,
    gitBranch,
    bytes: fs.statSync(file).size,
  };

  return { id: sessionId, title, nodes, currentLeafId: leafNodeId, summary, rawByNode };
}

function collapse(rows: RawRow[]): {
  nodes: TreeInput[];
  turns: Turn[];
  rawByNode: Map<string, string[]>;
} {
  const allRows = new Map<string, RawRow>();
  for (const row of rows) allRows.set(row.uuid!, row);

  /*
   * Only user and assistant rows are conversation. Attachments, hook output and
   * mode changes hang off the same parent as the assistant reply, so counting
   * them as children would make every ordinary turn look like a fork. They are
   * dropped from the graph and their descendants re-parented to the nearest
   * conversational ancestor.
   */
  // A transcript can repeat a uuid (a retried write, an interrupted flush).
  // Deduping here matters: a duplicate edge would make the walk below re-enter
  // the same subtree and mint a second copy of every turn under it.
  const kept = [...allRows.values()].filter(
    (row) => row.type === 'user' || row.type === 'assistant',
  );
  const byUuid = new Map<string, RawRow>();
  for (const row of kept) byUuid.set(row.uuid!, row);

  const nearestKeptParent = (row: RawRow): string | null => {
    let cursor = row.parentUuid ?? null;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor);
      if (byUuid.has(cursor)) return cursor;
      cursor = allRows.get(cursor)?.parentUuid ?? null;
    }
    return null;
  };

  const childrenOf = new Map<string, string[]>();
  const roots: string[] = [];
  for (const row of kept) {
    const parent = nearestKeptParent(row);
    if (parent) {
      const list = childrenOf.get(parent);
      if (list) list.push(row.uuid!);
      else childrenOf.set(parent, [row.uuid!]);
    } else {
      roots.push(row.uuid!);
    }
  }

  const turns = new Map<string, Turn>();
  const order: Turn[] = [];

  const newTurn = (row: RawRow, sender: 'human' | 'assistant', parentId: string | null): Turn => {
    const turn: Turn = {
      id: row.uuid!,
      parentId,
      sender,
      createdAt: row.timestamp ?? new Date(0).toISOString(),
      texts: [],
      tools: [],
      files: new Set(),
      commands: [],
      rawUuids: [],
      model: row.message?.model,
    };
    turns.set(turn.id, turn);
    order.push(turn);
    return turn;
  };

  const absorb = (turn: Turn, row: RawRow): void => {
    turn.rawUuids.push(row.uuid!);
    turn.model ??= row.message?.model;
    for (const block of blocks(row)) {
      if (block.type === 'text' && block.text?.trim()) turn.texts.push(block.text.trim());
      if (block.type !== 'tool_use') continue;
      const name = block.name ?? 'tool';
      const target = toolTarget(block.input);
      turn.tools.push({ name, target });
      if (WRITE_TOOLS.has(name) && target) turn.files.add(target);
      if (name === 'Bash' && target) turn.commands.push(target);
    }
  };

  interface Frame {
    uuid: string;
    parentTurnId: string | null;
    openTurnId: string | null;
  }
  const stack: Frame[] = roots.map((uuid) => ({ uuid, parentTurnId: null, openTurnId: null }));
  const visited = new Set<string>();

  while (stack.length) {
    const frame = stack.pop()!;
    if (visited.has(frame.uuid)) continue;
    visited.add(frame.uuid);
    const row = byUuid.get(frame.uuid)!;
    const kids = childrenOf.get(frame.uuid) ?? [];

    const open = frame.openTurnId ? turns.get(frame.openTurnId) : undefined;
    const isHuman = isPrompt(row);

    // A prompt starts a new human turn; an assistant row continues the turn in
    // progress or starts one. Machinery joins whatever is already open and
    // never becomes a turn itself — an injected `user` row is not the person
    // speaking, and it is certainly not Claude.
    let turn: Turn | undefined;
    if (isHuman) turn = newTurn(row, 'human', frame.parentTurnId);
    else if (isMachinery(row)) turn = open;
    else turn = open ?? newTurn(row, 'assistant', frame.parentTurnId);

    if (turn) absorb(turn, row);

    /*
     * Machinery is never an alternative version of the conversation, so those
     * children continue this turn however many there are. Claude answering with
     * two tool calls leaves a row with a continuation child *and* its own
     * result attached — counting that as a split drew forks nobody made.
     */
    const plumbing = kids.filter((kid) => isMachinery(byUuid.get(kid)!));
    const branches = kids.filter((kid) => !isMachinery(byUuid.get(kid)!));

    const parentForKids = turn ? turn.id : frame.parentTurnId;
    const stillOpen = isHuman ? null : (turn ? turn.id : frame.openTurnId);
    // One branch child means the turn simply continues. Several means a real
    // fork, so each one opens its own turn under the turn that split.
    const openForBranch = branches.length === 1 ? stillOpen : null;

    for (const kid of plumbing) {
      stack.push({ uuid: kid, parentTurnId: parentForKids, openTurnId: stillOpen });
    }
    for (const kid of branches) {
      stack.push({ uuid: kid, parentTurnId: parentForKids, openTurnId: openForBranch });
    }
  }

  const rawByNode = new Map<string, string[]>();
  const nodes: TreeInput[] = order.map((turn) => {
    rawByNode.set(turn.id, turn.rawUuids);
    const meta: NodeMeta = {
      model: turn.model,
      tools: turn.tools,
      filesTouched: [...turn.files],
      commands: turn.commands,
      truncated: true,
    };
    const text = turn.texts.join('\n\n');
    const fallback = turn.tools.length
      ? `[${[...new Set(turn.tools.map((tool) => tool.name))].join(', ')}]`
      : '[no text]';
    return {
      id: turn.id,
      parentId: turn.parentId,
      sender: turn.sender,
      createdAt: turn.createdAt,
      text: clip(text || fallback),
      meta,
    };
  });

  return { nodes, turns: order, rawByNode };
}

function findNodeForRaw(rawByNode: Map<string, string[]>, rawUuid: string): string | null {
  for (const [nodeId, uuids] of rawByNode) {
    if (nodeId === rawUuid || uuids.includes(rawUuid)) return nodeId;
  }
  return null;
}

function countForks(nodes: TreeInput[]): number {
  const kids = new Map<string, number>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    kids.set(node.parentId, (kids.get(node.parentId) ?? 0) + 1);
  }
  let forks = 0;
  for (const count of kids.values()) if (count > 1) forks += 1;
  return forks;
}

/** Branch tips you can no longer reach from where the session ended up. */
function countAbandoned(nodes: TreeInput[], leafId: string | null): number {
  const parents = new Map<string, string | null>();
  const hasChild = new Set<string>();
  for (const node of nodes) {
    parents.set(node.id, node.parentId);
    if (node.parentId) hasChild.add(node.parentId);
  }
  const live = new Set<string>();
  for (let id = leafId; id; id = parents.get(id) ?? null) live.add(id);

  let abandoned = 0;
  for (const node of nodes) {
    if (!hasChild.has(node.id) && !live.has(node.id)) abandoned += 1;
  }
  return abandoned;
}

/** Re-reads the transcript for one node's rows, so full bodies stay off the tree payload. */
export async function loadDetail(
  file: string,
  nodeId: string,
  rawUuids: string[],
): Promise<NodeDetail | null> {
  const wanted = new Set(rawUuids);
  const collected: RawRow[] = [];
  for await (const row of readRows(file)) {
    if (row.uuid && wanted.has(row.uuid)) collected.push(row);
  }
  if (!collected.length) return null;

  const results = new Map<string, { text: string; isError: boolean }>();
  for (const row of collected) {
    for (const block of blocks(row)) {
      if (block.type !== 'tool_result' || !block.tool_use_id) continue;
      results.set(block.tool_use_id, {
        text: stringify(block.content),
        isError: Boolean(block.is_error),
      });
    }
  }

  const texts: string[] = [];
  const steps: NodeDetail['steps'] = [];
  const files = new Set<string>();
  const commands: string[] = [];
  const tools: ToolCall[] = [];
  let model: string | undefined;

  for (const row of collected) {
    model ??= row.message?.model;
    for (const block of blocks(row)) {
      if (block.type === 'text' && block.text?.trim()) texts.push(block.text.trim());
      if (block.type !== 'tool_use') continue;
      const name = block.name ?? 'tool';
      const target = toolTarget(block.input);
      const result = block.id ? results.get(block.id) : undefined;
      tools.push({ name, target });
      if (WRITE_TOOLS.has(name) && target) files.add(target);
      if (name === 'Bash' && target) commands.push(target);
      steps.push({
        name,
        target,
        input: clipLong(stringify(block.input)),
        result: result ? clipLong(result.text) : undefined,
        isError: result?.isError,
      });
    }
  }

  const first = collected[0];
  return {
    id: nodeId,
    sender: isPrompt(first) ? 'human' : 'assistant',
    createdAt: first.timestamp ?? '',
    text: texts.join('\n\n'),
    meta: { model, tools, filesTouched: [...files], commands, truncated: false },
    steps,
  };
}

function stringify(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        item && typeof item === 'object' && 'text' in (item as Record<string, unknown>)
          ? String((item as { text?: string }).text ?? '')
          : stringify(item),
      )
      .join('\n');
  }
  return JSON.stringify(value, null, 2);
}

/** Tool output can be megabytes; the panel only ever shows the head of it. */
function clipLong(text: string, max = 4000): string {
  return text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters)` : text;
}
