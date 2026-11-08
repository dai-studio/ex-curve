// src/app/zoomNav.ts — pure helpers for the zoom navigator (ZoomNavigator.svelte), ported from
// DAI Studio's editor-src/src/lib/editor/zoomMath.ts: log-scale slider mapping and minimap
// bounds / coordinate conversion.
import type { Rect, Vec } from '../engine/model';

/** Slider range (the editor itself allows 2 %–25600 % for wheel / keyboard zoom). */
export const NAV_MIN_ZOOM = 0.05;
export const NAV_MAX_ZOOM = 64;
/** Multiplier for one zoom in / out step (⌘+ / ⌘−). */
export const ZOOM_STEP = 1.25;
/** Minimap size (px). */
export const NAV_MAP_W = 144;
export const NAV_MAP_H = 90;

const LN_MIN = Math.log(NAV_MIN_ZOOM);
const LN_SPAN = Math.log(NAV_MAX_ZOOM) - LN_MIN;

const clampNav = (z: number) => (!Number.isFinite(z) || z <= 0 ? 1 : Math.min(NAV_MAX_ZOOM, Math.max(NAV_MIN_ZOOM, z)));

/** Zoom → slider position t ∈ [0, 1] (logarithmic). */
export function zoomToSlider(z: number): number {
  return (Math.log(clampNav(z)) - LN_MIN) / LN_SPAN;
}

/** Slider position t ∈ [0, 1] → zoom (logarithmic). */
export function sliderToZoom(t: number): number {
  const c = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  return clampNav(Math.exp(LN_MIN + c * LN_SPAN));
}

/** Minimap viewBox: union of the page and the current view, padded, so the view box is always on the map. */
export function mapBounds(page: Rect | null, view: Rect, padding = 40): Rect {
  const rects = [view, ...(page && page.width > 0 && page.height > 0 ? [page] : [])];
  const x1 = Math.min(...rects.map((r) => r.x)) - padding;
  const y1 = Math.min(...rects.map((r) => r.y)) - padding;
  const x2 = Math.max(...rects.map((r) => r.x + r.width)) + padding;
  const y2 = Math.max(...rects.map((r) => r.y + r.height)) + padding;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** Pixels per canvas unit when `bounds` is fitted ("meet") into the map, plus letterbox offsets. */
export function mapScale(bounds: Rect, mapW: number, mapH: number): { scale: number; offsetX: number; offsetY: number } {
  if (bounds.width <= 0 || bounds.height <= 0 || mapW <= 0 || mapH <= 0) return { scale: 1, offsetX: 0, offsetY: 0 };
  const scale = Math.min(mapW / bounds.width, mapH / bounds.height);
  return { scale, offsetX: (mapW - bounds.width * scale) / 2, offsetY: (mapH - bounds.height * scale) / 2 };
}

/** Map pixel position (relative to the map's top-left) → canvas point. */
export function mapToCanvas(px: Vec, bounds: Rect, mapW: number, mapH: number): Vec {
  const { scale, offsetX, offsetY } = mapScale(bounds, mapW, mapH);
  return { x: bounds.x + (px.x - offsetX) / scale, y: bounds.y + (px.y - offsetY) / scale };
}

/** Map pixel delta → canvas delta. */
export function mapDeltaToCanvas(d: Vec, bounds: Rect, mapW: number, mapH: number): Vec {
  const { scale } = mapScale(bounds, mapW, mapH);
  return { x: d.x / scale, y: d.y / scale };
}
