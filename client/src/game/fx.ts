import * as THREE from "three";
import { TABLE } from "./config.ts";

type Particle = {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  color: THREE.Color;
  size: number;
  chip: number;
};

type Ripple = {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  life: number;
  max: number;
  radius: number;
};

export class Fx {
  hitstop = 0;
  timeScale = 1;
  private particles: Particle[] = [];
  private readonly geo = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly max = 280;
  private particleLimit = this.max;
  private particleDensity = 1;
  private readonly posArr = new Float32Array(this.max * 3);
  private readonly colArr = new Float32Array(this.max * 3);
  private readonly sizeArr = new Float32Array(this.max);
  private readonly alphaArr = new Float32Array(this.max);
  private readonly chipArr = new Float32Array(this.max);
  private readonly ripples: Ripple[] = [];
  private rippleIndex = 0;

  constructor(scene: THREE.Scene) {
    for (const [name, array, size] of [
      ["position", this.posArr, 3], ["color", this.colArr, 3],
      ["size", this.sizeArr, 1], ["alpha", this.alphaArr, 1], ["chip", this.chipArr, 1],
    ] as const) {
      this.geo.setAttribute(name, new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
    }
    this.geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: { pointScale: { value: 900 } },
      vertexShader: `
        uniform float pointScale;
        attribute float size;
        attribute float alpha;
        attribute float chip;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vChip;
        void main() {
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * view;
          gl_PointSize = clamp(size * pointScale / max(0.1, -view.z), 1.0, 48.0);
          vColor = color;
          vAlpha = alpha;
          vChip = chip;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        varying float vChip;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float roundGlow = 1.0 - smoothstep(0.04, 0.5, length(p));
          float fragment = 1.0 - smoothstep(0.34, 0.48, abs(p.x) + abs(p.y));
          float opacity = mix(roundGlow * roundGlow, fragment, vChip) * vAlpha;
          if (opacity < 0.01) discard;
          gl_FragColor = vec4(vColor, opacity);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const points = new THREE.Points(this.geo, this.material);
    points.name = "impact-particles";
    points.frustumCulled = false;
    scene.add(points);

    const ring = new THREE.RingGeometry(0.9, 1, 48);
    for (let i = 0; i < 8; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffd59b, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      });
      const mesh = new THREE.Mesh(ring, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.name = "impact-ripple";
      scene.add(mesh);
      this.ripples.push({ mesh, life: 0, max: 1, radius: 1 });
    }
  }

  setView(camera: THREE.PerspectiveCamera, height: number): void {
    this.material.uniforms.pointScale!.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  setBudget(limit: number, density: number): void {
    this.particleLimit = Math.max(1, Math.min(this.max, Math.floor(limit)));
    this.particleDensity = THREE.MathUtils.clamp(density, 0, 1);
    if (this.particles.length > this.particleLimit) this.particles.splice(0, this.particles.length - this.particleLimit);
    this.write();
  }

  burst(x: number, y: number, z: number, color: number, count: number, speed: number, chip = 0): void {
    const c = new THREE.Color(color);
    for (let i = 0; i < Math.min(Math.ceil(count * this.particleDensity), this.particleLimit); i += 1) {
      if (this.particles.length >= this.particleLimit) this.particles.shift();
      const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 1.3, Math.random() * 2 - 1).normalize();
      const life = 0.22 + Math.random() * 0.3;
      this.particles.push({
        pos: new THREE.Vector3(x, y, z),
        vel: dir.multiplyScalar(speed * (0.25 + Math.random() * 0.65)),
        life, max: life, color: c,
        size: (chip ? 0.05 : 0.035) + Math.random() * 0.055, chip,
      });
    }
  }

  private ripple(x: number, z: number, color: number, radius: number, life = 0.36): void {
    const ring = this.ripples[this.rippleIndex++ % this.ripples.length]!;
    ring.mesh.position.set(x, TABLE.feltY + 0.012, z);
    ring.mesh.material.color.setHex(color);
    ring.mesh.material.opacity = 0.55;
    ring.mesh.scale.setScalar(0.12);
    ring.mesh.visible = true;
    ring.life = ring.max = life;
    ring.radius = radius;
  }

  impact(x: number, y: number, z: number, speed: number): void {
    this.burst(x, y, z, 0xffefcf, Math.min(12, Math.ceil(speed)), 0.8 + speed * 0.08);
    if (speed > 5) this.ripple(x, z, 0xe4e6c5, 0.38);
  }

  sparks(x: number, y: number, z: number, speed: number): void {
    this.burst(x, y, z, 0xffc270, Math.min(32, 8 + Math.floor(speed * 1.5)), 1.8 + speed * 0.22);
    if (speed > 4.5) this.stop(0.04, 0.22);
  }

  smash(x: number, y: number, z: number, color: number): void {
    this.burst(x, y, z, color, 24, 3.6, 1);
    this.burst(x, y, z, 0xffe4b7, 10, 2.4);
    this.ripple(x, z, 0xffcc8a, 0.7, 0.4);
    this.stop(0.05, 0.22);
  }

  pocket(x: number, y: number, z: number): void {
    this.burst(x, y, z, 0x8fffd1, 12, 1.1);
    this.ripple(x, z, 0x8fffd1, 0.44, 0.45);
  }

  stop(real: number, scale: number): void {
    this.hitstop = Math.max(this.hitstop, real);
    this.timeScale = scale;
  }

  clear(): void {
    this.particles.length = 0;
    this.hitstop = 0;
    this.timeScale = 1;
    this.geo.setDrawRange(0, 0);
    for (const ripple of this.ripples) {
      ripple.life = 0;
      ripple.mesh.visible = false;
    }
  }

  update(dt: number): number {
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      if (this.hitstop <= 0) this.timeScale = 1;
    }
    const simDt = dt * this.timeScale;
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i]!;
      p.life -= simDt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= 8 * simDt;
      p.pos.addScaledVector(p.vel, simDt);
      if (p.pos.y < TABLE.feltY + 0.015) {
        p.pos.y = TABLE.feltY + 0.015;
        p.vel.y = Math.abs(p.vel.y) * 0.2;
        p.vel.x *= 0.85;
        p.vel.z *= 0.85;
      }
    }
    for (const ripple of this.ripples) {
      if (ripple.life <= 0) continue;
      ripple.life = Math.max(0, ripple.life - simDt);
      const age = 1 - ripple.life / ripple.max;
      ripple.mesh.scale.setScalar(0.12 + ripple.radius * (1 - (1 - age) ** 2));
      ripple.mesh.material.opacity = (1 - age) ** 2 * 0.55;
      ripple.mesh.visible = ripple.life > 0;
    }
    this.write();
    return simDt;
  }

  private write(): void {
    for (let i = 0; i < this.particles.length; i += 1) {
      const p = this.particles[i]!;
      p.pos.toArray(this.posArr, i * 3);
      p.color.toArray(this.colArr, i * 3);
      const life = Math.max(0, p.life / p.max);
      this.sizeArr[i] = p.size * (0.3 + life * 0.7);
      this.alphaArr[i] = life * life;
      this.chipArr[i] = p.chip;
    }
    this.geo.setDrawRange(0, this.particles.length);
    for (const attribute of Object.values(this.geo.attributes)) attribute.needsUpdate = true;
  }
}
