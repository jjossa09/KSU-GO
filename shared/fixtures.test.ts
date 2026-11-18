// Checks every fixture in shared/fixtures/ against shared/types.ts at runtime.
// Each parser builds a typed value field by field from `unknown`, so the
// compiler checks the parser against the type and the test checks the JSON.

import { describe, expect, it } from "vitest";
import type { Campus, Check, Event, EventSeed, Route, Step, StepBase } from "./types";
import seedJson from "./fixtures/events.seed.json";
import campusJson from "./fixtures/campus.json";
import sampleJson from "./fixtures/route.sample.json";
import flawedJson from "./fixtures/route.draft-flawed.json";
import placeholderJson from "./fixtures/routes/placeholder.draft.json";

// ---- Generic helpers ----

function fail(path: string, msg: string): never {
  throw new Error(`${path}: ${msg}`);
}

function obj(v: unknown, path: string): object {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(path, "expected an object");
  return v;
}

/** Fails on a missing key or on any key outside `allowed`. */
function keys(o: object, allowed: readonly string[], path: string): void {
  for (const k of allowed) {
    if (!Object.hasOwn(o, k)) fail(path, `missing key "${k}"`);
  }
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) fail(path, `unexpected key "${k}"`);
  }
}

function get(o: object, k: string): unknown {
  return Reflect.get(o, k);
}

function str(v: unknown, path: string): string {
  if (typeof v !== "string") fail(path, "expected a string");
  return v;
}

function num(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) fail(path, "expected a finite number");
  return v;
}

function nullable<T>(v: unknown, path: string, parse: (v: unknown, path: string) => T): T | null {
  return v === null ? null : parse(v, path);
}

function arr<T>(v: unknown, path: string, parse: (v: unknown, path: string) => T): T[] {
  if (!Array.isArray(v)) fail(path, "expected an array");
  const items: unknown[] = v;
  return items.map((item, i) => parse(item, `${path}[${i}]`));
}

function oneOf<K extends string>(allowed: Record<K, true>, v: unknown, path: string): K {
  const isK = (x: unknown): x is K => typeof x === "string" && Object.hasOwn(allowed, x);
  if (!isK(v)) fail(path, `expected one of ${Object.keys(allowed).join(", ")}, got ${JSON.stringify(v)}`);
  return v;
}

function point(v: unknown, path: string): [number, number] {
  if (!Array.isArray(v) || v.length !== 2) fail(path, "expected an [x, z] pair");
  const pair: unknown[] = v;
  return [num(pair[0], `${path}[0]`), num(pair[1], `${path}[1]`)];
}

// Exhaustive value sets for each union in types.ts. Record<Union, true>
// fails to compile if a member is missing or misspelled.

const CATEGORIES: Record<Event["category"], true> = {
  academic: true, social: true, career: true, sports: true, arts: true, other: true,
};
const STATUSES: Record<Route["status"], true> = { processing: true, draft: true, confirmed: true, failed: true };
const STAGES: Record<NonNullable<Route["progress"]>["stage"], true> = {
  ingest: true, timeline: true, geometry: true, assemble: true, verify: true,
};
const SOURCES: Record<StepBase["source"], true> = { ai: true, organizer: true };
const STEP_TYPES: Record<Step["type"], true> = { walk: true, turn: true, stairs: true, elevator: true, door: true };
const TURN_DIRECTIONS: Record<Extract<Step, { type: "turn" }>["direction"], true> = {
  left: true, right: true, u_left: true, u_right: true,
};
const STAIR_DIRECTIONS: Record<Extract<Step, { type: "stairs" }>["direction"], true> = { up: true, down: true };
const LEVELS: Record<Check["level"], true> = { pass: true, warn: true, fail: true };

// ---- Parsers, one per contract type ----

function parseEventSeed(v: unknown, path: string): EventSeed {
  const o = obj(v, path);
  keys(o, ["id", "title", "description", "organizer", "category", "startsInMin", "durationMin",
    "location", "routeId", "capacity", "registeredCount"], path);
  const loc = obj(get(o, "location"), `${path}.location`);
  keys(loc, ["buildingId", "room"], `${path}.location`);
  return {
    id: str(get(o, "id"), `${path}.id`),
    title: str(get(o, "title"), `${path}.title`),
    description: str(get(o, "description"), `${path}.description`),
    organizer: str(get(o, "organizer"), `${path}.organizer`),
    category: oneOf(CATEGORIES, get(o, "category"), `${path}.category`),
    startsInMin: num(get(o, "startsInMin"), `${path}.startsInMin`),
    durationMin: num(get(o, "durationMin"), `${path}.durationMin`),
    location: {
      buildingId: str(get(loc, "buildingId"), `${path}.location.buildingId`),
      room: str(get(loc, "room"), `${path}.location.room`),
    },
    routeId: nullable(get(o, "routeId"), `${path}.routeId`, str),
    capacity: nullable(get(o, "capacity"), `${path}.capacity`, num),
    registeredCount: num(get(o, "registeredCount"), `${path}.registeredCount`),
  };
}

function parseBuilding(v: unknown, path: string): Campus["buildings"][number] {
  const o = obj(v, path);
  keys(o, ["id", "name", "footprint", "heightM", "entrance"], path);
  return {
    id: str(get(o, "id"), `${path}.id`),
    name: str(get(o, "name"), `${path}.name`),
    footprint: arr(get(o, "footprint"), `${path}.footprint`, point),
    heightM: num(get(o, "heightM"), `${path}.heightM`),
    entrance: point(get(o, "entrance"), `${path}.entrance`),
  };
}

function parseCampus(v: unknown, path: string): Campus {
  const o = obj(v, path);
  keys(o, ["attribution", "buildings", "paths"], path);
  return {
    attribution: nullable(get(o, "attribution"), `${path}.attribution`, str),
    buildings: arr(get(o, "buildings"), `${path}.buildings`, parseBuilding),
    paths: arr(get(o, "paths"), `${path}.paths`, (p, pp) => arr(p, pp, point)),
  };
}

function confidence(v: unknown, path: string): number {
  const n = num(v, path);
  if (n < 0 || n > 1) fail(path, "confidence must be from 0 to 1");
  return n;
}

const BASE_KEYS: readonly string[] = ["id", "type", "source", "confidence", "tSec", "note"];
const TYPE_KEYS: Record<Step["type"], readonly string[]> = {
  walk: ["lengthM"],
  turn: ["direction"],
  stairs: ["direction", "riseM", "runM", "toFloor"],
  elevator: ["toFloor"],
  door: ["label"],
};

function parseStep(v: unknown, path: string): Step {
  const o = obj(v, path);
  if (!Object.hasOwn(o, "type")) fail(path, `missing key "type"`);
  const type = oneOf(STEP_TYPES, get(o, "type"), `${path}.type`);
  // Check the full key set before reading any value, so a missing key says so.
  keys(o, [...BASE_KEYS, ...TYPE_KEYS[type]], path);
  const base: StepBase = {
    id: str(get(o, "id"), `${path}.id`),
    source: oneOf(SOURCES, get(o, "source"), `${path}.source`),
    confidence: nullable(get(o, "confidence"), `${path}.confidence`, confidence),
    tSec: nullable(get(o, "tSec"), `${path}.tSec`, num),
    note: nullable(get(o, "note"), `${path}.note`, str),
  };
  switch (type) {
    case "walk":
      return { ...base, type, lengthM: num(get(o, "lengthM"), `${path}.lengthM`) };
    case "turn":
      return { ...base, type, direction: oneOf(TURN_DIRECTIONS, get(o, "direction"), `${path}.direction`) };
    case "stairs":
      return {
        ...base,
        type,
        direction: oneOf(STAIR_DIRECTIONS, get(o, "direction"), `${path}.direction`),
        riseM: num(get(o, "riseM"), `${path}.riseM`),
        runM: num(get(o, "runM"), `${path}.runM`),
        toFloor: nullable(get(o, "toFloor"), `${path}.toFloor`, str),
      };
    case "elevator":
      return { ...base, type, toFloor: str(get(o, "toFloor"), `${path}.toFloor`) };
    case "door":
      return { ...base, type, label: nullable(get(o, "label"), `${path}.label`, str) };
  }
}

function parseCheck(v: unknown, path: string): Check {
  const o = obj(v, path);
  keys(o, ["id", "level", "message", "stepId"], path);
  return {
    id: str(get(o, "id"), `${path}.id`),
    level: oneOf(LEVELS, get(o, "level"), `${path}.level`),
    message: str(get(o, "message"), `${path}.message`),
    stepId: nullable(get(o, "stepId"), `${path}.stepId`, str),
  };
}

function parseProgress(v: unknown, path: string): NonNullable<Route["progress"]> {
  const o = obj(v, path);
  keys(o, ["stage", "pct"], path);
  return { stage: oneOf(STAGES, get(o, "stage"), `${path}.stage`), pct: num(get(o, "pct"), `${path}.pct`) };
}

function parseStats(v: unknown, path: string): NonNullable<Route["stats"]> {
  const o = obj(v, path);
  keys(o, ["videoSec", "processingSec", "costUsd"], path);
  return {
    videoSec: num(get(o, "videoSec"), `${path}.videoSec`),
    processingSec: num(get(o, "processingSec"), `${path}.processingSec`),
    costUsd: num(get(o, "costUsd"), `${path}.costUsd`),
  };
}

function parseRoute(v: unknown, path: string): Route {
  const o = obj(v, path);
  keys(o, ["id", "version", "status", "progress", "error", "buildingId", "destination", "startFloor",
    "destinationFloor", "corridorWidthM", "ceilingHeightM", "steps", "checks", "stats", "createdAt",
    "confirmedAt"], path);
  const version = get(o, "version");
  if (version !== 1) fail(`${path}.version`, "expected 1");
  return {
    id: str(get(o, "id"), `${path}.id`),
    version,
    status: oneOf(STATUSES, get(o, "status"), `${path}.status`),
    progress: nullable(get(o, "progress"), `${path}.progress`, parseProgress),
    error: nullable(get(o, "error"), `${path}.error`, str),
    buildingId: str(get(o, "buildingId"), `${path}.buildingId`),
    destination: str(get(o, "destination"), `${path}.destination`),
    startFloor: str(get(o, "startFloor"), `${path}.startFloor`),
    destinationFloor: str(get(o, "destinationFloor"), `${path}.destinationFloor`),
    corridorWidthM: num(get(o, "corridorWidthM"), `${path}.corridorWidthM`),
    ceilingHeightM: num(get(o, "ceilingHeightM"), `${path}.ceilingHeightM`),
    steps: arr(get(o, "steps"), `${path}.steps`, parseStep),
    checks: arr(get(o, "checks"), `${path}.checks`, parseCheck),
    stats: nullable(get(o, "stats"), `${path}.stats`, parseStats),
    createdAt: str(get(o, "createdAt"), `${path}.createdAt`),
    confirmedAt: nullable(get(o, "confirmedAt"), `${path}.confirmedAt`, str),
  };
}

// ---- Parsed fixtures ----
// Parsed lazily, inside tests, so a shape error fails named tests instead of
// stopping the file from loading. A failed parse is not cached and rethrows.

function lazy<T>(parse: () => T): () => T {
  let cache: { value: T } | null = null;
  return () => {
    if (cache === null) cache = { value: parse() };
    return cache.value;
  };
}

const seeds = lazy(() => arr(seedJson, "events.seed.json", parseEventSeed));
const campus = lazy(() => parseCampus(campusJson, "campus.json"));
const sample = lazy(() => parseRoute(sampleJson, "route.sample.json"));
const flawed = lazy(() => parseRoute(flawedJson, "route.draft-flawed.json"));
const placeholder = lazy(() => parseRoute(placeholderJson, "routes/placeholder.draft.json"));

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/;
const SOON_MIN = 60;
const DAY_MIN = 24 * 60;
const WEEK_MIN = 7 * DAY_MIN;

const isLive = (e: EventSeed) => e.startsInMin <= 0 && e.startsInMin + e.durationMin > 0;
const isSoon = (e: EventSeed) => e.startsInMin > 0 && e.startsInMin <= SOON_MIN;
const isLaterToday = (e: EventSeed) => e.startsInMin > SOON_MIN && e.startsInMin < DAY_MIN;
const isToday = (e: EventSeed) => e.startsInMin < DAY_MIN && e.startsInMin + e.durationMin > 0;
const inMath204 = (e: EventSeed) => e.location.buildingId === "b-mathematics" && e.location.room === "204";

function findStep(route: Route, id: string): Step {
  const step = route.steps.find((s) => s.id === id);
  if (step === undefined) throw new Error(`${route.id}: no step ${id}`);
  return step;
}

// ---- Tests ----

describe("fixture shapes", () => {
  it("events.seed.json matches EventSeed[]", () => {
    expect(seeds().length).toBeGreaterThan(0);
  });
  it("campus.json matches Campus", () => {
    expect(campus().buildings.length).toBeGreaterThan(0);
  });
  it("route.sample.json matches Route", () => {
    expect(sample().id).toBe("route-sample");
  });
  it("route.draft-flawed.json matches Route", () => {
    expect(flawed().id).toBe("route-draft-flawed");
  });
  it("routes/placeholder.draft.json matches Route", () => {
    expect(placeholder().id).toBe("route-placeholder-draft");
  });
});

describe("events.seed.json", () => {
  it("has unique ids", () => {
    const ids = seeds().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses only buildingIds from campus.json", () => {
    const buildingIds = new Set(campus().buildings.map((b) => b.id));
    for (const e of seeds()) {
      const id = e.location.buildingId;
      expect(buildingIds.has(id), `${e.id}: unknown buildingId "${id}"`).toBe(true);
    }
  });

  it("has positive durations and registeredCount within capacity", () => {
    for (const e of seeds()) {
      expect(e.durationMin, e.id).toBeGreaterThan(0);
      expect(e.registeredCount, e.id).toBeGreaterThanOrEqual(0);
      if (e.capacity !== null) expect(e.registeredCount, e.id).toBeLessThanOrEqual(e.capacity);
    }
  });

  it("mixes null and numeric capacity", () => {
    expect(seeds().some((e) => e.capacity === null)).toBe(true);
    expect(seeds().some((e) => e.capacity !== null)).toBe(true);
  });

  it("uses every category at least once", () => {
    const used = new Set(seeds().map((e) => e.category));
    for (const c of Object.keys(CATEGORIES)) expect(used.has(oneOf(CATEGORIES, c, "category")), c).toBe(true);
  });

  it("has 2 live, 3 soon, 7 later today, and the rest within the week", () => {
    const all = seeds();
    expect(all.filter(isLive)).toHaveLength(2);
    expect(all.filter(isSoon)).toHaveLength(3);
    expect(all.filter(isLaterToday)).toHaveLength(7);
    const week = all.filter((e) => e.startsInMin >= DAY_MIN && e.startsInMin < WEEK_MIN);
    expect(week.length).toBeGreaterThanOrEqual(10);
    expect(all.filter(isLive).length + all.filter(isSoon).length + all.filter(isLaterToday).length
      + week.length).toBe(all.length);
  });

  it("has exactly two today-events on route-sample at b-mathematics/204, one of them soon", () => {
    const onSample = seeds().filter((e) => e.routeId === "route-sample");
    expect(onSample).toHaveLength(2);
    for (const e of onSample) {
      expect(isToday(e), e.id).toBe(true);
      expect(inMath204(e), e.id).toBe(true);
    }
    expect(onSample.some(isSoon)).toBe(true);
  });

  it("has exactly one other event at b-mathematics/204, with no route", () => {
    const others = seeds().filter((e) => inMath204(e) && e.routeId !== "route-sample");
    expect(others).toHaveLength(1);
    expect(others[0]?.routeId).toBeNull();
  });

  it("matches the route-sample destination room", () => {
    const route = sample();
    for (const e of seeds().filter((s) => s.routeId === "route-sample")) {
      expect(e.location.buildingId).toBe(route.buildingId);
      expect(`Room ${e.location.room}`).toBe(route.destination);
    }
  });
});

describe("campus.json", () => {
  it("has the seven selected OSM buildings with unique ids and unclosed footprints", () => {
    const { buildings } = campus();
    expect(buildings).toHaveLength(7);
    const ids = buildings.map((b) => b.id);
    expect(new Set(ids).size).toBe(buildings.length);
    expect(ids).toEqual(expect.arrayContaining([
      "b-mathematics", "b-library", "b-administration", "b-student-center",
      "b-east-building", "b-norton", "b-crawford",
    ]));
    for (const b of buildings) {
      expect(b.heightM, b.id).toBeGreaterThan(0);
      expect(b.footprint.length, b.id).toBeGreaterThanOrEqual(3);
      expect(b.footprint[0], b.id).not.toEqual(b.footprint[b.footprint.length - 1]);
      const twiceArea = b.footprint.reduce((area, a, i) => {
        const c = b.footprint[(i + 1) % b.footprint.length];
        return area + (c === undefined ? 0 : a[0] * c[1] - c[0] * a[1]);
      }, 0);
      expect(Math.abs(twiceArea), b.id).toBeGreaterThan(0);
    }
  });

  it("places each entrance on its footprint edge", () => {
    for (const b of campus().buildings) {
      const n = b.footprint.length;
      const onEdge = b.footprint.some((a, i) => {
        const c = b.footprint[(i + 1) % n];
        if (c === undefined) return false;
        const [px, pz] = b.entrance;
        const cross = (c[0] - a[0]) * (pz - a[1]) - (c[1] - a[1]) * (px - a[0]);
        const within = px >= Math.min(a[0], c[0]) && px <= Math.max(a[0], c[0])
          && pz >= Math.min(a[1], c[1]) && pz <= Math.max(a[1], c[1]);
        return Math.abs(cross) < 1e-9 && within;
      });
      expect(onEdge, b.id).toBe(true);
    }
  });

  it("credits OpenStreetMap contributors and has walkway polylines", () => {
    const c = campus();
    expect(c.attribution).toBe("© OpenStreetMap contributors");
    expect(c.paths.length).toBeGreaterThan(0);
    for (const p of c.paths) expect(p.length).toBeGreaterThanOrEqual(2);
  });
});

describe.each([
  ["route.sample.json", sample],
  ["route.draft-flawed.json", flawed],
  ["routes/placeholder.draft.json", placeholder],
])("%s structure", (_name, load) => {
  it("has unique step ids", () => {
    const ids = load().steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("begins and ends with a door, and the last door's label is the destination", () => {
    const route = load();
    const first = route.steps[0];
    const last = route.steps[route.steps.length - 1];
    expect(first?.type).toBe("door");
    expect(last?.type).toBe("door");
    if (last?.type === "door") expect(last.label).toBe(route.destination);
  });

  it("fills every StepBase field, with tSec increasing", () => {
    let prev = -Infinity;
    for (const s of load().steps) {
      expect(s.confidence, s.id).not.toBeNull();
      expect(s.note, s.id).not.toBeNull();
      expect(s.tSec, s.id).not.toBeNull();
      if (s.tSec !== null) {
        expect(s.tSec, s.id).toBeGreaterThan(prev);
        prev = s.tSec;
      }
    }
  });

  it("uses ISO 8601 times with offset and a buildingId from campus.json", () => {
    const route = load();
    expect(route.createdAt).toMatch(ISO_WITH_OFFSET);
    if (route.confirmedAt !== null) expect(route.confirmedAt).toMatch(ISO_WITH_OFFSET);
    expect(campus().buildings.map((b) => b.id)).toContain(route.buildingId);
  });

  it("points every check's stepId at a real step", () => {
    const route = load();
    const ids = new Set(route.steps.map((s) => s.id));
    for (const c of route.checks) if (c.stepId !== null) expect(ids.has(c.stepId), c.id).toBe(true);
  });
});

describe("route.sample.json", () => {
  it("keeps the contract sample's status and checks", () => {
    const route = sample();
    expect(route.id).toBe("route-sample");
    expect(route.status).toBe("confirmed");
    expect(route.confirmedAt).not.toBeNull();
    expect(route.checks).toEqual([
      { id: "leg_length_range", level: "pass", message: "No walk is shorter than 0.5 m.", stepId: null },
    ]);
    expect(route.steps.map((s) => s.id)).toEqual(
      ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11"],
    );
  });
});

describe("route.draft-flawed.json", () => {
  it("is an all-AI draft with no confirmation or progress", () => {
    const route = flawed();
    expect(route.id).toBe("route-draft-flawed");
    expect(route.status).toBe("draft");
    expect(route.confirmedAt).toBeNull();
    expect(route.progress).toBeNull();
    for (const s of route.steps) expect(s.source, s.id).toBe("ai");
  });

  it("plants s9 as a right turn at 0.4 and s3 at 0.5", () => {
    const s9 = findStep(flawed(), "s9");
    expect(s9.type === "turn" ? s9.direction : null).toBe("right");
    expect(s9.confidence).toBe(0.4);
    const s3 = findStep(flawed(), "s3");
    expect(s3.confidence).toBe(0.5);
    expect(s3).toEqual({ ...findStep(sample(), "s3"), confidence: 0.5 });
  });

  it("inserts a 0.2 m walk s12 right after s8", () => {
    const { steps } = flawed();
    const i8 = steps.findIndex((s) => s.id === "s8");
    const s12 = steps[i8 + 1];
    expect(s12?.id).toBe("s12");
    expect(s12?.type === "walk" ? s12.lengthM : null).toBe(0.2);
    expect(steps[i8 + 2]?.id).toBe("s9");
  });

  it("keeps every other step's confidence at or above 0.6", () => {
    for (const s of flawed().steps) {
      if (s.id === "s3" || s.id === "s9") continue;
      expect(s.confidence, s.id).toBeGreaterThanOrEqual(0.6);
    }
  });

  it("carries exactly the four planted checks", () => {
    const summary = flawed().checks.map((c) => ({ id: c.id, level: c.level, stepId: c.stepId }));
    expect(summary).toHaveLength(4);
    expect(summary).toEqual(expect.arrayContaining([
      { id: "low_confidence", level: "warn", stepId: "s3" },
      { id: "low_confidence", level: "warn", stepId: "s9" },
      { id: "turn_motion_mismatch", level: "warn", stepId: "s9" },
      { id: "leg_length_range", level: "fail", stepId: "s12" },
    ]));
  });
});

describe("routes/placeholder.draft.json", () => {
  it("deep-equals the flawed draft except for its id", () => {
    const p = placeholder();
    expect(p.id).toBe("route-placeholder-draft");
    expect({ ...p, id: flawed().id }).toEqual(flawed());
  });
});
