<script lang="ts">
  // Align / distribute / flip / z-order / group for the selection.
  import type { AppState } from '../state.svelte';
  import type { Command } from '../commands';
  import IconButton from './IconButton.svelte';

  let { app, cmd }: { app: AppState; cmd: Record<string, Command> } = $props();
  const v = $derived(app.view);
  const toPage = $derived(v.selection.length === 1);
</script>

<div class="arrange" role="toolbar" aria-label="Arrange">
  <div class="grp" title={toPage ? 'Aligns to the page' : 'Aligns to the selection'}>
    <IconButton command={cmd['align-left']} icon="align-left" tick={v} />
    <IconButton command={cmd['align-center']} icon="align-center" tick={v} />
    <IconButton command={cmd['align-right']} icon="align-right" tick={v} />
    <IconButton command={cmd['align-top']} icon="align-top" tick={v} />
    <IconButton command={cmd['align-middle']} icon="align-middle" tick={v} />
    <IconButton command={cmd['align-bottom']} icon="align-bottom" tick={v} />
  </div>
  <div class="grp">
    <IconButton command={cmd['distribute-h']} icon="distribute-h" tick={v} />
    <IconButton command={cmd['distribute-v']} icon="distribute-v" tick={v} />
    <IconButton command={cmd['flip-h']} icon="flip-h" tick={v} />
    <IconButton command={cmd['flip-v']} icon="flip-v" tick={v} />
    <IconButton command={cmd.front} icon="to-front" tick={v} />
    <IconButton command={cmd.back} icon="to-back" tick={v} />
    <IconButton command={cmd.group} icon="group" tick={v} />
    <IconButton command={cmd.ungroup} icon="ungroup" tick={v} />
  </div>
</div>

<style>
  .arrange { display: flex; flex-direction: column; gap: 2px; padding: 4px 8px 6px; border-bottom: 1px solid var(--c-border); }
  .grp { display: flex; justify-content: space-between; }
  .grp :global(button) { padding: 4px; color: var(--c-text-2); }
</style>
