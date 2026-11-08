// Library build of the embeddable editor for DAI Studio (and any other host):
//   dist-embed/curve-editor.js   ES module exporting mountCurve() and the public types
//   dist-embed/curve-editor.css  scoped to .curve-app
//   dist-embed/curve-editor.d.ts (written by `npm run build:embed` via tsconfig.embed.json)
// Svelte is bundled in, so hosts need no Svelte dependency. Fonts come from the host.
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  publicDir: false,
  build: {
    outDir: 'dist-embed',
    emptyOutDir: true,
    lib: { entry: 'src/embed.ts', formats: ['es'], fileName: () => 'curve-editor.js', cssFileName: 'curve-editor' },
    sourcemap: true,
  },
});
