import '@testing-library/jest-dom/vitest';

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

if (typeof Element !== 'undefined' && !Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}

const mockAnimate = () => ({
  onfinish: null,
  cancel: () => {},
  play: () => {},
  pause: () => {},
  finish: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
} as unknown as Animation);

if (typeof Element !== 'undefined') {
  Element.prototype.animate = mockAnimate;
}
if (typeof HTMLElement !== 'undefined') {
  HTMLElement.prototype.animate = mockAnimate;
}
if (typeof SVGElement !== 'undefined') {
  SVGElement.prototype.animate = mockAnimate;
}
if (typeof window !== 'undefined') {
  if (window.Element) window.Element.prototype.animate = mockAnimate;
  if (window.HTMLElement) window.HTMLElement.prototype.animate = mockAnimate;
  if (window.SVGElement) window.SVGElement.prototype.animate = mockAnimate;
}

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function (contextId: string) {
    if (contextId === '2d') {
      return {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        fillRect: () => {},
        clearRect: () => {},
        beginPath: () => {},
        arc: () => {},
        fill: () => {},
        stroke: () => {},
        moveTo: () => {},
        lineTo: () => {},
        setTransform: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) }),
      } as unknown as RenderingContext;
    }
    return null;
  } as typeof HTMLCanvasElement.prototype.getContext;
}

