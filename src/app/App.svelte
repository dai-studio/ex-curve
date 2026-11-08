<script lang="ts">
  // src/app/App.svelte — the editor shell. Talks to the engine only via AppState / Editor API.
  import type { AppState } from './state.svelte';
  import type { CurveCallbacks, CurveHandle, CurveHost } from '../embed';
  import { createCommands, commandMap, handleShortcut } from './commands';
  import TopBar from './components/TopBar.svelte';
  import Inspector from './components/Inspector.svelte';
  import SourcePanel from './components/SourcePanel.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import ContextMenu from './components/ContextMenu.svelte';
  import HelpDialog from './components/HelpDialog.svelte';
  import ToolRail from './components/ToolRail.svelte';
  import ToolOptions from './components/ToolOptions.svelte';
  import LayersPanel from './components/LayersPanel.svelte';
  import DefinitionsPanel from './components/DefinitionsPanel.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import ConfirmDialog from './components/ConfirmDialog.svelte';
  import NewDialog from './components/NewDialog.svelte';
  import ExportDialog from './components/ExportDialog.svelte';
  import CommandPalette from './components/CommandPalette.svelte';
  import AboutDialog from './components/AboutDialog.svelte';
  import Welcome from './components/Welcome.svelte';
  import ZoomNavigator from './components/ZoomNavigator.svelte';
  import DefinitionBar from './components/DefinitionBar.svelte';
  import { installScrub } from './scrub';
  import './theme.css';

  interface Props {
    app: AppState;
    host: CurveHost;
    callbacks: CurveCallbacks;
    handle: CurveHandle;
    showBadge: boolean;
  }
  let { app, host, callbacks, handle, showBadge }: Props = $props();

  // Props are fixed for the lifetime of a mount (see mountCurve), so capture them once.
  // svelte-ignore state_referenced_locally
  const commands = createCommands(app, callbacks, handle);
  const cmd = commandMap(commands);

  function placeStage(node: HTMLElement) {
    node.appendChild(app.stage);
  }

  function onKeydown(e: KeyboardEvent) {
    if (app.dialog || app.confirmState || app.showPalette) return; // modals own the keyboard
    handleShortcut(commands, e);
  }

  // ---- clipboard: real copy/cut/paste events need no permission prompt
  const editable = (t: EventTarget | null) =>
    t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  function onCopy(e: ClipboardEvent, cut = false) {
    if (editable(e.target) || app.dialog) return;
    const svg = app.editor.copySelection();
    if (!svg || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', svg);
    e.clipboardData.setData('image/svg+xml', svg);
    if (cut) app.editor.deleteSelection();
    app.status = cut ? 'Cut to clipboard' : 'Copied to clipboard';
  }
  function onPaste(e: ClipboardEvent) {
    if (editable(e.target) || app.dialog || !e.clipboardData) return;
    const dt = e.clipboardData;
    const image = Array.from(dt.files).find((f) => /^image\/(png|jpe?g|gif|webp|avif)$/.test(f.type));
    const text = dt.getData('image/svg+xml') || dt.getData('text/plain');
    e.preventDefault();
    if (text && app.editor.paste(text)) return;
    if (image) { void insertImage(image); return; }
    app.status = 'The clipboard has no SVG or image.';
  }
  async function insertImage(file: File) {
    const href = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
    const img = new Image();
    img.src = href;
    try { await img.decode(); } catch { app.status = `Could not read ${file.name}`; return; }
    app.editor.pasteImage(href, img.naturalWidth || 100, img.naturalHeight || 100);
  }
  /** Raster images dropped on the canvas are embedded; SVG files are left to the host (open). */
  function onDrop(e: DragEvent) {
    const f = e.dataTransfer?.files[0];
    if (!f || !/^image\/(png|jpe?g|gif|webp|avif)$/.test(f.type)) return;
    e.preventDefault();
    e.stopPropagation();
    void insertImage(f);
  }
</script>

<svelte:window onkeydown={onKeydown} oncopy={(e) => onCopy(e)} oncut={(e) => onCopy(e, true)} onpaste={onPaste} />

<div class="curve-app" data-theme={app.theme === 'system' ? undefined : app.theme} {@attach installScrub}>
  <TopBar {app} {cmd} {host} {showBadge} />
  <main class="curve-main" class:with-source={app.showSource}>
    <ToolRail {app} />
    <div class="curve-canvas" {@attach placeStage} role="presentation" ondragover={(e) => e.preventDefault()} ondrop={onDrop}>
      <ToolOptions {app} />
      <ZoomNavigator {app} />
      <DefinitionBar {app} />
      <Welcome {app} {cmd} {host} {handle} {showBadge} />
    </div>
    <aside class="curve-panel" aria-label="Inspector">
      <div class="curve-inspector-scroll"><Inspector {app} {cmd} /></div>
      <LayersPanel {app} />
      <DefinitionsPanel {app} />
      <SettingsPanel {app} />
    </aside>
    {#if app.showSource}
      <SourcePanel {app} {cmd} />
    {/if}
  </main>
  <StatusBar {app} />
  <ContextMenu {app} />
  <HelpDialog {app} {commands} />
  <NewDialog {app} {handle} />
  <ExportDialog {app} {host} />
  <ConfirmDialog {app} />
  <CommandPalette {app} {commands} />
  <AboutDialog {app} {host} />
</div>
