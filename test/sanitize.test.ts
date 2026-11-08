import { describeReport, sanitize } from '../src/engine/sanitize';

const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml').documentElement;

describe('sanitize', () => {
  it('removes scripts, handlers, javascript: links and link-rewriting animations', () => {
    const root = parse(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)">
      <script>alert(2)</script>
      <a href="javascript:alert(3)"><rect onclick="x()" width="10" height="10" fill="red"/></a>
      <a xlink:href=" JaVaScRiPt:alert(4)"><text>t</text></a>
      <a href="https://dai.studio"><circle r="2"/></a>
      <animate attributeName="href" values="javascript:alert(5)"/>
      <set attributeName="onmouseover" to="alert(6)"/>
      <foreignObject><iframe src="https://example.com"></iframe><div xmlns="http://www.w3.org/1999/xhtml" onmouseover="y()">hi</div></foreignObject>
      <style>@import url(https://evil.example/x.css); rect { fill: blue }</style>
      <image href="data:text/html,&lt;script&gt;alert(7)&lt;/script&gt;"/>
      <image href="data:image/png;base64,AAAA"/>
    </svg>`);
    const r = sanitize(root);
    const out = new XMLSerializer().serializeToString(root);
    expect(out).not.toMatch(/script|alert|onload|onclick|onmouseover|iframe|@import/i);
    expect(out).toContain('href="https://dai.studio"');
    expect(out).toContain('data:image/png;base64,AAAA');
    expect(out).toContain('rect { fill: blue }');
    expect(out).toContain('fill="red"');
    expect(r.removedElements).toEqual({ script: 1, animate: 1, set: 1, iframe: 1 });
    expect(r.removedAttributes).toBe(6);
    expect(describeReport(r)).toMatch(/^Removed for safety: 1 <script>/);
  });

  it('reports nothing for a clean document', () => {
    const r = sanitize(parse('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'));
    expect(describeReport(r)).toBe('');
  });

  it('works on detached fragments', () => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.innerHTML = '<script>x</script><rect onclick="y"/>';
    sanitize(g);
    expect(g.innerHTML).not.toMatch(/script|onclick/);
  });
});
