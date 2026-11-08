import { buildClip, CLIP_ATTR, parseClip, planDefs, referencedIds } from '../src/engine/clipboard';

const NS = 'http://www.w3.org/2000/svg';
const parse = (s: string) => new DOMParser().parseFromString(s, 'image/svg+xml').documentElement;

describe('clipboard', () => {
  const doc = parse(`<svg xmlns="${NS}" viewBox="0 0 100 100" width="100" height="100">
    <defs>
      <linearGradient id="g1" href="#g0"/><linearGradient id="g0"><stop offset="0"/></linearGradient>
      <marker id="m"/><filter id="unused"/>
    </defs>
    <rect id="r" fill="url(#g1)" width="10" height="10"/>
    <path id="p" d="M0 0L5 5" style="marker-end:url(&quot;#m&quot;)"/>
  </svg>`);

  it('finds references in attributes and styles', () => {
    expect([...referencedIds([doc.querySelector('#r')!, doc.querySelector('#p')!])].sort()).toEqual(['g1', 'm']);
  });

  it('copies referenced defs transitively, wraps transformed selections', () => {
    const text = buildClip([doc.querySelector('#r')!, doc.querySelector('#p')!], doc, [2, 0, 0, 2, 5, 5]);
    const root = parse(text);
    expect(root.hasAttribute(CLIP_ATTR)).toBe(true);
    expect([...root.querySelectorAll('defs > *')].map((e) => e.id).sort()).toEqual(['g0', 'g1', 'm']);
    expect(root.querySelector(':scope > g')!.getAttribute('transform')).toBe('matrix(2 0 0 2 5 5)');
    expect(root.querySelectorAll(':scope > g > *')).toHaveLength(2);
    expect(text.match(/xmlns="/g)).toHaveLength(1);
  });

  it('round-trips a Curve clip', () => {
    const clip = parseClip(buildClip([doc.querySelector('#r')!], doc, null))!;
    expect(clip.curve).toBe(true);
    expect(clip.content.map((e) => e.id)).toEqual(['r']);
    expect(clip.defs.map((e) => e.id).sort()).toEqual(['g0', 'g1']);
    expect(clip.transform).toBeNull();
  });

  it('maps a foreign viewBox to its size and sanitises', () => {
    const clip = parseClip(`<?xml version="1.0"?><svg xmlns="${NS}" width="48" height="48" viewBox="0 0 24 24"><title>x</title><style>.a{}</style><path class="a" d="M0 0" onclick="x()"/><script>bad()</script></svg>`)!;
    expect(clip.curve).toBe(false);
    expect(clip.transform).toBe('matrix(2 0 0 2 0 0)');
    expect(clip.content.map((e) => e.localName)).toEqual(['path']);
    expect(clip.defs.map((e) => e.localName)).toEqual(['style']);
    expect(clip.content[0].hasAttribute('onclick')).toBe(false);
    expect(clip.report.removedElements.script).toBe(1);
  });

  it('rejects non-SVG text', () => {
    expect(parseClip('hello')).toBeNull();
    expect(parseClip('<svg><unclosed')).toBeNull();
  });
});

describe('planDefs', () => {
  const NS2 = 'http://www.w3.org/2000/svg';
  const target = new DOMParser().parseFromString(`<svg xmlns="${NS2}"><defs><symbol id="star"><path d="M0 0"/></symbol><linearGradient id="g"><stop offset="0"/></linearGradient></defs></svg>`, 'image/svg+xml').documentElement;
  const defsOf = (markup: string) => Array.from(new DOMParser().parseFromString(`<svg xmlns="${NS2}">${markup}</svg>`, 'image/svg+xml').documentElement.children);

  it('reuses every existing id when pasting back into the same document', () => {
    const plan = planDefs(defsOf('<symbol id="star"><path d="M9 9"/></symbol><marker id="m"/>'), target, true);
    expect(plan.reused).toEqual(['star']);
    expect(plan.insert.map((e) => e.id)).toEqual(['m']);
  });

  it('reuses identical definitions from another document, inserts different ones', () => {
    const plan = planDefs(defsOf('<symbol id="star"><path d="M0 0"/></symbol><linearGradient id="g"><stop offset="1"/></linearGradient>'), target, false);
    expect(plan.reused).toEqual(['star']);
    expect(plan.insert.map((e) => e.id)).toEqual(['g']); // same id, different content: kept apart
  });

  it('round-trips the document token through a clip', () => {
    const doc = new DOMParser().parseFromString(`<svg xmlns="${NS2}"><rect id="r"/></svg>`, 'image/svg+xml').documentElement;
    expect(parseClip(buildClip([doc.querySelector('#r')!], doc, null, 'tok123'))!.docToken).toBe('tok123');
  });
});
