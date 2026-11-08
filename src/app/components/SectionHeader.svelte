<script lang="ts">
  // Header for the right panel's collapsible sections (Layers, Definitions, Settings): full-width
  // toggle with a rotating chevron, small uppercase title and an optional count on the right.
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  interface Props {
    title: string;
    open: boolean;
    ontoggle: () => void;
    count?: string | number;
    /** Extra content after the title (e.g. the definition being edited). */
    extra?: Snippet;
  }
  let { title, open, ontoggle, count, extra }: Props = $props();
</script>

<button type="button" class="section-head" aria-expanded={open} onclick={ontoggle}>
  <span class="chev" class:closed={!open}><Icon name="chevron" size={14} /></span>
  <span>{title}{@render extra?.()}</span>
  {#if count !== undefined}<span class="count">{count}</span>{/if}
</button>

<style>
  .section-head {
    width: 100%; flex: none; border-radius: 0; padding: 7px 12px; justify-content: flex-start; gap: 6px;
    font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--c-muted);
  }
  .count { margin-left: auto; font-weight: 500; letter-spacing: 0; color: var(--c-faint); }
  .chev { display: inline-flex; transition: transform 0.12s; }
  .chev.closed { transform: rotate(-90deg); }
</style>
