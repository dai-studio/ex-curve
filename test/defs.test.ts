import { blockedByDefinition, chainMatrix, definitionKind, hrefTarget, instanceMatrix, isDefinitionContent, listDefinitions, referencesFrom, usersOf, viewBoxMatrix } from '../src/engine/defs';

const NS = 'http://www.w3.org/2000/svg';
const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml').documentElement;
const doc = parse(`<svg xmlns="${NS}" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <linearGradient id="g"><stop offset="0"/></linearGradient>
    <symbol id="star" viewBox="-10 -10 20 20"><g id="inner" transform="rotate(90)"><path id="p" transform="translate(1 2)" d="M0 0"/></g></symbol>
    <rect id="tile" width="4" height="4" transform="scale(2)"/>
    <filter id="f"><feGaussianBlur stdDeviation="2"/></filter>
  </defs>
  <symbol id="loose" viewBox="0 0 10 10"/>
  <rect id="r" fill="url(#g)" style="stroke: url('#g'); filter:url(#f)"/>
  <use id="u1" href="#star" x="5" y="6" width="40" height="40"/>
  <use id="u2" xlink:href="#star"/>
</svg>`);
const $ = (id: string) => doc.querySelector(`#${id}`)!;

describe('definitions', () => {
  it('lists defs children and loose symbols', () => {
    expect(listDefinitions(doc).map((e) => e.id)).toEqual(['g', 'star', 'tile', 'f', 'loose']);
    expect(['g', 'star', 'tile', 'f'].map((id) => definitionKind($(id)))).toEqual(['gradient', 'symbol', 'shape', 'filter']);
  });
  it('knows what is definition content', () => {
    expect(isDefinitionContent($('p'))).toBe(true);
    expect(isDefinitionContent(doc.querySelector('stop')!)).toBe(true);
    expect(isDefinitionContent($('r'))).toBe(false);
  });
  it('resolves hrefs and references, naming style properties', () => {
    expect(hrefTarget(doc, $('u1'))).toBe($('star'));
    expect(hrefTarget(doc, $('u2'))).toBe($('star'));
    expect(referencesFrom($('r'))).toEqual([{ id: 'g', attr: 'fill' }, { id: 'g', attr: 'stroke' }, { id: 'f', attr: 'filter' }]);
    expect(usersOf(doc, 'star').map((e) => e.id)).toEqual(['u1', 'u2']);
    expect(usersOf(doc, 'g').map((e) => e.id)).toEqual(['r']);
  });
});

describe('instance geometry', () => {
  it('fits a viewBox with preserveAspectRatio', () => {
    expect(viewBoxMatrix({ x: -10, y: -10, width: 20, height: 20 }, 40, 40)).toEqual([2, 0, 0, 2, 20, 20]);
    // 2:1 viewport, meet → scale 1, centred horizontally
    expect(viewBoxMatrix({ x: 0, y: 0, width: 10, height: 10 }, 20, 10)).toEqual([1, 0, 0, 1, 5, 0]);
    expect(viewBoxMatrix({ x: 0, y: 0, width: 10, height: 10 }, 20, 10, 'xMinYMin slice')).toEqual([2, 0, 0, 2, 0, 0]);
    expect(viewBoxMatrix({ x: 0, y: 0, width: 10, height: 10 }, 20, 10, 'none')).toEqual([2, 0, 0, 1, 0, 0]);
  });
  it('maps a symbol through its instance', () => {
    // translate(5 6) · viewBox(-10 -10 20 20 → 40×40) = scale 2, offset 20 → [2,0,0,2,25,26]
    expect(instanceMatrix($('star'), $('u1'))).toEqual([2, 0, 0, 2, 25, 26]);
    // no size on the instance: the symbol's viewBox size
    expect(instanceMatrix($('star'), $('u2'))).toEqual([1, 0, 0, 1, 10, 10]);
    expect(instanceMatrix($('tile'), null)).toEqual([1, 0, 0, 1, 0, 0]);
  });
  it('chains transforms below the definition (a symbol contributes none)', () => {
    const m = chainMatrix($('star'), $('p'));
    // rotate(90) · translate(1 2): (0,0) → (-2, 1)
    expect(m.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0, 1, -1, 0, -2, 1]);
    expect(chainMatrix($('tile'), $('tile'))).toEqual([2, 0, 0, 2, 0, 0]);
  });
});

describe('blockedByDefinition', () => {
  const d = parse(`<svg xmlns="${NS}">
    <symbol id="s"><path fill="#f00"/><circle style="stroke: blue"/><rect fill="inherit"/></symbol>
    <rect id="shape" stroke="red"/>
    <use id="a" href="#s"/><use id="b" href="#shape"/><use id="c" href="#missing"/>
  </svg>`);
  const read = (el: Element, p: string) => {
    const s = /(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)/g;
    for (const m of (el.getAttribute('style') ?? '').matchAll(s)) if (m[1] === p) return m[2].trim();
    return el.getAttribute(p);
  };
  const q = (id: string) => d.querySelector(`#${id}`)!;
  it('counts elements in the definition that set each property themselves', () => {
    expect(blockedByDefinition(d, q('a'), ['fill', 'stroke'], read)).toEqual({ fill: 1, stroke: 1 });
    expect(blockedByDefinition(d, q('b'), ['fill', 'stroke'], read)).toEqual({ fill: 0, stroke: 1 });
    expect(blockedByDefinition(d, q('c'), ['fill'], read)).toEqual({ fill: 0 });
  });
});
