<script lang="ts">
  import type { AppState } from '../state.svelte';
  import type { CurveHost } from '../../embed';
  import { clampSize, minifySvg, rasterize } from '../../engine/raster';
  import { fmt } from '../../engine/num';
  import Modal from './Modal.svelte';

  let { app, host }: { app: AppState; host: CurveHost } = $props();

  let format = $state<'png' | 'svg-min'>('png');
  let scale = $state(2);
  let background = $state<'transparent' | 'white'>('transparent');
  let busy = $state(false);
  let error = $state('');
  const size = $derived(app.view.size);
  const out = $derived(clampSize(size.width * scale, size.height * scale));
  const base = $derived(app.fileName.replace(/\.svg$/i, ''));

  async function run(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      const svg = app.editor.serialize();
      if (format === 'png') {
        const blob = await rasterize(svg, { ...out, background: background === 'white' ? '#ffffff' : undefined });
        await host.saveFile?.(blob, `${base}${scale === 1 ? '' : `@${scale}x`}.png`);
      } else {
        await host.saveFile?.(new Blob([minifySvg(svg)], { type: 'image/svg+xml' }), `${base}.min.svg`);
      }
      app.status = 'Exported';
      app.dialog = null;
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') error = (err as Error)?.message ?? String(err);
    } finally {
      busy = false;
    }
  }
</script>

<Modal open={app.dialog === 'export'} title="Export" onclose={() => (app.dialog = null)} width={400}>
  <form id="curve-export-form" onsubmit={run}>
    <fieldset>
      <legend>Format</legend>
      <label><input type="radio" bind:group={format} value="png" /> PNG image</label>
      <label><input type="radio" bind:group={format} value="svg-min" /> Minified SVG</label>
    </fieldset>
    {#if format === 'png'}
      <fieldset>
        <legend>Scale</legend>
        <div class="seg">
          {#each [1, 2, 3, 4] as s (s)}
            <button type="button" class:on={scale === s} aria-pressed={scale === s} onclick={() => (scale = s)}>{s}×</button>
          {/each}
          <input type="number" min="0.1" max="64" step="0.1" aria-label="Custom scale" bind:value={scale} />
        </div>
        <p class="muted size">{fmt(out.width, 0)} × {fmt(out.height, 0)} px</p>
      </fieldset>
      <fieldset>
        <legend>Background</legend>
        <label><input type="radio" bind:group={background} value="transparent" /> Transparent</label>
        <label><input type="radio" bind:group={background} value="white" /> White</label>
      </fieldset>
    {/if}
    {#if error}<p class="err" role="alert">{error}</p>{/if}
  </form>
  {#snippet actions()}
    <button type="button" onclick={() => (app.dialog = null)}>Cancel</button>
    <button type="submit" form="curve-export-form" class="primary" disabled={busy || !(scale > 0)}>{busy ? 'Exporting…' : 'Export'}</button>
  {/snippet}
</Modal>

<style>
  fieldset { border: 0; padding: 0; margin: 0 0 14px; display: flex; flex-wrap: wrap; gap: 6px 16px; }
  legend { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--c-muted); margin-bottom: 6px; padding: 0; }
  label { display: inline-flex; align-items: center; gap: 6px; }
  .seg { display: flex; gap: 4px; align-items: center; }
  .seg button { border: 1px solid var(--c-border-strong); min-width: 40px; justify-content: center; }
  .seg button.on { border-color: var(--c-accent); }
  .seg input { width: 70px; height: 28px; }
  .size { width: 100%; margin: 2px 0 0; font-size: 12px; font-variant-numeric: tabular-nums; }
  .err { color: var(--c-danger); margin: 0; }
</style>
