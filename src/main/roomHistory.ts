import type { HistoryLine } from '../shared/roomHistory';

const MAX_LINES = 200;

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
