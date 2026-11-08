// src/app/scrub.ts
// Drag-to-scrub for every <input type="number"> in the app (delegated from the app root, so new
// fields get it automatically). Drag the field or its <label> horizontally to change the value:
// one step per STEP_PX pixels, Shift ×10, Alt ×0.1; Esc cancels. A click without a drag focuses
// the field as usual, and a focused field keeps normal text selection.
//
// While dragging, the input gets `data-scrubbing` and an `input` event per change; the drag ends
// with a `change` event. NumberField previews on those `input` events and commits on `change`,
// so a whole drag is one undo step; plain inputs simply see the new value.

const STEP_PX = 2;
const DRAG_PX = 3;
/** Pointer-downs this close to an input's right edge are left to the native spinner. */
const SPINNER_PX = 18;

interface ScrubState { input: HTMLInputElement; startX: number; start: number; active: boolean; id: number }

/** The number input a pointer-down should scrub: the input itself or the one inside a clicked label. */
export function scrubTarget(target: EventTarget | null): HTMLInputElement | null {
  if (!(target instanceof Element)) return null;
  if (target instanceof HTMLInputElement) return target.type === 'number' ? target : null;
  const label = target.closest('label');
  if (!label) return null;
  const inputs = label.querySelectorAll<HTMLInputElement>('input[type="number"]');
  return inputs.length === 1 ? inputs[0] : null;
}

const decimals = (n: number) => { const s = String(n); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };

/** Value after dragging `dx` pixels from `start`. */
export function scrubValue(start: number, dx: number, step: number, mods: { shift: boolean; alt: boolean }, min?: number, max?: number): number {
  const mult = mods.shift ? 10 : mods.alt ? 0.1 : 1;
  const unit = step * mult;
  let v = start + Math.trunc(dx / STEP_PX) * unit;
  if (min !== undefined && Number.isFinite(min)) v = Math.max(min, v);
  if (max !== undefined && Number.isFinite(max)) v = Math.min(max, v);
  // Round to the step's precision so 0.1 steps don't produce 0.30000000000000004.
  const p = Math.min(6, Math.max(decimals(unit), decimals(start)));
  return Number(v.toFixed(p));
}

function numAttr(input: HTMLInputElement, name: 'min' | 'max'): number | undefined {
  const v = parseFloat(input.getAttribute(name) ?? '');
  return Number.isFinite(v) ? v : undefined;
}

/** The value a drag starts from: the field's value, else a numeric placeholder; null = nothing to scrub (e.g. "Mixed"). */
export function startValue(input: HTMLInputElement): number | null {
  for (const s of [input.value, input.placeholder]) { const v = parseFloat(s); if (Number.isFinite(v)) return v; }
  return null;
}

/** Inputs styled with `appearance: textfield` (compact fields) have no native spinner. */
function hasSpinner(input: HTMLInputElement): boolean {
  return getComputedStyle(input).appearance !== 'textfield';
}

/** Install scrubbing under `root`; returns a cleanup function. */
export function installScrub(root: HTMLElement): () => void {
  let s: ScrubState | null = null;
  const doc = root.ownerDocument;

  const set = (input: HTMLInputElement, value: string) => {
    if (input.value === value) return;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const end = (commit: boolean) => {
    const st = s;
    s = null;
    root.classList.remove('curve-scrubbing');
    doc.removeEventListener('pointermove', onMove, true);
    doc.removeEventListener('pointerup', onUp, true);
    doc.removeEventListener('pointercancel', onCancel, true);
    doc.removeEventListener('keydown', onKey, true);
    if (!st) return;
    if (st.active) {
      if (!commit) set(st.input, String(st.start));
      st.input.dispatchEvent(new Event('change', { bubbles: true }));
      delete st.input.dataset.scrubbing;
      // A drag that started on a <label> ends with a click that would focus the input: swallow it.
      const swallow = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
      doc.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => doc.removeEventListener('click', swallow, { capture: true }), 0);
    }
  };

  function onMove(e: PointerEvent) {
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.startX;
    if (!s.active) {
      if (Math.abs(dx) < DRAG_PX) return;
      s.active = true;
      s.input.dataset.scrubbing = '1';
      root.classList.add('curve-scrubbing');
    }
    e.preventDefault();
    const stepAttr = parseFloat(s.input.step);
    const step = Number.isFinite(stepAttr) && stepAttr > 0 ? stepAttr : 1;
    const v = scrubValue(s.start, dx, step, { shift: e.shiftKey, alt: e.altKey }, numAttr(s.input, 'min'), numAttr(s.input, 'max'));
    set(s.input, String(v));
  }

  function onUp(e: PointerEvent) {
    if (!s || e.pointerId !== s.id) return;
    const { input, active } = s;
    end(true);
    if (!active) { input.focus(); input.select(); } // a plain click: edit as usual
  }

  function onCancel() { end(false); }

  function onKey(e: KeyboardEvent) {
    if (s && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(false); }
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0 || e.pointerType === 'touch' || s) return;
    const input = scrubTarget(e.target);
    if (!input || input.disabled || input.readOnly || doc.activeElement === input) return;
    if (e.target === input && hasSpinner(input) && e.offsetX > input.clientWidth - SPINNER_PX) return; // native spinner
    const start = startValue(input);
    if (start === null) return; // mixed values: click to type one instead
    e.preventDefault(); // don't focus yet: this may become a drag
    s = { input, startX: e.clientX, start, active: false, id: e.pointerId };
    doc.addEventListener('pointermove', onMove, true);
    doc.addEventListener('pointerup', onUp, true);
    doc.addEventListener('pointercancel', onCancel, true);
    doc.addEventListener('keydown', onKey, true);
  }

  root.addEventListener('pointerdown', onDown);
  return () => { end(false); root.removeEventListener('pointerdown', onDown); };
}
