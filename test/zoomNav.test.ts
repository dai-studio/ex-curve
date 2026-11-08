import { NAV_MAX_ZOOM, NAV_MIN_ZOOM, mapBounds, mapDeltaToCanvas, mapScale, mapToCanvas, sliderToZoom, zoomToSlider } from '../src/app/zoomNav';

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);

describe('zoom navigator maths', () => {
  it('maps the slider logarithmically and round-trips', () => {
    close(sliderToZoom(0), NAV_MIN_ZOOM);
    close(sliderToZoom(1), NAV_MAX_ZOOM);
    for (const z of [0.1, 0.5, 1, 2, 8]) close(sliderToZoom(zoomToSlider(z)), z);
    close(zoomToSlider(1000), 1);
    close(zoomToSlider(0.001), 0);
  });

  it('bounds the page and the view, padded', () => {
    expect(mapBounds({ x: 0, y: 0, width: 800, height: 600 }, { x: 700, y: -100, width: 400, height: 300 }, 40))
      .toEqual({ x: -40, y: -140, width: 1180, height: 780 });
  });

  it('converts map pixels to canvas coordinates with letterboxing', () => {
    const b = { x: 0, y: 0, width: 288, height: 90 }; // twice as wide as the 144×90 map
    expect(mapScale(b, 144, 90)).toEqual({ scale: 0.5, offsetX: 0, offsetY: 22.5 });
    expect(mapToCanvas({ x: 72, y: 45 }, b, 144, 90)).toEqual({ x: 144, y: 45 });
    expect(mapDeltaToCanvas({ x: 10, y: -4 }, b, 144, 90)).toEqual({ x: 20, y: -8 });
  });
});
