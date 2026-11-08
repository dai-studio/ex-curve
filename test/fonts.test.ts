import { documentFamilies, formatFamilies, loadInstalledFamilies, parseFamilies, primaryFamily, quoteFamily, resetInstalledFamilies, withFamily } from '../src/app/fonts';

describe('font-family lists', () => {
  it('parses quoted and unquoted families', () => {
    expect(parseFamilies(`"Times New Roman", Georgia,  'Noto  Sans' , serif`)).toEqual(['Times New Roman', 'Georgia', 'Noto Sans', 'serif']);
    expect(parseFamilies('"A, B", C')).toEqual(['A, B', 'C']);
    expect(parseFamilies('')).toEqual([]);
  });
  it('quotes only when needed', () => {
    expect(quoteFamily('Inter')).toBe('Inter');
    expect(quoteFamily('Noto Sans')).toBe('Noto Sans');
    expect(quoteFamily('Source Sans 3')).toBe('"Source Sans 3"');
    expect(quoteFamily('Font "X"')).toBe('"Font \\"X\\""');
    expect(quoteFamily('serif')).toBe('serif');
    expect(formatFamilies(['Source Sans 3', 'sans-serif'])).toBe('"Source Sans 3", sans-serif');
  });
  it('picks a family keeping the generic fallback', () => {
    expect(primaryFamily('Georgia, serif')).toBe('Georgia');
    expect(withFamily('Georgia, serif', 'Inter')).toBe('Inter, serif');
    expect(withFamily('system-ui, sans-serif', 'Source Sans 3')).toBe('"Source Sans 3", system-ui');
    expect(withFamily(null, 'Inter')).toBe('Inter');
    expect(withFamily('Georgia, serif', 'monospace')).toBe('monospace');
  });
  it('collects families used in a document', () => {
    const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" font-family="Inter, sans-serif">
      <style>.t { font-family: "Fira Code", monospace; }</style>
      <text font-family="Georgia, serif"/><text style="fill:red; font-family: 'Inter'"/></svg>`, 'image/svg+xml').documentElement;
    expect(documentFamilies(doc)).toEqual(['Inter', 'sans-serif', 'Fira Code', 'monospace', 'Georgia', 'serif']);
  });
});

describe('installed fonts', () => {
  beforeEach(() => resetInstalledFamilies());
  it('uses the host list, deduped and sorted', async () => {
    expect(await loadInstalledFamilies(async () => ['Zapfino', 'Arial', 'Arial', ' Menlo '])).toEqual(['Arial', 'Menlo', 'Zapfino']);
  });
  it('explains when the browser can’t list fonts', async () => {
    await expect(loadInstalledFamilies()).rejects.toThrow(/can’t list installed fonts/);
  });
});
