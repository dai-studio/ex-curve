<script lang="ts">
  // Layers: the document tree, topmost first. Click selects (entering groups as needed),
  // Shift-click adds, double-click renames the id, drag reorders or moves into groups,
  // eye/lock toggle visibility (display="none") and editor-only locking.
  import type { AppState } from '../state.svelte';
  import { adapterFor, isGroup } from '../../engine/adapters/registry';
  import Icon from './Icon.svelte';
  import SectionHeader from './SectionHeader.svelte';
  import type { IconName } from '../icons';

  let { app }: { app: AppState } = $props();
  const ed = $derived(app.editor);
  const v = $derived(app.view);

  let open = $state(true);
  const collapsed = new WeakSet<Element>(); // not reactive itself; ctick re-derives rows
  let ctick = $state(0);
  const MAX_ROWS = 3000;

  interface Row { el: Element; depth: number; group: boolean; label: string; icon: IconName }
  const ICON: Record<string, IconName> = {
    rect: 'rect', circle: 'circle', ellipse: 'ellipse', line: 'line', polyline: 'pen', polygon: 'polygon', path: 'pen',
    text: 'text', image: 'image', g: 'group', a: 'group', switch: 'group', use: 'copy', svg: 'rect', foreignObject: 'code',
  };
  function label(el: Element): string {
    if (el.id) return el.id;
    if (el.localName === 'text') { const t = (el.textContent ?? '').trim(); if (t) return `“${t.length > 24 ? t.slice(0, 24) + '…' : t}”`; }
    const NAMES: Record<string, string> = { g: 'Group', a: 'Link', use: 'Use', svg: 'SVG', foreignObject: 'HTML' };
    return NAMES[el.localName] ?? el.localName[0].toUpperCase() + el.localName.slice(1);
  }
  const rows = $derived.by(() => {
    void v; void ctick;
    const out: Row[] = [];
    const walk = (parent: Element, depth: number) => {
      const kids = Array.from(parent.children).filter((c) => adapterFor(c));
      for (let i = kids.length - 1; i >= 0 && out.length < MAX_ROWS; i--) {
        const el = kids[i], group = isGroup(el);
        out.push({ el, depth, group, label: label(el), icon: ICON[el.localName] ?? 'rect' });
        if (group && !collapsed.has(el)) walk(el, depth + 1);
      }
    };
    // While editing a definition, the tree shows that definition's content.
    const root = ed.definitionScope ?? ed.doc;
    if (root) walk(root, 0);
    return out;
  });
  const selected = $derived(new Set(v.selection));

  // Keep the first selected row visible (selection may come from the canvas).
  let tree = $state<HTMLElement>();
  $effect(() => {
    const first = v.selection[0];
    if (!tree || !first) return;
    const i = rows.findIndex((r) => r.el === first);
    tree.querySelector<HTMLElement>(`[data-layer-index="${i}"]`)?.scrollIntoView({ block: 'nearest' });
  });

  function toggleCollapse(el: Element) { if (collapsed.has(el)) collapsed.delete(el); else collapsed.add(el); ctick++; }

  // ---- rename
  let renaming = $state<Element | null>(null);
  let renameError = $state('');
  function finishRename(el: Element, value: string, commit: boolean) {
    if (commit) { const err = ed.setId(el, value); if (err) { renameError = err; return; } }
    renameError = '';
    renaming = null;
  }

  // ---- drag & drop
  let dragging: Element[] = [];
  let drop = $state<{ el: Element; zone: 'above' | 'below' | 'into' } | null>(null);
  function onDragStart(e: DragEvent, el: Element) {
    dragging = selected.has(el) ? v.selection : [el];
    e.dataTransfer?.setData('text/plain', 'curve-layer');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e: DragEvent, row: Row) {
    if (!dragging.length || dragging.some((d) => d === row.el || d.contains(row.el))) { drop = null; return; }
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    drop = { el: row.el, zone: row.group && f > 0.3 && f < 0.7 ? 'into' : f < 0.5 ? 'above' : 'below' };
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    const d = drop;
    drop = null;
    if (!d) return;
    // Rows are topmost-first: "above" a row is later in the document.
    if (d.zone === 'into') ed.moveElements(dragging, d.el, null);
    else ed.moveElements(dragging, d.el.parentElement!, d.zone === 'above' ? d.el.nextSibling : d.el);
    dragging = [];
  }

  function onRowKey(e: KeyboardEvent, row: Row, i: number) {
    const go = (j: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, j))];
      if (r) { ed.selectElement(r.el); queueMicrotask(() => document.querySelector<HTMLElement>(`[data-layer-index="${rows.indexOf(r)}"]`)?.focus()); }
    };
    if (e.key === 'ArrowDown') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(i - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); renaming = row.el; }
    else if (row.group && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      if ((e.key === 'ArrowLeft') !== collapsed.has(row.el)) toggleCollapse(row.el);
    }
  }
</script>

<section class="layers" class:open aria-label="Layers">
  <SectionHeader title="Layers" {open} ontoggle={() => (open = !open)} count="{rows.length}{rows.length >= MAX_ROWS ? '+' : ''}">
    {#snippet extra()}{#if v.definition}<span class="in-def"> · #{v.definition.id}</span>{/if}{/snippet}
  </SectionHeader>
  {#if open}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <ul class="tree" bind:this={tree} role="tree" aria-label="Document layers" ondragleave={(e) => { if (e.currentTarget === e.target) drop = null; }}>
      {#each rows as row, i (row.el)}
        {@const hidden = ed.isHidden(row.el)}
        {@const locked = ed.isLocked(row.el)}
        <li
          role="treeitem"
          aria-selected={selected.has(row.el)}
          aria-expanded={row.group ? !collapsed.has(row.el) : undefined}
          aria-level={row.depth + 1}
          tabindex={selected.has(row.el) || (i === 0 && !v.selection.length) ? 0 : -1}
          data-layer-index={i}
          class="row"
          class:sel={selected.has(row.el)}
          class:hidden
          class:drop-above={drop?.el === row.el && drop.zone === 'above'}
          class:drop-below={drop?.el === row.el && drop.zone === 'below'}
          class:drop-into={drop?.el === row.el && drop.zone === 'into'}
          style:padding-left="{6 + row.depth * 14}px"
          draggable={renaming !== row.el}
          ondragstart={(e) => onDragStart(e, row.el)}
          ondragover={(e) => onDragOver(e, row)}
          ondrop={onDrop}
          ondragend={() => { drop = null; dragging = []; }}
          onclick={(e) => { if (!locked) ed.selectElement(row.el, e.shiftKey); }}
          onkeydown={(e) => onRowKey(e, row, i)}>
          {#if row.group}
            <button type="button" class="twisty" class:closed={collapsed.has(row.el)} tabindex="-1"
              aria-label={collapsed.has(row.el) ? 'Expand' : 'Collapse'}
              onclick={(e) => { e.stopPropagation(); toggleCollapse(row.el); }}><Icon name="chevron" size={12} /></button>
          {:else}<span class="twisty-sp"></span>{/if}
          <span class="ic"><Icon name={row.icon} size={14} /></span>
          {#if renaming === row.el}
            <!-- svelte-ignore a11y_autofocus -->
            <input class="rename mono" type="text" value={row.el.id} autofocus aria-label="Element id" placeholder="id"
              onclick={(e) => e.stopPropagation()}
              onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') finishRename(row.el, e.currentTarget.value, true); if (e.key === 'Escape') finishRename(row.el, '', false); }}
              onblur={(e) => finishRename(row.el, e.currentTarget.value, true)} />
          {:else}
            <span class="name" class:mono={!!row.el.id} title={row.el.id ? `#${row.el.id}` : row.label}
              ondblclick={(e) => { e.stopPropagation(); renaming = row.el; }} role="presentation">{row.label}</span>
          {/if}
          <span class="tog">
            <button type="button" class:on={hidden} tabindex="-1" aria-label={hidden ? 'Show' : 'Hide'} title={hidden ? 'Show' : 'Hide'}
              onclick={(e) => { e.stopPropagation(); ed.setHidden([row.el], !hidden); }}><Icon name={hidden ? 'eye-off' : 'eye'} size={13} /></button>
            <button type="button" class:on={locked} tabindex="-1" aria-label={locked ? 'Unlock' : 'Lock'} title={locked ? 'Unlock' : 'Lock'}
              onclick={(e) => { e.stopPropagation(); ed.setLocked([row.el], !locked); }}><Icon name={locked ? 'lock' : 'unlock'} size={13} /></button>
          </span>
        </li>
      {:else}
        <li class="empty muted">No shapes yet. Draw one with the tools on the left.</li>
      {/each}
    </ul>
    {#if renameError}<p class="err" role="alert">{renameError}</p>{/if}
  {/if}
</section>

<style>
  .layers { display: flex; flex-direction: column; min-height: 0; border-top: 1px solid var(--c-border); }
  .layers.open { flex: 0 0 40%; min-height: 140px; }
  .in-def { color: var(--c-accent-strong); text-transform: none; letter-spacing: 0; }
  .twisty.closed { transform: rotate(-90deg); }
  .tree { list-style: none; margin: 0; padding: 0 0 8px; overflow: auto; flex: 1; min-height: 0; }
  .row {
    display: flex; align-items: center; gap: 4px; height: 26px; padding-right: 6px; cursor: default;
    border-top: 1px solid transparent; border-bottom: 1px solid transparent; outline: none;
  }
  .row:hover { background: var(--c-panel-2); }
  .row.sel { background: var(--c-accent-soft); }
  .row:focus-visible { box-shadow: inset 0 0 0 2px var(--c-accent-ring); }
  .row.hidden .name, .row.hidden .ic { opacity: 0.45; }
  .row.drop-above { border-top-color: var(--c-accent); }
  .row.drop-below { border-bottom-color: var(--c-accent); }
  .row.drop-into { box-shadow: inset 0 0 0 1.5px var(--c-accent); }
  .twisty { padding: 1px; color: var(--c-muted); transition: transform 0.12s; }
  .twisty-sp { width: 14px; flex: none; }
  .ic { color: var(--c-muted); display: inline-flex; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
  .name.mono { font-size: 12px; }
  .rename { flex: 1; min-width: 0; height: 22px; font-size: 12px; }
  .tog { display: flex; gap: 0; opacity: 0; }
  .row:hover .tog, .tog:has(.on) { opacity: 1; }
  .tog button { padding: 3px; color: var(--c-muted); }
  .tog button.on { background: transparent; color: var(--c-text-2); }
  .empty { padding: 8px 12px; font-size: 12px; }
  .err { color: var(--c-danger); font-size: 12px; margin: 4px 12px; }
</style>
