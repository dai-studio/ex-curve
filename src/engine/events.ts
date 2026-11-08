// Tiny typed event emitter used by the engine to talk to any shell (Svelte app, embed host).

export type Listener<A extends unknown[]> = (...args: A) => void;

export class Emitter<E extends { [K in keyof E]: unknown[] }> {
  private listeners: { [K in keyof E]?: Set<Listener<E[K]>> } = {};

  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof E>(type: K, fn: Listener<E[K]>): () => void {
    (this.listeners[type] ??= new Set()).add(fn);
    return () => this.off(type, fn);
  }

  off<K extends keyof E>(type: K, fn: Listener<E[K]>): void {
    this.listeners[type]?.delete(fn);
  }

  protected emit<K extends keyof E>(type: K, ...args: E[K]): void {
    for (const fn of [...(this.listeners[type] ?? [])]) fn(...args);
  }

  protected clearListeners(): void {
    this.listeners = {};
  }
}
