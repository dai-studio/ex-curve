<script lang="ts">
  import type { AppState } from '../state.svelte';
  import StylePanel from './StylePanel.svelte';
  import GeometryPanel from './GeometryPanel.svelte';
  import AttributesPanel from './AttributesPanel.svelte';
  import DocumentPanel from './DocumentPanel.svelte';
  import ArrangeBar from './ArrangeBar.svelte';
  import type { Command } from '../commands';
  import { definitionKind, isDefinitionContent, usersOf } from '../../engine/defs';

  let { app, cmd }: { app: AppState; cmd: Record<string, Command> } = $props();
  const v = $derived(app.view);

  type Tab = 'style' | 'geometry' | 'attributes';
  const TABS: [Tab, string][] = [['style', 'Style'], ['geometry', 'Geometry'], ['attributes', 'Attributes']];
  let tab = $state<Tab>('style');

  /** A non-visual definition (gradient, stop, filter…) or other defs content outside definition editing. */
  const defOnly = $derived.by(() => {
    const s = v.selection;
    if (s.length !== 1 || !isDefinitionContent(s[0])) return null;
    const d = app.editor.definition;
    if (d && (d.target === s[0] || d.target.contains(s[0]))) return null;
    const el = s[0];
    const def = el.closest('defs > *, symbol') ?? el;
    const users = app.editor.doc && def.id ? usersOf(app.editor.doc, def.id).length : 0;
    return { el, def, users, kind: definitionKind(def) };
  });

  const title = $derived.by(() => {
    const s = v.selection;
    if (s.length === 1) {
      const id = s[0].getAttribute('id');
      return { tag: `<${s[0].localName}>`, id };
    }
    const tags = new Set(s.map((e) => e.localName));
    return { tag: tags.size === 1 ? `${s.length} × <${[...tags][0]}>` : `${s.length} shapes`, id: null };
  });

  function onTabKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex(([t]) => t === tab);
    tab = TABS[(i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length][0];
    (e.currentTarget as HTMLElement).querySelector<HTMLButtonElement>(`[data-tab=${tab}]`)?.focus();
  }
</script>

{#if v.scope && v.scope !== app.editor.definitionScope}
  <div class="scope">Inside <code>&lt;{v.scope.localName}&gt;</code> · <kbd>Esc</kbd> to leave</div>
{/if}

{#if !v.hasDoc}
  <div class="sec"><p class="muted">No document.</p></div>
{:else if !v.selection.length}
  <DocumentPanel {app} />
{:else if defOnly}
  <div class="head">
    <span class="tag mono">{title.tag}</span>
    {#if title.id}<span class="id mono">#{title.id}</span>{/if}
  </div>
  <div class="defnote">
    {#if defOnly.el !== defOnly.def}Part of <code>#{defOnly.def.id || defOnly.def.localName}</code> · {/if}
    {defOnly.users ? `Used by ${defOnly.users} element${defOnly.users > 1 ? 's' : ''}` : 'Not used'}. Definitions don’t render by themselves; edit their attributes here.
  </div>
  <AttributesPanel {app} />
{:else}
  <div class="head">
    <span class="tag mono">{title.tag}</span>
    {#if title.id}<span class="id mono">#{title.id}</span>{/if}
  </div>
  <ArrangeBar {app} {cmd} />
  <div class="tabs" role="tablist" aria-label="Inspector sections" tabindex="-1" onkeydown={onTabKey}>
    {#each TABS as [t, label] (t)}
      <button type="button" role="tab" data-tab={t} id="curve-tab-{t}" aria-controls="curve-tabpanel"
        aria-selected={tab === t} tabindex={tab === t ? 0 : -1} class:on={tab === t} onclick={() => (tab = t)}>{label}</button>
    {/each}
  </div>
  <div id="curve-tabpanel" role="tabpanel" aria-labelledby="curve-tab-{tab}">
    {#if tab === 'style'}<StylePanel {app} />
    {:else if tab === 'geometry'}<GeometryPanel {app} />
    {:else}<AttributesPanel {app} />{/if}
  </div>
{/if}


<style>
  .scope { background: var(--c-accent-soft); padding: 6px 12px; font-size: 12px; }
  .head { display: flex; align-items: baseline; gap: 8px; padding: 12px 12px 4px; min-width: 0; }
  .tag { font-weight: 600; font-size: 13px; }
  .id { color: var(--c-muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .defnote { margin: 4px 12px 0; padding: 7px 10px; border-radius: var(--radius-sm); background: var(--c-panel-2); font-size: 12px; color: var(--c-text-2); line-height: 1.5; }
  .tabs { display: flex; gap: 2px; padding: 4px 8px 0; border-bottom: 1px solid var(--c-border); }
  .tabs button {
    border-radius: 6px 6px 0 0; padding: 6px 10px; font-size: 12.5px; color: var(--c-muted);
    border-bottom: 2px solid transparent; margin-bottom: -1px;
  }
  .tabs button.on { color: var(--c-text); background: transparent; border-bottom-color: var(--c-accent); }
</style>
