/** Styles for the drag handle. Hosts supply the colour tokens, as for the canvas. */
export const RESIZE_CSS = `
.resizer { position: relative; flex: none; width: 0; z-index: 3; }
.resizer::before {
  content: ""; position: absolute; top: 0; bottom: 0; left: -4px; width: 8px; cursor: col-resize;
}
.resizer::after {
  content: ""; position: absolute; top: 0; bottom: 0; left: -1px; width: 2px;
  background: var(--accent); opacity: 0; transition: opacity .12s; pointer-events: none;
}
.resizer:hover::after, .resizer.dragging::after, .resizer:focus-visible::after { opacity: 1; }
.resizer:focus-visible { outline: none; }
.resizer:has(+ [hidden]) { display: none; }
`;

export interface ResizeOptions {
  /** The panel edge the handle sits on. */
  edge: 'left' | 'right';
  /** The flexible element that gives up space as the panel grows. */
  neighbor: HTMLElement;
  /** Narrowest the panel may get. */
  min: number;
  /** Narrowest the neighbor may get. */
  neighborMin: number;
  label: string;
}

const KEY_STEP = 16;

/**
 * A drag handle for one panel. The handle is a sibling of the panel, so hosts that
 * replace the panel's children keep it. Widths last for the page's lifetime, one per mode.
 */
export class PanelResizer {
  readonly handle: HTMLElement;
  private widths = new Map<string, number>();
  private mode = '';
  private fallback = 0;

  constructor(private panel: HTMLElement, private opts: ResizeOptions) {
    this.handle = document.createElement('div');
    this.handle.className = 'resizer';
    this.handle.tabIndex = 0;
    this.handle.title = 'Drag to resize, double-click to reset';
    this.handle.setAttribute('role', 'separator');
    this.handle.setAttribute('aria-orientation', 'vertical');
    this.handle.setAttribute('aria-label', opts.label);
    this.handle.addEventListener('pointerdown', this.onPointerDown);
    this.handle.addEventListener('dblclick', () => this.set(this.fallback));
    this.handle.addEventListener('keydown', this.onKeyDown);
    // Re-clamp when the window shrinks, without losing the chosen width for when it grows back.
    window.addEventListener('resize', () => {
      if (this.mode && !this.panel.hidden) this.apply(this.preferred());
    });
  }

  /** Applies the width last set in this mode, or the given default. */
  use(mode: string, fallback: number): void {
    this.mode = mode;
    this.fallback = fallback;
    this.apply(this.preferred());
  }

  private preferred(): number {
    return this.widths.get(this.mode) ?? this.fallback;
  }

  private set(width: number): void {
    this.widths.set(this.mode, this.apply(width));
  }

  private apply(width: number): number {
    const current = this.panel.getBoundingClientRect().width;
    // Without layout (hidden panel), the neighbor can't be measured, so only the minimum applies.
    const max = this.panel.hidden
      ? Infinity
      : current + this.opts.neighbor.getBoundingClientRect().width - this.opts.neighborMin;
    const clamped = Math.round(Math.max(this.opts.min, Math.min(width, max)));
    this.panel.style.width = `${clamped}px`;
    return clamped;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = this.panel.getBoundingClientRect().width;
    const sign = this.opts.edge === 'left' ? -1 : 1;
    this.handle.setPointerCapture(event.pointerId);
    this.handle.classList.add('dragging');

    const move = (e: PointerEvent): void => this.set(startWidth + sign * (e.clientX - startX));
    const end = (): void => {
      this.handle.classList.remove('dragging');
      this.handle.removeEventListener('pointermove', move);
      this.handle.removeEventListener('pointerup', end);
      this.handle.removeEventListener('pointercancel', end);
    };
    this.handle.addEventListener('pointermove', move);
    this.handle.addEventListener('pointerup', end);
    this.handle.addEventListener('pointercancel', end);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const grow = this.opts.edge === 'left' ? 'ArrowLeft' : 'ArrowRight';
    const shrink = this.opts.edge === 'left' ? 'ArrowRight' : 'ArrowLeft';
    if (event.key !== grow && event.key !== shrink) return;
    event.preventDefault();
    const width = this.panel.getBoundingClientRect().width;
    this.set(width + (event.key === grow ? KEY_STEP : -KEY_STEP));
  };
}
