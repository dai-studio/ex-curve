import { documentColors, editStyleDeclaration, parsePaint, parseStyle, readStyle, stylePatch, toHex } from '../src/engine/style';
import { applyPatch } from '../src/engine/history';

const NS = 'http://www.w3.org/2000/svg';
function el(attrs: Record<string, string>) {
  const e = document.createElementNS(NS, 'rect');
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
const names = (e: Element) => Array.from(e.attributes).map((a) => a.name);

describe('parseStyle', () => {
  it('parses declarations in order with !important', () => {
    expect(parseStyle('fill: red ; stroke:blue !important;;')).toEqual([
      { prop: 'fill', value: 'red', important: false },
      { prop: 'stroke', value: 'blue', important: true },
    ]);
  });
});

describe('editStyleDeclaration', () => {
  it('replaces only the value, keeping spacing and other declarations', () => {
    expect(editStyleDeclaration('opacity:.5; fill : red;stroke:blue', 'fill', '#000')).toBe('opacity:.5; fill : #000;stroke:blue');
    expect(editStyleDeclaration('fill:red !important', 'fill', 'blue')).toBe('fill:blue !important');
  });
  it('does not match a property that merely ends with the name', () => {
    expect(editStyleDeclaration('stop-fill:red', 'fill', 'blue')).toBeNull();
    expect(editStyleDeclaration('fill-opacity:1', 'fill', 'blue')).toBeNull();
  });
  it('removes a declaration and its separator', () => {
    expect(editStyleDeclaration('fill:red; stroke:blue', 'fill', null)).toBe('stroke:blue');
    expect(editStyleDeclaration('stroke:blue; fill:red', 'fill', null)).toBe('stroke:blue');
    expect(editStyleDeclaration('fill:red', 'fill', null)).toBe('');
  });
});

describe('stylePatch (edit style where defined)', () => {
  it('edits a style declaration in place', () => {
    const e = el({ x: '0', style: 'fill:red;stroke:blue', fill: 'green' });
    const p = stylePatch(e, 'fill', '#00f');
    expect(p).toEqual({ style: 'fill:#00f;stroke:blue' });
    applyPatch(e, p);
    expect(names(e)).toEqual(['x', 'style', 'fill']);
  });
  it('edits an existing presentation attribute in place', () => {
    const e = el({ fill: 'red', x: '1' });
    expect(stylePatch(e, 'fill', 'blue')).toEqual({ fill: 'blue' });
  });
  it('adds a presentation attribute when undefined and removes from style', () => {
    expect(stylePatch(el({}), 'stroke-width', '2')).toEqual({ 'stroke-width': '2' });
    expect(stylePatch(el({ style: 'fill:red' }), 'fill', null)).toEqual({ style: null });
    expect(stylePatch(el({ fill: 'red' }), 'fill', null)).toEqual({ fill: null });
  });
  it('readStyle prefers the style declaration', () => {
    expect(readStyle(el({ fill: 'red', style: 'fill:blue' }), 'fill')).toMatchObject({ own: 'blue', source: 'style' });
    expect(readStyle(el({ fill: 'red' }), 'fill')).toMatchObject({ own: 'red', source: 'attribute' });
    expect(readStyle(el({}), 'fill').source).toBe('inherited');
  });
});

describe('colours', () => {
  it('normalises hex and rgb', () => {
    expect(toHex('#ABC')).toBe('#aabbcc');
    expect(toHex('#11223380')).toBe('#112233');
    expect(toHex('rgb(255, 0, 16)')).toBe('#ff0010');
  });
  it('classifies paints', () => {
    expect(parsePaint('none')).toEqual({ kind: 'none' });
    expect(parsePaint('url(#g1)')).toEqual({ kind: 'url', ref: 'g1' });
    expect(parsePaint('currentColor')).toEqual({ kind: 'current' });
    expect(parsePaint('#fff')).toEqual({ kind: 'color', hex: '#ffffff' });
  });
  it('collects document colours by frequency', () => {
    const svg = document.createElementNS(NS, 'svg');
    svg.append(el({ fill: '#f00' }), el({ fill: '#ff0000', stroke: '#00f' }), el({ style: 'fill:#00f' }), el({ fill: '#00f' }));
    expect(documentColors(svg)).toEqual(['#0000ff', '#ff0000']);
  });
});
