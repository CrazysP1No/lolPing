import { WHEEL_SLOTS } from './pings';

/** Wheel geometry in CSS pixels (matches prototype/wheel-demo.html). */
export const WHEEL = { innerR: 86, outerR: 188, extR: 288, iconR: 137, iconSize: 40 } as const;

/**
 * Slice under an offset from the wheel centre. Screen coordinates (y down).
 * Returns -1 inside the dead zone, else a slot index clockwise from N.
 */
export function pickSlice(dx: number, dy: number, deadZone: number = WHEEL.innerR): number {
  if (Math.hypot(dx, dy) < deadZone) return -1;
  const step = 360 / WHEEL_SLOTS;
  const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + step / 2 + 360) % 360;
  return Math.floor(deg / step) % WHEEL_SLOTS;
}
