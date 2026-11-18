// Render on demand: frames run only while the camera moves, a render was
// requested, or the flags say they are animating. Pure (no DOM, no WebGL), so
// tests drive it with a fake frame scheduler.

import type { FlagsHandle } from "./flagsSeam";

export type FrameScheduler = {
  request(callback: (timeMs: number) => void): number;
  cancel(id: number): void;
};

/** Quiet frames to run after the last change, so damping can settle, before stopping. */
export const IDLE_FRAMES = 30;
/** Longest step passed to flags, so a stalled tab does not jump animations. */
const MAX_DT_SECONDS = 0.25;

export function createRenderLoop(
  scheduler: FrameScheduler,
  step: {
    /** Advances camera controls; returns true if the camera moved. */
    updateCamera(): boolean;
    render(): void;
  },
) {
  let frameId = 0;
  let needsRender = true;
  let idleFrames = 0;
  let lastTime: number | undefined;
  let flags: FlagsHandle | null = null;

  function frame(timeMs: number) {
    frameId = 0;
    const dt = lastTime === undefined ? 0 : Math.min(Math.max((timeMs - lastTime) / 1000, 0), MAX_DT_SECONDS);
    lastTime = timeMs;
    const moved = step.updateCamera();
    const animating = flags ? flags.update(dt) : false;
    if (moved || animating || needsRender) {
      step.render();
      needsRender = false;
      idleFrames = 0;
    } else {
      idleFrames++;
    }
    if (frameId) return; // a render was requested while this frame ran
    if (idleFrames < IDLE_FRAMES) frameId = scheduler.request(frame);
    else lastTime = undefined;
  }

  function requestRender() {
    needsRender = true;
    idleFrames = 0;
    if (!frameId) frameId = scheduler.request(frame);
  }

  return {
    requestRender,
    /** True while a frame is scheduled. */
    get running() {
      return frameId !== 0;
    },
    /**
     * Disposes the current flags handle, then calls `create` for the next one
     * (null for no flags) and draws. Called on every campus:load.
     */
    replaceFlags(create: () => FlagsHandle | null) {
      const previous = flags;
      flags = null;
      previous?.dispose();
      flags = create();
      requestRender();
    },
    dispose() {
      if (frameId) scheduler.cancel(frameId);
      frameId = 0;
      const previous = flags;
      flags = null;
      previous?.dispose();
    },
  };
}
