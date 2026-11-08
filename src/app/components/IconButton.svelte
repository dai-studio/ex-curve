<script lang="ts">
  // A toolbar button bound to a registered command: icon, tooltip with shortcut, enabled state.
  import type { Command } from '../commands';
  import type { IconName } from '../icons';
  import Icon from './Icon.svelte';

  interface Props {
    command: Command;
    icon: IconName;
    /** Re-evaluate enabled() when this changes (the app view snapshot). */
    tick: unknown;
    on?: boolean;
    label?: boolean;
  }
  let { command, icon, tick, on = false, label = false }: Props = $props();
  const enabled = $derived.by(() => {
    void tick;
    return command.enabled?.() !== false;
  });
  const title = $derived(command.keys ? `${command.label} (${command.keys})` : command.label);
</script>

{#if command.available?.() !== false}
  <button
    type="button"
    class:icon={!label}
    class:on
    disabled={!enabled}
    {title}
    aria-label={command.label}
    aria-pressed={on || undefined}
    onclick={() => command.run()}>
    <Icon name={icon} />
    {#if label}<span>{command.label}</span>{/if}
  </button>
{/if}
