<script lang="ts">
  // Fill / stroke row: label, the shared ColorInput, and the paint's opacity (%).
  // `value` is the effective paint (own or inherited); null = mixed across the selection.
  import { fmt } from '../../engine/num';
  import ColorInput from './ColorInput.svelte';

  interface Props {
    label: string;
    value: string | null;
    /** The value is inherited / computed, not set on the element. */
    inherited?: boolean;
    opacity: number | null;
    swatches?: string[];
    onpaint: (value: string | null, live: boolean) => void;
    onopacity: (value: number, live: boolean) => void;
  }
  let { label, value, inherited = false, opacity, swatches = [], onpaint, onopacity }: Props = $props();
</script>

<div class="paint" class:inherited>
  <span class="lbl">{label}</span>
  <ColorInput {label} {value} {swatches} onchange={(v, live) => onpaint(v, live)} />
  <input class="op" type="number" min="0" max="100" step="5" inputmode="numeric" aria-label="{label} opacity (%)" title="{label} opacity (%)"
    value={opacity === null ? '' : fmt(opacity * 100, 0)}
    placeholder={opacity === null ? '–' : ''}
    onchange={(e) => { const v = Number(e.currentTarget.value); if (Number.isFinite(v)) onopacity(Math.min(1, Math.max(0, v / 100)), false); }} />
  <span class="pct">%</span>
</div>

<style>
  .paint { display: flex; align-items: center; gap: 6px; margin: 6px 0; }
  .lbl { width: 46px; flex: none; color: var(--c-text-2); font-size: 12px; }
  .inherited .lbl::after { content: '•'; color: var(--c-faint); margin-left: 3px; }
  .op { width: 46px !important; flex: none; text-align: right; padding-right: 4px !important; }
  /* Too narrow for a spinner: keep the number input (keyboard, semantics) without the arrows. */
  .op { appearance: textfield; -moz-appearance: textfield; }
  .op::-webkit-inner-spin-button, .op::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .pct { color: var(--c-muted); font-size: 11px; margin-left: -3px; }
</style>
