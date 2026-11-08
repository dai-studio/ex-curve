// One user action = one undo step. A gesture previews patches computed from the
// drag-start state, can be cancelled (click without movement), and commits a single
// AttributePatch history entry with before/after values per element.
import type { AttrPatch } from '../model';
import { applyPatch, History, snapshot } from '../history';

export class Gesture {
  private origin = new Map<Element, AttrPatch>();
  private base = new Map<Element, AttrPatch>();
  private touched = new Map<Element, Set<string>>();

  private record(el: Element, keys: string[]) {
    let o = this.origin.get(el);
    if (!o) this.origin.set(el, (o = {}));
    for (const k of keys) if (!(k in o)) o[k] = el.getAttribute(k);
  }

  /** Apply permanently within the gesture (ghost materialisation). */
  apply(el: Element, patch: AttrPatch): void {
    this.record(el, Object.keys(patch));
    applyPatch(el, patch);
  }

  /** Put `el` back into its drag-start state, so adapters compute absolute patches. */
  reset(el: Element): void {
    const b = this.base.get(el);
    if (b) applyPatch(el, b);
  }

  /** Reset to drag-start, then apply `patch`. */
  preview(el: Element, patch: AttrPatch): void {
    this.reset(el);
    let b = this.base.get(el), t = this.touched.get(el);
    if (!b) this.base.set(el, (b = {}));
    if (!t) this.touched.set(el, (t = new Set()));
    for (const k of Object.keys(patch)) {
      if (t.has(k)) continue;
      this.record(el, [k]);
      b[k] = el.getAttribute(k);
      t.add(k);
    }
    applyPatch(el, patch);
  }

  cancel(): void {
    for (const [el, o] of this.origin) applyPatch(el, o);
  }

  /** Push one history entry; returns the attributes that actually changed per element. */
  commit(history: History, label: string): Map<Element, Set<string>> {
    const changes = [...this.origin].map(([el, before]) => ({ el, before, after: snapshot(el, Object.keys(before)) }));
    history.pushAttr(label, changes);
    const out = new Map<Element, Set<string>>();
    for (const c of changes) {
      const keys = Object.keys(c.before).filter((k) => c.before[k] !== c.after[k]);
      if (keys.length) out.set(c.el, new Set(keys));
    }
    return out;
  }

  get elements(): Element[] { return [...this.origin.keys()]; }
}
