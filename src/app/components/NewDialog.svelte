<script lang="ts">
  import type { AppState } from '../state.svelte';
  import type { CurveHandle } from '../../embed';
  import Modal from './Modal.svelte';

  let { app, handle }: { app: AppState; handle: CurveHandle } = $props();

  const PRESETS: { label: string; w: number; h: number }[] = [
    { label: 'Icon 24', w: 24, h: 24 }, { label: 'Icon 48', w: 48, h: 48 }, { label: 'App icon 512', w: 512, h: 512 },
    { label: 'Canvas 800 × 600', w: 800, h: 600 }, { label: 'HD 1920 × 1080', w: 1920, h: 1080 },
    { label: 'Social 1200 × 630', w: 1200, h: 630 }, { label: 'A4 (mm → px)', w: 794, h: 1123 },
  ];
  let w = $state(800);
  let h = $state(600);
  let name = $state('Untitled.svg');
  const valid = $derived(w > 0 && h > 0 && w <= 100000 && h <= 100000);

  function create(e: SubmitEvent) {
    e.preventDefault();
    if (!valid) return;
    const n = name.trim() || 'Untitled.svg';
    handle.newDocument(w, h, n.toLowerCase().endsWith('.svg') ? n : `${n}.svg`);
    app.dialog = null;
  }
</script>

<Modal open={app.dialog === 'new'} title="New document" onclose={() => (app.dialog = null)}>
  <form id="curve-new-form" onsubmit={create}>
    <div class="presets" role="group" aria-label="Size presets">
      {#each PRESETS as p (p.label)}
        <button type="button" class:on={p.w === w && p.h === h} onclick={() => { w = p.w; h = p.h; }}>
          <span class="thumb" style:aspect-ratio="{p.w} / {p.h}"></span>{p.label}
        </button>
      {/each}
    </div>
    <div class="fields">
      <label>Name <input type="text" bind:value={name} /></label>
      <label>Width <input type="number" min="1" bind:value={w} /></label>
      <label>Height <input type="number" min="1" bind:value={h} /></label>
    </div>
  </form>
  {#snippet actions()}
    <button type="button" onclick={() => (app.dialog = null)}>Cancel</button>
    <button type="submit" form="curve-new-form" class="primary" disabled={!valid}>Create</button>
  {/snippet}
</Modal>

<style>
  .presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 6px; }
  .presets button {
    flex-direction: column; justify-content: center; gap: 6px; height: 74px; font-size: 12px;
    border: 1px solid var(--c-border); color: var(--c-text-2);
  }
  .presets button.on { border-color: var(--c-accent); }
  .thumb { display: block; max-width: 40px; max-height: 32px; width: 40px; border: 1.5px solid currentColor; border-radius: 2px; }
  .fields { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 8px; margin-top: 14px; }
  .fields label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--c-text-2); }
  .fields input { height: 30px; }
</style>
