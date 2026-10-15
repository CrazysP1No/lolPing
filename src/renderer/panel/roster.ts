import { strings, type Strings } from '../../shared/i18n';
import type { PanelAction, PanelState } from '../../shared/ipc';
import type { RoomMember } from '../../shared/room';
import type { HistoryLine } from '../../shared/roomHistory';
import { tagColorCss } from '../../shared/roomColors';
import { el } from './vote';

export type MemberFlag = keyof Strings['panelStatus'];

/** Why a member is more than plain "on", most important first; ['on'] when there is nothing to say. */
export function memberFlags(m: RoomMember): MemberFlag[] {
  const flags: MemberFlag[] = [];
  if (m.needsUpdate) flags.push('update');
  if (m.noChat) flags.push('noChat');
  if (m.status === 'paused') flags.push('paused');
  if (m.status === 'muted') flags.push('muted');
  if (m.textOff) flags.push('textOff');
  if (m.votesOff) flags.push('votesOff');
  return flags.length > 0 ? flags : ['on'];
}

/** The tooltip of a member's status icon: every flag on its own line. */
export const statusTip = (flags: readonly MemberFlag[], t: Strings): string =>
  flags.map((f) => t.panelStatus[f]).join('\n');

export interface RowActions {
  /** The name tag posts "<name> - Alive". */
  alive: boolean;
  mute: boolean;
  kick: boolean;
}

/** What a row offers: alive needs room text, kick needs votes, and neither mute nor kick applies to our own row. */
export function rowActions(m: RoomMember, s: Pick<PanelState, 'textOn' | 'votesOn'>): RowActions {
  return { alive: s.textOn, mute: !m.self, kick: s.votesOn && !m.self };
}

export const memberCount = (s: Pick<PanelState, 'room' | 'max'>): string => `${s.room.members.length} / ${s.max}`;

/** Whether a list scrolled to `top` shows its end, so a new line should keep it pinned there. */
export const atBottom = (top: number, clientHeight: number, scrollHeight: number): boolean =>
  scrollHeight - top - clientHeight <= 8;

const SVG_NS = 'http://www.w3.org/2000/svg';
const FLAG_GLYPH: Record<MemberFlag, string> = {
  on: '●', paused: '❚❚', muted: '⊘', update: '⇧', noChat: '!', textOff: 'T', votesOff: 'V',
};

type Tab = 'members' | 'history';
/** The tab stays as it was left, so the panel opens where the player last looked. */
let tab: Tab = 'members';

function speakerIcon(muted: boolean): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  const path = (d: string, stroke: boolean): void => {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    if (stroke) p.setAttribute('fill', 'none');
    svg.append(p);
  };
  path('M2 6h3l4-3v10l-4-3H2z', false);
  if (muted) path('M11.5 6l3.5 4M15 6l-3.5 4', true);
  else path('M11.5 5.5a3.5 3.5 0 0 1 0 5', true);
  return svg;
}

function memberRow(m: RoomMember, state: PanelState, t: Strings, act: (a: PanelAction) => void): HTMLElement {
  const can = rowActions(m, state);
  const row = el('div', `member${m.muted ? ' muted' : ''}`);

  const flags = memberFlags(m);
  const status = el('span', `status ${flags[0]}`, FLAG_GLYPH[flags[0]]);
  status.title = statusTip(flags, t);

  const tag = el(can.alive ? 'button' : 'span', 'tag', m.name);
  tag.style.setProperty('--tag', tagColorCss(m.color, m.rgb));
  if (tag instanceof HTMLButtonElement) {
    tag.type = 'button';
    tag.title = t.aliveLine(m.name);
    // The click's screen point is where everyone sees the line, like a ping at the cursor.
    tag.addEventListener('click', (e) => act({ t: 'alive', peer: m.peer, x: e.screenX, y: e.screenY }));
  }
  row.append(status, tag);
  if (m.self) row.append(el('span', 'self', t.roomYou));
  row.append(el('span', 'path', m.self ? '' : t.roomPath[m.path]));

  if (can.mute) {
    const label = m.muted ? t.roomUnmuteMember : t.roomMuteMember;
    const mute = el('button', `icon speaker${m.muted ? ' on' : ''}`);
    mute.type = 'button';
    mute.title = label;
    mute.setAttribute('aria-label', label);
    mute.append(speakerIcon(m.muted));
    mute.addEventListener('click', () => act({ t: 'mute', peer: m.peer, on: !m.muted }));
    row.append(mute);
  }
  if (can.kick) {
    const label = t.panelKick(m.name);
    const kick = el('button', 'icon kick', '✕');
    kick.type = 'button';
    kick.title = label;
    kick.setAttribute('aria-label', label);
    kick.addEventListener('click', () => act({ t: 'kick', peer: m.peer }));
    row.append(kick);
  }
  return row;
}

function historyLine(line: HistoryLine): HTMLElement {
  const row = el('div', `line ${line.kind}`);
  if (line.tag) {
    const who = el('span', 'who', line.tag.name);
    who.style.setProperty('--tag', tagColorCss(line.tag.color, line.tag.rgb));
    row.append(who);
  }
  row.append(el('span', 'said', line.text));
  return row;
}

function footerButton(label: string, kind: 'ff' | 'ready', act: (a: PanelAction) => void): HTMLButtonElement {
  const b = el('button', `vote-btn ${kind}`, label);
  b.type = 'button';
  b.addEventListener('click', () => act({ t: 'vote', kind }));
  return b;
}

/** Draws the room panel: the header, the players or the history, and the vote buttons. */
export function renderRoster(root: HTMLElement, state: PanelState, act: (a: PanelAction) => void): void {
  const t = strings(state.lang);
  // Redrawing rebuilds the list: keep where it was scrolled, and keep the history pinned to its newest line.
  const found = root.querySelector<HTMLElement>('.list');
  const before = found?.classList.contains(tab) ? found : null;
  const wasAtBottom = before ? atBottom(before.scrollTop, before.clientHeight, before.scrollHeight) : true;
  const wasTop = before?.scrollTop ?? 0;

  const card = el('section', 'roster');
  const head = el('header', 'roster-head');
  head.append(el('span', 'code', state.room.code ?? ''), el('span', 'count', memberCount(state)));

  const tabs = el('nav', 'tabs');
  for (const [id, label] of [['members', t.panelMembers], ['history', t.panelHistory]] as const) {
    const b = el('button', `tab${tab === id ? ' current' : ''}`, label);
    b.type = 'button';
    b.addEventListener('click', () => {
      tab = id;
      renderRoster(root, state, act);
    });
    tabs.append(b);
  }

  const list = el('div', `list ${tab}`);
  if (tab === 'members') {
    for (const m of state.room.members) list.append(memberRow(m, state, t, act));
  } else if (state.history.length === 0) {
    list.append(el('div', 'empty', t.panelHistoryEmpty));
  } else {
    for (const line of state.history) list.append(historyLine(line));
  }
  card.append(head, tabs, list);

  if (tab === 'members' && state.votesOn) {
    const foot = el('footer', 'roster-foot');
    foot.append(footerButton(t.panelSurrender, 'ff', act), footerButton(t.panelReadyCheck, 'ready', act));
    card.append(foot);
  }
  root.replaceChildren(card);
  list.scrollTop = tab === 'history' && wasAtBottom ? list.scrollHeight : wasTop;
}
