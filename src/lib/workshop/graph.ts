/**
 * A small typed dependency-graph executor. Each node names the nodes it
 * reads and how to compute its value from theirs; a node's cache key is
 * derived from its own identity and its inputs' keys, so a change anywhere
 * upstream invalidates exactly what depends on it. Runs in topological
 * order, refuses cycles and missing inputs, reports progress, yields between
 * nodes (so a worker can see a cancel message) and stops when aborted.
 */
import { fnv1a64 } from "./hash";

export interface GraphNode<V> {
  id: string;
  deps: string[];
  /** What this node does, independent of its inputs (step type + parameters). Ignored when `key` is set. */
  identity?: string;
  /** A fixed key, for source nodes (e.g. an image's content hash). */
  key?: string;
  run: (inputs: V[]) => V | Promise<V>;
}

export interface GraphCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
}

/** Anything with an `aborted` flag: an AbortSignal, or a getter that checks for newer work. */
export interface CancelSignal {
  readonly aborted: boolean;
}

export interface RunOptions<V> {
  cache?: GraphCache<V>;
  signal?: CancelSignal;
  /** Called after each node finishes, with how many are done out of how many are needed. */
  onProgress?: (done: number, total: number, id: string, cached: boolean) => void;
  /** Await a macrotask between nodes so other messages can be handled. Default true. */
  yieldBetween?: boolean;
}

export class GraphError extends Error {}
export class CancelledError extends Error {
  constructor() {
    super("Cancelled.");
  }
}

/** Node ids in an order where every node comes after its inputs. Throws on cycles and unknown inputs. */
export function topoOrder(nodes: Pick<GraphNode<unknown>, "id" | "deps">[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (byId.size !== nodes.length) throw new GraphError("Two steps share an id.");
  const indegree = new Map<string, number>();
  const users = new Map<string, string[]>();
  for (const n of nodes) {
    indegree.set(n.id, n.deps.length);
    for (const d of n.deps) {
      if (!byId.has(d)) throw new GraphError(`Step "${n.id}" reads "${d}", which doesn't exist.`);
      users.set(d, [...(users.get(d) ?? []), n.id]);
    }
  }
  const ready = nodes.filter((n) => n.deps.length === 0).map((n) => n.id);
  const order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const u of users.get(id) ?? []) {
      const left = indegree.get(u)! - 1;
      indegree.set(u, left);
      if (left === 0) ready.push(u);
    }
  }
  if (order.length !== nodes.length) {
    const stuck = nodes.filter((n) => !order.includes(n.id)).map((n) => n.id);
    throw new GraphError(`The steps form a loop: ${stuck.join(" → ")}.`);
  }
  return order;
}

/** Cache keys for every node, from its identity and its inputs' keys. */
export function nodeKeys(nodes: GraphNode<unknown>[]): Map<string, string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const keys = new Map<string, string>();
  for (const id of topoOrder(nodes)) {
    const n = byId.get(id)!;
    keys.set(id, n.key ?? `n:${fnv1a64(`${n.identity ?? n.id}|${n.deps.map((d) => keys.get(d)).join("|")}`)}`);
  }
  return keys;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Computes `targets` (and only what they need). Returns every computed or
 * cached value by node id. Evaluation is on demand, so a cached value that
 * was evicted while running is simply recomputed from its inputs.
 */
export async function runGraph<V>(nodes: GraphNode<V>[], targets: string[], o: RunOptions<V> = {}): Promise<Map<string, V>> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const keys = nodeKeys(nodes as GraphNode<unknown>[]);
  for (const t of targets) if (!byId.has(t)) throw new GraphError(`Unknown output "${t}".`);

  // Progress total: what the targets need, stopping at nodes already cached.
  const needed = new Set<string>();
  const visit = (id: string) => {
    if (needed.has(id)) return;
    needed.add(id);
    if (o.cache?.get(keys.get(id)!) !== undefined) return;
    for (const d of byId.get(id)!.deps) visit(d);
  };
  targets.forEach(visit);

  const values = new Map<string, V>();
  let done = 0;
  const evaluate = async (id: string): Promise<V> => {
    const have = values.get(id);
    if (have !== undefined) return have;
    if (o.signal?.aborted) throw new CancelledError();
    const key = keys.get(id)!;
    const hit = o.cache?.get(key);
    if (hit !== undefined) {
      values.set(id, hit);
      o.onProgress?.(++done, Math.max(done, needed.size), id, true);
      return hit;
    }
    const n = byId.get(id)!;
    const inputs: V[] = [];
    for (const d of n.deps) inputs.push(await evaluate(d));
    if (o.signal?.aborted) throw new CancelledError();
    const value = await n.run(inputs);
    values.set(id, value);
    o.cache?.set(key, value);
    o.onProgress?.(++done, Math.max(done, needed.size), id, false);
    if (o.yieldBetween !== false) await tick();
    return value;
  };
  for (const t of targets) await evaluate(t);
  return values;
}

/** Least-recently-used cache bounded by an estimate of each value's size in bytes. */
export class SizedLru<V> implements GraphCache<V> {
  private map = new Map<string, { value: V; bytes: number }>();
  private used = 0;
  constructor(
    private readonly limit: number,
    private readonly size: (v: V) => number,
  ) {}
  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }
  set(key: string, value: V) {
    const bytes = this.size(value);
    if (bytes > this.limit) return;
    const old = this.map.get(key);
    if (old) {
      this.used -= old.bytes;
      this.map.delete(key);
    }
    this.map.set(key, { value, bytes });
    this.used += bytes;
    for (const [k, e] of this.map) {
      if (this.used <= this.limit) break;
      this.map.delete(k);
      this.used -= e.bytes;
    }
  }
  get bytes() {
    return this.used;
  }
  get count() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
    this.used = 0;
  }
}
