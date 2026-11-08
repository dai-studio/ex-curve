<script lang="ts">
  /**
   * ZoomNavigator: always-open card in the canvas's bottom-left corner, ported from DAI Studio
   * (editor-src/src/lib/editor/ZoomNavigator.svelte).
   *
   *   - a minimap of the page and the document (rendered as an image, re-rendered debounced on
   *     changes) with a box for the current view: drag the box to pan, click elsewhere to jump;
   *   - a full-width log-scale zoom slider below it (the zoom % is in its tooltip / aria-valuetext).
   *
   * The slider zooms with the selection centred (or around the view centre when nothing is
   * selected) — Editor.zoomTo. Any view change (wheel, keyboard, fit, panning) updates it.
   */
  import { onDestroy, untrack } from 'svelte';
  import type { AppState } from '../state.svelte';
  import type { Rect } from '../../engine/model';
  import { NAV_MAP_H, NAV_MAP_W, mapBounds, mapDeltaToCanvas, mapToCanvas, sliderToZoom, zoomToSlider } from '../zoomNav';

  let { app }: { app: AppState } = $props();
  const ed = $derived(app.editor);
  const RERENDER_MS = 150;

  let zoom = $state(1);
  let view = $state<Rect>({ x: 0, y: 0, width: 1, height: 1 });
  let page = $state<Rect>({ x: 0, y: 0, width: 1, height: 1 });
  let bounds = $state<Rect>({ x: 0, y: 0, width: 1, height: 1 });
  let image = $state<string | null>(null);
  let mapSvg = $state<SVGSVGElement | null>(null);
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

  /** Render the document into the minimap (as an image: no ids or scripts leak into the app). */
  let timer: ReturnType<typeof setTimeout> | null = null;
  function rerender() {
    timer = null;
    if (image) URL.revokeObjectURL(image);
    image = ed.doc ? URL.createObjectURL(new Blob([ed.serialize()], { type: 'image/svg+xml' })) : null;
    syncView();
  }
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
    if (image) URL.revokeObjectURL(image);
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
      <rect class="zoom-map-page" x={page.x} y={page.y} width={page.width} height={page.height} />
      {#if image}<image href={image} x={page.x} y={page.y} width={page.width} height={page.height} preserveAspectRatio="none" />{/if}
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
  .zoom-map {
    display: block;
    background: var(--c-panel-2);
    border-bottom: 1px solid var(--c-border);
    cursor: crosshair;
    overflow: hidden;
  }
  .zoom-map-page { fill: var(--c-page); stroke: var(--c-border-strong); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .zoom-map image { pointer-events: none; }
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
