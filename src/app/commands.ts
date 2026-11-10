// src/app/commands.ts
// Every user command is registered once here, with its label, shortcut and enabled predicate.
// The top bar, menus, shortcut sheet and (later) the command palette all read this registry.
import type { AppState } from './state.svelte';
import type { CurveCallbacks, CurveHandle } from '../embed';
import { SAMPLE } from '../engine/sample';
import type { ToolId } from '../engine/tools';
import type { IconName } from './icons';
import { ZOOM_STEP } from './zoomNav';

export interface ToolDef { id: ToolId; label: string; key: string; icon: IconName; hint: string }

/** The tool rail, in display order. */
export const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', key: 'V', icon: 'select', hint: 'Select shapes and edit their points' },
  { id: 'hand', label: 'Hand', key: 'H', icon: 'hand', hint: 'Drag to move the canvas · Space-drag pans from any tool' },
  { id: 'rect', label: 'Rectangle', key: 'R', icon: 'rect', hint: 'Drag to draw · Shift square · Alt from centre' },
  { id: 'ellipse', label: 'Ellipse', key: 'E', icon: 'circle', hint: 'Drag to draw · Shift circle · Alt from centre' },
  { id: 'line', label: 'Line', key: 'L', icon: 'line', hint: 'Drag to draw · Shift 15° steps · Alt from centre' },
  { id: 'polygon', label: 'Polygon', key: 'Y', icon: 'polygon', hint: 'Drag from the centre · Shift 15° steps' },
  { id: 'star', label: 'Star', key: 'S', icon: 'star', hint: 'Drag from the centre · Shift 15° steps' },
  { id: 'pen', label: 'Pen', key: 'P', icon: 'pen', hint: 'Click corners, drag curves · click first point to close · Enter to finish' },
  { id: 'pencil', label: 'Pencil', key: 'N', icon: 'pencil', hint: 'Draw freehand · end at the start to close' },
  { id: 'text', label: 'Text', key: 'T', icon: 'text', hint: 'Click to type · click text to edit' },
];

export interface Command {
  id: string;
  label: string;
  /** Display form, e.g. "⌘S". */
  keys?: string;
  /** Matches the keyboard event; omitted when the engine handles the key itself. */
  match?: (e: KeyboardEvent) => boolean;
  enabled?: () => boolean;
  /** Hidden when the host does not support it (e.g. no onOpen callback). */
  available?: () => boolean;
  run: () => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl+';
const mod = (e: KeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey);
const key = (k: string, opts: { shift?: boolean } = {}) => (e: KeyboardEvent) =>
  mod(e) && !e.altKey && !!e.shiftKey === !!opts.shift && e.key.toLowerCase() === k;

export function createCommands(state: AppState, cb: CurveCallbacks, handle: CurveHandle): Command[] {
  const ed = state.editor;
  const v = () => state.view;
  const snapshot = () => handle.getSnapshot();
  const plainKey = (k: string) => (e: KeyboardEvent) =>
    !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === k.toLowerCase();
  const shiftKey = (k: string) => (e: KeyboardEvent) =>
    !e.metaKey && !e.ctrlKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === k.toLowerCase();
  const code = (c: string, opts: { shift?: boolean } = {}) => (e: KeyboardEvent) =>
    mod(e) && !e.altKey && !!e.shiftKey === !!opts.shift && e.code === c;
  const sel = () => v().selection.length;
  const toolCommands: Command[] = TOOLS.map((t) => ({
    id: `tool-${t.id}`, label: `${t.label} Tool`, keys: t.key, match: plainKey(t.key), run: () => ed.setTool(t.id),
  }));
  return [
    ...toolCommands,
    {
      id: 'new', label: 'New…', keys: `⌥${MOD}N`, match: (e) => mod(e) && e.altKey && e.code === 'KeyN',
      run: async () => { if (cb.onNew) cb.onNew(); else if (await state.confirmDiscard()) state.dialog = 'new'; },
    },
    {
      id: 'open', label: 'Open…', keys: `${MOD}O`, match: key('o'), available: () => !!cb.onOpen,
      run: async () => { if (await state.confirmDiscard()) cb.onOpen?.(); },
    },
    { id: 'export', label: 'Export…', keys: `⇧${MOD}E`, match: key('e', { shift: true }), enabled: () => v().hasDoc, run: () => { state.dialog = 'export'; } },
    {
      id: 'save', label: 'Save', keys: `${MOD}S`, match: key('s'), available: () => !!cb.onSave,
      enabled: () => v().hasDoc, run: () => cb.onSave?.(snapshot()),
    },
    {
      id: 'save-as', label: 'Save As…', keys: `⇧${MOD}S`, match: key('s', { shift: true }), available: () => !!cb.onSaveAs,
      enabled: () => v().hasDoc, run: () => cb.onSaveAs?.(snapshot()),
    },
    { id: 'sample', label: 'Open Sample', run: async () => { if (await state.confirmDiscard()) handle.load(SAMPLE, 'sample.svg'); } },
    // Keyboard copy/cut/paste go through clipboard events (App.svelte); these serve menus.
    { id: 'copy', label: 'Copy', keys: `${MOD}C`, enabled: () => sel() > 0, run: () => { const t = ed.copySelection(); if (t) void navigator.clipboard?.writeText(t); } },
    { id: 'cut', label: 'Cut', keys: `${MOD}X`, enabled: () => sel() > 0, run: () => { const t = ed.copySelection(); if (t) { void navigator.clipboard?.writeText(t); ed.deleteSelection(); } } },
    {
      id: 'paste', label: 'Paste', keys: `${MOD}V`, enabled: () => v().hasDoc,
      run: async () => {
        try { const t = await navigator.clipboard.readText(); if (!ed.paste(t)) state.status = 'The clipboard has no SVG.'; }
        catch { state.status = `Clipboard access was blocked; use ${MOD}V.`; }
      },
    },
    { id: 'undo', label: 'Undo', keys: `${MOD}Z`, enabled: () => v().canUndo, run: () => ed.undo() },
    { id: 'redo', label: 'Redo', keys: `⇧${MOD}Z`, enabled: () => v().canRedo, run: () => ed.redo() },
    { id: 'to-path', label: 'Convert to Path', enabled: () => v().canConvertPath, run: () => ed.convert('path') },
    { id: 'to-ellipse', label: 'Convert to Ellipse', enabled: () => v().canConvertEllipse, run: () => ed.convert('ellipse') },
    { id: 'delete', label: 'Delete', keys: '⌫', enabled: () => v().selection.length > 0, run: () => ed.deleteSelection() },
    { id: 'select-all', label: 'Select All', keys: `${MOD}A`, match: key('a'), enabled: () => v().hasDoc, run: () => ed.selectAll() },
    { id: 'duplicate', label: 'Duplicate', keys: `${MOD}D`, match: key('d'), enabled: () => sel() > 0, run: () => ed.duplicate() },
    { id: 'group', label: 'Group', keys: `${MOD}G`, match: key('g'), enabled: () => sel() > 0, run: () => ed.group() },
    { id: 'ungroup', label: 'Ungroup', keys: `⇧${MOD}G`, match: key('g', { shift: true }), enabled: () => (void v(), ed.canUngroup()), run: () => ed.ungroup() },
    { id: 'forward', label: 'Bring Forward', keys: `${MOD}]`, match: code('BracketRight'), enabled: () => sel() > 0, run: () => ed.zOrder('forward') },
    { id: 'backward', label: 'Send Backward', keys: `${MOD}[`, match: code('BracketLeft'), enabled: () => sel() > 0, run: () => ed.zOrder('backward') },
    { id: 'front', label: 'Bring to Front', keys: `⇧${MOD}]`, match: code('BracketRight', { shift: true }), enabled: () => sel() > 0, run: () => ed.zOrder('front') },
    { id: 'back', label: 'Send to Back', keys: `⇧${MOD}[`, match: code('BracketLeft', { shift: true }), enabled: () => sel() > 0, run: () => ed.zOrder('back') },
    { id: 'flip-h', label: 'Flip Horizontal', keys: '⇧H', match: shiftKey('h'), enabled: () => sel() > 0, run: () => ed.flip('x') },
    { id: 'flip-v', label: 'Flip Vertical', keys: '⇧V', match: shiftKey('v'), enabled: () => sel() > 0, run: () => ed.flip('y') },
    ...(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map((edge): Command => ({
      id: `align-${edge}`, label: `Align ${edge[0].toUpperCase()}${edge.slice(1)}`, enabled: () => sel() > 0, run: () => ed.align(edge),
    })),
    { id: 'distribute-h', label: 'Distribute Horizontally', enabled: () => sel() > 2, run: () => ed.distribute('x') },
    { id: 'distribute-v', label: 'Distribute Vertically', enabled: () => sel() > 2, run: () => ed.distribute('y') },
    {
      id: 'edit-definition', label: 'Edit Symbol / Definition', keys: '↵',
      match: (e) => e.key === 'Enter' && !mod(e) && !e.shiftKey && !e.altKey && ed.tool === 'select' && v().selection[0]?.localName === 'use',
      enabled: () => { const s = v().selection; return s.length === 1 && s[0].localName === 'use' && !v().definition; },
      run: () => { const s = v().selection[0]; if (s) ed.editDefinitionOf(s); },
    },
    {
      id: 'go-to-definition', label: 'Go to Definition',
      enabled: () => { const s = v().selection; return s.length === 1 && ed.definitionRefs(s[0]).length > 0; },
      run: () => ed.goToDefinition(),
    },
    { id: 'exit-definition', label: 'Done Editing Definition', enabled: () => !!v().definition, run: () => ed.exitDefinition() },
    { id: 'lock', label: 'Lock', enabled: () => sel() > 0, run: () => ed.setLocked(v().selection, true) },
    { id: 'hide', label: 'Hide', enabled: () => sel() > 0, run: () => ed.setHidden(v().selection, true) },
    { id: 'zoom-in', label: 'Zoom In', keys: `${MOD}+`, match: (e) => mod(e) && (e.key === '+' || e.key === '='), run: () => { ed.zoomTo(ed.zoom * ZOOM_STEP); state.refresh(); } },
    { id: 'zoom-out', label: 'Zoom Out', keys: `${MOD}−`, match: (e) => mod(e) && e.key === '-', run: () => { ed.zoomTo(ed.zoom / ZOOM_STEP); state.refresh(); } },
    { id: 'fit', label: 'Zoom to Fit', keys: `${MOD}0`, match: (e) => mod(e) && e.key === '0', run: () => { ed.zoomToFit(); state.refresh(); } },
    { id: 'source', label: 'Show Source', run: () => { state.showSource = !state.showSource; } },
    {
      id: 'copy-source', label: 'Copy SVG Source', enabled: () => v().hasDoc,
      run: () => { navigator.clipboard?.writeText(ed.serialize()); state.status = 'Copied SVG source'; },
    },
    { id: 'unlock-all', label: 'Unlock All', enabled: () => v().hasDoc, run: () => ed.unlockAll() },
    { id: 'toggle-snap', label: 'Snapping', keys: `⇧${MOD};`, match: code('Semicolon', { shift: true }), run: () => state.setSetting('snap', !state.settings.snap) },
    { id: 'toggle-grid', label: 'Show Grid (snaps when Snapping is on)', keys: `${MOD}'`, match: code('Quote'), run: () => state.setSetting('showGrid', !state.settings.showGrid) },
    { id: 'theme-system', label: 'Theme: System', run: () => state.setTheme('system') },
    { id: 'theme-light', label: 'Theme: Light', run: () => state.setTheme('light') },
    { id: 'theme-dark', label: 'Theme: Dark', run: () => state.setTheme('dark') },
    { id: 'palette', label: 'Command Palette', keys: `${MOD}K`, match: key('k'), run: () => { state.showPalette = true; } },
    { id: 'welcome', label: 'Welcome', run: () => { state.showWelcome = true; } },
    { id: 'about', label: 'About Curve', run: () => { state.dialog = 'about'; } },
    { id: 'help', label: 'Keyboard Shortcuts', keys: '?', match: (e) => e.key === '?' && !mod(e), run: () => { state.showHelp = true; } },
  ];
}

export function commandMap(cmds: Command[]): Record<string, Command> {
  return Object.fromEntries(cmds.map((c) => [c.id, c]));
}

/** Run the first command whose shortcut matches; returns true when handled. */
export function handleShortcut(cmds: Command[], e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return false;
  for (const c of cmds) {
    if (!c.match?.(e) || c.available?.() === false) continue;
    e.preventDefault();
    if (c.enabled?.() !== false) c.run();
    return true;
  }
  return false;
}

/** Menu bar layout: command ids, '-' for separators. */
export const MENUS: { label: string; items: string[] }[] = [
  { label: 'File', items: ['new', 'open', 'sample', 'welcome', '-', 'save', 'save-as', 'export', '-', 'copy-source'] },
  { label: 'Edit', items: ['undo', 'redo', '-', 'cut', 'copy', 'paste', 'duplicate', 'delete', '-', 'select-all'] },
  {
    label: 'Object',
    items: ['group', 'ungroup', '-', 'front', 'forward', 'backward', 'back', '-', 'align-left', 'align-center', 'align-right',
      'align-top', 'align-middle', 'align-bottom', 'distribute-h', 'distribute-v', '-', 'flip-h', 'flip-v', '-',
      'to-path', 'to-ellipse', '-', 'edit-definition', 'go-to-definition', 'exit-definition', '-', 'lock', 'unlock-all', 'hide'],
  },
  { label: 'View', items: ['zoom-in', 'zoom-out', 'fit', '-', 'toggle-snap', 'toggle-grid', 'source', '-', 'theme-system', 'theme-light', 'theme-dark'] },
  { label: 'Help', items: ['palette', 'help', '-', 'about'] },
];
