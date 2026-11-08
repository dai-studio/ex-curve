<script lang="ts">
  // Numeric input (<input type="number">): commits on Enter, blur and native spinner clicks (repeat
  // commits of the same value are no-ops); shows a placeholder ("Mixed" by default) when value is
  // null. Arrow keys step by `step` (Shift ×10) as a live preview that is committed on key-up, so
  // holding a key is one undo step. Dragging the field or its label scrubs (app/scrub.ts), also as
  // one undo step.
  import { fmt } from '../../engine/num';

  interface Props {
    value: number | null;
    label: string;
    step?: number;
    min?: number;
    max?: number;
    disabled?: boolean;
    digits?: number;
    /** Shown when value is null (default: "Mixed", for multi-selections). */
    placeholder?: string;
    onchange: (v: number, live: boolean) => void;
  }
  let { value, label, step = 1, min, max, disabled = false, digits = 2, placeholder = 'Mixed', onchange }: Props = $props();
  let text = $state('');
  let editing = $state(false);

  const shown = () => (value === null ? '' : fmt(value, digits));
  $effect(() => { if (!editing) text = shown(); });

  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  function commit(live = false) {
    const v = Number(text);
    // A number input reports '' for empty or unparsable text: restore the current value.
    if (text.trim() === '' || !Number.isFinite(v)) { text = shown(); return; }
    onchange(clamp(v), live);
  }
  function onkeydown(e: KeyboardEvent) {
    const input = e.currentTarget as HTMLInputElement;
    if (e.key === 'Enter') { commit(); input.select(); }
    else if (e.key === 'Escape') { editing = false; text = shown(); input.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault(); // replaces the native step: Shift ×10 and a live preview
      const base = Number(text) || value || 0;
      text = fmt(clamp(base + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)), digits);
      commit(true);
    }
  }
  function onkeyup(e: KeyboardEvent) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') commit(false);
  }
  /** Some browsers change a focused number input on wheel; scrolling the panel must not edit values. */
  function noWheelEdit(node: HTMLInputElement) {
    const stop = (e: WheelEvent) => { if (document.activeElement === node) e.preventDefault(); };
    node.addEventListener('wheel', stop, { passive: false });
    return () => node.removeEventListener('wheel', stop);
  }
</script>

<input
  type="number"
  inputmode="decimal"
  {step}
  min={min}
  max={max}
  class:mixed={value === null}
  placeholder={value === null ? placeholder : ''}
  aria-label={label}
  title="{label} · drag to adjust (Shift ×10, Alt ×0.1)"
  {disabled}
  value={text}
  oninput={(e) => {
    text = e.currentTarget.value;
    if (e.currentTarget.dataset.scrubbing) commit(true); // drag-to-scrub (app/scrub.ts) previews live
  }}
  onchange={() => commit()}
  onfocus={(e) => { editing = true; e.currentTarget.select(); }}
  onblur={() => { editing = false; commit(); }}
  {onkeydown}
  {onkeyup}
  {@attach noWheelEdit} />

<style>
  input { font-variant-numeric: tabular-nums; }
</style>
