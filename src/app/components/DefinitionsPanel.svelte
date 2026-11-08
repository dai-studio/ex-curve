<script lang="ts">
  // Definitions: everything in <defs> (and loose <symbol>s). Symbols and reusable shapes open for
  // editing on the canvas (through their first instance, else at the origin); gradients, filters,
  // markers, clip paths, masks, patterns and their children (stops, filter primitives…) are
  // selected for the inspector's Attributes tab.
  import type { AppState } from '../state.svelte';
  import { definitionKind, isCanvasDefinition, listDefinitions, usersOf, type DefKind } from '../../engine/defs';
  import { adapterFor } from '../../engine/adapters/registry';
  import Icon from './Icon.svelte';
  import SectionHeader from './SectionHeader.svelte';
  import type { IconName } from '../icons';

  let { app }: { app: AppState } = $props();
  const ed = $derived(app.editor);
  const v = $derived(app.view);

  let open = $state(false);
  const expanded = new Set<Element>();
  let etick = $state(0);

  const ICON: Record<DefKind, IconName> = {
    symbol: 'symbol', gradient: 'gradient', pattern: 'pattern', marker: 'marker', clipPath: 'cut', mask: 'mask',
    filter: 'filter', style: 'style', shape: 'rect',
  };
  const KIND: Record<DefKind, string> = {
    symbol: 'Symbol', gradient: 'Gradient', pattern: 'Pattern', marker: 'Marker', clipPath: 'Clip path', mask: 'Mask',
    filter: 'Filter', style: 'Style sheet', shape: 'Shape',
  };

  interface Row { el: Element; depth: number; label: string; icon: IconName; users: number; kids: boolean; def: Element }
  const rows = $derived.by(() => {
    void v; void etick;
    const out: Row[] = [];
    if (!ed.doc) return out;
    for (const def of listDefinitions(ed.doc)) {
      const kind = definitionKind(def);
      const kids = def.children.length > 0 && kind !== 'style';
      const label = def.id ? `#${def.id}` : `<${def.localName}>`;
      out.push({ el: def, depth: 0, label, icon: ICON[kind], users: def.id ? usersOf(ed.doc, def.id).length : 0, kids, def });
      if (kids && expanded.has(def)) {
        for (const c of Array.from(def.children)) {
          const off = c.getAttribute('offset');
          const name = c.id ? `#${c.id}` : c.localName === 'stop' && off !== null ? `stop ${off}` : c.localName;
          out.push({ el: c, depth: 1, label: name, icon: adapterFor(c) ? 'rect' : 'code', users: 0, kids: false, def });
        }
      }
    }
    return out;
  });
  const selected = $derived(new Set(v.selection));
  const editing = $derived(ed.definition?.target ?? null);

  /** First <use> of a definition, to edit it in place. */
  const firstUse = (def: Element) => (ed.doc && def.id ? usersOf(ed.doc, def.id).find((u) => u.localName === 'use') ?? null : null);

  function activate(row: Row) {
    const { el, def } = row;
    if (isCanvasDefinition(def) && (adapterFor(def) || definitionKind(def) === 'symbol')) {
      if (editing !== def) ed.editDefinition(def, firstUse(def));
      if (el !== def && adapterFor(el)) ed.selectElement(el);
    } else {
      ed.inspect(el);
    }
  }
  function toggle(def: Element) { if (expanded.has(def)) expanded.delete(def); else expanded.add(def); etick++; }
</script>

<section class="defs" class:open aria-label="Definitions">
  <SectionHeader title="Definitions" {open} ontoggle={() => (open = !open)} count={rows.filter((r) => r.depth === 0).length} />
  {#if open}
    {#if rows.length}
    <ul class="list" role="tree" aria-label="Document definitions">
      {#each rows as row (row.el)}
        <li role="treeitem" aria-selected={selected.has(row.el) || editing === row.el} tabindex="-1" aria-level={row.depth + 1}
          aria-expanded={row.kids ? expanded.has(row.el) : undefined}
          class="row" class:sel={selected.has(row.el)} class:active={editing === row.el}
          style:padding-left="{8 + row.depth * 16}px"
          onclick={() => activate(row)}
          onkeydown={(e) => { if (e.key === 'Enter') activate(row); }}
          title={row.depth === 0 ? `${KIND[definitionKind(row.el)]}${row.users ? ` · used by ${row.users}` : ' · unused'}` : row.label}>
          {#if row.kids}
            <button type="button" class="twisty" class:closed={!expanded.has(row.el)} tabindex="-1" aria-label={expanded.has(row.el) ? 'Collapse' : 'Expand'}
              onclick={(e) => { e.stopPropagation(); toggle(row.el); }}><Icon name="chevron" size={12} /></button>
          {:else}<span class="twisty-sp"></span>{/if}
          <span class="ic"><Icon name={row.icon} size={14} /></span>
          <span class="name mono">{row.label}</span>
          {#if row.depth === 0}
            <span class="kind">{KIND[definitionKind(row.el)]}</span>
            <span class="users" class:unused={!row.users}>{row.users}</span>
          {/if}
        </li>
      {/each}
    </ul>
    {:else}
      <p class="empty muted">No definitions. Symbols, gradients, filters and other reusable parts appear here.</p>
    {/if}
  {/if}
</section>

<style>
  .defs { display: flex; flex-direction: column; min-height: 0; border-top: 1px solid var(--c-border); flex: none; }
  .twisty.closed { transform: rotate(-90deg); }
  .list { list-style: none; margin: 0; padding: 0 0 8px; overflow: auto; max-height: 200px; }
  .row { display: flex; align-items: center; gap: 4px; height: 26px; padding-right: 10px; cursor: default; outline: none; }
  .row:hover { background: var(--c-panel-2); }
  .row.sel { background: var(--c-accent-soft); }
  .row.active { box-shadow: inset 2px 0 0 var(--c-accent); }
  .twisty { padding: 1px; color: var(--c-muted); transition: transform 0.12s; }
  .twisty-sp { width: 14px; flex: none; }
  .ic { color: var(--c-muted); display: inline-flex; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .kind { font-size: 11px; color: var(--c-faint); }
  .users {
    min-width: 18px; text-align: center; font-size: 10.5px; border-radius: 8px; padding: 0 5px;
    background: var(--c-panel-2); color: var(--c-text-2);
  }
  .users.unused { color: var(--c-faint); }
  .empty { margin: 0; padding: 8px 12px; font-size: 12px; }
</style>
