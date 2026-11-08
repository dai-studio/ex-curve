<script lang="ts">
  import type { AppState } from '../state.svelte';
  import { fmt } from '../../engine/num';

  let { app }: { app: AppState } = $props();
  const v = $derived(app.view);
</script>

<footer class="status">
  <span class="msg" role="status">{app.status}</span>
  <span class="right">
    {#if v.hasDoc}<span>{fmt(v.size.width, 1)} × {fmt(v.size.height, 1)}</span>{/if}
    {#if app.pointer}<span class="pos">{fmt(app.pointer.x, 1)}, {fmt(app.pointer.y, 1)}</span>{/if}
  </span>
</footer>

<style>
  .status {
    display: flex; justify-content: space-between; gap: 12px;
    padding: 3px 12px; font-size: 12px;
    background: var(--c-panel); border-top: 1px solid var(--c-border); color: var(--c-muted);
    font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .msg { overflow: hidden; text-overflow: ellipsis; }
  .right { display: flex; gap: 16px; }
  .pos { min-width: 90px; text-align: right; }
</style>
