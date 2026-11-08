<script lang="ts">
  import type { AppState } from '../state.svelte';
  import type { CurveHost } from '../../embed';
  import Modal from './Modal.svelte';

  let { app, host }: { app: AppState; host: CurveHost } = $props();
  const link = (url: string) => (e: MouseEvent) => { e.preventDefault(); host.openUrl?.(url); };
</script>

<Modal open={app.dialog === 'about'} title="About Curve" onclose={() => (app.dialog = null)} width={460}>
  <p>Curve is a precise SVG editor: every shape stays the element you drew, with editor points for its own attributes. It saves clean, readable SVG.</p>
  <p class="built">
    <strong>Built with DAI Studio.</strong> Curve was specified, planned and tracked in a DAI Studio design document
    (<code>design.dai</code>): features, rules and tests that an AI agent implemented and kept up to date as it worked.
  </p>
  <p class="links">
    <a href="https://dai.studio" onclick={link('https://dai.studio')}>dai.studio</a> ·
    <a href="https://github.com/dai-studio/curve" onclick={link('https://github.com/dai-studio/curve')}>Source on GitHub</a>
  </p>
  <p class="muted small">Icons: Tabler Icons (MIT). Your files stay in your browser; nothing is uploaded.</p>
  {#snippet actions()}<button type="button" class="primary" onclick={() => (app.dialog = null)}>Close</button>{/snippet}
</Modal>

<style>
  p { margin: 0 0 10px; color: var(--c-text-2); line-height: 1.55; }
  .built { padding: 10px 12px; border-radius: var(--radius); background: var(--c-accent-soft); color: var(--c-text); }
  a { color: var(--c-accent-strong); }
  .small { font-size: 12px; margin: 0; }
</style>
