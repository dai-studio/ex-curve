<script lang="ts">
  // Raw attribute editor. Each attribute gets an editor that fits its name and value
  // (see attrKinds.ts): number fields (spinner, drag-to-scrub), colour wells, keyword menus,
  // multi-line boxes for long values, and plain text otherwise. Edits write the attribute as-is.
  import type { AppState } from '../state.svelte';
  import { attrKind, enumOptions } from '../attrKinds';
  import { fmt } from '../../engine/num';
  import Icon from './Icon.svelte';
  import NumberField from './NumberField.svelte';
  import ColorInput from './ColorInput.svelte';
  import FontPicker from './FontPicker.svelte';
  import { documentColors } from '../../engine/style';

  let { app }: { app: AppState } = $props();
  const ed = $derived(app.editor);
  const v = $derived(app.view);
  const one = $derived(v.selection.length === 1 ? v.selection[0] : null);
  const attrs = $derived.by(() => {
    void v;
    return one ? Array.from(one.attributes).map((a) => ({ name: a.name, value: a.value, kind: attrKind(a.name, a.value) })) : [];
  });
  const swatches = $derived.by(() => { void v; return ed.doc ? documentColors(ed.doc, 16) : []; });
  /** Definition ids an attribute value points at (url(#id) / #id). */
  const refsIn = (name: string, value: string) => {
    const ids = new Set<string>();
    if ((name === 'href' || name === 'xlink:href') && value.trim().startsWith('#')) ids.add(value.trim().slice(1));
    for (const m of value.matchAll(/url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/g)) ids.add(m[1]);
    return [...ids].filter((id) => ed.doc?.querySelector(`[id="${CSS.escape(id)}"]`));
  };
  const changed = $derived.by(() => { void v; return (one && ed.lastChanged.get(one)) || new Set<string>(); });

  let newName = $state('');
  let newValue = $state('');
  let error = $state('');
  const NAME = /^[A-Za-z_][\w.-]*(:[A-Za-z_][\w.-]*)?$/;

  const set = (name: string, value: string | null, live = false) => {
    if (one) ed.applyPatches([[one, { [name]: value }]], value === null ? `Remove ${name}` : `Set ${name}`, live);
  };
  function add(e: SubmitEvent) {
    e.preventDefault();
    const n = newName.trim();
    if (!NAME.test(n)) { error = 'Invalid attribute name'; return; }
    if (/^on/i.test(n)) { error = 'Event handler attributes are not allowed'; return; }
    error = '';
    set(n, newValue);
    newName = ''; newValue = '';
  }
  /** Rows for a textarea: grows with the value, up to 6 lines. */
  const rows = (s: string) => Math.min(6, Math.max(2, Math.ceil(s.length / 28)));
</script>

{#if one}
  <div class="sec">
    <h4 class="sec-title">Attributes</h4>
    <table class="attrs">
      <tbody>
        {#each attrs as a (a.name)}
          <tr class:changed={changed.has(a.name)} class:long={a.kind.kind === 'long'}>
            <th title={a.name}>{a.name}</th>
            <td>
              {#if a.kind.kind === 'number'}
                <NumberField label={a.name} value={parseFloat(a.value)} step={a.kind.step} min={a.kind.min} max={a.kind.max}
                  digits={app.settings.precision} onchange={(n, live) => set(a.name, fmt(n), live)} />
              {:else if a.kind.kind === 'color'}
                <ColorInput label={a.name} value={a.value} {swatches} onchange={(c, live) => set(a.name, c, live)} />
              {:else if a.kind.kind === 'font'}
                <FontPicker {app} label={a.name} value={a.value} onchange={(f) => set(a.name, f)} />
              {:else if a.kind.kind === 'enum'}
                <select aria-label="{a.name} value" value={a.value} onchange={(e) => set(a.name, e.currentTarget.value)}>
                  {#each enumOptions(a.kind.options, a.value) as o (o)}<option value={o}>{o}</option>{/each}
                </select>
              {:else if a.kind.kind === 'long'}
                <textarea class="mono" aria-label="{a.name} value" rows={rows(a.value)} spellcheck="false" value={a.value}
                  onchange={(e) => set(a.name, e.currentTarget.value)}></textarea>
              {:else}
                <input type="text" class="mono" aria-label="{a.name} value" value={a.value} spellcheck="false"
                  onchange={(e) => set(a.name, e.currentTarget.value)} />
              {/if}
            </td>
            <td class="x">
              {#each refsIn(a.name, a.value) as id (id)}
                <button type="button" class="icon go" title="Go to #{id}" aria-label="Go to #{id}" onclick={() => ed.goToDefinition(one, id)}>
                  <Icon name="go-to" size={13} />
                </button>
              {/each}
              <button type="button" class="icon" title="Remove {a.name}" aria-label="Remove {a.name}" onclick={() => set(a.name, null)}>
                <Icon name="close" size={13} />
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    <form class="add" onsubmit={add}>
      <input type="text" class="mono" placeholder="name" aria-label="New attribute name" bind:value={newName} spellcheck="false" />
      <input type="text" class="mono" placeholder="value" aria-label="New attribute value" bind:value={newValue} spellcheck="false" />
      <button type="submit" disabled={!newName.trim()}>Add</button>
    </form>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
  </div>
{:else if v.selection.length > 1}
  <div class="sec"><p class="muted">Select one shape to edit its attributes.</p></div>
{/if}

<style>
  .attrs { width: 100%; border-collapse: collapse; font: 12px var(--mono); table-layout: fixed; }
  .attrs th {
    width: 106px; text-align: left; font-weight: 500; color: var(--c-muted); padding: 3px 6px 3px 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle;
  }
  .attrs tr.long th { vertical-align: top; padding-top: 7px; }
  .attrs td { padding: 2px 0; vertical-align: middle; }
  .attrs td.x { width: 26px; text-align: right; white-space: nowrap; }
  .attrs tr:has(.go) td.x { width: 50px; }
  .attrs .icon.go { opacity: 0.9; color: var(--c-accent-strong); }
  .attrs input[type='text'], .attrs select, .attrs textarea, .attrs :global(input[type='number']) {
    width: 100%; height: 26px; font: 11.5px var(--mono);
  }
  .attrs textarea { height: auto; resize: vertical; line-height: 1.4; padding: 4px 6px; word-break: break-all; }
  .attrs tr.changed th { background: var(--c-changed); }
  .attrs .icon { padding: 3px; opacity: 0.5; }
  .attrs tr:hover .icon { opacity: 1; }
  .add { display: flex; gap: 4px; margin-top: 10px; }
  .add input { flex: 1; min-width: 0; height: 26px; }
  .err { color: var(--c-danger); font-size: 12px; margin: 4px 0 0; }
</style>
