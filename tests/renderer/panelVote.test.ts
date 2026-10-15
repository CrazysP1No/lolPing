import { describe, expect, it } from 'vitest';
import { voteBoxes, voteLeft, voteTitle } from '../../src/renderer/panel/vote';
import { strings } from '../../src/shared/i18n';
import type { RoomMember } from '../../src/shared/room';
import { VOTE_MS, type VoteView } from '../../src/shared/voteTally';

const member = (peer: string, name: string, self = false): RoomMember => ({
  peer, name, color: 0, rgb: null, path: 'lan', status: 'on', needsUpdate: false, noEmotes: false, noChat: false,
  textOff: false, votesOff: false, muted: false, self,
});
const members = [member('aa', 'Me', true), member('bb', 'Alex'), member('cc', 'Sam')];
const view = (over: Partial<VoteView> = {}): VoteView => ({
  id: '01234567', kind: 'ff', starter: 'aa', voters: ['aa', 'bb', 'cc', 'gone'], ballots: { aa: true, bb: false }, endsAt: 100_000, ...over,
});

describe('voteBoxes', () => {
  it('gives one box per voter: yes, no or empty, and no name for a voter who has left', () => {
    expect(voteBoxes(view(), members)).toEqual([
      { peer: 'aa', name: 'Me', answer: 'yes' },
      { peer: 'bb', name: 'Alex', answer: 'no' },
      { peer: 'cc', name: 'Sam', answer: 'none' },
      { peer: 'gone', name: '', answer: 'none' },
    ]);
  });
});

describe('voteLeft', () => {
  it('runs from 1 at the start to 0 at the end and stays inside that', () => {
    const v = view({ kind: 'ready', endsAt: 1000 + VOTE_MS.ready });
    expect(voteLeft(v, 1000)).toBe(1);
    expect(voteLeft(v, 1000 + VOTE_MS.ready / 2)).toBe(0.5);
    expect(voteLeft(v, 1000 + VOTE_MS.ready + 5)).toBe(0);
    expect(voteLeft(v, 0)).toBe(1);
  });
});

describe('voteTitle', () => {
  it('names the vote in the chosen language, and the kick target by name', () => {
    expect(voteTitle(view(), members, strings('en'))).toBe('Surrender?');
    expect(voteTitle(view({ kind: 'ready' }), members, strings('zh-CN'))).toBe('准备确认');
    expect(voteTitle(view({ kind: 'kick', target: 'bb' }), members, strings('en'))).toBe('Remove Alex?');
    expect(voteTitle(view({ kind: 'kick', target: 'bb' }), members, strings('zh-CN'))).toBe('移出 Alex？');
  });
});
