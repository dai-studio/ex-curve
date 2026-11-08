// src/app/state.svelte.ts
// Bridges the framework-free engine (Editor events) to Svelte runes. Components read the
// `view` snapshot, which is replaced wholesale on every engine 'change', so templates that
// read live DOM elements (attributes, points) re-render after each edit.
import { Editor, type MenuItem } from '../engine/editor/editor';
import { settings as numSettings } from '../engine/num';
import type { Vec } from '../engine/model';
import type { ToolId } from '../engine/tools';
import { usersOf, type DefKind } from '../engine/defs';

export interface View {
  hasDoc: boolean;
  selection: Element[];
  /** Entered group (null at document root). */
  scope: Element | null;
  selectedPoints: [Element, string[]][];
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  canConvertPath: boolean;
  canConvertEllipse: boolean;
  zoom: number;
  size: { width: number; height: number };
  tool: ToolId;
  /** A tool has unfinished work (pen path in progress). */
  toolBusy: boolean;
  /** Definition (symbol / reusable shape) being edited on the canvas. */
  definition: { id: string; kind: DefKind; instances: number; throughInstance: boolean } | null;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** `snap` is the master switch; while the grid is shown, snapping includes the grid. */
export interface Settings { snap: boolean; showGrid: boolean; grid: number; precision: number }

function readTheme(): 'system' | 'light' | 'dark' {
  try {
    const t = localStorage.getItem('curve.theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export class AppState {
  readonly editor: Editor;
  /** The element the editor draws into; App places it in the layout. */
  readonly stage: HTMLElement;

  view = $state.raw<View>(this.empty());
  status = $state('');
  pointer = $state.raw<Vec | null>(null);
  menu = $state.raw<{ items: MenuItem[]; x: number; y: number } | null>(null);
  fileName = $state('Untitled.svg');
  dirty = $state(false);
  saveState = $state<SaveState>('idle');
  saveError = $state<string | undefined>(undefined);
  showSource = $state(false);
  showHelp = $state(false);
  /** Open modal dialog. */
  dialog = $state<'new' | 'export' | 'about' | null>(null);
  showPalette = $state(false);
  showWelcome = $state(false);
  theme = $state<'system' | 'light' | 'dark'>(readTheme());
  /** Pending confirmation (see confirm()). */
  confirmState = $state.raw<{ title: string; message: string; ok: string; resolve: (ok: boolean) => void } | null>(null);
  settings = $state<Settings>({ snap: true, showGrid: false, grid: 10, precision: 3 });

  /** Host-provided installed fonts (DAI Studio desktop); otherwise the browser API is used. */
  listFonts?: () => Promise<string[]>;

  private unsubs: (() => void)[] = [];

  constructor() {
    this.stage = document.createElement('section');
    this.stage.className = 'curve-stage';
    this.stage.tabIndex = 0;
    this.stage.setAttribute('aria-label', 'Drawing canvas');
    this.editor = new Editor(this.stage);
    const e = this.editor;
    this.unsubs.push(
      e.on('change', () => this.refresh()),
      e.on('status', (m) => { this.status = m; }),
      e.on('pointer', (p) => { this.pointer = p; }),
      e.on('menu', (items, x, y) => { this.menu = { items, x, y }; }),
      e.on('dirty', (d) => { this.dirty = d; if (d) this.saveState = 'idle'; }),
    );
    this.applySettings();
    // Dev-only handle for debugging and browser-driven tests.
    if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__curve = this;
  }

  private empty(): View {
    return {
      hasDoc: false, selection: [], scope: null, selectedPoints: [], canUndo: false, canRedo: false,
      canConvertPath: false, canConvertEllipse: false, zoom: 1, size: { width: 0, height: 0 },
      tool: 'select', toolBusy: false, definition: null,
    };
  }

  refresh(): void {
    const e = this.editor;
    this.view = {
      hasDoc: !!e.doc,
      selection: [...e.selection],
      scope: e.scope && e.scope !== e.doc ? e.scope : null,
      selectedPoints: [...e.selectedPoints].map(([el, ids]) => [el, [...ids]]),
      canUndo: e.history.canUndo,
      canRedo: e.history.canRedo,
      undoLabel: e.history.undoLabel,
      redoLabel: e.history.redoLabel,
      canConvertPath: e.canConvert('path'),
      canConvertEllipse: e.canConvert('ellipse'),
      zoom: e.zoom,
      size: e.size,
      tool: e.tool,
      toolBusy: e.toolBusy,
      definition: e.definition && e.doc
        ? { id: e.definition.target.id, kind: e.definition.kind, instances: usersOf(e.doc, e.definition.target.id).length, throughInstance: !!e.definition.instance }
        : null,
    };
  }

  /** Ask the user to confirm in an in-app dialog. */
  confirm(title: string, message: string, ok = 'Discard'): Promise<boolean> {
    this.confirmState?.resolve(false);
    return new Promise((resolve) => { this.confirmState = { title, message, ok, resolve }; });
  }

  /** Confirm before replacing a document with unsaved changes. */
  async confirmDiscard(): Promise<boolean> {
    if (!this.editor.isDirty) return true;
    return this.confirm('Discard unsaved changes?', `${this.fileName} has changes that haven't been saved.`);
  }

  setTheme(t: 'system' | 'light' | 'dark'): void {
    this.theme = t;
    try { localStorage.setItem('curve.theme', t); } catch { /* storage unavailable */ }
  }

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.settings[key] = value;
    this.applySettings();
    this.editor.render();
  }

  private applySettings(): void {
    const s = this.settings;
    numSettings.precision = Math.max(0, Math.min(8, Math.round(s.precision) || 0));
    Object.assign(this.editor.settings, { snap: s.snap, showGrid: s.showGrid, grid: Math.max(1, s.grid || 10) });
  }

  destroy(): void {
    for (const u of this.unsubs) u();
    this.editor.destroy();
    this.stage.remove();
  }
}
