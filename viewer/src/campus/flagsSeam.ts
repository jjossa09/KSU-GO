// The contract between the campus scene (MAP-3, ./index.ts) and the event
// flags (MAP-4, ./flags.ts). MAP-4 implements it as:
//
//   export const createFlags: CreateFlags = (flagsLayer, campus, events, now) => { ... };
//
// The scene calls createFlags once per campus:load, after disposing the handle
// from the previous load, and calls update() on every frame it draws.

import type { Group } from "three";
import type { Campus, Event } from "../../../shared/types";

export type FlagsHandle = {
  /**
   * Advances flag animation by `dtSeconds` (0 on the first frame after a pause).
   * Return true while the flags still need frames, for example while live flags
   * pulse; the scene keeps drawing until it returns false and the camera is still.
   */
  update(dtSeconds: number): boolean;
  /** Removes this load's flags from the layer and frees their geometry and materials. */
  dispose(): void;
};

/**
 * Adds the flags for `events` to `flagsLayer` (an empty group the scene owns),
 * placing them at building entrances from `campus`. `now` is the ISO time sent
 * with campus:load; flag state and height follow CONTRACTS.md §2.
 */
export type CreateFlags = (flagsLayer: Group, campus: Campus, events: Event[], now: string) => FlagsHandle;
