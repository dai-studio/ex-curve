// src/engine/tools/index.ts — tool registry.
import { EllipseTool, LineTool, PolygonTool, RectTool } from './shapes';
import { PenTool } from './pen';
import { PencilTool } from './pencil';
import { TextTool } from './text';
import type { CreationToolId, Tool, ToolHost } from './types';

export * from './types';

export function createTools(host: ToolHost): Record<CreationToolId, Tool> {
  return {
    rect: new RectTool(host),
    ellipse: new EllipseTool(host),
    line: new LineTool(host),
    polygon: new PolygonTool(host, false),
    star: new PolygonTool(host, true),
    pen: new PenTool(host),
    pencil: new PencilTool(host),
    text: new TextTool(host),
  };
}
