// Campus map scene: renderer, camera, controls, OSM credit and the flags seam.
// The geometry itself is built by ./build.ts.

import { Color, Fog, MathUtils, PerspectiveCamera, Plane, Raycaster, Scene, Spherical, Vector2, Vector3, WebGLRenderer } from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import type { CampusCommand, CampusLoad } from "../bridge";
import { palette } from "../palette";
import type { ViewerScene } from "../scene";
import { createCampusWorld, type CampusInfo } from "./build";
import { createRenderLoop } from "./renderLoop";

// Map "pitch": polar angle from straight down. Portrait looks a little more
// steeply down, so less near ground fills the bottom of a tall screen.
const TILT_LANDSCAPE = MathUtils.degToRad(55);
const TILT_PORTRAIT = MathUtils.degToRad(49);
const AZIMUTH = MathUtils.degToRad(112); // camera sits east-north-east of the target
const MIN_DISTANCE = 70;

export function createCampusScene(container: HTMLElement): ViewerScene<CampusLoad, CampusCommand> {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new Scene();
  const fogColor = new Color(palette.sky.fog);
  scene.background = fogColor;
  const fog = new Fog(fogColor, 300, 900);
  scene.fog = fog;
  const camera = new PerspectiveCamera(42, 1, 4, 4000);

  const world = createCampusWorld();
  scene.add(world.root);

  // One finger pans, two fingers pinch to zoom and drag to rotate (MapControls
  // defaults). Mouse: left pans, right rotates, wheel zooms.
  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.screenSpacePanning = false; // pan along the ground, so the target stays at y = 0
  controls.minDistance = MIN_DISTANCE;
  controls.enabled = false; // until the first campus:load

  container.replaceChildren(renderer.domElement);
  const credit = document.createElement("div");
  credit.setAttribute("role", "note");
  Object.assign(credit.style, {
    position: "absolute",
    right: "6px",
    bottom: "max(5px, env(safe-area-inset-bottom))",
    padding: "1px 6px",
    borderRadius: "4px",
    background: css(palette.ui.surface, 0.75),
    color: css(palette.ui.text),
    font: "10px/1.5 -apple-system, system-ui, sans-serif",
    pointerEvents: "none",
    userSelect: "none",
    display: "none",
  });
  container.append(credit);

  // ---- render on demand: frames run only while something moves --------------
  let userMoved = false;
  let info: CampusInfo | undefined;

  function render() {
    const d = camera.position.distanceTo(controls.target);
    fog.near = d * 1.1;
    fog.far = d * 2.5;
    renderer.render(scene, camera);
  }

  const loop = createRenderLoop(
    { request: (callback) => requestAnimationFrame(callback), cancel: (id) => cancelAnimationFrame(id) },
    { updateCamera: () => controls.update(), render },
  );
  const requestRender = loop.requestRender;

  controls.addEventListener("start", () => {
    userMoved = true;
    requestRender();
  });
  controls.addEventListener("change", requestRender);

  // ---- default view: frame the demo building and the plaza -------------------
  const ground = new Plane(new Vector3(0, 1, 0), 0);
  const raycaster = new Raycaster();
  const spherical = new Spherical();
  const projected = new Vector3();

  function placeCamera(target: Vector3, distance: number, tilt: number) {
    spherical.set(distance, tilt, AZIMUTH);
    camera.position.setFromSpherical(spherical).add(target);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }

  function extent(points: Vector3[]) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const point of points) {
      projected.copy(point).project(camera);
      minX = Math.min(minX, projected.x); maxX = Math.max(maxX, projected.x);
      minY = Math.min(minY, projected.y); maxY = Math.max(maxY, projected.y);
    }
    return { minX, maxX, minY, maxY };
  }

  /** Moves `target` to the ground point under screen position (x, y) in NDC. */
  function retarget(target: Vector3, distance: number, tilt: number, x: number, y: number) {
    raycaster.setFromCamera(new Vector2(x, y), camera);
    const hit = new Vector3();
    if (raycaster.ray.intersectPlane(ground, hit)) target.copy(hit);
    placeCamera(target, distance, tilt);
  }

  /**
   * Default view. First the closest centered camera that keeps every focus
   * point inside the margins (MAP-1's fit). Then, on screens with height to
   * spare, the view slides away from the camera until the focus area rests on
   * the bottom margin, backing off just enough to stay inside the sides. Spare
   * height goes to the horizon at the top instead of to empty lawn below.
   */
  function fitView(campusInfo: CampusInfo, tilt: number) {
    const points = campusInfo.focusPoints.map(([x, y, z]) => new Vector3(x, y, z));
    const target = new Vector3();
    points.forEach((p) => target.add(p));
    target.divideScalar(points.length).setY(0);
    const marginX = 0.88, marginY = 0.84;
    const fits = (e: ReturnType<typeof extent>) =>
      e.minX >= -marginX && e.maxX <= marginX && e.minY >= -marginY - 0.01 && e.maxY <= marginY;
    let distance = 300;
    for (let iteration = 0; iteration < 5; iteration++) {
      let lo = 40, hi = 2000;
      for (let k = 0; k < 30; k++) {
        distance = (lo + hi) / 2;
        placeCamera(target, distance, tilt);
        if (fits(extent(points))) hi = distance;
        else lo = distance;
      }
      distance = hi;
      placeCamera(target, distance, tilt);
      const e = extent(points);
      retarget(target, distance, tilt, (e.minX + e.maxX) / 2, (e.minY + e.maxY) / 2);
    }

    // Slide along the ground, away from the camera, until the lowest focus
    // point sits on the bottom margin. It moves down as the slide grows, so
    // bisection finds the slide; a second bisection finds the distance.
    if (extent(points).minY > -marginY + 0.02) {
      const away = new Vector3(-Math.sin(AZIMUTH), 0, -Math.cos(AZIMUTH));
      const centered = target.clone();
      const anchored = (d: number) => {
        let lo = 0, hi = d;
        for (let k = 0; k < 30; k++) {
          const slide = (lo + hi) / 2;
          placeCamera(target.copy(centered).addScaledVector(away, slide), d, tilt);
          if (extent(points).minY > -marginY) lo = slide;
          else hi = slide;
        }
        placeCamera(target.copy(centered).addScaledVector(away, lo), d, tilt);
        return extent(points);
      };
      let lo = distance, hi = distance * 2;
      for (let k = 0; k < 24; k++) {
        const d = (lo + hi) / 2;
        if (fits(anchored(d))) hi = d;
        else lo = d;
      }
      distance = hi;
      anchored(distance);
    }
    controls.target.copy(target);
    controls.maxDistance = Math.min(Math.max(distance * 1.5, 300), 380);
    controls.update();
  }

  function setTiltLimits(tilt: number) {
    // Narrow pitch range, always above the horizon: with the target on the
    // ground and a minimum distance, the camera can never go under the ground.
    controls.minPolarAngle = tilt - MathUtils.degToRad(7);
    controls.maxPolarAngle = tilt + MathUtils.degToRad(5);
  }

  function resize() {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    const portrait = width < height;
    camera.aspect = width / height;
    camera.fov = portrait ? 45 : 36;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    if (info && !userMoved) {
      const tilt = portrait ? TILT_PORTRAIT : TILT_LANDSCAPE;
      setTiltLimits(tilt);
      fitView(info, tilt);
    }
    requestRender();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(container);

  return {
    load(message) {
      const first = !world.built;
      const built = world.load(message.campus); // builds buildings on the first load only

      // ---- MAP-4 FLAGS SEAM ---------------------------------------------------
      // replaceFlags disposes the previous load's flags handle, then asks for
      // the next one. The contract (CreateFlags, FlagsHandle) is in ./flagsSeam.
      // When MAP-4's ./flags.ts exists, add at the top of this file:
      //   import { createFlags } from "./flags";
      // and replace `return null;` below with:
      //   return createFlags(world.flagsLayer, message.campus, message.events, message.now);
      // The loop calls the handle's update(dt) on every frame it draws and keeps
      // drawing while update returns true (live flags pulsing). Buildings are
      // never rebuilt; they are in built.buildings, keyed by building id.
      loop.replaceFlags(() => {
        return null;
      });
      // -------------------------------------------------------------------------

      if (first) {
        info = built.info;
        const { bounds, center } = info;
        controls.cursor.set(center[0], 0, center[1]);
        controls.maxTargetRadius = 0.36 * Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
        controls.enabled = true;
        credit.textContent = info.attribution ?? "";
        credit.style.display = info.attribution ? "block" : "none";
        resize();
      }
      requestRender();
    },
    handle() {
      // campus:select (highlight a flag and move the camera to it) belongs to MAP-4.
    },
    dispose() {
      loop.dispose(); // cancels the frame and disposes the flags handle
      observer.disconnect();
      controls.dispose();
      world.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      credit.remove();
    },
  };
}

function css(hex: number, alpha = 1): string {
  return `rgb(${(hex >> 16) & 255} ${(hex >> 8) & 255} ${hex & 255} / ${alpha})`;
}
