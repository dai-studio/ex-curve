<script lang="ts">
  import type { AppState } from '../state.svelte';
  import { TOOLS } from '../commands';
  import Icon from './Icon.svelte';

  let { app }: { app: AppState } = $props();
  const current = $derived(app.view.tool);

  // Roving focus: arrow keys move between tools (one tab stop for the whole rail).
  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    e.stopPropagation();
    const btns = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button')];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
  }
</script>

<div class="rail" aria-label="Tools" role="toolbar" tabindex="-1" aria-orientation="vertical" onkeydown={onKeydown}>
  {#each TOOLS as t (t.id)}
    <button
      type="button"
      class="tool"
      class:on={current === t.id}
      title="{t.label} ({t.key})"
      aria-label={t.label}
      aria-pressed={current === t.id}
      tabindex={current === t.id ? 0 : -1}
      onclick={() => app.editor.setTool(t.id)}>
      <Icon name={t.icon} size={20} />
    </button>
  {/each}
</div>

<style>
  .rail {
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    padding: 8px 0; background: var(--c-panel); border-right: 1px solid var(--c-border);
    overflow-y: auto; scrollbar-width: none;
  }
  .tool { width: 34px; height: 34px; justify-content: center; padding: 0; color: var(--c-text-2); }
  .tool.on { background: var(--c-accent-soft); color: var(--c-accent-strong); }
  @media (max-width: 720px) {
    .rail { flex-direction: row; padding: 0 6px; border-right: 0; border-bottom: 1px solid var(--c-border); overflow-x: auto; }
  }
</style>
