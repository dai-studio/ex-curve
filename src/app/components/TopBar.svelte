<script lang="ts">
  import type { AppState } from '../state.svelte';
  import type { Command } from '../commands';
  import type { CurveHost } from '../../embed';
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import MenuBar from './MenuBar.svelte';

  interface Props { app: AppState; cmd: Record<string, Command>; host: CurveHost; showBadge: boolean }
  let { app, cmd, host, showBadge }: Props = $props();
  const v = $derived(app.view);
</script>

<header class="topbar">
  <div class="brand">
    <svg class="logo" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="curve-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#4d47bd" /><stop offset="1" stop-color="#753cec" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="6" fill="url(#curve-logo-g)" />
      <path d="M5 17C8 6 16 18 19 7" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" />
      <circle cx="5" cy="17" r="1.6" fill="#fff" /><circle cx="19" cy="7" r="1.6" fill="#fff" />
    </svg>
    <span class="name">Curve</span>
  </div>
  <MenuBar {app} {cmd} />

  <div class="file" title={app.fileName}>
    <span class="file-name">{app.fileName}</span>
    {#if app.saveState === 'saving'}
      <span class="save muted">Saving…</span>
    {:else if app.saveState === 'error'}
      <span class="save error" title={app.saveError}>Save failed</span>
    {:else if app.dirty}
      <span class="dirty" title="Unsaved changes" aria-label="Unsaved changes"></span>
    {/if}
  </div>

  <div class="group">
    <IconButton command={cmd.new} icon="new" tick={v} />
    <IconButton command={cmd.open} icon="open" tick={v} />
    <IconButton command={cmd.save} icon="save" tick={v} />
  </div>
  <div class="group">
    <IconButton command={cmd.undo} icon="undo" tick={v} />
    <IconButton command={cmd.redo} icon="redo" tick={v} />
  </div>
  <div class="group">
    <IconButton command={cmd['to-path']} icon="to-path" tick={v} />
    <IconButton command={cmd['to-ellipse']} icon="ellipse" tick={v} />
    <IconButton command={cmd.delete} icon="delete" tick={v} />
  </div>
  <div class="group">
    <button type="button" class="icon" class:on={app.settings.snap} title="Snapping (objects, and the grid when shown) · Ctrl while dragging to bypass" aria-pressed={app.settings.snap} onclick={() => app.setSetting('snap', !app.settings.snap)}><Icon name="magnet" /></button>
    <button type="button" class="icon" class:on={app.settings.showGrid} title="Show grid" aria-pressed={app.settings.showGrid} onclick={() => app.setSetting('showGrid', !app.settings.showGrid)}><Icon name="grid" /></button>
  </div>

  <div class="spacer"></div>

  <div class="group">
    <IconButton command={cmd.source} icon="code" tick={v} on={app.showSource} />
    <IconButton command={cmd.help} icon="keyboard" tick={v} />
  </div>
  {#if showBadge}
    <a class="badge" href="https://dai.studio" target="_blank" rel="noopener"
      onclick={(e) => { e.preventDefault(); host.openUrl?.('https://dai.studio'); }}>
      Built with <strong>DAI Studio</strong>
    </a>
  {/if}
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: var(--c-panel);
    border-bottom: 1px solid var(--c-border);
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .brand { display: flex; align-items: center; gap: 8px; margin-right: 6px; flex: none; }
  .logo { width: 24px; height: 24px; display: block; }
  .name { font-weight: 700; font-size: 14px; letter-spacing: 0.01em; }
  .file {
    display: flex; align-items: center; gap: 6px; min-width: 0; max-width: 220px;
    padding: 0 10px; margin: 0 4px; border-left: 1px solid var(--c-border); border-right: 1px solid var(--c-border);
  }
  .file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--c-text-2); }
  .dirty { width: 7px; height: 7px; border-radius: 50%; background: var(--c-accent); flex: none; }
  .save { font-size: 12px; white-space: nowrap; }
  .save.error { color: var(--c-danger); }
  .group { display: flex; align-items: center; gap: 1px; padding: 0 4px; flex: none; }
  .group + .group { border-left: 1px solid var(--c-border); }
  .spacer { flex: 1; }
  .badge {
    flex: none;
    margin-left: 6px;
    font-size: 11.5px;
    color: var(--c-text-2);
    text-decoration: none;
    border: 1px solid var(--c-border);
    border-radius: 999px;
    padding: 3px 10px;
    white-space: nowrap;
  }
  .badge strong {
    background: var(--brand-gradient);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .badge:hover { border-color: var(--c-accent); }
</style>
