<script lang="ts">
  import type { AppState } from '../state.svelte';
  import { documentColors, parsePaint, readStyle } from '../../engine/style';
  import PaintField from './PaintField.svelte';
  import NumberField from './NumberField.svelte';
  import FontPicker from './FontPicker.svelte';
  import { blockedByDefinition, hrefTarget } from '../../engine/defs';

  let { app }: { app: AppState } = $props();
  const els = $derived(app.view.selection);
  const ed = $derived(app.editor);

  const norm = (prop: string, v: string | null) => {
    if (v === null) return null;
    if (prop === 'fill' || prop === 'stroke') { const p = parsePaint(v); return p?.kind === 'color' ? p.hex : v.trim(); }
    const n = parseFloat(v);
    return Number.isFinite(n) && /^[\d.\s+-]+(px)?$/.test(v.trim()) ? String(n) : v.trim();
  };
  /** Effective value across the selection: null when mixed. */
  function agg(prop: string): { value: string | null; inherited: boolean } {
    void app.view;
    if (!els.length) return { value: null, inherited: true };
    const vals = els.map((el) => { const r = readStyle(el, prop); return { v: r.own ?? r.computed, inh: r.own === null }; });
    const first = norm(prop, vals[0].v);
    const same = vals.every((x) => norm(prop, x.v) === first);
    return { value: same ? vals[0].v : null, inherited: vals.every((x) => x.inh) };
  }
  const num = (v: string | null) => (v === null ? null : Number.isFinite(parseFloat(v)) ? parseFloat(v) : null);

  const fill = $derived(agg('fill'));
  const stroke = $derived(agg('stroke'));
  const fillOp = $derived(num(agg('fill-opacity').value));
  const strokeOp = $derived(num(agg('stroke-opacity').value));
  const width = $derived(num(agg('stroke-width').value));
  const dash = $derived(agg('stroke-dasharray').value);
  const cap = $derived(agg('stroke-linecap').value);
  const join = $derived(agg('stroke-linejoin').value);
  const opacity = $derived(num(agg('opacity').value));
  const fillRule = $derived(agg('fill-rule').value);
  const hasText = $derived(els.some((e) => e.localName === 'text' || e.localName === 'tspan'));
  const allText = $derived(els.length > 0 && els.every((e) => e.localName === 'text' || e.localName === 'tspan'));
  const fontSize = $derived(hasText ? num(agg('font-size').value) : null);
  const fontFamily = $derived(hasText ? agg('font-family').value : null);
  const fontWeight = $derived(hasText ? agg('font-weight').value : null);
  const anchor = $derived(hasText ? agg('text-anchor').value : null);
  /**
   * Selected <use>s whose definition sets fill / stroke itself: a value on the instance is only
   * inherited, so it won't show (SVG inheritance never overrides an element's own value).
   */
  const blocked = $derived.by(() => {
    void app.view;
    const doc = ed.doc;
    if (!doc) return null;
    const props = new Set<string>();
    let use: Element | null = null;
    for (const el of els) {
      if (el.localName !== 'use') continue;
      const b = blockedByDefinition(doc, el, ['fill', 'stroke'], (e, p) => readStyle(e, p).own);
      for (const p of ['fill', 'stroke']) if (b[p]) props.add(p);
      if ((b.fill || b.stroke) && !use) use = el;
    }
    const target = use && hrefTarget(doc, use);
    return use && target ? { use, id: target.id, kind: target.localName === 'symbol' ? 'symbol' : 'definition', props: [...props] } : null;
  });
  const swatches = $derived.by(() => { void app.view; return ed.doc ? documentColors(ed.doc, 16) : []; });

  /** New shapes follow the last style the user picked. */
  function remember(prop: string, value: string | null) {
    if (value === null) return;
    const d = ed.defaultStyle;
    if (prop === 'fill') { if (allText) d.text.fill = value; else d.shape.fill = value; }
    else if (prop === 'stroke') { d.shape.stroke = value; if (value !== 'none') d.stroke.stroke = value; }
    else if (prop === 'stroke-width') { d.shape['stroke-width'] = value; d.stroke['stroke-width'] = value; }
  }
  function set(prop: string, value: string | null, live = false) {
    ed.setStyle(els, prop, value, live);
    if (!live) remember(prop, value);
  }
  /** Setting a colour on a paint that is 'none' also makes it visible again. */
  function setPaint(prop: 'fill' | 'stroke', value: string | null, live: boolean) {
    set(prop, value, live);
    if (prop === 'stroke' && value !== 'none' && !live && (width === 0)) set('stroke-width', '1');
  }
  const opStr = (v: number) => (v >= 1 ? null : String(Math.round(v * 1000) / 1000));
</script>

{#if els.length}
  <div class="sec">
    <h4 class="sec-title">Fill & stroke</h4>
    {#if blocked}
      <div class="notice" role="note">
        <p>
          <code>#{blocked.id}</code> sets its own {blocked.props.join(' and ')}, so
          {els.length > 1 ? 'these instances' : 'this instance'} can’t change {blocked.props.length > 1 ? 'them' : 'it'}:
          a {blocked.props[0]} here won’t show.
        </p>
        <button type="button" onclick={() => blocked && ed.editDefinitionOf(blocked.use)}>Edit {blocked.kind}</button>
      </div>
    {/if}
    <PaintField label="Fill" value={fill.value} inherited={fill.inherited} opacity={fillOp} {swatches}
      onpaint={(v, live) => setPaint('fill', v, live)} onopacity={(v, live) => set('fill-opacity', opStr(v), live)} />
    <PaintField label="Stroke" value={stroke.value} inherited={stroke.inherited} opacity={strokeOp} {swatches}
      onpaint={(v, live) => setPaint('stroke', v, live)} onopacity={(v, live) => set('stroke-opacity', opStr(v), live)} />
    <div class="grid2 stroke-opts">
      <label title="Stroke width"><span>W</span>
        <NumberField label="Stroke width" value={width} min={0} step={0.5}
          onchange={(v, live) => set('stroke-width', String(v), live)} /></label>
      <label title="Dash pattern, e.g. 4 2"><span>- -</span>
        <input type="text" aria-label="Dash pattern" placeholder={dash === null ? 'Mixed' : 'none'} class:mixed={dash === null}
          value={dash === null || dash === 'none' ? '' : dash}
          onchange={(e) => set('stroke-dasharray', e.currentTarget.value.trim() || null)} /></label>
      <label title="Line cap"><span>Cap</span>
        <select aria-label="Line cap" value={cap ?? ''} onchange={(e) => set('stroke-linecap', e.currentTarget.value)}>
          {#if cap === null}<option value="" disabled>Mixed</option>{/if}
          <option value="butt">Butt</option><option value="round">Round</option><option value="square">Square</option>
        </select></label>
      <label title="Line join"><span>Join</span>
        <select aria-label="Line join" value={join ?? ''} onchange={(e) => set('stroke-linejoin', e.currentTarget.value)}>
          {#if join === null}<option value="" disabled>Mixed</option>{/if}
          <option value="miter">Miter</option><option value="round">Round</option><option value="bevel">Bevel</option>
        </select></label>
    </div>
    <div class="grid2">
      <label title="Opacity (%)"><span>α</span>
        <NumberField label="Opacity (%)" value={opacity === null ? null : opacity * 100} min={0} max={100} step={5} digits={0}
          onchange={(v, live) => set('opacity', opStr(v / 100), live)} /></label>
      <label title="Fill rule"><span>Rule</span>
        <select aria-label="Fill rule" value={fillRule ?? ''} onchange={(e) => set('fill-rule', e.currentTarget.value)}>
          {#if fillRule === null}<option value="" disabled>Mixed</option>{/if}
          <option value="nonzero">Nonzero</option><option value="evenodd">Even-odd</option>
        </select></label>
    </div>
  </div>

  {#if hasText}
    <div class="sec">
      <h4 class="sec-title">Text</h4>
      <div class="row">
        <span class="lbl">Font</span>
        <FontPicker {app} label="Font family" value={fontFamily} onchange={(f) => set('font-family', f.trim() || null)} />
      </div>
      <div class="grid2">
        <label title="Font size"><span>Sz</span>
          <NumberField label="Font size" value={fontSize} min={0} onchange={(v, live) => set('font-size', String(v), live)} /></label>
        <label title="Font weight"><span>Wt</span>
          <select aria-label="Font weight" value={fontWeight ?? ''} onchange={(e) => set('font-weight', e.currentTarget.value)}>
            {#if fontWeight === null}<option value="" disabled>Mixed</option>{/if}
            {#each ['100', '200', '300', '400', '500', '600', '700', '800', '900'] as w (w)}<option value={w}>{w}</option>{/each}
            {#if fontWeight && !/^\d00$/.test(fontWeight)}<option value={fontWeight}>{fontWeight}</option>{/if}
          </select></label>
      </div>
      <div class="row">
        <span class="lbl">Anchor</span>
        <div class="seg" role="group" aria-label="Text anchor">
          {#each [['start', 'Start'], ['middle', 'Middle'], ['end', 'End']] as [v, l] (v)}
            <button type="button" class:on={anchor === v} aria-pressed={anchor === v} onclick={() => set('text-anchor', v)}>{l}</button>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  {#if swatches.length}
    <div class="sec">
      <h4 class="sec-title">Document colours</h4>
      <div class="swatches">
        {#each swatches as c (c)}
          <button type="button" class="sw" style:background={c} title="{c} — click: fill · Shift-click: stroke" aria-label="Use {c}"
            onclick={(e) => setPaint(e.shiftKey ? 'stroke' : 'fill', c, false)}></button>
        {/each}
      </div>
    </div>
  {/if}
{/if}

<style>
  .stroke-opts { margin-top: 8px; margin-bottom: 6px; }
  .notice {
    display: flex; align-items: flex-start; gap: 8px; margin: 0 0 8px; padding: 7px 8px 7px 10px;
    border-radius: var(--radius-sm); border: 1px solid #f59e0b55; background: #f59e0b14;
    font-size: 12px; line-height: 1.45; color: var(--c-text-2);
  }
  .notice p { margin: 0; flex: 1; }
  .notice code { font-size: 11.5px; color: var(--c-text); }
  .notice button { flex: none; padding: 2px 8px; font-size: 12px; border: 1px solid var(--c-border-strong); background: var(--c-panel); }
  .seg { display: flex; flex: 1; border: 1px solid var(--c-border-strong); border-radius: var(--radius-sm); overflow: hidden; }
  .seg button { flex: 1; justify-content: center; border-radius: 0; padding: 3px 0; font-size: 12px; }
  .seg button + button { border-left: 1px solid var(--c-border); }
  .swatches { display: flex; flex-wrap: wrap; gap: 5px; }
  .sw { width: 20px; height: 20px; padding: 0; border-radius: 5px; border: 1px solid rgb(15 23 42 / 0.15); }
  .sw:hover { transform: scale(1.12); }
</style>
