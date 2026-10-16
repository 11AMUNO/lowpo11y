"use client";

import type { SeamlessSettings } from "@/lib/processing/seamless/engine";
import type { Encoding, WorkerRequest, WorkerResponse } from "./protocol";

type Processed = Extract<WorkerResponse, { type: "processed" }>;
type Exported = Extract<WorkerResponse, { type: "exported" }>;

/** Promise wrapper around the Seamless worker. Each request carries a token; stale replies are ignored by callers. */
export class SeamlessClient {
  private worker: Worker;
  private next = 1;
  private pending = new Map<number, { resolve: (r: Processed | Exported) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const m = ev.data;
      const p = this.pending.get(m.token);
      if (!p) {
        if (m.type === "processed") {
          m.result.close();
          m.source.close();
        }
        return;
      }
      this.pending.delete(m.token);
      if (m.type === "error") p.reject(new Error(m.message));
      else p.resolve(m);
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || "The processing worker stopped."));
      this.pending.clear();
    };
  }

  private send<T>(req: WorkerRequest & { token: number }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.set(req.token, { resolve: resolve as (r: Processed | Exported) => void, reject });
      this.worker.postMessage(req);
    });
  }

  process(id: number, file: Blob, settings: SeamlessSettings, encode: Encoding): Promise<Processed> {
    return this.send<Processed>({ type: "process", token: this.next++, id, file, settings, encode });
  }

  export(id: number, file: Blob, settings: SeamlessSettings, encode: Encoding, sample3x3 = false): Promise<Exported> {
    return this.send<Exported>({ type: "export", token: this.next++, id, file, settings, encode, sample3x3 });
  }

  forget(id: number) {
    this.worker.postMessage({ type: "forget", id } satisfies WorkerRequest);
  }

  dispose() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error("Closed."));
    this.pending.clear();
  }
}
