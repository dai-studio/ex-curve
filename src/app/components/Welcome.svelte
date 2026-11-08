<script lang="ts">
  // Welcome screen over the canvas: start blank, open a file, reopen a recent one or a starter.
  import type { AppState } from '../state.svelte';
  import type { Command } from '../commands';
  import type { CurveHandle, CurveHost, CurveRecent } from '../../embed';
  import { STARTERS } from '../starters';
  import Icon from './Icon.svelte';

  interface Props { app: AppState; cmd: Record<string, Command>; host: CurveHost; handle: CurveHandle; showBadge: boolean }
  let { app, cmd, host, handle, showBadge }: Props = $props();

  let recent = $state<CurveRecent[]>([]);
  $effect(() => {
    if (!app.showWelcome || !host.recentFiles) return;
    host.recentFiles().then((r) => (recent = r)).catch(() => (recent = []));
  });

  const QUICK = [
    { label: 'Blank 800 × 600', w: 800, h: 600 },
    { label: 'Icon 24 × 24', w: 24, h: 24 },
    { label: 'Square 1080', w: 1080, h: 1080 },
  ];
  const close = () => (app.showWelcome = false);
  async function start(fn: () => void) {
    if (!(await app.confirmDiscard())) return;
    fn();
    close();
  }
  const ago = (t: number) => {
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
  };
  const thumb = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
</script>

<svelte:window onkeydown={(e) => { if (app.showWelcome && e.key === 'Escape' && !app.dialog) close(); }} />

{#if app.showWelcome}
  <div class="welcome" role="dialog" aria-modal="false" aria-labelledby="curve-welcome-title">
    <div class="card">
      <header>
        <h1 id="curve-welcome-title">Welcome to Curve</h1>
        <p class="muted">A precise SVG editor. Shapes stay the elements you drew, and the SVG stays clean.</p>
        <button type="button" class="icon close" aria-label="Close welcome screen" onclick={close}><Icon name="close" /></button>
      </header>

      <div class="cols">
        <section>
          <h2>Start</h2>
          {#each QUICK as q (q.label)}
            <button type="button" class="action" onclick={() => start(() => handle.newDocument(q.w, q.h))}><Icon name="new" />{q.label}</button>
          {/each}
          <button type="button" class="action" onclick={() => { close(); cmd.new.run(); }}><Icon name="settings" />Custom size…</button>
          {#if cmd.open.available?.() !== false}
            <button type="button" class="action" onclick={() => { close(); cmd.open.run(); }}><Icon name="open" />Open file… <kbd>{cmd.open.keys}</kbd></button>
          {/if}
          {#if recent.length}
            <h2 class="sub">Recent</h2>
            {#each recent as r (r.openedAt)}
              <button type="button" class="action recent" onclick={() => start(() => r.open())}>
                <Icon name="open" /><span class="nm">{r.name}</span><span class="when muted">{ago(r.openedAt)}</span>
              </button>
            {/each}
          {/if}
        </section>

        <section>
          <h2>Starters</h2>
          <div class="starters">
            {#each STARTERS as s (s.file)}
              <button type="button" class="starter" onclick={() => start(() => handle.load(s.svg, s.file))}>
                <span class="thumb"><img src={thumb(s.svg)} alt="" /></span>
                <span class="nm">{s.name}</span>
                <span class="muted desc">{s.description}</span>
              </button>
            {/each}
          </div>
        </section>
      </div>

      <footer>
        <span class="muted">Tip: press <kbd>{cmd.palette.keys}</kbd> for every command, <kbd>?</kbd> for shortcuts. Files never leave your browser.</span>
        {#if showBadge}
          <a href="https://dai.studio" onclick={(e) => { e.preventDefault(); host.openUrl?.('https://dai.studio'); }}>Built with <strong>DAI Studio</strong></a>
        {/if}
      </footer>
    </div>
  </div>
{/if}

<style>
  .welcome {
    position: absolute; inset: 0; z-index: 20; display: grid; place-items: center; padding: 16px;
    background: color-mix(in srgb, var(--c-stage) 82%, transparent); backdrop-filter: blur(3px);
    overflow: auto;
  }
  .card {
    position: relative; width: min(760px, 100%); padding: 26px 28px 20px;
    background: var(--c-panel); border: 1px solid var(--c-border); border-radius: 16px; box-shadow: var(--c-shadow);
  }
  h1 { margin: 0 0 4px; font-size: 22px; }
  header p { margin: 0 0 18px; }
  .close { position: absolute; top: 14px; right: 14px; }
  .cols { display: grid; grid-template-columns: 240px 1fr; gap: 28px; }
  @media (max-width: 640px) { .cols { grid-template-columns: 1fr; } }
  h2 { margin: 0 0 8px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--c-muted); }
  h2.sub { margin-top: 16px; }
  .action { width: 100%; justify-content: flex-start; padding: 7px 8px; gap: 10px; color: var(--c-text-2); }
  .action kbd { margin-left: auto; }
  .recent .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .recent .when { margin-left: auto; font-size: 11.5px; flex: none; }
  .starters { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .starter {
    flex-direction: column; align-items: stretch; gap: 3px; padding: 8px; text-align: left;
    border: 1px solid var(--c-border); border-radius: 10px;
  }
  .starter:hover { border-color: var(--c-accent); }
  .thumb {
    display: grid; place-items: center; height: 96px; margin-bottom: 4px; border-radius: 6px;
    /* Documents are previewed on a light page in both themes, like the canvas. */
    background: repeating-conic-gradient(#eef2f7 0% 25%, #ffffff 0% 50%) 50% / 16px 16px;
  }
  .thumb img { width: 80%; height: 80px; object-fit: contain; }
  .starter .nm { font-weight: 600; font-size: 13px; color: var(--c-text); }
  .desc { font-size: 12px; }
  footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 22px; padding-top: 14px; border-top: 1px solid var(--c-border); font-size: 12px; }
  footer a { color: var(--c-text-2); text-decoration: none; }
  footer strong { background: var(--brand-gradient); -webkit-background-clip: text; background-clip: text; color: transparent; }
</style>
