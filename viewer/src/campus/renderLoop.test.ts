import { describe, expect, it } from "vitest";
import type { FlagsHandle } from "./flagsSeam";
import { IDLE_FRAMES, createRenderLoop, type FrameScheduler } from "./renderLoop";

/** Runs scheduled frames by hand, 1/60 s apart. */
function fakeScheduler() {
  const pending = new Map<number, (timeMs: number) => void>();
  let nextId = 1;
  let time = 0;
  const scheduler: FrameScheduler = {
    request(callback) {
      pending.set(nextId, callback);
      return nextId++;
    },
    cancel(id) {
      pending.delete(id);
    },
  };
  return {
    scheduler,
    get pending() {
      return pending.size;
    },
    /** Runs up to `count` frames; returns how many ran before nothing was scheduled. */
    run(count: number) {
      let ran = 0;
      for (; ran < count && pending.size > 0; ran++) {
        const [id, callback] = pending.entries().next().value!;
        pending.delete(id);
        time += 1000 / 60;
        callback(time);
      }
      return ran;
    },
  };
}

function fakeFlags(animating: () => boolean) {
  const handle = { updates: [] as number[], disposed: 0, update: (dt: number) => false, dispose: () => {} };
  handle.update = (dt: number) => {
    handle.updates.push(dt);
    return animating();
  };
  handle.dispose = () => {
    handle.disposed++;
  };
  return handle satisfies FlagsHandle;
}

function setup() {
  const frames = fakeScheduler();
  let renders = 0;
  const loop = createRenderLoop(frames.scheduler, { updateCamera: () => false, render: () => renders++ });
  return { frames, loop, renders: () => renders };
}

describe("createRenderLoop", () => {
  it("stops after a short idle tail when nothing animates", () => {
    const { frames, loop, renders } = setup();
    loop.requestRender();
    expect(frames.run(1000)).toBe(1 + IDLE_FRAMES);
    expect(renders()).toBe(1);
    expect(loop.running).toBe(false);
  });

  it("keeps frames coming while the flags' update returns true", () => {
    const { frames, loop, renders } = setup();
    let pulsing = true;
    const flags = fakeFlags(() => pulsing);
    loop.replaceFlags(() => flags);

    expect(frames.run(600)).toBe(600); // ten seconds at 60 fps, still scheduled
    expect(loop.running).toBe(true);
    expect(renders()).toBe(600);
    expect(flags.updates[0]).toBe(0);
    expect(flags.updates[1]).toBeCloseTo(1 / 60, 6);

    pulsing = false;
    expect(frames.run(1000)).toBe(IDLE_FRAMES);
    expect(loop.running).toBe(false);
  });

  it("disposes the previous handle before creating the next one on reload", () => {
    const { loop } = setup();
    const first = fakeFlags(() => false);
    const second = fakeFlags(() => false);
    loop.replaceFlags(() => first);

    let firstDisposedBeforeCreate = false;
    loop.replaceFlags(() => {
      firstDisposedBeforeCreate = first.disposed === 1;
      return second;
    });
    expect(firstDisposedBeforeCreate).toBe(true);
    expect(first.disposed).toBe(1);
    expect(second.disposed).toBe(0);

    loop.replaceFlags(() => null);
    expect(second.disposed).toBe(1);
  });

  it("disposes the flags and cancels the frame on dispose", () => {
    const { frames, loop } = setup();
    const flags = fakeFlags(() => true);
    loop.replaceFlags(() => flags);
    loop.dispose();
    expect(flags.disposed).toBe(1);
    expect(frames.pending).toBe(0);
  });
});
