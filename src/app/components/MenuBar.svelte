<script lang="ts">
  // Application menus generated from the command registry (MENUS). Keyboard: Enter/Space/↓ open,
  // ↑↓ move, ←→ switch menus, Esc closes; hovering switches menus while one is open.
  import type { AppState } from '../state.svelte';
  import { MENUS, type Command } from '../commands';

  let { app, cmd }: { app: AppState; cmd: Record<string, Command> } = $props();
  let open = $state<number | null>(null);
  let bar = $state<HTMLElement>();
  /** The open dropdown. It is rendered outside the menubar: a menubar may only own menu items. */
  let drop = $state<HTMLElement>();

  /** Toggle-style commands show a check mark. */
  const checked = (id: string): boolean | undefined => {
    void app.view;
    switch (id) {
      case 'toggle-snap': return app.settings.snap;
      case 'toggle-grid': return app.settings.showGrid;
      case 'source': return app.showSource;
      case 'theme-system': return app.theme === 'system';
      case 'theme-light': return app.theme === 'light';
      case 'theme-dark': return app.theme === 'dark';
      default: return undefined;
    }
  };
  const enabled = (c: Command) => { void app.view; return c.enabled?.() !== false; };
  /** Dropdowns are position: fixed, so the scrollable top bar can't clip them. */
  let pos = $state({ x: 0, y: 0 });
  const items = (i: number) => MENUS[i].items.map((id) => (id === '-' ? null : cmd[id])).filter((c, j, a) => c !== undefined && !(c === null && a[j - 1] === null))
    .filter((c) => c === null || c.available?.() !== false) as (Command | null)[];

  function focusItem(idx: number) {
    const list = [...(drop?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled), [role=menuitemcheckbox]:not(:disabled)') ?? [])];
    list[(idx + list.length) % list.length]?.focus();
  }
  function openMenu(i: number, focusFirst = false) {
    open = (i + MENUS.length) % MENUS.length;
    const r = bar?.querySelectorAll<HTMLElement>('.top')[open]?.getBoundingClientRect();
    if (r) pos = { x: Math.min(r.left, innerWidth - 250), y: r.bottom + 4 };
    if (focusFirst) queueMicrotask(() => focusItem(0));
  }
  function close(refocus = true) {
    const i = open;
    open = null;
    if (refocus && i !== null) bar?.querySelectorAll<HTMLButtonElement>('.top')[i]?.focus();
  }
  function run(c: Command) {
    close(false);
    c.run();
  }
  function onMenuKey(e: KeyboardEvent) {
    if (open === null) return;
    const list = [...(drop?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(i - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); openMenu(open + 1, true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); openMenu(open - 1, true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close(false);
  }
</script>

<svelte:window onpointerdown={(e) => {
  const t = e.target as Node;
  if (open !== null && !bar?.contains(t) && !drop?.contains(t)) close(false);
}} />

<div class="menubar" role="menubar" tabindex="-1" aria-label="Main menu" bind:this={bar} onkeydown={onMenuKey}>
  {#each MENUS as m, i (m.label)}
      <button type="button" class="top" class:on={open === i} role="menuitem" aria-haspopup="menu" aria-expanded={open === i}
        aria-controls={open === i ? `curve-menu-${i}` : undefined}
        onclick={() => (open === i ? close(false) : openMenu(i))}
        onpointerenter={() => { if (open !== null && open !== i) openMenu(i); }}
        onkeydown={(e) => { if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenu(i, true); } }}>
        {m.label}
      </button>
  {/each}
</div>

{#each MENUS as m, i (m.label)}
      {#if open === i}
        <!-- svelte-ignore a11y_interactive_supports_focus -->
        <div class="dropdown" id="curve-menu-{i}" role="menu" aria-label={m.label} bind:this={drop}
          style:left="{pos.x}px" style:top="{pos.y}px" onkeydown={onMenuKey}>
          {#each items(i) as c, j (c?.id ?? `sep-${j}`)}
            {#if c === null}
              <div class="sep" role="separator"></div>
            {:else}
              {@const chk = checked(c.id)}
              <button type="button" role={chk === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={chk}
                disabled={!enabled(c)} onclick={() => run(c)}>
                <span class="check">{chk ? '✓' : ''}</span>
                <span class="label">{c.label}</span>
                {#if c.keys}<span class="keys">{c.keys}</span>{/if}
              </button>
            {/if}
          {/each}
        </div>
      {/if}
{/each}

<style>
  .menubar { display: flex; align-items: center; gap: 0; flex: none; }
  .top { padding: 4px 9px; font-size: 13px; color: var(--c-text-2); }
  .top.on { background: var(--c-panel-2); color: var(--c-text); }
  .dropdown {
    position: fixed; z-index: 40; min-width: 240px; padding: 4px;
    background: var(--c-panel); border: 1px solid var(--c-border); border-radius: var(--radius); box-shadow: var(--c-shadow);
    display: flex; flex-direction: column;
    max-height: calc(100vh - 80px); overflow-y: auto;
  }
  .dropdown button { width: 100%; padding: 5px 10px 5px 4px; border-radius: 4px; gap: 4px; font-size: 13px; }
  .dropdown button:hover:not(:disabled), .dropdown button:focus-visible { background: var(--c-accent-soft); outline: none; }
  .check { width: 18px; text-align: center; color: var(--c-accent); flex: none; }
  .label { flex: 1; text-align: left; }
  .keys { color: var(--c-muted); font-size: 12px; font-variant-numeric: tabular-nums; margin-left: 16px; }
  .sep { height: 1px; background: var(--c-border); margin: 4px 6px; }
  @media (max-width: 900px) { .top { padding: 4px 6px; } }
</style>
