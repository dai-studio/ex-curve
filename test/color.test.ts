import { hexToHsv, hexToRgb, hsvToHex, rgbToHex } from '../src/app/color';

describe('colour conversions', () => {
  it('parses and formats hex', () => {
    expect(hexToRgb('#f0a')).toEqual([255, 0, 170]);
    expect(hexToRgb('7cc6fe')).toEqual([124, 198, 254]);
    expect(hexToRgb('nope')).toBeNull();
    expect(rgbToHex(255, 0, 170.4)).toBe('#ff00aa');
  });
  it('converts primaries and greys to HSV', () => {
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv('#00ff00')).toEqual({ h: 120, s: 1, v: 1 });
    expect(hexToHsv('#808080')).toEqual({ h: 0, s: 0, v: 128 / 255 });
  });
  it('round-trips hex → HSV → hex', () => {
    for (const hex of ['#7cc6fe', '#1d4e89', '#f49cbb', '#000000', '#ffffff', '#4d47bd', '#753cec', '#123456']) {
      expect(hsvToHex(hexToHsv(hex)!)).toBe(hex);
    }
  });
});
