<script lang="ts">
  import type { AppState } from '../state.svelte';
  import Modal from './Modal.svelte';

  let { app }: { app: AppState } = $props();
  const c = $derived(app.confirmState);
  function answer(ok: boolean) {
    const s = app.confirmState;
    app.confirmState = null;
    s?.resolve(ok);
  }
</script>

<Modal open={!!c} title={c?.title ?? ''} onclose={() => answer(false)} width={400}>
  <p>{c?.message}</p>
  {#snippet actions()}
    <button type="button" onclick={() => answer(false)}>Cancel</button>
    <button type="button" class="primary" onclick={() => answer(true)}>{c?.ok}</button>
  {/snippet}
</Modal>

<style>
  p { margin: 0; color: var(--c-text-2); }
</style>
