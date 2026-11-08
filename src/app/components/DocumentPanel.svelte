<script lang="ts">
  import type { AppState } from '../state.svelte';
  import type { Rect } from '../../engine/model';
  import NumberField from './NumberField.svelte';
  import Icon from './Icon.svelte';
  import { fmt } from '../../engine/num';

  let { app }: { app: AppState } = $props();
  const ed = $derived(app.editor);
  const v = $derived(app.view);
  const viewBox = $derived.by(() => { void v; return ed.getViewBox(); });
  const count = $derived.by(() => { void v; return ed.doc ? ed.doc.querySelectorAll('*').length : 0; });

  /** Edit one viewBox component; a document without a viewBox starts from 0 0 width height. */
  function setVb(key: keyof Rect, value: number, live: boolean) {
    const base = viewBox ?? { x: 0, y: 0, width: v.size.width, height: v.size.height };
    if ((key === 'width' || key === 'height') && value <= 0) { app.status = 'viewBox width and height must be greater than 0'; return; }
    ed.setViewBox({ ...base, [key]: value }, live);
  }
</script>

{#if v.hasDoc}
  <div class="sec">
    <h4 class="sec-title">Document</h4>
    <div class="grid2">
      <label><span>W</span><NumberField label="Document width" value={v.size.width} min={1} onchange={(w) => ed.setDocSize(w, v.size.height)} /></label>
      <label><span>H</span><NumberField label="Document height" value={v.size.height} min={1} onchange={(h) => ed.setDocSize(v.size.width, h)} /></label>
    </div>
    <div class="vb-head">
      <span class="lbl">viewBox</span>
      {#if viewBox}
        <button type="button" class="icon" title="Remove viewBox" aria-label="Remove viewBox" onclick={() => ed.setViewBox(null)}><Icon name="close" size={13} /></button>
      {:else}
        <span class="muted none">none</span>
      {/if}
    </div>
    <div class="grid2" role="group" aria-label="viewBox">
      <label title="viewBox min-x"><span>X</span><NumberField label="viewBox min-x" value={viewBox?.x ?? null} placeholder={'0'} onchange={(n, live) => setVb('x', n, live)} /></label>
      <label title="viewBox min-y"><span>Y</span><NumberField label="viewBox min-y" value={viewBox?.y ?? null} placeholder={'0'} onchange={(n, live) => setVb('y', n, live)} /></label>
      <label title="viewBox width"><span>W</span><NumberField label="viewBox width" value={viewBox?.width ?? null} placeholder={fmt(v.size.width)} onchange={(n, live) => setVb('width', n, live)} /></label>
      <label title="viewBox height"><span>H</span><NumberField label="viewBox height" value={viewBox?.height ?? null} placeholder={fmt(v.size.height)} onchange={(n, live) => setVb('height', n, live)} /></label>
    </div>
    <div class="row"><span class="lbl">Elements</span><span>{count}</span></div>
  </div>
  <div class="sec">
    <p class="muted hint">Click a shape to edit it, or pick a drawing tool on the left. Press <kbd>?</kbd> for shortcuts.</p>
  </div>
{/if}

<style>
  .vb-head { display: flex; align-items: center; justify-content: space-between; margin: 12px 0 2px; }
  .vb-head .lbl { color: var(--c-text-2); font-size: 12px; }
  .vb-head .icon { padding: 3px; }
  .none { font-size: 12px; }
  .hint { margin: 0; font-size: 12px; line-height: 1.6; }
</style>
