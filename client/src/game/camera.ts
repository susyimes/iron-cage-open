import * as THREE from "three";
import { CAGE, TABLE, tableOuter } from "./config.ts";

/** Fit the table and fence, including HUD margins, at any orbit and aspect ratio. */
export function tableViewDistance(aspect: number, fov: number, yaw: number, pitch: number): number {
  const { halfX, halfZ } = tableOuter();
  const tanV = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  const tanH = tanV * Math.max(0.1, aspect);
  const horizontal = 0.88;
  const vertical = aspect < 0.85 ? 0.68 : aspect > 2 ? 0.7 : 0.8;
  const outward = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const up = new THREE.Vector3().crossVectors(outward, right);
  let distance = 0;
  const point = new THREE.Vector3();
  for (const x of [-halfX - 0.12, halfX + 0.12]) {
    for (const z of [-halfZ - 0.12, halfZ + 0.12]) {
      for (const y of [-0.34, CAGE.height * 0.72 - 0.2]) {
        point.set(x, y, z);
        const depth = point.dot(outward);
        distance = Math.max(distance,
          depth + Math.abs(point.dot(right)) / (tanH * horizontal),
          depth + Math.abs(point.dot(up)) / (tanV * vertical));
      }
    }
  }
  return distance;
}

export const TABLE_LOOK_Y = TABLE.feltY + 0.2;
