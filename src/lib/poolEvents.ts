// A tiny module-level pub/sub so the "Create Pool" flow can tell the pool
// directory to refetch after a new pool is mined — without threading a
// callback through the page or adding a full context/provider.
//
// Sibling components (CreatePoolButton and PoolDirectory) both live under the
// dashboard page; this decouples them: the button emits, the directory listens.

type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe to "pools changed" events. Returns an unsubscribe function. */
export function onPoolsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Notify all subscribers that the set of pools has changed (e.g. a new pool). */
export function emitPoolsChanged(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A misbehaving listener must not break the others.
    }
  }
}
