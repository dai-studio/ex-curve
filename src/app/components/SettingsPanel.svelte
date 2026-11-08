<script lang="ts">
  // Settings: a collapsible section at the bottom of the right panel, like Layers and Definitions.
  import type { AppState } from '../state.svelte';
  import SectionHeader from './SectionHeader.svelte';

  let { app }: { app: AppState } = $props();
  let open = $state(false);
</script>

<section class="settings" aria-label="Settings">
  <SectionHeader title="Settings" {open} ontoggle={() => (open = !open)} />
  {#if open}
    <div class="body">
      <label>Precision (decimals)
        <input type="number" min="0" max="8" value={app.settings.precision}
          onchange={(e) => app.setSetting('precision', Number(e.currentTarget.value))} />
      </label>
      <label>Grid size
        <input type="number" min="1" value={app.settings.grid}
          onchange={(e) => app.setSetting('grid', Number(e.currentTarget.value))} />
      </label>
    </div>
  {/if}
</section>

<style>
  .settings { flex: none; border-top: 1px solid var(--c-border); }
  .body { padding: 2px 12px 10px; }
  label { display: flex; justify-content: space-between; align-items: center; margin: 6px 0; color: var(--c-text-2); font-size: 12px; }
  /* More specific than the panel-wide number-input rule (width: 100%). */
  .body label input[type='number'] { width: 72px; height: 26px; flex: none; }
</style>
