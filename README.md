# Curve

A precise SVG editor in your browser. Every shape stays the SVG element you drew, the saved SVG stays clean and readable, and your files never leave your computer.

**[Open Curve →](https://curve.by.dai.studio/)**

Curve is a static web app (installable as a PWA that opens `.svg` files) and an embeddable editor component. [DAI Studio](https://dai.studio) uses it as its SVG editor, and Curve was itself specified and built with DAI Studio. The design lives in [`design.dai`](design.dai).

## Features

- **Native shape editing**: `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path`, `text`, `image` and `use` are each edited through their own on-canvas points. Paths keep their original commands (relative/absolute, shorthand) when edited.
- **Drawing tools**: rectangle, ellipse/circle, line, polygon, star, pen, pencil, text.
- **Inspector**: fill, stroke, opacity, fonts, position, size, rotation, and an attribute editor with number, colour and keyword fields.
- **Layers and arrange**: reorder, group/ungroup, align, distribute, flip, lock, hide.
- **Symbols and definitions**: edit `<symbol>`s through their `<use>` instances; inspect gradients, filters, markers and other `<defs>`.
- **Safe import and clipboard**: copy/paste SVG between documents and apps; scripts and event handlers are stripped on import.
- **Files and export**: open/save local files, autosave in the browser, PNG export, minified SVG.

## Development

Requires Node.js and npm.

```sh
npm install
npm run dev        # Vite dev server
npm test           # Vitest (jsdom)
npm run check      # tsc + svelte-check
npm run build      # check, then build the web app into dist/
```

`npm run preview:cf` builds and serves `dist/` locally with Wrangler, the same way it is served in production.

### Project layout

```
src/
  main.ts       Standalone web app: mounts the editor with the web host
  embed.ts      Public embed API (mountCurve and its types)
  app/          Svelte 5 UI: panels, dialogs, menus, app state
  engine/       Framework-free editor core: document model, shape adapters,
                path parsing, tools, history, snapping, sanitizing, export
  host/         Web host: File System Access, IndexedDB autosave, drag and drop
test/           Vitest suites and an embed smoke test page
public/         Static assets, PWA manifest, fonts, icons
scripts/        icons.mjs: extracts the Tabler icons Curve uses into src/app/icons.ts
```

## Embedding

`npm run build:embed` produces a self-contained library in `dist-embed/`:

| File | Contents |
| --- | --- |
| `curve-editor.js` | ES module exporting `mountCurve()` and the public types (Svelte is bundled in) |
| `curve-editor.css` | Styles, scoped to `.curve-app` |
| `curve-editor.d.ts` | Type declarations |

The editor works only on SVG strings; the host owns all file I/O. Fonts come from the host page.

```ts
import { mountCurve } from './curve-editor.js';
import './curve-editor.css';

const handle = mountCurve({
  target: document.getElementById('editor')!,
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"/>',
  displayName: 'drawing.svg',
  callbacks: {
    onSave: async ({ svg, revision }) => {
      await writeSomewhere(svg);
      handle.setSaveState('saved', undefined, revision);
    },
    onDirtyChange: (dirty) => console.log('dirty', dirty),
  },
});
```

Omitting `onSave`, `onSaveAs` or `onOpen` hides the matching command. The handle also offers `load`, `newDocument`, `getSvg`, `getSnapshot`, `undo`, `redo`, `zoomToFit` and `destroy`. See [`src/embed.ts`](src/embed.ts) for the full contract.

To smoke-test the build, run `npm run build:embed`, serve the project root, and open `/test/embed.html`.

## Deployment

The app is a static site served by Cloudflare Workers static assets (no Worker script). `wrangler.prod.jsonc` serves [curve.by.dai.studio](https://curve.by.dai.studio/); `wrangler.dev.jsonc` is a separate staging Worker. Both build with `npm ci && npm run build`.

## Credits

- Icons: [Tabler Icons](https://github.com/tabler/tabler-icons) (MIT)
- Font: [Noto Sans](https://fonts.google.com/noto/specimen/Noto+Sans) (SIL Open Font License)

## License

[BSD 2-Clause](LICENSE) © 2026 DAI Studio

