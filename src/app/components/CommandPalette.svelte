<script lang="ts">
  // ⌘K: run any available command by name. Matches words in order (subsequence per word).
  import type { AppState } from '../state.svelte';
  import type { Command } from '../commands';

  let { app, commands }: { app: AppState; commands: Command[] } = $props();
  let dialog = $state<HTMLDialogElement>();
  let input = $state<HTMLInputElement>();
  let q = $state('');
  let active = $state(0);

  $effect(() => {
    if (!dialog) return;
    if (app.showPalette && !dialog.open) { q = ''; active = 0; dialog.showModal(); input?.focus(); }
    else if (!app.showPalette && dialog.open) dialog.close();
  });

  function score(label: string, query: string): number {
    const l = label.toLowerCase(), t = query.toLowerCase().trim();
    if (!t) return 1;
    if (l.startsWith(t)) return 3;
    if (l.includes(t)) return 2;
    let i = 0;
    for (const ch of t.replace(/\s+/g, '')) { i = l.indexOf(ch, i); if (i < 0) return 0; i++; }
    return 1;
  }
  const results = $derived.by(() => {
    void app.view;
    return commands
      .filter((c) => c.available?.() !== false && c.id !== 'palette')
      .map((c) => ({ c, s: score(c.label, q), on: c.enabled?.() !== false }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || Number(b.on) - Number(a.on))
      .slice(0, 50);
  });
  $effect(() => { void q; active = 0; });

  function run(c: Command) {
    app.showPalette = false;
    queueMicrotask(() => c.run());
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(results.length - 1, active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = results[active]; if (r?.on) run(r.c); }
  }
  $effect(() => { void active; dialog?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }); });
</script>

<dialog bind:this={dialog} class="palette" aria-label="Command palette"
  onclose={() => (app.showPalette = false)} onclick={(e) => { if (e.target === dialog) app.showPalette = false; }}>
  <input bind:this={input} bind:value={q} type="text" placeholder="Type a command…" aria-label="Command"
    role="combobox" aria-expanded="true" aria-controls="curve-palette-list" aria-activedescendant="curve-cmd-{active}"
    onkeydown={onKey} spellcheck="false" autocomplete="off" />
  <ul id="curve-palette-list" role="listbox">
    {#each results as r, i (r.c.id)}
      <li id="curve-cmd-{i}" data-i={i} role="option" aria-selected={i === active} aria-disabled={!r.on}
        class:active={i === active} class:off={!r.on}
        onpointermove={() => (active = i)} onclick={() => r.on && run(r.c)} onkeydown={() => {}}>
        <span>{r.c.label}</span>{#if r.c.keys}<kbd>{r.c.keys}</kbd>{/if}
      </li>
    {:else}
      <li class="none muted">No matching commands</li>
    {/each}
  </ul>
</dialog>

<style>
  .palette {
    margin-top: 12vh; width: min(560px, calc(100vw - 32px)); padding: 0;
    background: var(--c-panel); color: var(--c-text);
    border: 1px solid var(--c-border); border-radius: 12px; box-shadow: var(--c-shadow); overflow: hidden;
  }
  .palette::backdrop { background: rgb(15 23 42 / 0.25); }
  input { width: 100%; border: 0 !important; border-bottom: 1px solid var(--c-border) !important; border-radius: 0 !important; padding: 14px 16px !important; font-size: 15px !important; outline: none !important; background: transparent !important; }
  ul { list-style: none; margin: 0; padding: 6px; max-height: 50vh; overflow: auto; }
  li { display: flex; justify-content: space-between; align-items: center; padding: 7px 10px; border-radius: 6px; cursor: pointer; }
  li.active { background: var(--c-accent-soft); }
  li.off { opacity: 0.45; cursor: default; }
  li.none { cursor: default; }
</style>
