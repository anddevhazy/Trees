import './styles.css';
import { buildTree, commonAncestor, countForks, countLeaves } from '@claude-trees/core';
import type { ConversationTree, TreeNode } from '@claude-trees/core';
import { CANVAS_CSS, TreeCanvas } from '@claude-trees/core/canvas';
import { api, type NodeDetail, type ProjectSummary, type SessionSummary } from './api';

const style = document.createElement('style');
style.textContent = CANVAS_CSS;
document.head.append(style);

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const listEl = el('list');
const filterEl = el<HTMLInputElement>('filter');
const titleEl = el('title');
const statsEl = el('stats');
const statusEl = el('status');
const canvasEl = el('canvas');
const tipEl = el('tip');
const panelEl = el('panel');
const compareBtn = el<HTMLButtonElement>('compare');

interface State {
  projects: ProjectSummary[];
  openProject: ProjectSummary | null;
  sessions: SessionSummary[];
  session: SessionSummary | null;
  tree: ConversationTree | null;
  comparing: boolean;
  picks: Array<{ id: string; side: 'left' | 'right' }>;
}

const state: State = {
  projects: [],
  openProject: null,
  sessions: [],
  session: null,
  tree: null,
  comparing: false,
  picks: [],
};

const canvas = new TreeCanvas({
  onSelect: (node) => void onSelect(node),
  onHover: (node, screen) => showTip(node, screen),
});
canvasEl.prepend(canvas.element);

function setStatus(message: string, isError = false): void {
  statusEl.textContent = message;
  statusEl.parentElement?.classList.toggle('error', isError);
}

function fail(error: unknown): void {
  setStatus(error instanceof Error ? error.message : String(error), true);
}

const relative = (iso: string | null): string => {
  if (!iso) return '';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
};

const sizeOf = (bytes: number): string =>
  bytes > 1_000_000 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

/* Sidebar ------------------------------------------------------------------ */

function row(name: string, subs: Array<{ text: string; warn?: boolean }>, onClick: () => void, on = false): HTMLElement {
  const button = document.createElement('button');
  button.className = `row${on ? ' on' : ''}`;
  const title = document.createElement('div');
  title.className = 'name';
  title.textContent = name;
  const sub = document.createElement('div');
  sub.className = 'sub';
  for (const part of subs) {
    if (!part.text) continue;
    const span = document.createElement('span');
    if (part.warn) span.className = 'warn';
    span.textContent = part.text;
    sub.append(span);
  }
  button.append(title, sub);
  button.addEventListener('click', onClick);
  return button;
}

function renderSidebar(): void {
  const query = filterEl.value.trim().toLowerCase();
  listEl.replaceChildren();

  if (!state.openProject) {
    const projects = state.projects.filter((project) =>
      project.path.toLowerCase().includes(query),
    );
    const group = document.createElement('div');
    group.className = 'group';
    group.textContent = `${projects.length} projects`;
    listEl.append(group);
    for (const project of projects) {
      listEl.append(
        row(
          project.path.split('/').pop() || project.path,
          [{ text: `${project.sessions} sessions` }, { text: relative(project.lastActive) }],
          () => void openProject(project),
        ),
      );
    }
    return;
  }

  const back = document.createElement('button');
  back.className = 'back';
  back.textContent = `← all projects`;
  back.addEventListener('click', () => {
    state.openProject = null;
    state.sessions = [];
    renderSidebar();
  });
  const group = document.createElement('div');
  group.className = 'group';
  group.textContent = state.openProject.path;
  listEl.append(back, group);

  const sessions = state.sessions.filter((session) =>
    `${session.title} ${session.firstPrompt}`.toLowerCase().includes(query),
  );
  for (const session of sessions) {
    listEl.append(
      row(
        session.title,
        [
          { text: `${session.messages} turns` },
          { text: session.forks ? `${session.forks} forks` : '' },
          { text: session.abandoned ? `${session.abandoned} abandoned` : '', warn: true },
          { text: relative(session.endedAt) },
          { text: sizeOf(session.bytes) },
        ],
        () => void openSession(session),
        state.session?.id === session.id,
      ),
    );
  }
  if (!sessions.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No sessions match.';
    listEl.append(empty);
  }
}

async function openProject(project: ProjectSummary): Promise<void> {
  state.openProject = project;
  state.sessions = [];
  renderSidebar();
  setStatus('Scanning transcripts…');
  try {
    state.sessions = await api.sessions(project.slug);
    setStatus(`${state.sessions.length} sessions.`);
  } catch (error) {
    fail(error);
  }
  renderSidebar();
}

async function openSession(session: SessionSummary): Promise<void> {
  state.session = session;
  state.picks = [];
  setComparing(false);
  panelEl.hidden = true;
  renderSidebar();
  setStatus('Loading session…');
  try {
    const payload = await api.session(state.openProject!.slug, session.id);
    const tree = buildTree({
      id: payload.id,
      name: payload.name,
      nodes: payload.nodes,
      currentLeafId: payload.currentLeafId,
    });
    state.tree = tree;
    titleEl.textContent = payload.name;
    statsEl.textContent =
      `${tree.byId.size} turns · ${countForks(tree)} forks · ${countLeaves(tree)} endings · ` +
      `${session.abandoned} unreachable`;
    canvas.render(tree);
    setStatus('Click a turn to read it. Scroll to zoom, drag to pan.');
  } catch (error) {
    fail(error);
  }
}

/* Selection, detail, comparison ------------------------------------------- */

function setComparing(on: boolean): void {
  state.comparing = on;
  compareBtn.classList.toggle('on', on);
  compareBtn.textContent = on ? 'Comparing — click 2 turns' : 'Compare branches';
  if (!on) {
    state.picks = [];
    canvas.setPicks([]);
  }
}

compareBtn.addEventListener('click', () => {
  setComparing(!state.comparing);
  if (!state.comparing) panelEl.hidden = true;
});

async function onSelect(node: TreeNode): Promise<void> {
  if (!state.comparing) {
    await showDetail(node);
    return;
  }
  const existing = state.picks.findIndex((pick) => pick.id === node.id);
  if (existing >= 0) state.picks.splice(existing, 1);
  else if (state.picks.length < 2) state.picks.push({ id: node.id, side: state.picks.length ? 'right' : 'left' });
  else state.picks = [{ id: node.id, side: 'left' }];

  state.picks = state.picks.map((pick, index) => ({ ...pick, side: index ? 'right' : 'left' }));
  canvas.setPicks(state.picks);

  if (state.picks.length === 2) renderDiff();
  else setStatus('Pick a second turn to compare against.');
}

function heading(node: TreeNode | { sender: string; createdAt: string }): string {
  const who = node.sender === 'human' ? 'You' : 'Claude';
  const when = node.createdAt ? new Date(node.createdAt).toLocaleString() : '';
  return `${who} · ${when}`;
}

function chips(title: string, values: string[] | undefined, write = false): HTMLElement | null {
  if (!values?.length) return null;
  const section = document.createElement('div');
  section.className = 'section';
  const head = document.createElement('h4');
  head.textContent = `${title} (${values.length})`;
  const wrap = document.createElement('div');
  wrap.className = 'chips';
  for (const value of values) {
    const chip = document.createElement('span');
    chip.className = `chip${write ? ' write' : ''}`;
    chip.textContent = value;
    wrap.append(chip);
  }
  section.append(head, wrap);
  return section;
}

function panelShell(titleText: string, wide: boolean): HTMLElement {
  panelEl.hidden = false;
  panelEl.classList.toggle('wide', wide);
  panelEl.replaceChildren();

  const head = document.createElement('div');
  head.className = 'panel-head';
  const who = document.createElement('div');
  who.className = 'who';
  who.textContent = titleText;
  const spacer = document.createElement('div');
  spacer.className = 'spacer';
  const close = document.createElement('button');
  close.className = 'tool';
  close.textContent = 'Close';
  close.addEventListener('click', () => {
    panelEl.hidden = true;
  });
  head.append(who, spacer, close);

  const body = document.createElement('div');
  body.className = 'panel-body';
  panelEl.append(head, body);
  return body;
}

async function showDetail(node: TreeNode): Promise<void> {
  const body = panelShell(heading(node), false);
  body.textContent = 'Loading…';
  let detail: NodeDetail;
  try {
    detail = await api.node(state.openProject!.slug, state.session!.id, node.id);
  } catch (error) {
    body.textContent = error instanceof Error ? error.message : String(error);
    return;
  }

  body.replaceChildren();

  const text = document.createElement('div');
  text.className = 'section body-text';
  text.textContent = detail.text || '(no message text — this turn was only tool work)';
  body.append(text);

  const files = chips('Files written', detail.meta.filesTouched, true);
  if (files) body.append(files);
  const commands = chips('Commands run', detail.meta.commands);
  if (commands) body.append(commands);

  if (detail.steps.length) {
    const section = document.createElement('div');
    section.className = 'section';
    const head = document.createElement('h4');
    head.textContent = `Tool calls (${detail.steps.length})`;
    section.append(head);
    for (const step of detail.steps) {
      const details = document.createElement('details');
      details.className = 'step';
      details.dataset.error = String(Boolean(step.isError));
      const summary = document.createElement('summary');
      const name = document.createElement('b');
      name.textContent = step.name;
      const target = document.createElement('span');
      target.className = 'target';
      target.textContent = step.target ?? '';
      summary.append(name, target);
      const input = document.createElement('pre');
      input.textContent = step.input;
      details.append(summary, input);
      if (step.result) {
        const result = document.createElement('pre');
        result.textContent = step.result;
        details.append(result);
      }
      section.append(details);
    }
    body.append(section);
  }
  setStatus(`Turn ${node.depth + 1} of this branch.`);
}

function renderDiff(): void {
  const tree = state.tree;
  if (!tree || state.picks.length !== 2) return;
  const [left, right] = state.picks;
  const { ancestor, left: leftTail, right: rightTail } = commonAncestor(tree, left.id, right.id);

  const body = panelShell('Comparing two branches', true);

  const note = document.createElement('div');
  note.className = 'ancestor';
  note.textContent = ancestor
    ? `Shared up to turn ${ancestor.depth + 1} — “${ancestor.text.slice(0, 90)}”. Below is where they part.`
    : 'These branches share no common ancestor.';
  body.append(note);

  const grid = document.createElement('div');
  grid.className = 'diff';
  grid.append(column('left', leftTail), column('right', rightTail));
  body.append(grid);

  setStatus(`${leftTail.length} turns vs ${rightTail.length} turns after the split.`);
}

function column(side: 'left' | 'right', nodes: TreeNode[]): HTMLElement {
  const col = document.createElement('div');
  col.className = `diff-col ${side}`;
  const head = document.createElement('h4');
  head.textContent = `${side === 'left' ? 'Branch A' : 'Branch B'} · ${nodes.length} turns`;
  col.append(head);

  if (!nodes.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'This branch ends at the split.';
    col.append(empty);
  }

  for (const node of nodes) {
    const card = document.createElement('div');
    card.className = 'step-card';
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = heading(node);
    const preview = document.createElement('div');
    preview.className = 'preview';
    preview.textContent = node.text;
    card.append(who, preview);

    const touched = [...(node.meta?.filesTouched ?? []), ...(node.meta?.commands ?? [])];
    if (touched.length) {
      const wrap = document.createElement('div');
      wrap.className = 'chips';
      wrap.style.marginTop = '6px';
      for (const value of touched.slice(0, 6)) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = value.length > 48 ? `${value.slice(0, 48)}…` : value;
        wrap.append(chip);
      }
      card.append(wrap);
    }
    card.addEventListener('click', () => canvas.centreOn(node.id));
    col.append(card);
  }
  return col;
}

/* Tooltip ------------------------------------------------------------------ */

function showTip(node: TreeNode | null, screen: { x: number; y: number }): void {
  if (!node) {
    tipEl.classList.remove('on');
    return;
  }
  const who = document.createElement('div');
  who.className = 'who';
  const version = node.siblingCount > 1 ? ` · version ${node.siblingIndex + 1}/${node.siblingCount}` : '';
  const touched = (node.meta?.filesTouched?.length ?? 0) + (node.meta?.commands?.length ?? 0);
  who.textContent =
    `${node.sender === 'human' ? 'You' : 'Claude'} · turn ${node.depth + 1}${version}` +
    (touched ? ` · touched ${touched}` : '');
  const body = document.createElement('div');
  body.textContent = node.text;
  tipEl.replaceChildren(who, body);

  const rect = canvasEl.getBoundingClientRect();
  tipEl.style.left = `${Math.min(Math.max(8, screen.x + 18), rect.width - 376)}px`;
  tipEl.style.top = `${Math.min(Math.max(8, screen.y - 20), rect.height - 130)}px`;
  tipEl.classList.add('on');
}

/* Boot --------------------------------------------------------------------- */

el('fit').addEventListener('click', () => canvas.fit());
filterEl.addEventListener('input', renderSidebar);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') panelEl.hidden = true;
});

api
  .projects()
  .then((projects) => {
    state.projects = projects;
    renderSidebar();
    setStatus(`${projects.length} projects with transcripts.`);
  })
  .catch(fail);
