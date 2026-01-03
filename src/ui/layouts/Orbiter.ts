import {Grid, GridOptions} from './Grid.js';

/**
 * A layout container designed to hold secondary UI elements, such
 * as an exit button or settings icon. It typically "orbits" or remains
 * attached to a corner of its parent panel, outside the main content area.
 */

export type OrbiterPosition =
  | 'top-right'
  | 'top-left'
  | 'bottom-right'
  | 'bottom-left'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right';

export type OrbiterOptions = GridOptions & {
  orbiterPosition?: OrbiterPosition;
  orbiterScale?: number;
  offset?: number;
  elevation?: number;
};

export class Orbiter extends Grid {
  orbiterPosition: OrbiterPosition;
  orbiterScale: number;
  offset: number;
  elevation: number;

  // These values are based on Material Design guidelines: https://developer.android.com/design/ui/xr/guides/spatial-ui
  private static readonly BASE_OFFSET = 0.05; // put the orbiter within 20dp of the parent panel by default
  private static readonly BASE_ELEVATION = 0.02; // put the orbiter at 15dp above the parent panel by default
  private static readonly MAX_OUTWARD = 0.1; // avoid the orbiter being too far away from the parent panel

  constructor(options: OrbiterOptions = {}) {
    const {
      orbiterPosition = 'top-right',
      orbiterScale = 0.2,
      offset = 0.0,
      elevation = 0.0,
      ...gridOptions
    } = options;

    super(gridOptions);

    this.orbiterPosition = orbiterPosition;
    this.orbiterScale = orbiterScale;
    this.offset = offset;
    this.elevation = elevation;
  }

  init() {
    super.init();
    this.scale.set(this.orbiterScale, this.orbiterScale, 1.0);
    this._place();
  }

  private _place() {
    const hx = this.rangeX * 0.5;
    const hy = this.rangeY * 0.5;

    const rightEdge = -hx;
    const leftEdge = +hx;
    const topEdge = +hy;
    const bottomEdge = -hy;

    // Clamp edge spacing so the orbiter stays within the recommended range:
    // edgeDelta == 0 corresponds to the 50% overlap boundary.
    const edgeDeltaRaw = Orbiter.BASE_OFFSET + this.offset;
    const edgeDelta = Math.max(0, Math.min(Orbiter.MAX_OUTWARD, edgeDeltaRaw));

    // Clamp elevation so the orbiter remains in front of the parent panel and doesn’t float excessively.
    const zDeltaRaw = Orbiter.BASE_ELEVATION + this.elevation;
    const zDelta = Math.max(0, Math.min(Orbiter.MAX_OUTWARD, zDeltaRaw));

    let x = 0.0;
    let y = 0.0;

    switch (this.orbiterPosition) {
      case 'top':
        x = 0.0;
        y = topEdge + edgeDelta;
        break;
      case 'bottom':
        x = 0.0;
        y = bottomEdge - edgeDelta;
        break;
      case 'right':
        x = rightEdge - edgeDelta;
        y = 0.0;
        break;
      case 'left':
        x = leftEdge + edgeDelta;
        y = 0.0;
        break;
      case 'top-right':
        x = rightEdge - edgeDelta;
        y = topEdge + edgeDelta;
        break;
      case 'top-left':
        x = leftEdge + edgeDelta;
        y = topEdge + edgeDelta;
        break;
      case 'bottom-right':
        x = rightEdge - edgeDelta;
        y = bottomEdge - edgeDelta;
        break;
      case 'bottom-left':
        x = leftEdge + edgeDelta;
        y = bottomEdge - edgeDelta;
        break;
    }

    const z = this.position.z + zDelta;
    this.position.set(x, y, z);
  }
}
