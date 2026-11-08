import { attrKind, enumOptions } from '../src/app/attrKinds';

describe('attrKind', () => {
  it('uses number fields only for plain numbers', () => {
    expect(attrKind('x', '40')).toEqual({ kind: 'number', step: 1 });
    expect(attrKind('width', '12.5')).toEqual({ kind: 'number', step: 1, min: 0 });
    expect(attrKind('x', '-3e2')).toMatchObject({ kind: 'number' });
    expect(attrKind('width', '50%')).toEqual({ kind: 'text' });
    expect(attrKind('x', '10px')).toEqual({ kind: 'text' });
    expect(attrKind('x', '1 2 3')).toEqual({ kind: 'text' });
  });
  it('bounds opacities and font weights', () => {
    expect(attrKind('fill-opacity', '0.5')).toEqual({ kind: 'number', step: 0.05, min: 0, max: 1 });
    expect(attrKind('font-weight', '700')).toEqual({ kind: 'number', step: 100, min: 1, max: 1000 });
    expect(attrKind('font-weight', 'bold')).toMatchObject({ kind: 'enum' });
  });
  it('keeps numeric-looking identifiers as text', () => {
    expect(attrKind('id', '123')).toEqual({ kind: 'text' });
    expect(attrKind('version', '1.1')).toEqual({ kind: 'text' });
  });
  it('recognises colours, keywords and long values', () => {
    expect(attrKind('fill', 'url(#g)')).toEqual({ kind: 'color' });
    expect(attrKind('stop-color', '#fff')).toEqual({ kind: 'color' });
    expect(attrKind('data-accent', '#ff0066')).toEqual({ kind: 'color' });
    expect(attrKind('stroke-linecap', 'round')).toMatchObject({ kind: 'enum', options: ['butt', 'round', 'square'] });
    expect(attrKind('d', 'M0 0L10 10')).toEqual({ kind: 'long' });
    expect(attrKind('transform', 'translate(5 5)')).toEqual({ kind: 'long' });
    expect(attrKind('href', '#star')).toEqual({ kind: 'text' });
    expect(attrKind('font-family', 'Georgia, serif')).toEqual({ kind: 'font' });
  });
  it('keeps a non-standard keyword selectable', () => {
    expect(enumOptions(['a', 'b'], 'b')).toEqual(['a', 'b']);
    expect(enumOptions(['a', 'b'], 'inherit')).toEqual(['inherit', 'a', 'b']);
  });
});
