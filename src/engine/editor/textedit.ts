// src/engine/editor/textedit.ts
// Inline text editing for <text>: a contenteditable box over the canvas, matched to the
// element's font, size and anchor at the current zoom. The SVG text is hidden while editing
// (its original visibility attribute is restored before the edit is reported, so the document
// only changes through the single recorded edit).
import { matApply, type Mat } from '../geom';
import { num } from '../num';

export interface TextEditHost {
  /** Element local space → host (overlay) pixels. */
  screenMat(el: Element): Mat | null;
  /** Called once with the final text, or null when cancelled. */
  done(el: SVGTextElement, text: string | null, isNew: boolean): void;
}

interface Active {
  el: SVGTextElement;
  isNew: boolean;
  box: HTMLDivElement;
  original: string;
  visibility: string | null;
}

export class InlineTextEditor {
  private active: Active | null = null;

  constructor(private host: HTMLElement, private cb: TextEditHost) {}

  get editing(): SVGTextElement | null { return this.active?.el ?? null; }

  /** Start editing. `at` (client coordinates) puts the caret there; otherwise all text is selected. */
  open(el: SVGTextElement, isNew: boolean, at?: { x: number; y: number }): void {
    this.commit();
    const box = document.createElement('div');
    box.className = 'curve-text-edit';
    box.contentEditable = 'plaintext-only';
    if (box.contentEditable !== 'plaintext-only') box.contentEditable = 'true';
    box.spellcheck = false;
    box.setAttribute('role', 'textbox');
    box.setAttribute('aria-label', 'Text');
    const original = el.textContent ?? '';
    box.textContent = original;
    const a: Active = { el, isNew, box, original, visibility: el.getAttribute('visibility') };
    this.active = a;
    this.place();
    el.setAttribute('visibility', 'hidden');
    this.host.appendChild(box);

    box.addEventListener('pointerdown', (e) => e.stopPropagation());
    box.addEventListener('dblclick', (e) => e.stopPropagation());
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') { e.preventDefault(); this.commit(); }
    });
    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const t = e.clipboardData?.getData('text/plain').replace(/\s*\n\s*/g, ' ') ?? '';
      document.execCommand('insertText', false, t);
    });
    box.addEventListener('blur', () => { if (this.active === a) this.commit(); });
    box.focus();
    const sel = getSelection();
    if (!sel) return;
    if (at && this.placeCaret(box, sel, at)) return;
    sel.selectAllChildren(box);
    if (isNew) sel.collapseToEnd();
  }

  private placeCaret(box: HTMLElement, sel: Selection, at: { x: number; y: number }): boolean {
    const doc = box.ownerDocument as Document & {
      caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?(x: number, y: number): Range | null;
    };
    let range: Range | null = null;
    if (doc.caretPositionFromPoint) {
      const p = doc.caretPositionFromPoint(at.x, at.y);
      if (p && box.contains(p.offsetNode)) { range = doc.createRange(); range.setStart(p.offsetNode, p.offset); }
    } else if (doc.caretRangeFromPoint) {
      const r = doc.caretRangeFromPoint(at.x, at.y);
      if (r && box.contains(r.startContainer)) range = r;
    }
    if (!range) return false;
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }

  /** Keep the box aligned after zoom / pan. */
  place(): void {
    const a = this.active;
    if (!a) return;
    const M = this.cb.screenMat(a.el);
    if (!M) return;
    const cs = getComputedStyle(a.el);
    const scale = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1;
    const size = (parseFloat(cs.fontSize) || 16) * scale;
    const s = matApply(M, { x: num(a.el, 'x'), y: num(a.el, 'y') });
    const anchor = cs.textAnchor === 'middle' ? '-50%' : cs.textAnchor === 'end' ? '-100%' : '0';
    const fill = cs.fill && /^(#|rgb|hsl|[a-z]+$)/i.test(cs.fill) && cs.fill !== 'none' ? cs.fill : 'currentColor';
    Object.assign(a.box.style, {
      left: `${s.x}px`,
      top: `${s.y - size * 0.86}px`,
      fontSize: `${size}px`,
      fontFamily: cs.fontFamily,
      fontWeight: cs.fontWeight,
      fontStyle: cs.fontStyle,
      letterSpacing: cs.letterSpacing,
      color: fill,
      transform: `translateX(${anchor})`,
    });
  }

  commit(): void { this.finish(false); }
  cancel(): void { this.finish(true); }

  private finish(cancelled: boolean): void {
    const a = this.active;
    if (!a) return;
    this.active = null;
    const text = cancelled ? null : (a.box.textContent ?? '').replace(/\n/g, ' ');
    a.box.remove();
    if (a.visibility === null) a.el.removeAttribute('visibility');
    else a.el.setAttribute('visibility', a.visibility);
    this.cb.done(a.el, text, a.isNew);
  }
}
