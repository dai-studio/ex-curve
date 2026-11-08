// src/main.ts — the standalone Curve web app: the embeddable editor plus the web host.
import { mountCurve } from './embed';
import { WebHost } from './host/web';

const web = new WebHost();
const target = document.getElementById('app')!;
const restored = await web.restore();

const handle = mountCurve({
  target,
  // First visit: a blank page under the welcome screen. Later visits: the autosaved working copy.
  svg: restored?.svg,
  displayName: restored?.name,
  welcome: !restored,
  host: { kind: 'web', saveFile: web.saveFile, recentFiles: web.recentFiles },
  callbacks: {
    onOpen: web.open,
    onSave: web.save,
    onSaveAs: web.saveAs,
    onChange: web.onChange,
    onDirtyChange: web.onChange, // persist the saved/unsaved state with the working copy
    onDocumentReplaced: web.onDocumentReplaced,
    onDocMetaChange: web.onDocMetaChange,
  },
});
web.attach(handle, restored);
web.enableDrop(target);

// Dev-only: ?select=<css selector>&tool=<id> to open the app in a given state (headless screenshots).
if (import.meta.env.DEV) {
  const q = new URLSearchParams(location.search);
  const app = (globalThis as Record<string, unknown>).__curve as import('./app/state.svelte').AppState | undefined;
  const sel = q.get('select'), tool = q.get('tool');
  if (app?.editor.doc && sel) app.editor.select(Array.from(app.editor.doc.querySelectorAll(sel)));
  if (app && tool) app.editor.setTool(tool as import('./engine/tools').ToolId);
}
