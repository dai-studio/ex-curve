// src/engine/raster.ts
// Export (M4): rasterise the document to PNG through an <img> and a canvas, and an optional
// minified serialisation for saving.

const MAX_SIDE = 16384;
const MAX_AREA = 268_435_456; // 16384²; browsers refuse larger canvases

export interface RasterOptions {
  /** Output size in pixels. */
  width: number;
  height: number;
  /** CSS colour drawn behind the image; omit for transparency. */
  background?: string;
}

/** Clamp an output size to what canvases support, keeping the aspect ratio. */
export function clampSize(width: number, height: number): { width: number; height: number } {
  let s = Math.min(1, MAX_SIDE / width, MAX_SIDE / height);
  if (width * height * s * s > MAX_AREA) s = Math.sqrt(MAX_AREA / (width * height));
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

/** Render SVG markup to a PNG blob at the given pixel size. */
export async function rasterize(svg: string, opts: RasterOptions): Promise<Blob> {
  const { width, height } = clampSize(opts.width, opts.height);
  // Give the root an explicit pixel size so the image's intrinsic size is exact.
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  if (!doc.getAttribute('viewBox')) {
    const w = parseFloat(doc.getAttribute('width') ?? '') || width, h = parseFloat(doc.getAttribute('height') ?? '') || height;
    doc.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  doc.setAttribute('width', String(width));
  doc.setAttribute('height', String(height));
  doc.setAttribute('preserveAspectRatio', 'none');
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');
    if (opts.background) { ctx.fillStyle = opts.background; ctx.fillRect(0, 0, width, height); }
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

const TEXTISH = new Set(['text', 'tspan', 'textPath', 'title', 'desc', 'style', 'pre', 'foreignObject']);

/**
 * Minified copy of an SVG: drops comments, <metadata> and whitespace-only text between elements
 * (never inside text content or <style>). Attribute values are left exactly as they are.
 */
export function minifySvg(svg: string): string {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = parsed.documentElement;
  const walk = (n: Node, keepSpace: boolean) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === Node.COMMENT_NODE) c.remove();
      else if (c.nodeType === Node.TEXT_NODE) { if (!keepSpace && !(c.textContent ?? '').trim()) c.remove(); }
      else if (c.nodeType === Node.ELEMENT_NODE) {
        const el = c as Element;
        if (el.localName === 'metadata') el.remove();
        else walk(el, keepSpace || TEXTISH.has(el.localName) || el.getAttribute('xml:space') === 'preserve');
      }
    }
  };
  walk(root, false);
  return new XMLSerializer().serializeToString(root);
}
