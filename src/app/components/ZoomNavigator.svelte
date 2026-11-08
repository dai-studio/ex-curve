<script lang="ts">
  /**
   * ZoomNavigator: always-open card in the canvas's bottom-left corner, ported from DAI Studio
   * (editor-src/src/lib/editor/ZoomNavigator.svelte).
   *
   *   - a minimap of the page and the document with a box for the current view: drag the box to
   *     pan, click elsewhere to jump. The document is drawn into a <canvas> (re-rendered debounced
   *     on changes): a thumbnail must not be the page's Largest Contentful Paint, and canvases
   *     aren't LCP candidates while SVG <image>s are. The SVG on top only holds the view box;
   *   - a full-width log-scale zoom slider below it (the zoom % is in its tooltip / aria-valuetext).
   *
   * The slider zooms with the selection centred (or around the view centre when nothing is
   * selected) — Editor.zoomTo. Any view change (wheel, keyboard, fit, panning) updates it.
   */
  import { onDestroy, untrack } from 'svelte';
  import type { AppState } from '../state.svelte';
  import type { Rect } from '../../engine/model';
  import { NAV_MAP_H, NAV_MAP_W, mapBounds, mapDeltaToCanvas, mapScale, mapToCanvas, sliderToZoom, zoomToSlider } from '../zoomNav';

  let { app }: { app: AppState } = $props();
  const ed = $derived(app.editor);
  const RERENDER_MS = 150;

  let zoom = $state(1);
  let view = $state<Rect>({ x: 0, y: 0, width: 1, height: 1 });
  let page = $state<Rect>({ x: 0, y: 0, width: 1, height: 1 });
  let bounds = $state<Rect>({ x: 0, y: 0, width: 1, height: 1 });
  /** The document, decoded once per change; painted into the canvas whenever the map moves. */
  let picture = $state.raw<HTMLImageElement | null>(null);
  let mapSvg = $state<SVGSVGElement | null>(null);
  let canvasEl = $state<HTMLCanvasElement | null>(null);
  /** Set while dragging the view box: map bounds stay frozen meanwhile. */
  let drag = $state<{ startX: number; startY: number; start: Rect; bounds: Rect } | null>(null);

  const percent = $derived(Math.round(zoom * 100));
  const sliderValue = $derived(zoomToSlider(zoom));

  function syncView() {
    zoom = ed.zoom;
    view = ed.viewRect;
    page = ed.pageRect;
    if (!drag) bounds = mapBounds(page, view);
  }

  /**
   * Decode the document as an image (an <img> renders SVG without running scripts, and its ids
   * can't clash with the canvas). Only the latest render is kept if several overlap.
   */
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  async function rerender() {
    timer = null;
    syncView();
    const gen = ++generation;
    if (!ed.doc) { picture = null; return; }
    const url = URL.createObjectURL(new Blob([ed.serialize()], { type: 'image/svg+xml' }));
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { /* unrenderable document: keep the page outline only */ }
    URL.revokeObjectURL(url);
    if (gen === generation) picture = img.complete && img.naturalWidth ? img : null;
  }

  /** Paint page and document into the canvas, in the same "meet" mapping as the SVG view box. */
  function paint() {
    const c = canvasEl;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (c.width !== NAV_MAP_W * dpr) { c.width = NAV_MAP_W * dpr; c.height = NAV_MAP_H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, NAV_MAP_W, NAV_MAP_H);
    const { scale, offsetX, offsetY } = mapScale(bounds, NAV_MAP_W, NAV_MAP_H);
    const x = (page.x - bounds.x) * scale + offsetX, y = (page.y - bounds.y) * scale + offsetY;
    const w = page.width * scale, h = page.height * scale;
    const css = getComputedStyle(c);
    ctx.fillStyle = css.getPropertyValue('--c-page').trim() || '#fff';
    ctx.fillRect(x, y, w, h);
    if (picture) ctx.drawImage(picture, x, y, w, h);
    ctx.strokeStyle = css.getPropertyValue('--c-border-strong').trim() || '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
  }
  $effect(() => { void bounds; void page; void picture; void canvasEl; void app.theme; paint(); });
  function scheduleRerender() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(rerender, RERENDER_MS);
  }

  $effect(() => {
    const e = ed;
    const offView = e.on('view', syncView);
    const offDoc = e.on('doc', () => { syncView(); scheduleRerender(); });
    // rerender() reads and writes component state; keep it out of this effect's dependencies.
    untrack(rerender);
    return () => { offView(); offDoc(); };
  });

  onDestroy(() => {
    if (timer) clearTimeout(timer);
    generation++;
    onDragEnd();
  });

  function onSlider(e: Event) {
    ed.zoomTo(sliderToZoom(parseFloat((e.currentTarget as HTMLInputElement).value)));
  }

  /** Pointer position relative to the map's top-left (px). */
  function mapPoint(e: PointerEvent) {
    const r = mapSvg?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  }

  function onBoxDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    drag = { startX: e.clientX, startY: e.clientY, start: { ...view }, bounds: { ...bounds } };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
  }

  function onDragMove(e: PointerEvent) {
    if (!drag) return;
    const d = mapDeltaToCanvas({ x: e.clientX - drag.startX, y: e.clientY - drag.startY }, drag.bounds, NAV_MAP_W, NAV_MAP_H);
    ed.panTo(drag.start.x + d.x, drag.start.y + d.y);
  }

  function onDragEnd() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
    if (!drag) return;
    drag = null;
    syncView();
  }

  /** Click on the map (outside the box): centre the view there. */
  function onMapDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const p = mapToCanvas(mapPoint(e), bounds, NAV_MAP_W, NAV_MAP_H);
    ed.panTo(p.x - view.width / 2, p.y - view.height / 2);
  }
</script>

{#if app.view.hasDoc}
  <div class="zoom-nav">
    <div class="zoom-map-wrap" style:width="{NAV_MAP_W}px" style:height="{NAV_MAP_H}px">
    <canvas bind:this={canvasEl} class="zoom-map-canvas" aria-hidden="true"></canvas>
    <svg
      bind:this={mapSvg}
      class="zoom-map"
      width={NAV_MAP_W}
      height={NAV_MAP_H}
      viewBox="{bounds.x} {bounds.y} {bounds.width} {bounds.height}"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Document overview"
      onpointerdown={onMapDown}
    >
      <rect
        class="zoom-map-view"
        role="presentation"
        class:dragging={!!drag}
        x={view.x}
        y={view.y}
        width={view.width}
        height={view.height}
        onpointerdown={onBoxDown}
      />
    </svg>
    </div>

    <div class="zoom-row">
      <input
        class="zoom-slider"
        type="range"
        min="0"
        max="1"
        step="0.001"
        value={sliderValue}
        aria-label="Zoom"
        aria-valuetext="{percent}%"
        title="Zoom {percent}%"
        oninput={onSlider}
      />
    </div>
  </div>
{/if}

<style>
  /* Compact card: full-width minimap on top, full-width slider below. */
  .zoom-nav {
    position: absolute;
    left: 8px;
    bottom: 8px;
    z-index: 5;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--c-panel);
    border: 1px solid var(--c-border);
    border-radius: 6px;
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.08);
    user-select: none;
  }
  .zoom-map-wrap { position: relative; flex: none; background: var(--c-panel-2); border-bottom: 1px solid var(--c-border); }
  .zoom-map-canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .zoom-map { position: relative; display: block; cursor: crosshair; overflow: hidden; }
  .zoom-map-view {
    fill: rgb(99 102 241 / 0.08);
    stroke: var(--c-accent);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
    cursor: grab;
  }
  .zoom-map-view.dragging { cursor: grabbing; }
  .zoom-row { display: flex; align-items: center; padding: 4px 6px; }
  .zoom-slider { width: 100%; height: 12px; margin: 0; accent-color: var(--c-accent); cursor: pointer; }
</style>
