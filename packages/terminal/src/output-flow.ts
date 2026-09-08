export interface TerminalOutputHandlers {
  data: (data: string, sequence: number) => void;
  pause: () => void;
  resume: () => void;
  drained: () => void;
  overflow: () => void;
}

/** One acknowledged frame at a time from the PTY to the terminal emulator. */
export class TerminalOutputFlow {
  private chunks: string[] = [];
  private queuedBytes = 0;
  private flight?: { sequence: number; bytes: number };
  private sequence = 0;
  private ready = false;
  private paused = false;
  private ended = false;
  private disposed = false;

  constructor(private readonly handlers: TerminalOutputHandlers,
    private readonly highWater = 256 * 1024,
    private readonly lowWater = 64 * 1024,
    private readonly hardLimit = 2 * 1024 * 1024) {}

  get retainedBytes(): number { return this.queuedBytes + (this.flight?.bytes ?? 0); }

  push(data: string): void {
    if (this.disposed || this.ended || !data) return;
    const bytes = Buffer.byteLength(data);
    if (this.retainedBytes + bytes > this.hardLimit) {
      // Never drop arbitrary ANSI fragments and then pretend output is intact.
      this.dispose();
      this.handlers.overflow();
      return;
    }
    this.chunks.push(data);
    this.queuedBytes += bytes;
    this.updatePressure();
    this.pump();
  }

  acknowledge(sequence: number): void {
    if (this.disposed) return;
    if (!this.ready) {
      if (sequence !== 0) return;
      this.ready = true;
    } else {
      if (!this.flight || this.flight.sequence !== sequence) return;
      this.flight = undefined;
    }
    this.updatePressure();
    this.pump();
  }

  end(): void { this.ended = true; this.pump(); }
  dispose(): void { this.disposed = true; this.chunks = []; this.queuedBytes = 0; this.flight = undefined; }

  private updatePressure(): void {
    if (!this.paused && this.retainedBytes >= this.highWater) {
      this.paused = true;
      this.handlers.pause();
    } else if (this.paused && this.retainedBytes <= this.lowWater) {
      this.paused = false;
      this.handlers.resume();
    }
  }

  private pump(): void {
    if (this.disposed || !this.ready || this.flight) return;
    if (!this.chunks.length) {
      if (this.ended) { this.dispose(); this.handlers.drained(); }
      return;
    }
    let data = "";
    while (this.chunks.length && data.length < 16 * 1024) {
      const chunk = this.chunks[0]!;
      let take = Math.min(chunk.length, 16 * 1024 - data.length);
      // Keep UTF-16 surrogate pairs intact when slicing a frame.
      if (take < chunk.length && /[\uD800-\uDBFF]/.test(chunk[take - 1]!)) take--;
      if (!take) break;
      data += chunk.slice(0, take);
      if (take === chunk.length) this.chunks.shift();
      else this.chunks[0] = chunk.slice(take);
    }
    const bytes = Buffer.byteLength(data);
    this.queuedBytes -= bytes;
    this.flight = { sequence: ++this.sequence, bytes };
    this.handlers.data(data, this.sequence);
  }
}
