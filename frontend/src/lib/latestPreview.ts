// One request at a time. Superseded work can finish, but cannot publish or queue a backlog.
export class LatestPreview<Input, Output> {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: { input: Input; generation: number } | null = null;
  private running = false;
  private controller: AbortController | null = null;
  private disposed = false;
  private ready = false;
  private readonly request: (input: Input, signal: AbortSignal) => Promise<Output>;
  private readonly success: (input: Input, output: Output) => void;
  private readonly failure: (input: Input, error: unknown) => void;
  private readonly delay: number;

  constructor(request: (input: Input, signal: AbortSignal) => Promise<Output>, success: (input: Input, output: Output) => void, failure: (input: Input, error: unknown) => void, delay = 180) {
    this.request = request; this.success = success; this.failure = failure; this.delay = delay;
  }
  schedule(input: Input | null) {
    this.generation++;
    clearTimeout(this.timer);
    this.ready = false;
    this.pending = input == null ? null : { input, generation: this.generation };
    if (input != null && !this.disposed) this.timer = setTimeout(() => { this.ready = true; void this.drain(); }, this.delay);
  }
  private async drain() {
    if (this.disposed || this.running || !this.ready || !this.pending) return;
    const work = this.pending;
    this.pending = null; this.running = true;
    this.controller = new AbortController();
    try {
      const result = await this.request(work.input, this.controller.signal);
      if (!this.disposed && work.generation === this.generation) this.success(work.input, result);
    } catch (error) {
      if (!this.disposed && work.generation === this.generation) this.failure(work.input, error);
    } finally {
      this.running = false; this.controller = null;
      void this.drain();
    }
  }
  dispose() {
    this.disposed = true; this.schedule(null); this.controller?.abort();
  }
}
