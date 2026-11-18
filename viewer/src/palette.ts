// KSU-GO look: one small palette shared by the campus map and the indoor route.
//
// Colors come from the MAP-1 "Path A" look test (warm pastel walls, soft lawn,
// cream walkways, pale-blue sky). Names describe a role, never a building, so the
// route scene can reuse them. Values are sRGB hex numbers for `new Color(hex)`.

const CREAM = 0xfffaf0;
const SAND = 0xead2a4;
const HORIZON = 0xd8f1ee;

export const palette = {
  /** Lawn: `near` at the section center fading to `far` in the fog, with soft `patch` blotches. */
  ground: { near: 0x93dc6c, far: 0x5fc25e, patch: 0xb4ea86 },
  /** Paved walkways and corridor floors, with a thin darker `edge`. */
  walkway: { fill: 0xf9ebc4, edge: SAND },
  /** Open paved square: `fill`, its curb `edge`, a stone `ring` and the `lawn` inside it. */
  plaza: { fill: CREAM, edge: SAND, ring: 0xf0d9a8, lawn: 0x8fd96b },
  /** Building walls, warm pastels. Pick by index and cycle. */
  walls: [0xf8d4d0, 0xfadcc6, 0xf5d5e2, 0xf1e2c8, 0xf4d6c8, 0xeedad0, 0xf6dfcc],
  /** A roof is its wall color shifted by `tint` (THREE `Color.offsetHSL`), edged in `trim`, with `unit` boxes on top. */
  roof: { tint: { hue: 0, saturation: -0.06, lightness: -0.07 }, trim: CREAM, unit: 0xe9e4da },
  /** Window glass; `lit` panes are scattered among the plain ones. */
  window: { glass: 0x86aed1, lit: 0xa9cbe6 },
  /** Entrances: door `panel`, light `frame`, and `awnings` paired by index with `walls`. */
  door: {
    panel: 0x5e4636,
    frame: CREAM,
    awnings: [0xe8736b, 0xe0893f, 0xd0659f, 0xc9973f, 0xc4775a, 0xb7826a, 0xd9805a],
  },
  /** The demo building stands out: warmer wall and roof, and an `accent` for its awning and outline. */
  demo: { wall: 0xffdf9a, roof: 0xf4bd72, trim: 0xfff1cf, accent: 0xef6a4c },
  /** Low-poly trees: round `leafy` crowns and stacked-cone `conifer` crowns. */
  trees: { trunk: 0x9a6b47, leafy: 0x58b54f, conifer: 0x3f9e5a },
  /** The plaza sculpture: stone `pedestal`, and a globe of `ocean` and `land` with a gold `ring`. */
  landmark: { pedestal: 0xece0c8, ocean: 0x45a6dd, land: 0x8fd36c, ring: 0xf2c14e },
  /** Sky gradient from `horizon` up to `top`. Distance `fog` matches the horizon so far objects melt into it. */
  sky: { top: 0x6ec3f2, horizon: HORIZON, fog: HORIZON },
  /** Light colors: hemisphere `sky` and `ground`, plus the warm `sun`. */
  light: { sky: 0xf2f8ff, ground: 0x9cc77f, sun: 0xfff0d8 },
  /** Overlays such as the map credit and labels: dark `text` on a light `surface`, and a dark `scrim`. */
  ui: { text: 0x34514a, surface: 0xffffff, surfaceWarm: CREAM, scrim: 0x142828 },
} as const;

export type Palette = typeof palette;
