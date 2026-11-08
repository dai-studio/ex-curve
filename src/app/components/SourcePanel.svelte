<script lang="ts">
  import type { AppState } from '../state.svelte';
  import type { Command } from '../commands';

  let { app, cmd }: { app: AppState; cmd: Record<string, Command> } = $props();

  // Serialising is not free: debounce while dragging.
  let text = $state('');
  $effect(() => {
    void app.view;
    const t = setTimeout(() => { text = app.editor.serialize(); }, 120);
    return () => clearTimeout(t);
  });
</script>

<section class="source" aria-label="Document source">
  <div class="head">
    <span>Document source</span>
    <button type="button" onclick={() => cmd['copy-source'].run()}>Copy</button>
  </div>
  <pre>{text}</pre>
</section>

<style>
  .source {
    grid-column: 3; grid-row: 2; min-height: 0;
    display: flex; flex-direction: column;
    background: var(--c-panel); border-left: 1px solid var(--c-border); border-top: 1px solid var(--c-border);
  }
  .head { display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; color: var(--c-muted); }
  pre { margin: 0; padding: 0 12px 12px; overflow: auto; font: 11px/1.45 var(--mono); white-space: pre-wrap; word-break: break-all; }
</style>
