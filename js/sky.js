// Gradient sky dome, blocky sun & moon, stars, drifting clouds and
// the day/night lighting that drives the whole scene.
import * as THREE from './three.js';
import { SimplexNoise } from './noise.js';

const C = (hex) => new THREE.Color(hex);
const PALETTE = {
  dayTop: C('#2f7fe0'), dayHorizon: C('#a9d6ff'),
  duskTop: C('#3b4f9a'), duskHorizon: C('#ff9a5a'),
  nightTop: C('#02040d'), nightHorizon: C('#0b1430'),
};

function blockyDisc(size, inner, outer, edge) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const px = size / 16;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d < 4) ctx.fillStyle = inner;
    else if (d < 6) ctx.fillStyle = outer;
    else if (d < 8 && edge) ctx.fillStyle = edge;
    else continue;
    ctx.fillRect(x * px, y * px, px, px);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function moonTexture(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const px = size / 16;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d >= 5) continue;
    const crater = (x === 6 && y === 6) || (x === 9 && y === 8) || (x === 7 && y === 10) || (x === 10 && y === 5);
    ctx.fillStyle = crater ? '#b9c0d6' : '#eef2ff';
    ctx.fillRect(x * px, y * px, px, px);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function cloudTexture(seed) {
  const N = 64;
  const noise = new SimplexNoise(seed + 777);
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    // tileable noise by sampling a torus
    const a = (x / N) * Math.PI * 2, b = (y / N) * Math.PI * 2;
    const v = noise.noise3(Math.cos(a) * 1.6, Math.sin(a) * 1.6, Math.cos(b) * 1.6 + Math.sin(b) * 0.9)
      + 0.5 * noise.noise3(Math.cos(a) * 3.2 + 9, Math.sin(a) * 3.2, Math.sin(b) * 3.2);
    const i = (y * N + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = v > 0.32 ? 255 : 0;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

export class Sky {
  constructor(scene, seed) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    // Dome
    this.uniforms = {
      topColor: { value: new THREE.Color() },
      horizonColor: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      glowColor: { value: new THREE.Color('#ffb070') },
      glowStrength: { value: 0 },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(400, 24, 16),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        side: THREE.BackSide, depthWrite: false, fog: false,
        vertexShader: `varying vec3 vDir;
          void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 sunDir;
          uniform vec3 glowColor; uniform float glowStrength; varying vec3 vDir;
          void main(){
            vec3 d = normalize(vDir);
            float h = clamp(d.y, -1.0, 1.0);
            float t = pow(clamp(h, 0.0, 1.0), 0.55);
            vec3 col = mix(horizonColor, topColor, t);
            if (h < 0.0) col = mix(horizonColor, horizonColor * 0.75, clamp(-h * 3.0, 0.0, 1.0));
            float s = max(dot(d, normalize(sunDir)), 0.0);
            col += glowColor * pow(s, 6.0) * glowStrength * (1.0 - t * 0.6);
            col += vec3(1.0, 0.95, 0.85) * pow(s, 60.0) * 0.35 * clamp(sunDir.y * 4.0 + 0.5, 0.0, 1.0);
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.dome = dome;
    this.group.add(dome);

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const sp = [];
    for (let i = 0; i < 700; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      sp.push(Math.cos(th) * r * 360, u * 360, Math.sin(th) * r * 360);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    // Sun & moon
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(60, 60),
      new THREE.MeshBasicMaterial({ map: blockyDisc(64, '#fffbe0', '#ffe27a', 'rgba(255,200,90,0.35)'), transparent: true, fog: false, depthWrite: false }));
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(40, 40),
      new THREE.MeshBasicMaterial({ map: moonTexture(64), transparent: true, fog: false, depthWrite: false }));
    this.sun.renderOrder = this.moon.renderOrder = -8;
    this.group.add(this.sun, this.moon);

    // Clouds: one big plane, texture sampled in world space so it stays put as you walk
    this.cloudTex = cloudTexture(seed);
    this.cloudUniforms = {
      map: { value: this.cloudTex },
      offset: { value: new THREE.Vector2() },
      color: { value: new THREE.Color(1, 1, 1) },
      camPos: { value: new THREE.Vector3() },
      opacity: { value: 0.85 },
    };
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(900, 900),
      new THREE.ShaderMaterial({
        uniforms: this.cloudUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
        vertexShader: `varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `uniform sampler2D map; uniform vec2 offset; uniform vec3 color; uniform vec3 camPos; uniform float opacity; varying vec3 vWorld;
          void main(){
            vec2 uv = (vWorld.xz + offset) / 512.0;
            float a = texture2D(map, uv).a;
            if (a < 0.5) discard;
            float d = length(vWorld.xz - camPos.xz);
            float fade = 1.0 - smoothstep(220.0, 430.0, d);
            gl_FragColor = vec4(color, opacity * fade);
            #include <colorspace_fragment>
          }`,
      }));
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.renderOrder = 2;
    this.clouds.frustumCulled = false;
    this.cloudHeight = 92;
    this.group.add(this.clouds);

    // Lights
    this.ambient = new THREE.AmbientLight(0xffffff, 1);
    this.hemi = new THREE.HemisphereLight(0xbfdcff, 0x6a5a40, 0.5);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1);
    this.sunLight.position.set(1, 1, 0);
    scene.add(this.ambient, this.hemi, this.sunLight, this.sunLight.target);

    this.fog = new THREE.Fog(0xa9d6ff, 30, 90);
    scene.fog = this.fog;
    this.wind = 0;
    this.daylight = 1;
    this.tmpTop = new THREE.Color();
    this.tmpHor = new THREE.Color();
  }

  setCloudsVisible(v) { this.clouds.visible = v; }

  setFogDistance(far) {
    this.fog.far = far;
    this.fog.near = far * 0.45;
  }

  /** time in [0,1): 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight */
  update(time, camera, dt, underwater) {
    const a = time * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0.25).normalize();
    const sunH = sunDir.y;
    const day = THREE.MathUtils.smoothstep(sunH, -0.18, 0.25);
    const dusk = Math.max(0, 1 - Math.abs(sunH) / 0.32); // peaks at the horizon
    this.daylight = day;

    const top = this.tmpTop.copy(PALETTE.nightTop).lerp(PALETTE.dayTop, day).lerp(PALETTE.duskTop, dusk * 0.35);
    const hor = this.tmpHor.copy(PALETTE.nightHorizon).lerp(PALETTE.dayHorizon, day).lerp(PALETTE.duskHorizon, dusk * 0.55);
    this.uniforms.topColor.value.copy(top);
    this.uniforms.horizonColor.value.copy(hor);
    this.uniforms.sunDir.value.copy(sunDir);
    this.uniforms.glowStrength.value = dusk * 0.9 + 0.08;

    // follow camera
    this.group.position.copy(camera.position);
    // clouds live inside the camera-following group, at a fixed world height
    this.clouds.position.set(0, this.cloudHeight - camera.position.y, 0);

    this.sun.position.copy(sunDir).multiplyScalar(320);
    this.moon.position.copy(sunDir).multiplyScalar(-320);
    this.sun.quaternion.copy(camera.quaternion);
    this.moon.quaternion.copy(camera.quaternion);
    this.stars.rotation.z = a;
    this.starMat.opacity = Math.max(0, 1 - day * 1.6);

    this.wind += dt * 1.6;
    this.cloudUniforms.offset.value.set(this.wind, 0);
    this.cloudUniforms.camPos.value.copy(camera.position);
    const cc = 0.05 + 0.95 * day * day;
    this.cloudUniforms.color.value.setRGB(cc, cc, cc * 1.02).lerp(new THREE.Color('#ffc9a0'), dusk * 0.4);

    // Lighting
    const sunUp = Math.max(0, sunH);
    this.sunLight.position.copy(sunH > 0 ? sunDir : sunDir.clone().negate()).multiplyScalar(100).add(camera.position);
    this.sunLight.target.position.copy(camera.position);
    this.sunLight.intensity = sunH > 0 ? 0.25 + 0.75 * Math.min(1, sunUp * 3) : 0.12 * Math.min(1, -sunH * 4);
    this.sunLight.color.setRGB(1, 0.85 + 0.15 * day, 0.7 + 0.3 * day);
    if (sunH <= 0) this.sunLight.color.setRGB(0.6, 0.7, 1.0);
    this.ambient.intensity = 0.28 + 0.62 * day;
    this.ambient.color.setRGB(0.75 + 0.25 * day, 0.8 + 0.2 * day, 1);
    this.hemi.intensity = 0.15 + 0.35 * day;

    // Fog/background follows horizon
    if (underwater) {
      this.fog.color.setRGB(0.1, 0.25 + 0.2 * day, 0.45 + 0.25 * day);
    } else {
      this.fog.color.copy(hor);
    }
    return { day, sunDir };
  }

  dispose() {
    this.scene.remove(this.group, this.ambient, this.hemi, this.sunLight, this.sunLight.target);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
    this.cloudTex.dispose();
    this.scene.fog = null;
  }
}
