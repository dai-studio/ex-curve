<script lang="ts">
  import type { AppState } from '../state.svelte';

  let { app }: { app: AppState } = $props();
  let el = $state<HTMLElement>();
  let pos = $state({ x: 0, y: 0 });

  // Keep the menu inside the viewport once it has been measured.
  $effect(() => {
    const m = app.menu;
    if (!m || !el) return;
    const r = el.getBoundingClientRect();
    pos = { x: Math.min(m.x, innerWidth - r.width - 4), y: Math.min(m.y, innerHeight - r.height - 4) };
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  });

  const close = () => { app.menu = null; };
  function onPointerDown(e: PointerEvent) {
    if (app.menu && el && !el.contains(e.target as Node)) close();
  }
  function onKeydown(e: KeyboardEvent) {
    if (app.menu && e.key === 'Escape') { e.stopPropagation(); close(); }
  }
</script>

<svelte:window onpointerdowncapture={onPointerDown} onkeydowncapture={onKeydown} />

{#if app.menu}
  <div class="menu" role="menu" bind:this={el} style:left="{pos.x}px" style:top="{pos.y}px">
    {#each app.menu.items as it, i (i)}
      <button type="button" role="menuitem" disabled={it.disabled} onclick={() => { close(); it.run(); }}>
        <span class="check">{it.checked ? '✓' : ''}</span>{it.label}
      </button>
    {/each}
  </div>
{/if}

<style>
  .menu {
    position: fixed; z-index: 30; min-width: 190px; padding: 4px;
    background: var(--c-panel); border: 1px solid var(--c-border); border-radius: var(--radius);
    box-shadow: var(--c-shadow);
    display: flex; flex-direction: column;
  }
  .menu button { text-align: left; border-radius: 4px; padding: 5px 10px 5px 4px; gap: 2px; }
  .menu button:hover:not(:disabled), .menu button:focus-visible { background: var(--c-accent-soft); outline: none; }
  .check { width: 16px; text-align: center; color: var(--c-accent); }
</style>
