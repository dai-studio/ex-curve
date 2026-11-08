<script lang="ts">
  // Keyboard shortcuts sheet. Shortcuts come from the command registry, grouped into sections
  // that flow across columns, so the whole sheet fits on screen without scrolling.
  import type { AppState } from '../state.svelte';
  import type { Command } from '../commands';

  let { app, commands }: { app: AppState; commands: Command[] } = $props();
  let dialog = $state<HTMLDialogElement>();

  $effect(() => {
    if (!dialog) return;
    if (app.showHelp && !dialog.open) dialog.showModal();
    else if (!app.showHelp && dialog.open) dialog.close();
  });

  /** Sections in display order; commands not listed land in "More". */
  const SECTIONS: [string, string[]][] = [
    ['Tools', ['tool-select', 'tool-rect', 'tool-ellipse', 'tool-line', 'tool-polygon', 'tool-star', 'tool-pen', 'tool-pencil', 'tool-text']],
    ['File', ['new', 'open', 'save', 'save-as', 'export']],
    ['Edit', ['undo', 'redo', 'cut', 'copy', 'paste', 'duplicate', 'delete', 'select-all']],
    ['Object', ['group', 'ungroup', 'front', 'forward', 'backward', 'back', 'flip-h', 'flip-v', 'edit-definition']],
    ['View', ['zoom-in', 'zoom-out', 'fit', 'toggle-snap', 'toggle-grid', 'palette', 'help']],
  ];

  const GESTURES: [string, string][] = [
    ['Click · Shift-click', 'Select · add to selection'],
    ['Drag a handle', 'Edit; hollow handles insert a point'],
    ['Marquee', 'Select shapes, or points of the selection'],
    ['Arrows · Shift', 'Nudge 1 · 10 px'],
    ['Double-click', 'Edit text · enter group or symbol · cycle node type'],
    ['Esc', 'Clear points · selection · leave group'],
    ['Shift while dragging', 'Keep proportions · 15° steps'],
    ['Alt while dragging', 'From the centre · break smooth node'],
    ['Ctrl while dragging', 'Bypass snapping'],
    ['Space-drag · wheel', 'Pan'],
    ['⌘/Ctrl-wheel · pinch', 'Zoom'],
    ['Drag a number field', 'Scrub (Shift ×10, Alt ×0.1)'],
    ['Right-click', 'Node type, arc flags, convert, go to definition'],
  ];

  /** Section titles per column (balanced so no column runs much longer than the others). */
  const COLUMNS = [['Tools', 'File'], ['Edit', 'View'], ['Object', 'More'], ['Mouse & canvas']];

  /** Short labels for the sheet ("Rectangle Tool" → "Rectangle"). */
  const short = (c: Command) => c.label.replace(/ Tool$/, '').replace(/…$/, '').replace(/\s*\(.*\)$/, '');

  const sections = $derived.by(() => {
    const byId = new Map(commands.filter((c) => c.keys && c.available?.() !== false).map((c) => [c.id, c]));
    const used = new Set<string>();
    const out = SECTIONS.map(([title, ids]) => {
      const items = ids.map((id) => byId.get(id)).filter((c): c is Command => !!c);
      items.forEach((c) => used.add(c.id));
      return { title, items };
    });
    const rest = [...byId.values()].filter((c) => !used.has(c.id));
    if (rest.length) out.push({ title: 'More', items: rest });
    return out.filter((s) => s.items.length);
  });
</script>

<dialog bind:this={dialog} onclose={() => { app.showHelp = false; }} aria-labelledby="curve-help-title">
  <header>
    <h2 id="curve-help-title">Keyboard shortcuts</h2>
    <form method="dialog"><button class="close" aria-label="Close">✕</button></form>
  </header>
  <div class="sheet">
    {#each COLUMNS as titles, i (i)}
      <div class="col">
        {#each titles as title (title)}
          {#if title === 'Mouse & canvas'}
            <section>
              <h3>{title}</h3>
              <dl>
                {#each GESTURES as [k, d] (k)}
                  <div class="row g"><dt>{k}</dt><dd>{d}</dd></div>
                {/each}
              </dl>
            </section>
          {:else}
            {#each sections.filter((x) => x.title === title) as sec (sec.title)}
              <section>
                <h3>{sec.title}</h3>
                <dl>
                  {#each sec.items as c (c.id)}
                    <div class="row"><dt>{short(c)}</dt><dd><kbd>{c.keys}</kbd></dd></div>
                  {/each}
                </dl>
              </section>
            {/each}
          {/if}
        {/each}
      </div>
    {/each}
  </div>
</dialog>

<style>
  dialog {
    background: var(--c-panel); color: var(--c-text);
    border: 1px solid var(--c-border); border-radius: 12px; box-shadow: var(--c-shadow);
    width: min(1060px, calc(100vw - 32px)); max-height: calc(100vh - 32px); padding: 16px 20px 18px;
  }
  dialog::backdrop { background: rgb(15 23 42 / 0.35); }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  h2 { margin: 0; font-size: 16px; }
  .close { padding: 4px 8px; color: var(--c-muted); }
  /* Four balanced columns; two on narrower windows, one on phones. */
  .sheet { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0 28px; align-items: start; }
  @media (max-width: 900px) { .sheet { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 560px) { .sheet { grid-template-columns: minmax(0, 1fr); } }
  section { margin: 0 0 14px; }
  h3 {
    margin: 0 0 4px; padding-bottom: 3px; border-bottom: 1px solid var(--c-border);
    font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--c-muted);
  }
  dl { margin: 0; }
  .row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 2px 0; font-size: 12.5px; }
  dt { color: var(--c-text-2); }
  dd { margin: 0; white-space: nowrap; }
  /* Gestures: key and description run together on one line where they fit. */
  .row.g { display: block; padding: 2px 0; font-size: 12px; line-height: 1.45; }
  .row.g dt, .row.g dd { display: inline; }
  .row.g dt { font-weight: 600; color: var(--c-text); margin-right: 6px; }
  .row.g dd { white-space: normal; color: var(--c-text-2); }
  kbd { font-size: 11px; }
</style>
