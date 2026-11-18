import { Box3, Group, Mesh } from "three";
import { describe, expect, it } from "vitest";
import campusJson from "../../../shared/fixtures/campus.json";
import type { Campus } from "../../../shared/types";
import { buildCampus, createCampusWorld, type BuildingData } from "./build";
import { ringBounds } from "./geometry";

const campus = campusJson as Campus;
// The roof overhang (0.45 m, mitered: up to 1.1 m at a sharp corner), the
// entrance awning and step (1.8 m) and the demo building's ground outline
// (1 m, up to 1.1 m at a corner) may reach past the footprint.
const REACH_M = 2.5;

function buildingMeshes(group: Group) {
  const meshes: Mesh[] = [];
  group.traverse((object) => {
    if (object instanceof Mesh && typeof object.userData.buildingId === "string") meshes.push(object);
  });
  return meshes;
}

describe("buildCampus", () => {
  const built = buildCampus(campus);
  const meshes = buildingMeshes(built.group);

  it("makes exactly one mesh per building id, tagged with that id", () => {
    const ids = campus.buildings.map((b) => b.id);
    expect(meshes.map((m) => m.userData.buildingId).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const mesh = built.buildings.get(id);
      expect(mesh?.name).toBe(id);
      expect((mesh?.userData as BuildingData).buildingId).toBe(id);
    }
  });

  it("places each building mesh within its footprint's bounds", () => {
    built.group.updateMatrixWorld(true);
    for (const b of campus.buildings) {
      const mesh = built.buildings.get(b.id)!;
      const fb = ringBounds(b.footprint);
      expect(mesh.position.x).toBeGreaterThanOrEqual(fb.minX);
      expect(mesh.position.x).toBeLessThanOrEqual(fb.maxX);
      expect(mesh.position.z).toBeGreaterThanOrEqual(fb.minZ);
      expect(mesh.position.z).toBeLessThanOrEqual(fb.maxZ);
      expect(mesh.position.y).toBe(0);

      const box = new Box3().setFromObject(mesh);
      expect(box.min.x).toBeGreaterThanOrEqual(fb.minX - REACH_M);
      expect(box.max.x).toBeLessThanOrEqual(fb.maxX + REACH_M);
      expect(box.min.z).toBeGreaterThanOrEqual(fb.minZ - REACH_M);
      expect(box.max.z).toBeLessThanOrEqual(fb.maxZ + REACH_M);
      expect(box.min.y).toBeGreaterThanOrEqual(0);
      // The walls reach the stated height (plus parapet and rooftop units).
      expect(box.max.y).toBeGreaterThanOrEqual(b.heightM);
      expect(box.max.y).toBeLessThan(b.heightM + 4);
    }
  });

  it("is deterministic for the same campus", () => {
    const again = buildCampus(campus);
    expect(again.info.stats).toEqual(built.info.stats);
  });
});

describe("createCampusWorld", () => {
  it("builds buildings once; later loads keep the same meshes and flags layer", () => {
    const world = createCampusWorld();
    const first = world.load(campus);
    const meshesBefore = buildingMeshes(world.root);

    const second = world.load(campus);
    expect(second).toBe(first);
    expect(buildingMeshes(world.root)).toEqual(meshesBefore);
    expect(world.root.children).toContain(world.flagsLayer);
    world.dispose();
  });
});
