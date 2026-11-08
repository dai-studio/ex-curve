<script lang="ts">
  // FontPicker: a font-family field with a dropdown of families, each previewed in its own face.
  // Groups: Generic, In this document, Installed (host.listFonts, or the browser's Local Font
  // Access API after "Show installed fonts" — a click is required and the browser asks permission).
  // Typing filters the list; Enter picks the highlighted family or commits the typed value as-is.
  // Picking keeps the current value's generic fallback ("Georgia, serif" + Inter → "Inter, serif").
  import type { AppState } from '../state.svelte';
  import {
    GENERIC_FAMILIES, canQueryLocalFonts, documentFamilies, installedFamilies, isGeneric, loadInstalledFamilies,
    primaryFamily, quoteFamily, withFamily,
  } from '../fonts';
  import Icon from './Icon.svelte';

  interface Props {
    app: AppState;
    value: string | null;
    label: string;
    onchange: (value: string) => void;
  }
  let { app, value, label, onchange }: Props = $props();

  const MAX_INSTALLED = 300;
  let text = $state('');
  let editing = $state(false);
  let typed = $state(false);
  let open = $state(false);
  let active = $state(0);
  let installed = $state<string[] | null>(installedFamilies());
  let loading = $state(false);
  let loadError = $state('');
  let root = $state<HTMLElement>();
  let list = $state<HTMLElement>();
  let pos = $state({ x: 0, y: 0, w: 240, up: false });
  const id = `curve-font-${Math.random().toString(36).slice(2, 8)}`;

  $effect(() => { if (!editing) { text = value ?? ''; typed = false; } });

  const canInstall = $derived(!!app.listFonts || canQueryLocalFonts());
  const query = $derived(typed ? primaryFamily(text).toLowerCase() || text.trim().toLowerCase() : '');
  const match = (f: string) => !query || f.toLowerCase().includes(query);

  interface Group { title: string; items: { f: string; i: number }[]; more: number }
  const groups = $derived.by((): Group[] => {
    void app.view;
    const doc = app.editor.doc ? documentFamilies(app.editor.doc).filter((f) => !isGeneric(f)) : [];
    const docSet = new Set(doc.map((f) => f.toLowerCase()));
    const inst = (installed ?? []).filter((f) => !docSet.has(f.toLowerCase()) && match(f));
    let i = 0;
    const index = (fs: string[]) => fs.map((f) => ({ f, i: i++ }));
    return [
      { title: 'Generic', items: index(GENERIC_FAMILIES.filter(match)), more: 0 },
      { title: 'In this document', items: index(doc.filter(match)), more: 0 },
      { title: 'Installed', items: index(inst.slice(0, MAX_INSTALLED)), more: Math.max(0, inst.length - MAX_INSTALLED) },
    ];
  });
  const flat = $derived(groups.flatMap((g) => g.items.map((x) => x.f)));
  $effect(() => { void query; active = 0; });
  const current = $derived(primaryFamily(value).toLowerCase());

  function place() {
    const r = root!.getBoundingClientRect();
    const H = 300, w = Math.max(r.width, 240);
    const up = r.bottom + 4 + H > innerHeight && r.top - H - 4 > 0;
    pos = { x: Math.max(8, Math.min(r.left, innerWidth - w - 8)), y: up ? r.top - 4 : r.bottom + 4, w, up };
  }
  async function openList() {
    if (open) return;
    place();
    open = true;
    // A host list needs no permission prompt: load it straight away.
    if (app.listFonts && !installed) void loadInstalled();
    queueMicrotask(() => list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
  }
  function close() { open = false; typed = false; }

  async function loadInstalled() {
    loading = true;
    loadError = '';
    try { installed = await loadInstalledFamilies(app.listFonts); }
    catch (e) { loadError = (e as Error).message; }
    finally { loading = false; }
  }

  function choose(family: string) {
    const v = withFamily(value, family);
    text = v; // the blur below commits the field: make that the chosen value, not the typed filter
    onchange(v);
    editing = false;
    close();
    root?.querySelector('input')?.blur();
  }
  function commitText() {
    const t = text.trim();
    if (t && t !== (value ?? '')) onchange(t);
    else text = value ?? '';
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { void openList(); return; }
      if (!flat.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length;
      queueMicrotask(() => list?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && typed && flat[active]) choose(flat[active]);
      else { commitText(); close(); }
    } else if (e.key === 'Escape') {
      if (open) { e.stopPropagation(); close(); }
      else { text = value ?? ''; (e.currentTarget as HTMLInputElement).blur(); }
    } else if (e.key === 'Tab') close();
  }

  function onWindowDown(e: PointerEvent) {
    if (!open) return;
    const t = e.target as Node;
    if (!root?.contains(t) && !list?.contains(t)) close();
  }
</script>

<svelte:window onpointerdowncapture={onWindowDown} onresize={() => open && place()} />

<div class="fp" bind:this={root}>
  <input type="text" role="combobox" aria-label={label} aria-expanded={open} aria-controls={id} aria-autocomplete="list"
    aria-activedescendant={open && flat.length ? `${id}-${active}` : undefined}
    spellcheck="false" autocomplete="off" placeholder={value === null ? 'Mixed' : 'Font family'}
    style:font-family={value ? `${value}, var(--font)` : undefined}
    bind:value={text}
    oninput={() => { typed = true; void openList(); }}
    onfocus={(e) => { editing = true; e.currentTarget.select(); }}
    onblur={() => { editing = false; if (!open) commitText(); }}
    {onkeydown} />
  <button type="button" class="toggle" tabindex="-1" aria-label="Show fonts" title="Show fonts"
    onclick={() => (open ? close() : (root?.querySelector('input')?.focus(), void openList()))}>
    <Icon name="chevron" size={14} />
  </button>
</div>

{#if open}
  <div class="fp-pop" class:up={pos.up} bind:this={list} id={id} role="listbox" aria-label="{label} options"
    style:left="{pos.x}px" style:top="{pos.y}px" style:width="{pos.w}px">
    {#each groups as g (g.title)}
      {#if g.items.length || g.title === 'Installed'}
        <div class="group" role="presentation">{g.title}</div>
        {#each g.items as { f, i } (f)}
          <div class="opt" id="{id}-{i}" data-i={i} role="option" aria-selected={i === active} tabindex="-1"
            class:active={i === active} class:current={f.toLowerCase() === current}
            onpointermove={() => (active = i)}
            onpointerdown={(e) => { e.preventDefault(); choose(f); }}
            onkeydown={() => {}}>
            <span class="sample" style:font-family="{quoteFamily(f)}, var(--font)">{f}</span>
            {#if f.toLowerCase() === current}<span class="tick">✓</span>{/if}
          </div>
        {/each}
        {#if g.title === 'Installed'}
          {#if g.more}<div class="hint">{g.more} more — type to narrow down</div>{/if}
          {#if !installed}
            {#if loading}<div class="hint">Loading installed fonts…</div>
            {:else if canInstall}
              <button type="button" class="load" onpointerdown={(e) => e.preventDefault()} onclick={() => void loadInstalled()}>Show installed fonts</button>
              {#if !app.listFonts}<div class="hint">Your browser will ask for permission.</div>{/if}
            {:else}<div class="hint">This browser can’t list installed fonts. You can still type any font name.</div>{/if}
            {#if loadError}<div class="hint err">{loadError}</div>{/if}
          {:else if !g.items.length && !g.more}<div class="hint">No matches.</div>{/if}
        {/if}
      {/if}
    {/each}
  </div>
{/if}

<style>
  .fp {
    display: flex; align-items: stretch; flex: 1; min-width: 0; height: 26px;
    border: 1px solid var(--c-border-strong); border-radius: var(--radius-sm); background: var(--c-panel); overflow: hidden;
  }
  .fp:focus-within { outline: 2px solid var(--c-accent-ring); outline-offset: 1px; }
  .fp input {
    flex: 1; min-width: 0; height: 100% !important; padding: 0 6px !important; border: 0 !important; outline: none !important;
    background: transparent !important; font-size: 12.5px;
  }
  .fp input::placeholder { color: var(--c-faint); font-family: var(--font); }
  .toggle { flex: none; padding: 0 6px; border-radius: 0; border-left: 1px solid var(--c-border); color: var(--c-text-2); }

  .fp-pop {
    position: fixed; z-index: 50; max-height: 300px; overflow-y: auto; padding: 4px;
    background: var(--c-panel); border: 1px solid var(--c-border); border-radius: 10px; box-shadow: var(--c-shadow);
  }
  .fp-pop.up { transform: translateY(-100%); }
  .group {
    padding: 8px 8px 3px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--c-muted);
  }
  .opt { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 5px; cursor: default; }
  .opt.active { background: var(--c-accent-soft); }
  .sample { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
  .tick { color: var(--c-accent); font-size: 12px; }
  .opt.current .sample { color: var(--c-accent-strong); }
  .hint { padding: 4px 8px 6px; font-size: 11.5px; color: var(--c-muted); }
  .hint.err { color: var(--c-danger); }
  .load { margin: 2px 8px 2px; padding: 4px 10px; font-size: 12px; border: 1px solid var(--c-border-strong); }
</style>
