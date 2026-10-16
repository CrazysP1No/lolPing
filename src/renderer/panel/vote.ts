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

/** Whether the buttons work: we are a voter who hasn't answered, and the vote is neither over nor out of time. */
export function canAnswer(v: VoteView, me: string | undefined, over: boolean, now: number): boolean {
  return me !== undefined && !over && now < v.endsAt && v.voters.includes(me) && !(me in v.ballots);
}

/** The surrender widget's bottom line once there is nothing to press: what we answered, or that the vote is over. */
export function voteStatus(mine: boolean | undefined, over: boolean, t: Strings): string | null {
  if (mine !== undefined) return mine ? t.voteYouYes : t.voteYouNo;
  return over ? t.voteEnded : null;
}

export function voteTitle(v: VoteView, members: readonly RoomMember[], t: Strings): string {
  if (v.kind === 'ff') return t.voteTitleFf;
  if (v.kind === 'ready') return t.voteTitleReady;
  return t.voteTitleKick(members.find((m) => m.peer === v.target)?.name ?? '?');
}

const MARK = { yes: '✓', no: '✗' } as const;
/** The ready check's timer runs round the edge of its disc. */
const RING_RADIUS = 128;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const SVG_NS = 'http://www.w3.org/2000/svg';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className: string, text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** One mark per voter: the surrender widget's bar segments, or the ready check's diamonds. */
function marks(className: string, boxes: readonly VoteBox[]): HTMLElement {
  const row = el('div', className);
  for (const b of boxes) {
    const mark = el('span', b.answer);
    mark.title = b.name;
    row.append(mark);
  }
  return row;
}

/** The ready check's disc: gold rings, the timer arc, and a dark blue face. */
function disc(): { face: SVGSVGElement; ring: SVGElement } {
  const face = document.createElementNS(SVG_NS, 'svg');
  face.setAttribute('class', 'disc');
  face.setAttribute('viewBox', '0 0 300 300');
  const defs = svg('defs', {});
  const glow = svg('radialGradient', { id: 'face', cx: '50%', cy: '42%', r: '60%' });
  glow.append(svg('stop', { offset: '0%', 'stop-color': '#1b4150' }), svg('stop', { offset: '100%', 'stop-color': '#050f16' }));
  defs.append(glow);
  const ring = svg('circle', {
    class: 'timer', cx: 150, cy: 150, r: RING_RADIUS, 'stroke-dasharray': RING_LENGTH, transform: 'rotate(-90 150 150)',
  });
  face.append(
    defs,
    svg('circle', { class: 'rim', cx: 150, cy: 150, r: 142 }),
    svg('circle', { class: 'track', cx: 150, cy: 150, r: RING_RADIUS }),
    ring,
    svg('circle', { class: 'band', cx: 150, cy: 150, r: 118 }),
    svg('circle', { class: 'face', cx: 150, cy: 150, r: 110 }),
  );
  return { face, ring };
}

/** A gold frame with a slash through it, after the client's match-found crest. */
function crest(): SVGSVGElement {
  const icon = document.createElementNS(SVG_NS, 'svg');
  icon.setAttribute('class', 'crest');
  icon.setAttribute('viewBox', '0 0 48 48');
  icon.append(
    svg('rect', { x: 4, y: 4, width: 40, height: 40, rx: 11, 'stroke-width': 3 }),
    svg('rect', { x: 10, y: 10, width: 28, height: 28, rx: 6, 'stroke-width': 1.5 }),
    svg('path', { d: 'M15 33L33 15', 'stroke-width': 3 }),
  );
  return icon;
}

/** What the countdown moves: set on every draw, updated by `tick`. */
let countdown: { vote: VoteView; over: boolean; bar: HTMLElement | null; ring: SVGElement | null } | null = null;

let ticking = false;

function tick(): void {
  if (!countdown) {
    ticking = false;
    return;
  }
  const { vote, over, bar, ring } = countdown;
  const left = voteLeft(vote, Date.now());
  if (bar) bar.style.transform = `scaleX(${left})`;
  if (ring) ring.setAttribute('stroke-dashoffset', String(RING_LENGTH * (1 - left)));
  if (over) ticking = false; // drawn once more, now that the result is in
  else requestAnimationFrame(tick);
}

/** Draws the open vote into `root`: League's surrender widget (also used for a kick), or the client's ready check. */
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
  const answerable = canAnswer(v, me, state.voteOver, Date.now());
  const boxes = voteBoxes(v, members);

  const answerButton = (yes: boolean, className: string, label: string, name = label): HTMLButtonElement => {
    const b = el('button', `${className}${mine === yes ? ' chosen' : ''}`);
    b.append(el('span', 'label', label));
    b.type = 'button';
    b.setAttribute('aria-label', name);
    b.disabled = !answerable;
    b.addEventListener('click', () => act({ t: 'ballot', yes }));
    return b;
  };

  let card: HTMLElement;
  let bar: HTMLElement | null = null;
  let ring: SVGElement | null = null;
  if (v.kind === 'ready') {
    card = el('section', 'vote ready');
    const drawn = disc();
    ring = drawn.ring;
    const inside = el('div', 'inside');
    const starter = members.find((m) => m.peer === v.starter)?.name;
    inside.append(crest(), el('h1', 'title', voteTitle(v, members, t)));
    if (starter) inside.append(el('p', 'sub', t.voteStartedBy(starter)));
    inside.append(marks('pips', boxes));
    card.append(drawn.face, inside, answerButton(true, 'accept', mine === true ? t.readyAccepted : t.voteAccept),
      answerButton(false, 'decline', t.voteDecline));
  } else {
    card = el('section', 'vote surrender');
    bar = el('div', 'bar');
    const track = el('div', 'track');
    track.append(bar);
    const foot = el('div', 'foot');
    const status = voteStatus(mine, state.voteOver, t);
    if (status === null) foot.append(answerButton(true, 'yes', MARK.yes, t.voteYes), answerButton(false, 'no', MARK.no, t.voteNo));
    else foot.append(el('span', 'said', status));
    card.append(el('h1', 'title', voteTitle(v, members, t)), marks('segments', boxes), track, foot);
  }
  root.replaceChildren(card);
  countdown = { vote: v, over: state.voteOver, bar, ring };
  if (!ticking) {
    ticking = true;
    requestAnimationFrame(tick);
  }
}
