// src/embed.ts
// Public entry point: mount Curve into any element. The standalone app (main.ts) and DAI Studio
// use this same contract. The editor only works on SVG strings; the host owns all file I/O,
// mirroring DAI Studio's mountEditor()/EditorHandle. Keep these types plain interfaces:
// the embed build extracts them into curve-editor.d.ts.
import { flushSync, mount, unmount } from 'svelte';
import App from './app/App.svelte';
import { AppState } from './app/state.svelte';
import { SAMPLE } from './engine/sample';

export interface CurveSnapshot {
  svg: string;
  /** Pass back to setSaveState('saved', undefined, revision) once written. */
  revision: number;
}

export interface CurveDocMeta {
  name: string;
  width: number;
  height: number;
}

export interface CurveHost {
  kind: 'web' | 'desktop';
  /** Open a URL outside the editor (badge, help links). Defaults to window.open. */
  openUrl?(url: string): void;
  /** Save an exported file (PNG, minified SVG). Defaults to a browser download. */
  saveFile?(blob: Blob, suggestedName: string): Promise<void> | void;
  /** Recently opened files for the welcome screen. */
  recentFiles?(): Promise<CurveRecent[]>;
  /**
   * Installed font family names for the font picker. Desktop hosts can read them natively; when
   * omitted, the web Local Font Access API (Chromium) is used where available.
   */
  listFonts?(): Promise<string[]>;
}

export interface CurveRecent {
  name: string;
  /** Epoch ms. */
  openedAt: number;
  open(): void;
}

export interface CurveCallbacks {
  onReady?(handle: CurveHandle): void;
  onLoadError?(error: Error): void;
  onDirtyChange?(dirty: boolean): void;
  /** ⌘S / File › Save. The host writes the snapshot, then calls setSaveState. Omit to hide Save. */
  onSave?(snapshot: CurveSnapshot): void;
  /** ⇧⌘S / File › Save As. Omit to hide Save As. */
  onSaveAs?(snapshot: CurveSnapshot): void;
  /** ⌘O / File › Open. The host picks a file and calls handle.load. Omit to hide Open. */
  onOpen?(): void;
  /** File › New. Omit to use the built-in blank document. */
  onNew?(): void;
  onDocMetaChange?(meta: CurveDocMeta): void;
  /** Document content changed (edit, undo, redo). Use for autosave. */
  onChange?(): void;
  /** A different document replaced the current one ('new' blank document or 'loaded' markup). */
  onDocumentReplaced?(kind: 'new' | 'loaded'): void;
}

export interface CurveMountOptions {
  target: HTMLElement;
  /** Initial document. Omit for a blank document. */
  svg?: string;
  displayName?: string;
  host?: Partial<CurveHost>;
  callbacks?: CurveCallbacks;
  /** Hide the "Built with DAI Studio" badge (when embedded in DAI Studio itself). */
  noBadge?: boolean;
  /** Show the welcome screen on start. */
  welcome?: boolean;
}

export type CurveSaveState = 'saving' | 'saved' | 'error';

export interface CurveHandle {
  load(svg: string, name?: string): boolean;
  /** Start a blank document (user units = px). */
  newDocument(width?: number, height?: number, name?: string): void;
  getSvg(): string;
  getSnapshot(): CurveSnapshot;
  readonly isDirty: boolean;
  markDirty(): void;
  setSaveState(state: CurveSaveState, error?: string, revision?: number): void;
  setDisplayName(name: string): void;
  undo(): void;
  redo(): void;
  zoomToFit(): void;
  destroy(): void;
}

export const SAMPLE_SVG = SAMPLE;

/** Save a blob through a browser download. */
export function downloadBlob(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Mount the editor into `options.target`. */
export function mountCurve(options: CurveMountOptions): CurveHandle {
  const cb = options.callbacks ?? {};
  const host: CurveHost = {
    kind: options.host?.kind ?? 'web',
    openUrl: options.host?.openUrl ?? ((url) => { window.open(url, '_blank', 'noopener'); }),
    saveFile: options.host?.saveFile ?? downloadBlob,
    recentFiles: options.host?.recentFiles,
    listFonts: options.host?.listFonts,
  };
  const state = new AppState();
  state.listFonts = host.listFonts;
  const editor = state.editor;
  if (options.displayName) state.fileName = options.displayName;

  const meta = () => cb.onDocMetaChange?.({ name: state.fileName, ...editor.size });
  const unsubs = [
    editor.on('dirty', (d) => cb.onDirtyChange?.(d)),
    editor.on('doc', () => { meta(); cb.onChange?.(); }),
  ];

  const handle: CurveHandle = {
    load(svg, name) {
      let warning = '';
      try {
        warning = editor.load(svg);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        state.status = `Could not open ${name ?? 'document'}: ${e.message}`;
        cb.onLoadError?.(e);
        return false;
      }
      if (name) state.fileName = name;
      state.showWelcome = false;
      state.saveState = 'idle';
      state.status = warning || (name ? `Opened ${name}` : '');
      meta();
      cb.onDocumentReplaced?.('loaded');
      return true;
    },
    newDocument(width = 800, height = 600, name = 'Untitled.svg') {
      editor.newDocument(width, height);
      state.fileName = name;
      state.showWelcome = false;
      state.saveState = 'idle';
      state.status = '';
      meta();
      cb.onDocumentReplaced?.('new');
    },
    getSvg: () => editor.serialize(),
    getSnapshot: () => ({ svg: editor.serialize(), revision: editor.stateId }),
    get isDirty() { return editor.isDirty; },
    markDirty: () => editor.markDirty(),
    setSaveState(s, error, revision) {
      state.saveState = s;
      state.saveError = error;
      if (s === 'saved') { editor.markSaved(revision); state.status = `Saved ${state.fileName}`; }
      if (s === 'error') state.status = `Save failed: ${error ?? 'unknown error'}`;
    },
    setDisplayName(name) { state.fileName = name; meta(); },
    undo: () => editor.undo(),
    redo: () => editor.redo(),
    zoomToFit: () => editor.zoomToFit(),
    destroy() {
      for (const u of unsubs) u();
      unmount(app);
      state.destroy();
    },
  };

  const app = mount(App, {
    target: options.target,
    props: {
      app: state,
      host,
      callbacks: cb,
      handle,
      showBadge: !options.noBadge,
    },
  });
  flushSync();

  if (options.svg !== undefined) handle.load(options.svg, options.displayName);
  else handle.newDocument();
  if (options.welcome) state.showWelcome = true;
  cb.onReady?.(handle);
  return handle;
}
