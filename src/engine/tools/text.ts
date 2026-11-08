// src/engine/tools/text.ts
// Text tool: click an existing <text> to edit it, or click empty canvas to place a new one and
// type. Editing happens in an inline overlay (ToolHost.editText); Enter / Esc / click outside commit.
import { fmt } from '../num';
import type { Tool, ToolEvent, ToolHost } from './types';

export class TextTool implements Tool {
  readonly id = 'text' as const;
  readonly cursor = 'text';

  constructor(private host: ToolHost) {}

  pointerDown(e: ToolEvent): void {
    const t = e.target instanceof Element ? e.target.closest('text') : null;
    if (t && this.host.scope().contains(t)) {
      this.host.editText(t as SVGTextElement, { at: e.client });
      return;
    }
    const o = this.host.options;
    const el = this.host.create('text', { x: fmt(e.p.x), y: fmt(e.p.y), 'font-size': fmt(o.fontSize), 'font-family': o.fontFamily }, 'text');
    this.host.attachPreview(el);
    this.host.editText(el as SVGTextElement, { isNew: true });
  }

  pointerMove(): void {}
  pointerUp(): void {}
  cancel(): void {}
}
