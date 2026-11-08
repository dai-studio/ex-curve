<script lang="ts">
  import type { AppState } from '../state.svelte';
  import { fmt } from '../../engine/num';
  import NumberField from './NumberField.svelte';

  let { app }: { app: AppState } = $props();
  const ed = $derived(app.editor);
  const v = $derived(app.view);
  const one = $derived(v.selection.length === 1 ? v.selection[0] : null);
  const info = $derived.by(() => { void v; return one ? ed.getBox(one) : null; });

  /** Native geometry attributes shown as numeric fields, per element. */
  const NUMERIC: Record<string, string[]> = {
    rect: ['rx', 'ry'], circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'], line: ['x1', 'y1', 'x2', 'y2'],
    text: ['x', 'y'], image: ['x', 'y', 'width', 'height'], use: ['x', 'y'], foreignObject: ['x', 'y', 'width', 'height'],
  };
  const LONG: Record<string, string> = { polyline: 'points', polygon: 'points', path: 'd' };
  const fields = $derived(one ? (NUMERIC[one.localName] ?? []) : []);
  const long = $derived(one ? LONG[one.localName] : undefined);
  const attrNum = (name: string) => { void v; const a = one?.getAttribute(name); const n = a == null ? 0 : parseFloat(a); return Number.isFinite(n) ? n : null; };
  const longValue = $derived.by(() => { void v; return one && long ? (one.getAttribute(long) ?? '') : ''; });

  function setBox(k: 'x' | 'y' | 'width' | 'height', val: number, live: boolean) {
    if (!one || !info) return;
    const b = { ...info.box, [k]: val };
    if ((k === 'width' || k === 'height') && val <= 0) return;
    ed.setBox(one, b, live);
  }
  const setAttr = (name: string, val: string, live = false) => { if (one) ed.applyPatches([[one, { [name]: val }]], `Set ${name}`, live); };

  const points = $derived(v.selectedPoints.flatMap(([el, ids]) => ed.pointsOf(el).filter((p) => ids.includes(p.id))));
</script>

{#if one && info}
  <div class="sec">
    <h4 class="sec-title">Position & size</h4>
    <div class="grid2">
      <label><span>X</span><NumberField label="X" value={info.box.x} onchange={(val, live) => setBox('x', val, live)} /></label>
      <label><span>Y</span><NumberField label="Y" value={info.box.y} onchange={(val, live) => setBox('y', val, live)} /></label>
      <label><span>W</span><NumberField label="Width" value={info.box.width} min={0} disabled={info.rotated} onchange={(val, live) => setBox('width', val, live)} /></label>
      <label><span>H</span><NumberField label="Height" value={info.box.height} min={0} disabled={info.rotated} onchange={(val, live) => setBox('height', val, live)} /></label>
      <label title="Rotation (degrees)"><span>∠</span><NumberField label="Rotation (degrees)" value={info.rotation} step={15} digits={1} onchange={(val, live) => one && ed.setRotation(one, val, live)} /></label>
    </div>
    {#if info.rotated}<p class="note">Rotated: size is edited with the handles on canvas.</p>{/if}
  </div>
  {#if fields.length || long}
    <div class="sec">
      <h4 class="sec-title">&lt;{one.localName}&gt; geometry</h4>
      {#if fields.length}
        <div class="grid2">
          {#each fields as f (f)}
            <label title={f}><span class="attr">{f}</span><NumberField label={f} value={attrNum(f)} onchange={(val, live) => setAttr(f, fmt(val), live)} /></label>
          {/each}
        </div>
      {/if}
      {#if long}
        <textarea class="mono long" aria-label={long} rows="5" spellcheck="false" value={longValue}
          onchange={(e) => setAttr(long, e.currentTarget.value.trim())}></textarea>
      {/if}
    </div>
  {/if}
{:else if v.selection.length > 1}
  <div class="sec"><p class="note">{v.selection.length} shapes selected. Select one shape to edit its geometry.</p></div>
{/if}

{#if points.length}
  <div class="sec">
    <h4 class="sec-title">Selected points</h4>
    <ul class="pts">
      {#each points as p (p.id)}
        <li><code>{p.id}</code> {p.kind} <span class="muted">({fmt(p.x, 2)}, {fmt(p.y, 2)}) → {p.attr.join(', ')}</span></li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .attr { width: auto !important; min-width: 18px; font-family: var(--mono); }
  .long { width: 100%; margin-top: 8px; font-size: 11.5px; resize: vertical; }
  .note { margin: 6px 0 0; color: var(--c-muted); font-size: 12px; }
  .pts { margin: 0; padding-left: 16px; font-size: 12px; }
</style>
