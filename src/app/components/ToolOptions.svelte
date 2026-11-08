<script lang="ts">
  // Floating context bar over the canvas: the active tool's hint and options.
  import type { AppState } from '../state.svelte';
  import { TOOLS } from '../commands';
  import FontPicker from './FontPicker.svelte';

  let { app }: { app: AppState } = $props();
  const def = $derived(TOOLS.find((t) => t.id === app.view.tool));
  const opts = $derived(app.editor.toolOptions);
  // toolOptions is a plain engine object; bump to re-render after edits.
  let tick = $state(0);
  const set = (k: 'polygonSides' | 'starPoints' | 'starInnerRatio' | 'fontSize', v: number, min: number, max: number) => {
    if (!Number.isFinite(v)) return;
    opts[k] = Math.min(max, Math.max(min, v));
    tick++;
  };
</script>

{#if def && def.id !== 'select'}
  {#key tick}
    <div class="ctx" role="group" aria-label="{def.label} options">
      <strong>{def.label}</strong>
      <span class="hint">{def.hint}</span>
      {#if def.id === 'polygon'}
        <label>Sides <input type="number" min="3" max="64" value={opts.polygonSides}
          onchange={(e) => set('polygonSides', Math.round(+e.currentTarget.value), 3, 64)} /></label>
      {:else if def.id === 'star'}
        <label>Points <input type="number" min="3" max="64" value={opts.starPoints}
          onchange={(e) => set('starPoints', Math.round(+e.currentTarget.value), 3, 64)} /></label>
        <label>Inner <input type="number" min="5" max="95" step="5" value={Math.round(opts.starInnerRatio * 100)}
          onchange={(e) => set('starInnerRatio', +e.currentTarget.value / 100, 0.05, 0.95)} />%</label>
      {:else if def.id === 'text'}
        <span class="font"><FontPicker {app} label="Font for new text" value={opts.fontFamily}
          onchange={(f) => { opts.fontFamily = f; tick++; }} /></span>
        <label>Size <input type="number" min="1" max="1000" value={opts.fontSize}
          onchange={(e) => set('fontSize', +e.currentTarget.value, 1, 1000)} /></label>
      {/if}
      {#if app.view.toolBusy}
        <button type="button" class="primary" onclick={() => app.editor.setTool('select')}>Done</button>
      {/if}
    </div>
  {/key}
{/if}

<style>
  .ctx {
    position: absolute; left: 12px; top: 12px; z-index: 5;
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    max-width: calc(100% - 24px);
    padding: 6px 12px; border-radius: 10px;
    background: var(--c-panel); border: 1px solid var(--c-border); box-shadow: var(--c-shadow);
    font-size: 12px;
  }
  .hint { color: var(--c-muted); }
  label { display: inline-flex; align-items: center; gap: 6px; color: var(--c-text-2); }
  input { width: 58px; }
  .primary { padding: 3px 10px; }
  .font { display: flex; width: 200px; }
</style>
