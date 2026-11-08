// src/host/web.ts
// The standalone web host: all file I/O for the browser.
// - File System Access API (Chromium): Open keeps the file handle, so ⌘S writes back to the
//   same file; Save As / Export use the native save dialog. Other browsers fall back to a file
//   input and downloads.
// - The working copy is autosaved to IndexedDB (debounced) and restored on reload, including
//   its file handle and dirty state.
// - Recent files (handles) are kept in IndexedDB for the welcome screen.
// - Installed as a PWA, .svg files opened from the OS arrive through the Launch Queue.
import { downloadBlob, type CurveDocMeta, type CurveHandle, type CurveRecent, type CurveSnapshot } from '../embed';
import { idbDel, idbGet, idbSet } from './idb';

const SVG_TYPE = { description: 'SVG image', accept: { 'image/svg+xml': ['.svg'] } };
const PNG_TYPE = { description: 'PNG image', accept: { 'image/png': ['.png'] } };
const AUTOSAVE_MS = 600;
const MAX_RECENT = 8;

interface WorkingCopy { svg: string; name: string; dirty: boolean; file: FileSystemFileHandle | null; savedAt: number }
interface RecentEntry { name: string; file: FileSystemFileHandle; openedAt: number }

const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError';

export class WebHost {
  private handle: CurveHandle | null = null;
  private file: FileSystemFileHandle | null = null;
  private input: HTMLInputElement;
  private timer = 0;
  private name = 'Untitled.svg';
  /** True while this host is loading a document itself (keeps the file handle). */
  private loading = false;
  readonly fsAccess = typeof window !== 'undefined' && !!window.showOpenFilePicker;

  constructor() {
    this.input = document.createElement('input');
    this.input.type = 'file';
    this.input.accept = '.svg,image/svg+xml';
    this.input.hidden = true;
    this.input.addEventListener('change', async () => {
      const f = this.input.files?.[0];
      this.input.value = '';
      if (f) this.loadText(await f.text(), f.name, null);
    });
    document.body.appendChild(this.input);
    addEventListener('beforeunload', (e) => {
      if (this.handle?.isDirty) { this.flush(); e.preventDefault(); }
    });
    addEventListener('pagehide', () => this.flush());
  }

  /** The autosaved working copy from a previous session, if any. */
  async restore(): Promise<WorkingCopy | null> {
    // Never let storage hold up startup (some private modes leave IndexedDB requests pending).
    const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), 1500));
    const w = await Promise.race([idbGet<WorkingCopy>('working'), timeout]);
    return w && typeof w.svg === 'string' ? w : null;
  }

  attach(handle: CurveHandle, restored: WorkingCopy | null): void {
    this.handle = handle;
    if (restored) {
      this.file = restored.file;
      if (restored.dirty) handle.markDirty();
    }
    window.launchQueue?.setConsumer((params) => { const f = params.files[0]; if (f) void this.openHandle(f); });
  }

  // ---------------------------------------------------------------- callbacks for mountCurve

  onDocumentReplaced = (): void => {
    if (!this.loading) this.file = null;
    this.scheduleAutosave();
  };

  onChange = (): void => this.scheduleAutosave();

  onDocMetaChange = (m: CurveDocMeta): void => {
    this.name = m.name;
    document.title = `${m.name} — Curve`;
  };

  open = async (): Promise<void> => {
    if (!window.showOpenFilePicker) { this.input.click(); return; }
    try {
      const [h] = await window.showOpenFilePicker({ types: [SVG_TYPE], id: 'curve-open' });
      if (h) await this.openHandle(h);
    } catch (e) {
      if (!isAbort(e)) this.handle?.setSaveState('error', `Could not open: ${(e as Error).message}`);
    }
  };

  save = async (snap: CurveSnapshot): Promise<void> => {
    if (!this.file) return this.saveAs(snap);
    const h = this.handle!;
    h.setSaveState('saving');
    try {
      if (!(await this.writable(this.file))) { h.setSaveState('error', 'Permission to write the file was denied'); return; }
      await this.write(this.file, snap.svg);
      h.setSaveState('saved', undefined, snap.revision);
      void this.addRecent(this.file);
      this.scheduleAutosave();
    } catch (e) {
      h.setSaveState('error', (e as Error).message);
    }
  };

  saveAs = async (snap: CurveSnapshot): Promise<void> => {
    const h = this.handle!;
    const name = this.currentName();
    if (!window.showSaveFilePicker) {
      downloadBlob(new Blob([snap.svg], { type: 'image/svg+xml' }), name);
      h.setSaveState('saved', undefined, snap.revision);
      return;
    }
    try {
      const file = await window.showSaveFilePicker({ suggestedName: name, types: [SVG_TYPE], id: 'curve-save' });
      h.setSaveState('saving');
      await this.write(file, snap.svg);
      this.file = file;
      h.setDisplayName(file.name);
      h.setSaveState('saved', undefined, snap.revision);
      void this.addRecent(file);
      this.scheduleAutosave();
    } catch (e) {
      if (!isAbort(e)) h.setSaveState('error', (e as Error).message);
    }
  };

  /** Export target (PNG / minified SVG). */
  saveFile = async (blob: Blob, suggestedName: string): Promise<void> => {
    if (!window.showSaveFilePicker) { downloadBlob(blob, suggestedName); return; }
    const type = blob.type === 'image/png' ? PNG_TYPE : SVG_TYPE;
    const file = await window.showSaveFilePicker({ suggestedName, types: [type], id: 'curve-export' });
    await this.write(file, blob);
  };

  recentFiles = async (): Promise<CurveRecent[]> => {
    const list = (await idbGet<RecentEntry[]>('recent')) ?? [];
    return list.map((r) => ({ name: r.name, openedAt: r.openedAt, open: () => void this.openRecent(r) }));
  };

  /** Accept .svg files dropped anywhere on `target`. */
  enableDrop(target: HTMLElement): void {
    target.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
    target.addEventListener('drop', async (e) => {
      const item = e.dataTransfer?.items[0];
      const f = e.dataTransfer?.files[0];
      if (!f || !(f.type === 'image/svg+xml' || /\.svg$/i.test(f.name))) return;
      e.preventDefault();
      const h = await item?.getAsFileSystemHandle?.().catch(() => null);
      if (h && h.kind === 'file') await this.openHandle(h as FileSystemFileHandle);
      else this.loadText(await f.text(), f.name, null);
    });
  }

  // ---------------------------------------------------------------- internals

  private currentName(): string { return this.name || 'Untitled.svg'; }

  private loadText(text: string, name: string, file: FileSystemFileHandle | null): boolean {
    this.loading = true;
    try {
      const ok = !!this.handle?.load(text, name);
      if (ok) this.file = file;
      return ok;
    } finally {
      this.loading = false;
    }
  }

  private async openHandle(h: FileSystemFileHandle): Promise<void> {
    const f = await h.getFile();
    if (this.loadText(await f.text(), f.name, h)) void this.addRecent(h);
  }

  private async openRecent(r: RecentEntry): Promise<void> {
    try {
      if (r.file.requestPermission && (await r.file.requestPermission({ mode: 'read' })) !== 'granted') return;
      await this.openHandle(r.file);
    } catch {
      // The file moved or was deleted: forget it.
      const list = ((await idbGet<RecentEntry[]>('recent')) ?? []).filter((x) => x !== r && x.openedAt !== r.openedAt);
      await idbSet('recent', list);
      this.handle?.setSaveState('error', `${r.name} is no longer available`);
    }
  }

  private async addRecent(file: FileSystemFileHandle): Promise<void> {
    const list = (await idbGet<RecentEntry[]>('recent')) ?? [];
    const rest: RecentEntry[] = [];
    for (const r of list) if (!(await r.file.isSameEntry(file).catch(() => false))) rest.push(r);
    await idbSet('recent', [{ name: file.name, file, openedAt: Date.now() }, ...rest].slice(0, MAX_RECENT));
  }

  private async writable(file: FileSystemFileHandle): Promise<boolean> {
    if (!file.queryPermission) return true;
    if ((await file.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
    return (await file.requestPermission?.({ mode: 'readwrite' })) === 'granted';
  }

  private async write(file: FileSystemFileHandle, data: string | Blob): Promise<void> {
    const w = await file.createWritable();
    await w.write(data);
    await w.close();
  }

  private scheduleAutosave(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), AUTOSAVE_MS);
  }

  /** Write the working copy now. */
  private flush(): void {
    clearTimeout(this.timer);
    const h = this.handle;
    if (!h) return;
    const copy: WorkingCopy = { svg: h.getSvg(), name: this.currentName(), dirty: h.isDirty, file: this.file, savedAt: Date.now() };
    void idbSet('working', copy);
  }

  /** Forget the working copy (e.g. after the user starts over). */
  clear(): Promise<void> { return idbDel('working'); }
}
