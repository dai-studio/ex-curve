<script lang="ts">
  // ColorInput: the app's one colour control, a single segmented field  [ chip | #hex | eyedropper ].
  //   - chip: shows the colour; opens the colour selector (saturation/brightness square, hue slider,
  //     document swatches, None) which previews live while dragging and commits on release;
  //   - hex: the value as hex; also accepts any paint text (none, currentColor, url(#…), names);
  //   - eyedropper: pick a colour from the screen (where the browser supports it).
  // `value` null means mixed (multi-selection). onchange(value, live): live = preview, false = commit.
  import { parsePaint, toHex } from '../../engine/style';
  import { hexToHsv, hsvToHex, type Hsv } from '../color';
  import Icon from './Icon.svelte';

  interface Props {
    value: string | null;
    label: string;
    /** Offer "None" in the selector. */
    allowNone?: boolean;
    /** Document colours shown in the selector. */
    swatches?: string[];
    onchange: (value: string, live: boolean) => void;
  }
  let { value, label, allowNone = true, swatches = [], onchange }: Props = $props();

  const paint = $derived(parsePaint(value));
  const hex = $derived(paint?.kind === 'color' ? paint.hex : null);
  const kind = $derived(value === null ? 'mixed' : paint?.kind === 'color' ? 'color' : paint?.kind === 'none' ? 'none' : 'other');
  const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;

  // ---- hex / text segment
  const shown = $derived(value === null ? '' : hex ? hex.slice(1).toUpperCase() : value);
  let text = $state('');
  let editing = $state(false);
  $effect(() => { if (!editing) text = shown; });

  function commitText() {
    const t = text.trim();
    if (!t || t === shown) { text = shown; return; }
    const digits = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t);
    if (digits) onchange(`#${digits[1].toLowerCase()}`, false);
    else if (/^none$/i.test(t)) { if (allowNone) onchange('none', false); else text = shown; }
    else onchange(t, false); // colour names, currentColor, url(#…) are written as typed
  }

  // ---- selector popover
  let open = $state(false);
  let hsv = $state<Hsv>({ h: 220, s: 0.5, v: 0.9 });
  let dragging = $state(false);
  let root = $state<HTMLElement>();
  let pop = $state<HTMLElement>();
  let svEl = $state<HTMLElement>();
  let pos = $state({ x: 0, y: 0 });
  const current = $derived(hsvToHex(hsv));

  // Follow outside changes (undo, typing) without losing the hue of greys while dragging.
  $effect(() => {
    if (!open || dragging || !hex || hsvToHex(hsv) === hex) return;
    hsv = hexToHsv(hex) ?? hsv;
  });

  function toggle() {
    if (open) { open = false; return; }
    if (hex) hsv = hexToHsv(hex) ?? hsv;
    const r = root!.getBoundingClientRect();
    const W = 236, H = 300;
    pos = {
      x: Math.max(8, Math.min(r.left, innerWidth - W - 8)),
      y: r.bottom + 4 + H > innerHeight ? Math.max(8, r.top - H - 4) : r.bottom + 4,
    };
    open = true;
    queueMicrotask(() => svEl?.focus());
  }
  function close(refocus = true) {
    open = false;
    if (refocus) root?.querySelector<HTMLButtonElement>('.chip')?.focus();
  }
  const emit = (live: boolean) => onchange(current, live);

  function svAt(e: PointerEvent) {
    const r = svEl!.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const v = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    hsv = { ...hsv, s, v };
    emit(true);
  }
  function svDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    svEl!.focus();
    svEl!.setPointerCapture(e.pointerId);
    dragging = true;
    svAt(e);
  }
  function svMove(e: PointerEvent) { if (dragging) svAt(e); }
  function svUp() {
    if (!dragging) return;
    dragging = false;
    emit(false);
  }
  function svKey(e: KeyboardEvent) {
    const d = e.shiftKey ? 0.1 : 0.01;
    const k = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] }[e.key];
    if (!k) return;
    e.preventDefault();
    hsv = { ...hsv, s: Math.min(1, Math.max(0, hsv.s + k[0])), v: Math.min(1, Math.max(0, hsv.v + k[1])) };
    emit(true);
  }
  function svKeyUp(e: KeyboardEvent) { if (e.key.startsWith('Arrow')) emit(false); }

  function pick(c: string) {
    hsv = hexToHsv(c) ?? hsv;
    onchange(c, false);
  }

  async function eyedrop() {
    try {
      const ED = (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
      const r = await new ED().open();
      const h = toHex(r.sRGBHex);
      if (h) pick(h);
    } catch { /* cancelled */ }
  }

  function onWindowDown(e: PointerEvent) {
    if (!open) return;
    const t = e.target as Node;
    if (!root?.contains(t) && !pop?.contains(t)) close(false);
  }
  function onWindowKey(e: KeyboardEvent) {
    if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  }
</script>

<svelte:window onpointerdowncapture={onWindowDown} onkeydowncapture={onWindowKey} />

<div class="ci" bind:this={root} role="group" aria-label="{label} colour">
  <button type="button" class="chip seg" aria-label="{label}: open colour selector" aria-haspopup="dialog" aria-expanded={open}
    title="Choose {label.toLowerCase()} colour" onclick={toggle}>
    <span class="swatch {kind}" style:--swatch={hex ?? 'transparent'}></span>
  </button>
  <label class="hex seg" class:raw={kind === 'other'}>
    {#if kind === 'color' || kind === 'mixed'}<span class="hash" aria-hidden="true">#</span>{/if}
    <input type="text" class="mono" aria-label="{label} value" spellcheck="false" autocomplete="off"
      placeholder={value === null ? 'Mixed' : ''} bind:value={text}
      onfocus={(e) => { editing = true; e.currentTarget.select(); }}
      onblur={() => { editing = false; commitText(); }}
      onkeydown={(e) => { if (e.key === 'Enter') commitText(); else if (e.key === 'Escape') { text = shown; e.currentTarget.blur(); } }} />
  </label>
  <button type="button" class="drop seg" disabled={!hasEyeDropper} onclick={eyedrop}
    aria-label="Pick {label.toLowerCase()} from screen"
    title={hasEyeDropper ? `Pick ${label.toLowerCase()} from screen` : "This browser doesn't support the eyedropper"}>
    <Icon name="eyedropper" size={14} />
  </button>
</div>

{#if open}
  <div class="cp-pop" bind:this={pop} role="dialog" aria-label="{label} colour selector" style:left="{pos.x}px" style:top="{pos.y}px">
    <div class="sv" bind:this={svEl} style:--hue="hsl({hsv.h} 100% 50%)" tabindex="0" role="slider"
      aria-label="Saturation and brightness" aria-valuenow={Math.round(hsv.s * 100)}
      aria-valuetext="saturation {Math.round(hsv.s * 100)}%, brightness {Math.round(hsv.v * 100)}%"
      onpointerdown={svDown} onpointermove={svMove} onpointerup={svUp} onpointercancel={svUp}
      onkeydown={svKey} onkeyup={svKeyUp}>
      <span class="thumb" style:left="{hsv.s * 100}%" style:top="{(1 - hsv.v) * 100}%" style:background={current}></span>
    </div>
    <input class="hue" type="range" min="0" max="359" step="1" value={Math.round(hsv.h)} aria-label="Hue"
      oninput={(e) => { hsv = { ...hsv, h: +e.currentTarget.value }; emit(true); }}
      onchange={() => emit(false)} />
    <div class="row">
      <span class="preview" style:background={current}></span>
      <span class="mono cur">{current.toUpperCase()}</span>
      {#if allowNone}
        <button type="button" class="none-btn" class:on={kind === 'none'} onclick={() => { onchange('none', false); close(); }}>
          <span class="swatch none"></span>None
        </button>
      {/if}
    </div>
    {#if swatches.length}
      <div class="swatches" role="group" aria-label="Document colours">
        {#each swatches as c (c)}
          <button type="button" class="sw" class:on={c === hex} style:background={c} title={c} aria-label="Use {c}" onclick={() => pick(c)}></button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* One control: [ chip | #hex | eyedropper ] */
  .ci {
    display: flex; align-items: stretch; flex: 1; min-width: 0; height: 26px;
    border: 1px solid var(--c-border-strong); border-radius: var(--radius-sm); background: var(--c-panel);
    overflow: hidden;
  }
  .ci:focus-within { outline: 2px solid var(--c-accent-ring); outline-offset: 1px; }
  .seg { display: flex; align-items: center; border: 0; border-radius: 0; background: transparent; }
  .seg + .seg { border-left: 1px solid var(--c-border); }
  .chip { padding: 0 5px; flex: none; }
  .chip:focus-visible, .drop:focus-visible { outline: none; background: var(--c-accent-soft); }
  .hex { flex: 1; min-width: 0; padding: 0 0 0 6px; gap: 1px; cursor: text; }
  .hash { color: var(--c-muted); font: 12px var(--mono); }
  .hex input {
    flex: 1; min-width: 0; height: 100%; padding: 0 4px 0 0; border: 0 !important; outline: none !important;
    background: transparent !important; font: 12px var(--mono); color: var(--c-text);
  }
  .hex input::placeholder { color: var(--c-muted); font-style: italic; }
  .drop { flex: none; padding: 0 6px; color: var(--c-text-2); }
  .drop:disabled { opacity: 0.35; }

  .swatch {
    display: block; width: 16px; height: 16px; border-radius: 4px; border: 1px solid rgb(15 23 42 / 0.2);
    background: linear-gradient(var(--swatch), var(--swatch)), repeating-conic-gradient(#cbd5e1 0% 25%, #fff 0% 50%) 50% / 6px 6px;
  }
  .swatch.none { background: linear-gradient(to top right, transparent 44%, var(--c-danger) 45% 55%, transparent 56%), #fff; }
  .swatch.mixed { background: repeating-linear-gradient(45deg, var(--c-panel-2) 0 3px, var(--c-border-strong) 3px 6px); }
  .swatch.other { background: repeating-linear-gradient(-45deg, #fff 0 3px, #cbd5e1 3px 6px); }

  /* Selector popover */
  .cp-pop {
    position: fixed; z-index: 50; width: 236px; padding: 10px;
    background: var(--c-panel); border: 1px solid var(--c-border); border-radius: 10px; box-shadow: var(--c-shadow);
    display: flex; flex-direction: column; gap: 10px;
  }
  .sv {
    position: relative; height: 150px; border-radius: 6px; cursor: crosshair; touch-action: none; outline: none;
    background: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, var(--hue));
  }
  .sv:focus-visible { box-shadow: 0 0 0 2px var(--c-accent-ring); }
  .thumb {
    position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
    border: 2px solid #fff; box-shadow: 0 0 0 1px rgb(0 0 0 / 0.35), 0 1px 3px rgb(0 0 0 / 0.3); pointer-events: none;
  }
  .hue {
    -webkit-appearance: none; appearance: none; width: 100%; height: 12px; margin: 0; border-radius: 6px; cursor: pointer;
    background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
  }
  .hue::-webkit-slider-thumb {
    -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #fff;
    border: 2px solid #fff; box-shadow: 0 0 0 1px rgb(0 0 0 / 0.35), 0 1px 3px rgb(0 0 0 / 0.3);
  }
  .hue::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: #fff; border: 2px solid #fff; box-shadow: 0 0 0 1px rgb(0 0 0 / 0.35); }
  .hue:focus-visible { outline: 2px solid var(--c-accent-ring); outline-offset: 2px; }
  .row { display: flex; align-items: center; gap: 8px; }
  .preview { width: 22px; height: 22px; border-radius: 5px; border: 1px solid rgb(15 23 42 / 0.2); flex: none; }
  .cur { font-size: 12px; color: var(--c-text-2); flex: 1; }
  .none-btn { padding: 3px 8px; gap: 5px; font-size: 12px; border: 1px solid var(--c-border-strong); }
  .none-btn .swatch { width: 12px; height: 12px; }
  .none-btn.on { border-color: var(--c-accent); }
  .swatches { display: grid; grid-template-columns: repeat(8, 1fr); gap: 5px; }
  .sw { aspect-ratio: 1; padding: 0; border-radius: 4px; border: 1px solid rgb(15 23 42 / 0.15); }
  .sw.on { box-shadow: 0 0 0 2px var(--c-accent); }
  .sw:hover { transform: scale(1.1); }
</style>
