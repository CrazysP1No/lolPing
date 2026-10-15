import { strings, type Strings } from '../../shared/i18n';
import type { PanelAction, PanelState } from '../../shared/ipc';
import type { RoomMember } from '../../shared/room';
import { VOTE_MS, type VoteView } from '../../shared/voteTally';

export interface VoteBox {
  peer: string;
  name: string;
  answer: 'yes' | 'no' | 'none';
}

/** One box per voter, in the order the vote fixed them. A voter who has left the room has no name any more. */
export function voteBoxes(v: VoteView, members: readonly RoomMember[]): VoteBox[] {
  return v.voters.map((peer) => {
    const ballot = v.ballots[peer];
    return { peer, name: members.find((m) => m.peer === peer)?.name ?? '', answer: ballot === undefined ? 'none' : ballot ? 'yes' : 'no' };
  });
}

/** The share of the vote's time that is left, 1 at the start and 0 at the end. */
export function voteLeft(v: VoteView, now: number): number {
  return Math.min(1, Math.max(0, (v.endsAt - now) / VOTE_MS[v.kind]));
}

export function voteTitle(v: VoteView, members: readonly RoomMember[], t: Strings): string {
  if (v.kind === 'ff') return t.voteTitleFf;
  if (v.kind === 'ready') return t.voteTitleReady;
  return t.voteTitleKick(members.find((m) => m.peer === v.target)?.name ?? '?');
}

const MARK = { yes: '\u2713', no: '\u2717', none: '' } as const;
const RING_RADIUS = 26;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function boxRow(boxes: readonly VoteBox[]): HTMLElement {
  const row = el('div', 'boxes');
  for (const b of boxes) {
    const box = el('span', `box ${b.answer}`, MARK[b.answer]);
    box.title = b.name;
    row.append(box);
  }
  return row;
}

/** What the countdown moves: set on every draw, updated by `tick`. */
let countdown: { vote: VoteView; bar: HTMLElement | null; ring: SVGCircleElement | null; seconds: HTMLElement | null } | null = null;

let ticking = false;

function tick(): void {
  if (!countdown) {
    ticking = false;
    return;
  }
  const { vote, bar, ring, seconds } = countdown;
  const left = voteLeft(vote, Date.now());
  if (bar) bar.style.transform = `scaleX(${left})`;
  if (ring) ring.setAttribute('stroke-dashoffset', String(RING_LENGTH * (1 - left)));
  if (seconds) seconds.textContent = String(Math.ceil((left * VOTE_MS[vote.kind]) / 1000));
  requestAnimationFrame(tick);
}

/** Draws the open vote into `root`: the surrender and kick widget, or the ready check card. */
export function renderVote(root: HTMLElement, state: PanelState, act: (a: PanelAction) => void): void {
  const v = state.vote;
  if (!v) {
    root.replaceChildren();
    countdown = null;
    return;
  }
  const t = strings(state.lang);
  const members = state.room.members;
  const me = members.find((m) => m.self)?.peer;
  const mine = me === undefined ? undefined : v.ballots[me];
  const canAnswer = me !== undefined && v.voters.includes(me) && mine === undefined && Date.now() < v.endsAt;
  const ready = v.kind === 'ready';

  const card = el('section', `vote ${ready ? 'ready' : 'surrender'}`);
  card.append(el('h1', 'title', voteTitle(v, members, t)));
  const boxes = boxRow(voteBoxes(v, members));
  let bar: HTMLElement | null = null;
  let ring: SVGCircleElement | null = null;
  let seconds: HTMLElement | null = null;

  const answerButton = (yes: boolean, className: string, label: string, name = label): HTMLButtonElement => {
    const b = el('button', `${className}${mine === yes ? ' chosen' : ''}`, label);
    b.type = 'button';
    b.setAttribute('aria-label', name);
    b.disabled = !canAnswer;
    b.addEventListener('click', () => act({ t: 'ballot', yes }));
    return b;
  };

  if (ready) {
    const dial = el('div', 'dial');
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 60 60');
    const track = document.createElementNS(SVG_NS, 'circle');
    ring = document.createElementNS(SVG_NS, 'circle');
    for (const c of [track, ring]) {
      c.setAttribute('cx', '30');
      c.setAttribute('cy', '30');
      c.setAttribute('r', String(RING_RADIUS));
    }
    track.setAttribute('class', 'track');
    ring.setAttribute('class', 'ring');
    ring.setAttribute('stroke-dasharray', String(RING_LENGTH));
    svg.append(track, ring);
    seconds = el('span', 'seconds');
    dial.append(svg, seconds);
    card.append(dial, answerButton(true, 'accept', t.voteAccept), answerButton(false, 'decline', t.voteDecline), boxes);
  } else {
    bar = el('div', 'bar');
    const track = el('div', 'track');
    track.append(bar);
    const buttons = el('div', 'buttons');
    buttons.append(answerButton(true, 'yes', MARK.yes, t.voteYes), answerButton(false, 'no', MARK.no, t.voteNo));
    card.append(boxes, track, buttons);
  }
  root.replaceChildren(card);
  countdown = { vote: v, bar, ring, seconds };
  if (!ticking) {
    ticking = true;
    requestAnimationFrame(tick);
  }
}
