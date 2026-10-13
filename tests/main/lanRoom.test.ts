import { randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import { LanTransport } from '../../src/main/lanTransport';
import { deriveRoomKeys, sealVideo } from '../../src/main/roomCrypto';
import { RoomManager, type RemotePing, type RoomToast, type RemoteText } from '../../src/main/roomManager';
import { makeRoomCode } from '../../src/shared/roomCode';

// Two rooms on loopback. Loopback carries no broadcast, so each transport is seeded with the other's port.
const A_PORT = 47_501;
const B_PORT = 47_502;
const CODE = makeRoomCode(randomBytes(9));

async function until(cond: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

function peer(port: number, other: number, name: string) {
  const lan = new LanTransport({ port, bindAddress: '127.0.0.1', broadcast: false, seeds: [{ host: '127.0.0.1', port: other }] });
  const room = new RoomManager({
    transports: [lan],
    now: Date.now,
    randomBytes: (n) => randomBytes(n),
    deriveKeys: deriveRoomKeys,
    appVersion: '0.3.0',
    profile: () => ({ name, color: 1, limit: 0 }),
    resolveTarget: () => ({ displayId: 1, width: 1000, height: 500 }),
  });
  const pings: RemotePing[] = [];
  const texts: RemoteText[] = [];
  const toasts: RoomToast[] = [];
  let packets = 0;
  const packetLengths: number[] = [];
  lan.on('packet', (_peer: string, packet: Uint8Array) => {
    packets++;
    packetLengths.push(packet.length);
  });
  room.on('remotePing', (p: RemotePing) => pings.push(p));
  room.on('remoteText', (p: RemoteText) => texts.push(p));
  room.on('toast', (t: RoomToast) => toasts.push(t));
  return { lan, room, pings, texts, toasts, packets: () => packets, packetLengths: () => [...packetLengths] };
}

let open: ReturnType<typeof peer>[] = [];
afterEach(() => {
  for (const p of open) p.room.quit();
  open = [];
});

describe('two rooms over loopback UDP', () => {
  it('find each other, exchange pings, survive a rebind and see a leave', async () => {
    const a = peer(A_PORT, B_PORT, 'Alice');
    const b = peer(B_PORT, A_PORT, 'Bob');
    open = [a, b];
    await Promise.all([a.room.join(CODE), b.room.join(CODE)]);
    await until(() => a.room.state().members.length === 2 && b.room.state().members.length === 2);
    expect(b.room.state().members[1]).toMatchObject({ name: 'Alice', path: 'lan' });
    expect(a.lan.status).toBe('ok');

    a.room.sendPing('push', { d: 1, x: 0.5, y: 0.5 });
    await until(() => b.pings.length === 1);
    expect(b.pings[0]).toEqual({ displayId: 1, x: 500, y: 250, id: 'push', tag: { name: 'Alice', color: 1 } });

    a.room.sendText('集合 🎮', { d: 1, x: 0.25, y: 0.75 });
    await until(() => b.texts.length === 1);
    expect(b.texts[0]).toEqual({ displayId: 1, x: 250, y: 375, text: '集合 🎮', tag: { name: 'Alice', color: 1 } });
    b.room.sendText('收到', { d: 1, x: 0.5, y: 0.5 });
    await until(() => a.texts.length === 1);
    expect(a.texts[0].text).toBe('收到');

    b.lan.rebind();
    await until(() => b.lan.status === 'ok');
    a.room.sendPing('omw', { d: 1, x: 0, y: 0 });
    await until(() => b.pings.length === 2);

    a.room.leave();
    await until(() => b.toasts.some((t) => t.kind === 'left'));
    expect(b.room.state().members).toHaveLength(1);
  });

  it('see a member who left and joined the same room again', async () => {
    const a = peer(A_PORT, B_PORT, 'Alice');
    const b = peer(B_PORT, A_PORT, 'Bob');
    open = [a, b];
    await Promise.all([a.room.join(CODE), b.room.join(CODE)]);
    await until(() => b.room.state().members.length === 2);
    a.room.leave();
    await until(() => b.room.state().members.length === 1);
    await a.room.join(CODE);
    await until(() => b.room.state().members.length === 2 && a.room.state().members.length === 2);
    a.room.sendPing('bait', { d: 1, x: 0.1, y: 0.1 });
    await until(() => b.pings.length === 1);
  });

  it('survives two rebinds in a row while packets are still going out', async () => {
    const a = peer(A_PORT, B_PORT, 'Alice');
    const b = peer(B_PORT, A_PORT, 'Bob');
    open = [a, b];
    await Promise.all([a.room.join(CODE), b.room.join(CODE)]);
    await until(() => a.room.state().members.length === 2);
    for (let i = 0; i < 200; i++) a.room.sendPing('push', { d: 1, x: 0.5, y: 0.5 });
    a.lan.rebind();
    a.lan.rebind();
    await until(() => a.lan.status !== 'starting');
    expect(a.lan.status).toBe('ok');
  });

  it('whenClosed() resolves once the port is free again, after the last packets went out', async () => {
    const a = peer(A_PORT, B_PORT, 'Alice');
    open = [a];
    await a.room.join(CODE);
    await until(() => a.lan.status === 'ok');
    a.room.quit(); // queues a bye, then stops
    await a.lan.whenClosed();
    const probe = createSocket('udp4');
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject);
      probe.bind(A_PORT, '127.0.0.1', () => resolve());
    });
    probe.close();
  });

    it('caps junk from one address before it reaches decryption', async () => {
    const b = peer(B_PORT, A_PORT, 'Bob');
    open = [b];
    await b.room.join(CODE);
    await until(() => b.lan.status === 'ok');
    const junk = createSocket('udp4');
    const before = b.packets();
    await Promise.all(Array.from({ length: 500 }, () => new Promise<void>((r) => junk.send(randomBytes(64), B_PORT, '127.0.0.1', () => r()))));
    await new Promise((r) => setTimeout(r, 200));
    junk.close();
    const through = b.packets() - before;
    expect(through).toBeGreaterThan(50);
    expect(through).toBeLessThanOrEqual(130);
    expect(b.room.state().members).toHaveLength(1);
  });

  it('accepts a video-sized packet but still rejects an oversized control packet', async () => {
    const a = peer(A_PORT, B_PORT, 'Alice');
    const b = peer(B_PORT, A_PORT, 'Bob');
    open = [a, b];
    await Promise.all([a.room.join(CODE), b.room.join(CODE)]);
    await until(() => a.lan.status === 'ok' && b.lan.status === 'ok');

    const video = sealVideo((await deriveRoomKeys(CODE)).msgKey, new Uint8Array(8_000));
    a.lan.broadcast(video);
    await until(() => b.packetLengths().includes(video.length));
    expect(b.packetLengths()).toContain(video.length);

    const control = Buffer.from(video);
    control[0] = 0x01;
    const controlBefore = b.packetLengths().filter((length) => length === control.length).length;
    a.lan.broadcast(control);
    await new Promise((r) => setTimeout(r, 100));
    expect(b.packetLengths().filter((length) => length === control.length)).toHaveLength(controlBefore);
    a.room.quit();
    b.room.quit();
    await Promise.all([a.lan.whenClosed(), b.lan.whenClosed()]);
  });

  it('reports a port that is already taken as unavailable', async () => {
    const blocker = createSocket('udp4');
    await new Promise<void>((r) => blocker.bind(A_PORT, '127.0.0.1', () => r()));
    const a = peer(A_PORT, B_PORT, 'Alice');
    open = [a];
    await a.room.join(CODE);
    await until(() => a.lan.status !== 'starting');
    expect(a.lan.status).toBe('unavailable');
    expect(a.room.state().lan).toBe('unavailable');
    blocker.close();
  });
});
