import type { TagRgb } from '../shared/roomColors';

const MAX_LINES = 200;

/** A line of this session's room chat. `tag` is who said it; a vote result has none. */
export interface HistoryLine {
  at: number;
  kind: 'text' | 'alive' | 'vote';
  tag: { name: string; color: number; rgb: TagRgb | null } | null;
  text: string;
}

/** What was said in the room since we joined, newest 200 lines. Memory only; the panel reads it. */
export class RoomHistory {
  private readonly all: HistoryLine[] = [];

  push(line: HistoryLine): void {
    this.all.push(line);
    if (this.all.length > MAX_LINES) this.all.splice(0, this.all.length - MAX_LINES);
  }

  lines(): readonly HistoryLine[] {
    return this.all;
  }

  clear(): void {
    this.all.length = 0;
  }
}
