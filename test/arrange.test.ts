import { alignDeltas, distributeDeltas, planZOrder, ungroupBlocker, ungroupChildren } from '../src/engine/arrange';
import { History } from '../src/engine/history';
import { uniquifyIds, rewriteRefs } from '../src/engine/ids';

const NS = 'http://www.w3.org/2000/svg';
function svg(markup: string): SVGSVGElement {
  return new DOMParser().parseFromString(`<svg xmlns="${NS}">${markup}</svg>`, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
}
const ids = (p: Element) => Array.from(p.children).map((e) => e.id).join('');

function applyZ(root: Element, sel: string[], op: 'forward' | 'backward' | 'front' | 'back') {
  const h = new History();
  const els = sel.map((id) => root.querySelector(`#${id}`)!);
  const moves = planZOrder(els, op);
  h.mutate('z', moves.flatMap((m) => [{ type: 'remove' as const, el: m.el }, { type: 'insert' as const, el: m.el, parent: root, before: m.before }]));
  return h;
}

describe('z-order', () => {
  const cases: [string[], 'forward' | 'backward' | 'front' | 'back', string][] = [
    [['b'], 'forward', 'acbd'], [['a', 'b'], 'forward', 'cabd'], [['d'], 'forward', 'abcd'],
    [['c'], 'backward', 'acbd'], [['c', 'd'], 'backward', 'acdb'],
    [['a', 'c'], 'front', 'bdac'], [['b', 'd'], 'back', 'bdac'],
  ];
  for (const [sel, op, want] of cases) {
    it(`${op} ${sel.join(',')} → ${want}, and undo restores`, () => {
      const root = svg('<rect id="a"/>\n<rect id="b"/>\n<rect id="c"/>\n<rect id="d"/>');
      const original = root.innerHTML;
      const h = applyZ(root, sel, op);
      expect(ids(root)).toBe(want);
      h.undo();
      expect(ids(root)).toBe('abcd');
      expect(root.innerHTML).toBe(original); // whitespace text nodes back in place too
      h.redo();
      expect(ids(root)).toBe(want);
    });
  }
});

describe('align and distribute', () => {
  const boxes = [{ x: 0, y: 0, width: 10, height: 10 }, { x: 30, y: 5, width: 20, height: 20 }];
  it('aligns edges and centres to a target', () => {
    const t = { x: 0, y: 0, width: 50, height: 25 };
    expect(alignDeltas(boxes, 'left', t)).toEqual([{ x: 0, y: 0 }, { x: -30, y: 0 }]);
    expect(alignDeltas(boxes, 'right', t)).toEqual([{ x: 40, y: 0 }, { x: 0, y: 0 }]);
    expect(alignDeltas(boxes, 'middle', t)).toEqual([{ x: 0, y: 7.5 }, { x: 0, y: -2.5 }]);
  });
  it('distributes equal gaps keeping the outer boxes', () => {
    const b = [{ x: 0, y: 0, width: 10, height: 1 }, { x: 80, y: 0, width: 20, height: 1 }, { x: 15, y: 0, width: 10, height: 1 }];
    // span 0..100, sizes 40 → gap 30: positions 0, 40, 80
    expect(distributeDeltas(b, 'x')).toEqual([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 25, y: 0 }]);
  });
});

describe('ungroup', () => {
  it('pushes transform, inherited style and opacity into children', () => {
    const root = svg('<g id="g" transform="translate(5 5)" fill="red" opacity="0.5"><rect transform="rotate(10)" opacity="0.5"/><circle fill="blue"/></g>');
    const g = root.querySelector('g')!;
    expect(ungroupBlocker(g)).toBeNull();
    const [r, c] = ungroupChildren(g);
    expect(r.getAttribute('transform')).toBe('translate(5 5) rotate(10)');
    expect(r.getAttribute('fill')).toBe('red');
    expect(r.getAttribute('opacity')).toBe('0.25');
    expect(c.getAttribute('fill')).toBe('blue');
  });
  it('refuses groups whose rendering depends on the group', () => {
    expect(ungroupBlocker(svg('<g filter="url(#f)"/>').querySelector('g')!)).toMatch(/filter/);
    expect(ungroupBlocker(svg('<g clip-path="url(#c)"/>').querySelector('g')!)).toMatch(/clip-path/);
  });
});

describe('ids', () => {
  it('renames clashing ids and rewrites references inside the copy', () => {
    const copy = svg('<g id="a"><linearGradient id="grad"/><rect fill="url(#grad)" style="stroke:url(&quot;#grad&quot;)"/><use href="#a"/></g>').firstElementChild!;
    const map = uniquifyIds([copy], new Set(['a', 'grad']));
    expect(map.get('a')).toBe('a-2');
    expect(copy.querySelector('rect')!.getAttribute('fill')).toBe('url(#grad-2)');
    expect(copy.querySelector('rect')!.getAttribute('style')).toBe('stroke:url("#grad-2")');
    expect(copy.querySelector('use')!.getAttribute('href')).toBe('#a-2');
  });
  it('leaves unrelated references alone', () => {
    expect(rewriteRefs('fill', 'url(#other)', new Map([['x', 'y']]))).toBeNull();
  });
});
