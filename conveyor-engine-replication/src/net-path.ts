/**
 * Engine-owned transport. Frames are protocol envelopes
 * (welcome / input / snap / ack / resync / error).
 * No scheduler, link profile, payload hash, or RNG.
 */

export interface NetSendOptions {
  to?: string;
  kind?: string;
}

export interface NetSendReceipt {
  ok: boolean;
  seq?: number;
}

export interface NetPath<Frame = unknown> {
  send(frame: Frame, options?: NetSendOptions): Promise<NetSendReceipt>;
  close?(reason?: string): void;
}

/** In-process callback, socket send, or queue push. Invoked synchronously from `send`. */
export type NetFrameSink<Frame> = (frame: Frame, options: NetSendOptions) => void;

/**
 * Production path. The sink runs in the same turn as `send`, before the
 * receipt resolves. No latency, loss, reorder, or partition.
 */
export class DirectNetPath<Frame = unknown> implements NetPath<Frame> {
  readonly #sink: NetFrameSink<Frame>;
  #closed = false;
  #seq = 0;

  constructor(sink: NetFrameSink<Frame>) {
    this.#sink = sink;
  }

  send(frame: Frame, options: NetSendOptions = {}): Promise<NetSendReceipt> {
    if (this.#closed) return Promise.resolve({ ok: false });
    const seq = ++this.#seq;
    try {
      this.#sink(frame, options);
    } catch (err) {
      return Promise.reject(err);
    }
    return Promise.resolve({ ok: true, seq });
  }

  close(_reason?: string): void {
    this.#closed = true;
  }
}
