<script lang="ts">
  // Native <dialog> modal: focus trapping, Esc to close and backdrop come from the platform.
  import type { Snippet } from 'svelte';

  interface Props { open: boolean; title: string; onclose: () => void; children: Snippet; actions?: Snippet; width?: number }
  let { open, title, onclose, children, actions, width = 440 }: Props = $props();
  let dialog = $state<HTMLDialogElement>();
  const id = `curve-modal-${Math.random().toString(36).slice(2, 8)}`;

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });
</script>

<dialog bind:this={dialog} aria-labelledby={id} style:width="min({width}px, calc(100vw - 32px))"
  onclose={() => { if (open) onclose(); }}
  onclick={(e) => { if (e.target === dialog) onclose(); }}>
  <h2 {id}>{title}</h2>
  <div class="body">{@render children()}</div>
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</dialog>

<style>
  dialog {
    background: var(--c-panel); color: var(--c-text);
    border: 1px solid var(--c-border); border-radius: 12px; box-shadow: var(--c-shadow);
    padding: 20px 22px;
  }
  dialog::backdrop { background: rgb(15 23 42 / 0.35); }
  h2 { margin: 0 0 14px; font-size: 16px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
  .actions :global(button) { padding: 6px 14px; border: 1px solid var(--c-border-strong); }
  .actions :global(button.primary) { border: 0; }
</style>
