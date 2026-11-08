import { Editor, type MenuItem } from './editor/editor';
import { settings as numSettings, fmt } from './num';
import { SAMPLE } from './sample';

const $ = <T extends Element>(sel: string) => document.querySelector(sel) as T;
const stage = $<HTMLElement>('#stage');
const editor = new Editor(stage);
const inspector = $<HTMLElement>('#inspector');
const source = $<HTMLElement>('#source');
const statusMsg = $<HTMLElement>('#status-msg');
const statusPos = $<HTMLElement>('#status-pos');
const menu = $<HTMLElement>('#menu');
let fileName = 'drawing.svg';

function status(msg: string) { statusMsg.textContent = msg; }

function load(text: string, name: string) {
  try {
    editor.load(text);
    fileName = name;
    status(`Opened ${name}`);
  } catch (err) {
    status(`Could not open ${name}: ${(err as Error).message}`);
  }
}

function save() {
  if (!editor.doc) return;
  const blob = new Blob([editor.serialize()], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
  status(`Saved ${fileName}`);
}

// ---------------------------------------------------------------- inspector

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function renderInspector() {
  const sel = editor.selection;
  const scope = editor.scope && editor.scope !== editor.doc ? `<div class="scope">Inside &lt;${editor.scope.localName}&gt; · Esc to leave</div>` : '';
  if (!editor.doc) { inspector.innerHTML = '<p class="muted">No document.</p>'; return; }
  if (!sel.length) { inspector.innerHTML = `${scope}<p class="muted">Nothing selected. Click a shape to edit its points.</p>`; return; }
  if (sel.length > 1) { inspector.innerHTML = `${scope}<h3>${sel.length} shapes</h3>${pointsSummary()}`; return; }
  const el = sel[0];
  const changed = editor.lastChanged.get(el) ?? new Set();
  const rows = Array.from(el.attributes).map((a) =>
    `<tr class="${changed.has(a.name) ? 'changed' : ''}"><th>${esc(a.name)}</th><td>${esc(a.value)}</td></tr>`).join('');
  const kinds = editor.pointsOf(el).reduce<Record<string, number>>((m, p) => { m[p.kind] = (m[p.kind] ?? 0) + 1; return m; }, {});
  const summary = Object.entries(kinds).map(([k, n]) => `<span class="chip k-${k}">${n} ${k}</span>`).join(' ');
  inspector.innerHTML = `${scope}<h3>&lt;${esc(el.localName)}&gt;</h3>
    <div class="chips">${summary || '<span class="muted">Transform box only — double-click to enter</span>'}</div>
    <table class="attrs">${rows}</table>${pointsSummary()}`;
}

function pointsSummary(): string {
  const out: string[] = [];
  for (const [el, ids] of editor.selectedPoints) {
    const pts = editor.pointsOf(el).filter((p) => ids.has(p.id));
    for (const p of pts) out.push(`<li><code>${esc(p.id)}</code> ${p.kind} (${fmt(p.x, 2)}, ${fmt(p.y, 2)}) → ${p.attr.map(esc).join(', ')}</li>`);
  }
  return out.length ? `<h4>Selected points</h4><ul class="pts">${out.join('')}</ul>` : '';
}

let sourceTimer = 0;
function refresh() {
  renderInspector();
  $<HTMLButtonElement>('[data-cmd=undo]').disabled = !editor.history.canUndo;
  $<HTMLButtonElement>('[data-cmd=redo]').disabled = !editor.history.canRedo;
  $<HTMLButtonElement>('[data-cmd=to-path]').disabled = !editor.canConvert('path');
  $<HTMLButtonElement>('[data-cmd=to-ellipse]').disabled = !editor.canConvert('ellipse');
  $<HTMLButtonElement>('[data-cmd=delete]').disabled = !editor.selection.length;
  $<HTMLElement>('.zoom').textContent = `${Math.round(editor.zoom * 100)}%`;
  if (!source.hidden) {
    clearTimeout(sourceTimer);
    sourceTimer = window.setTimeout(() => { source.querySelector('pre')!.textContent = editor.serialize(); }, 120);
  }
}

editor.onChange = refresh;
editor.onStatus = status;
editor.onPointer = (p) => { statusPos.textContent = p ? `${fmt(p.x, 1)}, ${fmt(p.y, 1)}` : ''; };

// ---------------------------------------------------------------- context menu

editor.onMenu = (items: MenuItem[], x: number, y: number) => {
  menu.replaceChildren(...items.map((it) => {
    const b = document.createElement('button');
    b.textContent = (it.checked !== undefined ? (it.checked ? '✓ ' : ' ') : '') + it.label;
    b.disabled = !!it.disabled;
    b.onclick = () => { menu.hidden = true; it.run(); };
    return b;
  }));
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - r.width - 4)}px`;
  menu.style.top = `${Math.min(y, innerHeight - r.height - 4)}px`;
};
addEventListener('pointerdown', (e) => { if (!menu.contains(e.target as Node)) menu.hidden = true; }, true);
addEventListener('keydown', (e) => { if (e.key === 'Escape') menu.hidden = true; });

// ---------------------------------------------------------------- toolbar

const fileInput = $<HTMLInputElement>('#file');
fileInput.onchange = async () => {
  const f = fileInput.files?.[0];
  if (f) load(await f.text(), f.name);
  fileInput.value = '';
};

const commands: Record<string, () => void> = {
  open: () => fileInput.click(),
  save,
  sample: () => load(SAMPLE, 'sample.svg'),
  undo: () => editor.undo(),
  redo: () => editor.redo(),
  'to-path': () => editor.convert('path'),
  'to-ellipse': () => editor.convert('ellipse'),
  delete: () => editor.deleteSelection(),
  'zoom-in': () => { editor.zoomBy(1.25); refresh(); },
  'zoom-out': () => { editor.zoomBy(0.8); refresh(); },
  fit: () => { editor.zoomToFit(); refresh(); },
  source: () => { source.hidden = !source.hidden; $('[data-cmd=source]').classList.toggle('on', !source.hidden); refresh(); requestAnimationFrame(() => editor.render()); },
  copy: () => { navigator.clipboard?.writeText(editor.serialize()); status('Copied SVG source'); },
  help: () => $<HTMLDialogElement>('#help').showModal(),
};
document.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach((b) => {
  b.addEventListener('click', () => { commands[b.dataset.cmd!]?.(); stage.focus(); });
});

document.querySelectorAll<HTMLInputElement>('[data-set]').forEach((inp) => {
  inp.addEventListener('change', () => {
    const k = inp.dataset.set!;
    if (k === 'precision') numSettings.precision = Math.max(0, Math.min(8, Number(inp.value) || 0));
    else if (k === 'grid') editor.settings.grid = Math.max(1, Number(inp.value) || 10);
    else (editor.settings as Record<string, unknown>)[k] = inp.checked;
    editor.render();
  });
});

addEventListener('keydown', (e) => {
  const cmd = e.metaKey || e.ctrlKey;
  if (cmd && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  if (cmd && e.key.toLowerCase() === 'o') { e.preventDefault(); fileInput.click(); }
});

// Drag & drop an .svg onto the canvas.
stage.addEventListener('dragover', (e) => e.preventDefault());
stage.addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files[0];
  if (f) load(await f.text(), f.name);
});

load(SAMPLE, 'sample.svg');
