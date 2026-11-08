// History store (Task_54): typed entries AttributePatch | ReplaceElement.
import type { AttrPatch } from './model';

export interface AttributeChange { el: Element; before: AttrPatch; after: AttrPatch }
export interface AttributePatchEntry { type: 'attr'; id: number; label: string; changes: AttributeChange[] }
/** Replace oldNode with newNode at a position; either may be null (insert / remove). */
export interface Replacement { parent: Node; next: Node | null; oldNode: Element | null; newNode: Element | null }
export interface ReplaceElementEntry { type: 'replace'; id: number; label: string; items: Replacement[] }
export type HistoryEntry = AttributePatchEntry | ReplaceElementEntry;
export type MutateOp =
  | { type: 'remove'; el: Element }
  | { type: 'insert'; el: Element; parent: Node; before: Node | null };

export function applyPatch(el: Element, patch: AttrPatch): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) el.removeAttribute(k);
    else el.setAttribute(k, v); // keeps existing attribute order
  }
}

export function snapshot(el: Element, keys: Iterable<string>): AttrPatch {
  const out: AttrPatch = {};
  for (const k of keys) out[k] = el.getAttribute(k);
  return out;
}

export function samePatch(a: AttrPatch, b: AttrPatch): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? null) !== (b[k] ?? null)) return false;
  return true;
}

function swap(parent: Node, next: Node | null, from: Element | null, to: Element | null) {
  if (from && to) from.replaceWith(to);
  else if (from) from.remove();
  else if (to) parent.insertBefore(to, next && next.parentNode === parent ? next : null);
}

type NewEntry = Omit<AttributePatchEntry, 'id'> | Omit<ReplaceElementEntry, 'id'>;

let nextEntryId = 1;

export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  onChange: () => void = () => {};

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get undoLabel(): string | undefined { return this.undoStack.at(-1)?.label; }
  get redoLabel(): string | undefined { return this.redoStack.at(-1)?.label; }

  /**
   * Identifies the current document state: the id of the newest applied entry (0 = as loaded).
   * Undoing back to a saved state returns the same id, so dirty = stateId !== savedStateId.
   */
  get stateId(): number { return this.undoStack.at(-1)?.id ?? 0; }

  /** Record an already-applied attribute edit. Empty / no-op changes are dropped. */
  pushAttr(label: string, changes: AttributeChange[]): void {
    const real = changes.filter((c) => !samePatch(c.before, c.after));
    if (!real.length) return;
    this.push({ type: 'attr', label, changes: real });
  }

  push(entry: NewEntry): void {
    const e = { ...entry, id: nextEntryId++ } as HistoryEntry;
    this.undoStack.push(e);
    this.redoStack = [];
    this.onChange();
  }

  /** Perform and record element replacements (one undo step). */
  replace(label: string, pairs: [Element | null, Element | null, Node?][]): void {
    const items: Replacement[] = pairs.map(([oldNode, newNode, parent]) => ({
      parent: parent ?? oldNode!.parentNode!, next: oldNode?.nextSibling ?? null, oldNode, newNode,
    }));
    if (!items.length) return;
    for (const it of items) swap(it.parent, it.next, it.oldNode, it.newNode);
    this.push({ type: 'replace', label, items });
  }

  /**
   * Perform DOM operations in order and record them as one undo step. Each removal captures its
   * position when it runs, so sequences of moves (remove + insert) undo and redo exactly.
   */
  mutate(label: string, ops: MutateOp[]): void {
    const items: Replacement[] = [];
    for (const op of ops) {
      const it: Replacement = op.type === 'remove'
        ? { parent: op.el.parentNode!, next: op.el.nextSibling, oldNode: op.el, newNode: null }
        : { parent: op.parent, next: op.before, oldNode: null, newNode: op.el };
      swap(it.parent, it.next, it.oldNode, it.newNode);
      items.push(it);
    }
    if (items.length) this.push({ type: 'replace', label, items });
  }

  undo(): HistoryEntry | undefined {
    const e = this.undoStack.pop();
    if (!e) return;
    if (e.type === 'attr') for (const c of [...e.changes].reverse()) applyPatch(c.el, c.before);
    else for (const it of [...e.items].reverse()) swap(it.parent, it.next, it.newNode, it.oldNode);
    this.redoStack.push(e);
    this.onChange();
    return e;
  }

  redo(): HistoryEntry | undefined {
    const e = this.redoStack.pop();
    if (!e) return;
    if (e.type === 'attr') for (const c of e.changes) applyPatch(c.el, c.after);
    else for (const it of e.items) swap(it.parent, it.next, it.oldNode, it.newNode);
    this.undoStack.push(e);
    this.onChange();
    return e;
  }

  clear(): void { this.undoStack = []; this.redoStack = []; this.onChange(); }
}
