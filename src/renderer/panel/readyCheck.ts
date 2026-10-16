import { strings } from '../../shared/i18n';
import type { PanelAction, PanelState } from '../../shared/ipc';
import { canAnswer, el, voteBoxes, voteTitle } from './vote';

/** What the client's ready check is showing: the countdown, our answer, or a vote that ended before we answered. */
export type ReadyPhase = 'countdown' | 'accepted' | 'declined' | 'ended';

export function readyPhase(mine: boolean | undefined, over: boolean): ReadyPhase {
  if (mine !== undefined) return mine ? 'accepted' : 'declined';
  return over ? 'ended' : 'countdown';
}

/**
 * The countdown video's speed, so it reaches its end when the vote does. The client does the same with its 10.7 s
 * video; an odd answer (no time left, a video not loaded yet) plays at normal speed.
 */
export function countdownRate(duration: number, currentTime: number, secondsLeft: number): number {
  const rate = (duration - currentTime) / secondsLeft;
  return Number.isFinite(rate) && rate > 0.0625 ? rate : 1;
}

type Clip = 'countdown' | 'acceptedIntro' | 'acceptedIdle' | 'declined';
const CLIP_FILE: Record<Clip, string> = {
  countdown: 'ready-countdown', acceptedIntro: 'ready-accepted-intro', acceptedIdle: 'ready-accepted-idle', declined: 'ready-declined',
};

interface Card {
  id: string;
  root: HTMLElement;
  scene: HTMLElement;
  title: HTMLElement;
  details: HTMLElement;
  pips: HTMLElement;
  accept: HTMLButtonElement;
  decline: HTMLButtonElement;
  clips: Record<Clip, HTMLVideoElement>;
  phase: ReadyPhase | null;
  endsAt: number;
  /** Keeps the countdown's speed matched to the time left. */
  pace: number | undefined;
}

/** The card stays up while its vote does: redrawing it would restart the videos. */
let card: Card | null = null;

function clip(name: Clip, loop: boolean): HTMLVideoElement {
  const v = el('video', `clip ${name}`);
  v.src = `../ui/${CLIP_FILE[name]}.webm`;
  v.muted = true;
  v.loop = loop;
  v.preload = 'auto';
  v.hidden = true;
  return v;
}

function play(c: Card, name: Clip): void {
  for (const [key, v] of Object.entries(c.clips) as [Clip, HTMLVideoElement][]) {
    if (key === name) continue;
    v.hidden = true;
    v.pause();
  }
  const v = c.clips[name];
  v.hidden = false;
  v.currentTime = 0;
  void v.play().catch(() => undefined); // a video that can't play leaves the frame as it is
}

function pace(c: Card): void {
  const v = c.clips.countdown;
  v.playbackRate = countdownRate(v.duration, v.currentTime, (c.endsAt - Date.now()) / 1000);
}

function enter(c: Card, phase: ReadyPhase): void {
  clearInterval(c.pace);
  c.pace = undefined;
  c.scene.classList.toggle('declined', phase === 'declined');
  if (phase === 'countdown') {
    play(c, 'countdown');
    pace(c);
    c.pace = window.setInterval(() => pace(c), 1000);
  } else if (phase === 'accepted') {
    play(c, 'acceptedIntro');
  } else if (phase === 'declined') {
    play(c, 'declined');
  } else {
    c.clips.countdown.pause(); // the vote ended without us: the ring stops where it was
  }
  c.phase = phase;
}

function build(id: string, endsAt: number, act: (a: PanelAction) => void): Card {
  const root = el('section', 'vote ready');
  const body = el('div', 'body');
  const scene = el('div', 'scene');
  const timer = el('div', 'timer');
  const clips: Record<Clip, HTMLVideoElement> = {
    countdown: clip('countdown', false),
    acceptedIntro: clip('acceptedIntro', false),
    acceptedIdle: clip('acceptedIdle', true),
    declined: clip('declined', false),
  };
  timer.append(...Object.values(clips));
  const status = el('div', 'status');
  const title = el('h1', 'title');
  const details = el('p', 'details');
  const pips = el('div', 'pips');
  status.append(title, details, pips);
  const buttons = el('div', 'buttons');
  const button = (className: string, yes: boolean): HTMLButtonElement => {
    const b = el('button', className);
    b.type = 'button';
    b.addEventListener('click', () => act({ t: 'ballot', yes }));
    return b;
  };
  const accept = button('accept', true);
  const decline = button('decline', false);
  buttons.append(accept, decline);
  body.append(scene, el('div', 'frame'), timer, el('div', 'map'), status, buttons);
  root.append(body);
  const c: Card = { id, root, scene, title, details, pips, accept, decline, clips, phase: null, endsAt, pace: undefined };
  clips.acceptedIntro.addEventListener('ended', () => {
    if (c.phase === 'accepted') play(c, 'acceptedIdle');
  });
  return c;
}

/** Takes the ready check down and stops its videos. */
export function dropReady(): void {
  if (!card) return;
  clearInterval(card.pace);
  for (const v of Object.values(card.clips)) v.pause();
  card = null;
}

/** Draws the client's ready check: the frame round the map, its timer videos, and Accept and Decline under it. */
export function renderReady(root: HTMLElement, state: PanelState, act: (a: PanelAction) => void): void {
  const v = state.vote;
  if (!v) return;
  const t = strings(state.lang);
  const members = state.room.members;
  const me = members.find((m) => m.self)?.peer;
  const mine = me === undefined ? undefined : v.ballots[me];

  if (!card || card.id !== v.id) {
    dropReady();
    card = build(v.id, v.endsAt, act);
  }
  const c = card;
  if (!root.contains(c.root)) root.replaceChildren(c.root);

  const phase = readyPhase(mine, state.voteOver);
  if (phase === 'accepted') {
    c.title.textContent = t.readyAccepted;
    c.details.textContent = t.readyWaiting;
  } else if (phase === 'declined') {
    c.title.textContent = t.readyDeclined;
    c.details.textContent = '';
  } else {
    c.title.textContent = voteTitle(v, members, t);
    const starter = members.find((m) => m.peer === v.starter)?.name;
    c.details.textContent = starter ? t.voteStartedBy(starter) : '';
  }
  c.pips.replaceChildren(...voteBoxes(v, members).map((b) => {
    const pip = el('span', b.answer);
    pip.title = b.name;
    return pip;
  }));

  const answerable = canAnswer(v, me, state.voteOver, Date.now());
  c.accept.textContent = t.voteAccept;
  c.decline.textContent = t.voteDecline;
  c.accept.disabled = !answerable;
  c.decline.disabled = !answerable;
  c.decline.classList.toggle('chosen', mine === false);
  if (c.phase !== phase) enter(c, phase);
}
