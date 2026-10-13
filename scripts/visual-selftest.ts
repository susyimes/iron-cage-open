import assert from "node:assert/strict";
import * as THREE from "three";
import { tableViewDistance, TABLE_LOOK_Y } from "../client/src/game/camera.ts";
import { CAM, CAGE, TABLE, tableOuter } from "../client/src/game/config.ts";
import { Fx } from "../client/src/game/fx.ts";

// Project the actual table bounds through Three's camera matrices. Test portrait,
// landscape, ultrawide, and every shot direction rather than one reference pose.
let views = 0;
for (const aspect of [390 / 844, 844 / 390, 16 / 9, 4 / 3, 32 / 9, 1]) {
  const fov = aspect < 0.85 ? 60 : 46;
  for (const pitch of [0.4, CAM.overviewPitch, CAM.surveyPitch, 1.22]) {
    for (let step = 0; step < 24; step += 1) {
      const yaw = step * Math.PI / 12;
      const distance = tableViewDistance(aspect, fov, yaw, pitch);
      const camera = new THREE.PerspectiveCamera(fov, aspect, 0.08, 80);
      camera.position.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      camera.position.multiplyScalar(distance).y += TABLE_LOOK_Y;
      camera.lookAt(0, TABLE_LOOK_Y, 0);
      camera.updateMatrixWorld();
      const outer = tableOuter();
      for (const x of [-outer.halfX, outer.halfX]) {
        for (const z of [-outer.halfZ, outer.halfZ]) {
          for (const y of [TABLE.feltY - 0.1, TABLE.feltY + CAGE.height * 0.72]) {
            const projected = new THREE.Vector3(x, y, z).project(camera);
            assert.ok(Math.abs(projected.x) <= 0.881, `horizontal clipping: ${aspect}, ${yaw}`);
            assert.ok(Math.abs(projected.y) <= 0.801, `vertical clipping: ${aspect}, ${yaw}`);
            assert.ok(projected.z > -1 && projected.z < 1, "outside camera clipping planes");
          }
        }
      }
      views += 1;
    }
  }
}
console.log(`PASS ${views} table framing cases with HUD margins`);

const scene = new THREE.Scene();
const fx = new Fx(scene);
const points = scene.getObjectByName("impact-particles") as THREE.Points;
assert.equal(points.geometry.drawRange.count, 0, "idle effects must draw no particles");
const objects = scene.children.length;
for (let i = 0; i < 40; i += 1) {
  fx.smash(0, TABLE.feltY + 0.12, 0, 0xffcc00);
  fx.sparks(0, TABLE.feltY + 0.12, 0, 18);
  fx.pocket(0, TABLE.feltY, 2);
}
fx.update(1 / 60);
assert.equal(points.geometry.drawRange.count, 280, "particle budget must remain bounded");
assert.equal(scene.children.length, objects, "impacts must reuse the ripple pool");
const sizes = points.geometry.getAttribute("size");
const alpha = points.geometry.getAttribute("alpha");
for (let i = 0; i < points.geometry.drawRange.count; i += 1) {
  assert.ok(sizes.getX(i) > 0 && sizes.getX(i) < 0.12);
  assert.ok(alpha.getX(i) > 0 && alpha.getX(i) < 1);
}
for (let i = 0; i < 90; i += 1) fx.update(1 / 60);
assert.equal(points.geometry.drawRange.count, 0, "expired particles must stop drawing");
assert.equal(scene.children.filter((o) => o.name === "impact-ripple" && o.visible).length, 0);
assert.equal(fx.timeScale, 1, "hit stop must release");
fx.smash(0, 1, 0, 0xffffff);
fx.clear();
assert.equal(fx.hitstop, 0);
assert.equal(fx.timeScale, 1);
assert.equal(points.geometry.drawRange.count, 0);
console.log("PASS effect budget, expiry, hit stop, pooled ripples and reset");

const buffers = points.geometry.attributes;
fx.setBudget(80, 0.3);
fx.burst(0, 1, 0, 0xffffff, 20, 1);
fx.update(0);
assert.equal(points.geometry.drawRange.count, 6, "lower quality must reduce emitted particles");
for (let i = 0; i < 30; i++) fx.smash(0, 1, 0, 0xffffff);
fx.update(0);
assert.equal(points.geometry.drawRange.count, 80);
fx.setBudget(40, 0.3);
assert.equal(points.geometry.drawRange.count, 40, "changing quality must trim particles already alive");
fx.setBudget(280, 1);
for (let i = 0; i < 30; i++) fx.smash(0, 1, 0, 0xffffff);
fx.update(0);
assert.equal(points.geometry.drawRange.count, 280, "high quality must restore the full effect budget");
assert.equal(points.geometry.attributes, buffers, "switching quality must reuse GPU buffers");
console.log("PASS particle quality switching, live trimming and full-quality restoration");
