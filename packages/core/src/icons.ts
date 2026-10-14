import { svgEl } from './canvas.js';

/** Stroke icons on a 24px grid, drawn in the current text colour. */
const PATHS = {
  close: ['M6 6l12 12', 'M18 6L6 18'],
  fit: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
  refresh: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],
  questions: ['m3 17 2 2 4-4', 'm3 7 2 2 4-4', 'M13 6h8', 'M13 12h8', 'M13 18h8'],
  compare: ['M4 4h16v16H4z', 'M12 4v16'],
  jump: ['m15 14 5-5-5-5', 'M4 20v-7a4 4 0 0 1 4-4h12'],
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 14): SVGSVGElement {
  const svg = svgEl('svg', {
    class: 'icon',
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  });
  for (const d of PATHS[name]) svg.append(svgEl('path', { d }));
  return svg;
}

/** The mark: one turn forking into two endings, the live one in the accent colour. */
export function logo(size = 18): SVGSVGElement {
  const svg = svgEl('svg', { class: 'logo', viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true' });
  const edge = { fill: 'none', 'stroke-width': 2, 'stroke-linecap': 'round' };
  svg.append(
    svgEl('path', { ...edge, d: 'M6 12c6 0 5 6 12 6', stroke: 'var(--line)' }),
    svgEl('path', { ...edge, d: 'M6 12c6 0 5-6 12-6', stroke: 'var(--accent)' }),
    svgEl('circle', { cx: 5, cy: 12, r: 3, fill: 'var(--human)' }),
    svgEl('circle', { cx: 19, cy: 18, r: 2.5, fill: 'var(--assistant)' }),
    svgEl('circle', { cx: 19, cy: 6, r: 3, fill: 'var(--accent)' }),
  );
  return svg;
}
