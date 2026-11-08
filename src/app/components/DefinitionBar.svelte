<script lang="ts">
  // Breadcrumb shown while a symbol / reusable shape is edited on the canvas.
  import type { AppState } from '../state.svelte';

  let { app }: { app: AppState } = $props();
  const d = $derived(app.view.definition);
  const what = $derived(d?.kind === 'symbol' ? 'symbol' : 'definition');
</script>

{#if d}
  <div class="defbar" role="status">
    <span class="crumb"><span class="muted">Document</span> › <strong class="mono">#{d.id}</strong> <span class="muted">({what})</span></span>
    <span class="note muted">
      {#if d.instances > 1}All {d.instances} instances update{:else if d.instances === 1}Its instance updates{:else}Not used yet{/if}
      {#if !d.throughInstance} · shown at the origin{/if}
    </span>
    <button type="button" class="primary" onclick={() => app.editor.exitDefinition()} title="Done (Esc)">Done</button>
  </div>
{/if}

<style>
  .defbar {
    position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 6;
    display: flex; align-items: center; gap: 12px; max-width: calc(100% - 24px);
    padding: 5px 6px 5px 14px; border-radius: 999px;
    background: var(--c-panel); border: 1px solid var(--c-accent); box-shadow: var(--c-shadow);
    font-size: 12.5px; white-space: nowrap;
  }
  .crumb strong { color: var(--c-accent-strong); }
  .note { font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
  .primary { padding: 3px 14px; border-radius: 999px; }
</style>
