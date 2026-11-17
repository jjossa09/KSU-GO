// TypeScript version of CONTRACTS.md sections 2 to 4.
// If this file and CONTRACTS.md disagree, CONTRACTS.md wins.

// ---- Section 2: Events ----

/** All times are ISO 8601 with offset. All ids are strings. */
export type Event = {
  id: string;
  title: string;
  description: string;
  /** Club or office name. */
  organizer: string;
  category: "academic" | "social" | "career" | "sports" | "arts" | "other";
  startsAt: string;
  endsAt: string;
  /** `buildingId` comes from campus.json. */
  location: { buildingId: string; room: string };
  /** Confirmed route to the room; several events may share one. */
  routeId: string | null;
  capacity: number | null;
  registeredCount: number;
};

/**
 * Seed form used in `events.seed.json`: an Event with `startsInMin` and
 * `durationMin` in place of `startsAt` and `endsAt`.
 */
export type EventSeed = Omit<Event, "startsAt" | "endsAt"> & {
  /** Minutes from now; negative means already started. */
  startsInMin: number;
  durationMin: number;
};

// ---- Section 3: Campus ----

/** Local meters: `x` is east, `z` is south (north is `-z`), `y` is up. Origin is the section's center. */
export type Campus = {
  /** Credit the map screen must show, e.g. "© OpenStreetMap contributors" if OSM data is used. */
  attribution: string | null;
  buildings: {
    /** e.g. "b-engineering" */
    id: string;
    name: string;
    /** [x, z] ring, not closed; approximate outline of the building. */
    footprint: [number, number][];
    heightM: number;
    /** [x, z] */
    entrance: [number, number];
  }[];
  /** Walkway polylines, [x, z]. */
  paths: [number, number][][];
};

// ---- Section 4: Route ----

export type Route = {
  id: string;
  version: 1;
  status: "processing" | "draft" | "confirmed" | "failed";
  progress: { stage: "ingest" | "timeline" | "geometry" | "assemble" | "verify"; pct: number } | null;
  /** Set when status is "failed". */
  error: string | null;
  buildingId: string;
  /** e.g. "Room 204" */
  destination: string;
  /** e.g. "1"; entered by the organizer. */
  startFloor: string;
  /** e.g. "2"; entered by the organizer. */
  destinationFloor: string;
  /** Default 2.0. */
  corridorWidthM: number;
  /** Default 2.7. */
  ceilingHeightM: number;
  /** Empty while processing. Always begins and ends with a `door`; the last door's label is the `destination`. */
  steps: Step[];
  /** Verifier results. */
  checks: Check[];
  stats: { videoSec: number; processingSec: number; costUsd: number } | null;
  createdAt: string;
  confirmedAt: string | null;
};

export type StepBase = {
  /** Unique within the route. */
  id: string;
  source: "ai" | "organizer";
  /** 0 to 1, from the AI. */
  confidence: number | null;
  /** Time in the source video. */
  tSec: number | null;
  /** Landmark or sign text, e.g. "past the vending machines". */
  note: string | null;
};

export type Step = StepBase &
  (
    | { type: "walk"; lengthM: number }
    | { type: "turn"; direction: "left" | "right" | "u_left" | "u_right" }
    | { type: "stairs"; direction: "up" | "down"; riseM: number; runM: number; toFloor: string | null }
    | { type: "elevator"; toFloor: string }
    | { type: "door"; label: string | null }
  );

export type Check = {
  /** e.g. "leg_length_range" */
  id: string;
  level: "pass" | "warn" | "fail";
  /** Shown to the organizer. */
  message: string;
  stepId: string | null;
};
