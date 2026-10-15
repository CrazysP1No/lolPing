import { describe, expect, it } from 'vitest';
import { atBottom, memberCount, memberFlags, rowActions, statusTip } from '../../src/renderer/panel/roster';
import { strings } from '../../src/shared/i18n';
import type { RoomMember, RoomStateCore } from '../../src/shared/room';

const member = (over: Partial<RoomMember> = {}): RoomMember => ({
  peer: 'bb', name: 'Alex', color: 0, rgb: null, path: 'lan', status: 'on', needsUpdate: false, noEmotes: false,
  noChat: false, textOff: false, votesOff: false, muted: false, self: false, ...over,
});

describe('memberFlags', () => {
  it('is just "on" for a member with nothing to report', () => {
    expect(memberFlags(member())).toEqual(['on']);
  });

  it('lists what is wrong, most important first', () => {
    expect(memberFlags(member({ needsUpdate: true, noChat: true, status: 'paused', textOff: true, votesOff: true })))
      .toEqual(['update', 'noChat', 'paused', 'textOff', 'votesOff']);
    expect(memberFlags(member({ status: 'muted' }))).toEqual(['muted']);
    expect(memberFlags(member({ votesOff: true }))).toEqual(['votesOff']);
  });
});

describe('statusTip', () => {
  it('writes every flag on its own line, in the chosen language', () => {
    expect(statusTip(['on'], strings('en'))).toBe('In the room');
    expect(statusTip(['noChat', 'paused'], strings('en'))).toBe('Can’t see text and votes\nPaused');
    expect(statusTip(['textOff'], strings('zh-CN'))).toBe('文字已关闭');
  });
});

describe('rowActions', () => {
  it('lets the name tag post an alive line only while room text is on', () => {
    expect(rowActions(member(), { textOn: true, votesOn: true }).alive).toBe(true);
    expect(rowActions(member(), { textOn: false, votesOn: true }).alive).toBe(false);
  });

  it('offers mute and kick on other members, kick only with votes on', () => {
    expect(rowActions(member(), { textOn: true, votesOn: true })).toEqual({ alive: true, mute: true, kick: true });
    expect(rowActions(member(), { textOn: true, votesOn: false })).toMatchObject({ mute: true, kick: false });
  });

  it('offers neither mute nor kick on our own row, but still alive', () => {
    const own = member({ self: true });
    expect(rowActions(own, { textOn: true, votesOn: true })).toEqual({ alive: true, mute: false, kick: false });
  });
});

describe('memberCount', () => {
  it('shows the people here out of the room limit', () => {
    const room: RoomStateCore = {
      phase: 'active', code: 'PING-AAAAA-BBBBB', members: [member(), member({ peer: 'cc' }), member({ peer: 'dd' })],
      lan: 'ok', internet: 'ok', lonely: false, clockSkew: false,
    };
    expect(memberCount({ room, max: 16 })).toBe('3 / 16');
  });
});

describe('atBottom', () => {
  it('is true at the end of the list and within a few pixels of it', () => {
    expect(atBottom(600, 400, 1000)).toBe(true);
    expect(atBottom(595, 400, 1000)).toBe(true);
    expect(atBottom(100, 400, 1000)).toBe(false);
  });

  it('is true for a list that fits without scrolling', () => {
    expect(atBottom(0, 400, 300)).toBe(true);
  });
});
