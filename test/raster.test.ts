import { clampSize, minifySvg } from '../src/engine/raster';

describe('export helpers', () => {
  it('clamps raster size to canvas limits keeping aspect ratio', () => {
    expect(clampSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(clampSize(32768, 8192)).toEqual({ width: 16384, height: 4096 });
    const big = clampSize(16000, 16000);
    expect(big.width * big.height).toBeLessThanOrEqual(268_435_456);
  });

  it('minifies structure but keeps text content and attributes', () => {
    const out = minifySvg(`<svg xmlns="http://www.w3.org/2000/svg">
      <!-- comment -->
      <metadata>junk</metadata>
      <g>
        <rect width="1"   height="2"/>
      </g>
      <text x="0"> Hello  <tspan> world</tspan> </text>
    </svg>`);
    expect(out).toBe('<svg xmlns="http://www.w3.org/2000/svg"><g><rect width="1" height="2"/></g><text x="0"> Hello  <tspan> world</tspan> </text></svg>');
  });
});
