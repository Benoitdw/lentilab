import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { buildScene } from './scene.js';

// ---------------------------------------------------------------------------
// Paramètres
// ---------------------------------------------------------------------------
// Ordonnances en convention « cylindre négatif » : sphère / cylindre × axe.
const P = {
  eye: { sph: -2, cyl: -1, axis: 180 },
  pupilMm: 4,
  age: 30,
  A: { sph: -2, cyl: -1, axis: 180, profile: 'mono', add: 0 },
  B: { sph: -2, cyl: -1, axis: 180, profile: 'rings', add: 2 },
  view: 'nu',
};
const VIEWS = [
  ['nu', 'Œil nu'], ['A', 'Lentille A'], ['B', 'Lentille B'], ['split', 'A | B'], ['ref', 'Vision parfaite'],
];
// Amplitude d'accommodation moyenne (Hofstetter) en dioptries
const accAmp = () => Math.max(0, 18.5 - 0.3 * P.age);

// Profils de puissance radiaux ΔP(r), r en mm, ΔP en dioptries, ajoutés à la puissance nominale.
// Modèles ILLUSTRATIFS (pas des données fabricant).
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const PROFILES = {
  mono:    ['Monofocale (sans aberration)',          () => 0],
  sa:      ['Monofocale + aberration sphérique',     (r, a) => a * (r / 3) ** 2],
  cd_prog: ['Centre-distance progressif',            (r, a) => a * sstep(1.0, 3.0, r)],
  cn_prog: ['Centre-près progressif',                (r, a) => a * (1 - sstep(0.5, 2.5, r))],
  rings:   ['Centre-distance à anneaux (dual focus)', (r, a) => a * (sstep(1.6, 1.75, r) - sstep(2.3, 2.45, r) + sstep(2.9, 3.05, r) - sstep(3.6, 3.75, r))],
  edof:    ['EDOF (illustratif)',                    (r, a) => a * (0.5 - 0.5 * Math.cos(3 * Math.PI * (r / 3.5) ** 2))],
};

// ---------------------------------------------------------------------------
// Renderer / caméra / scène
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.autoClear = false;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFramebufferScaleFactor(0.8); // le flou est coûteux : un peu moins de pixels en VR
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const EYE_HEIGHT = 1.6;
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 600);
camera.rotation.order = 'YXZ';

const scene = new THREE.Scene();
const SKY = new THREE.Color(0xa9c8e8);
scene.fog = new THREE.Fog(SKY, 150, 480);
buildScene(scene, renderer, EYE_HEIGHT);

// ---------------------------------------------------------------------------
// Optique : table des taches image (PSF) par vergence d'objet
// ---------------------------------------------------------------------------
// Pour un point p de la pupille (m), le rayon arrive sur la rétine décalé de
//   o = E·p   (rad)   avec   E = P_lentille + ΔP(|p|)·I − P_ordonnance + (A − V)·I
// V = 1/d (vergence de l'objet), A = accommodation choisie par l'œil (0..Amax).
// On choisit A qui maximise l'énergie dans 2′ d'arc (puis plus petit RMS).
// La table stocke, pour NB vergences, K décalages o_k + le rayon max de la tache.
const NB = 128, VMAX = 8; // vergences 0..8 D (objets de l'infini à 12,5 cm)
let K = 96;               // rayons tracés par pixel (48 en VR)

// Matrice de puissance [xx, xy, yy] pour sphère S, cylindre C, axe α
function powerMatrix(s, c, axisDeg) {
  const a = THREE.MathUtils.degToRad(axisDeg), sn = Math.sin(a), cs = Math.cos(a);
  return [s + c * sn * sn, -c * sn * cs, s + c * cs * cs];
}

function pupilSamples() { // spirale de Vogel : échantillonnage uniforme du disque
  const R = P.pupilMm / 2000, pts = [];
  for (let k = 0; k < K; k++) {
    const r = R * Math.sqrt((k + 0.5) / K), t = k * 2.39996323;
    pts.push([r * Math.cos(t), r * Math.sin(t)]);
  }
  return pts;
}

function computeLUT(lens) {
  const pts = pupilSamples();
  const eye = powerMatrix(P.eye.sph, P.eye.cyl, P.eye.axis);
  const L = lens ? powerMatrix(lens.sph, lens.cyl, lens.axis) : [0, 0, 0];
  const base = [L[0] - eye[0], L[1] - eye[1], L[2] - eye[2]];
  const prof = lens ? PROFILES[lens.profile][1] : () => 0;
  const dP = pts.map(([x, y]) => prof(Math.hypot(x, y) * 1000, lens ? lens.add : 0));
  const Amax = accAmp(), T2 = (0.6e-3) ** 2;
  const W = K + 1, data = new Float32Array(W * NB * 4);

  const score = (A, V) => {
    let ee = 0, s = 0;
    for (let k = 0; k < K; k++) {
      const m = A - V + dP[k], [x, y] = pts[k];
      const ox = (base[0] + m) * x + base[1] * y, oy = base[1] * x + (base[2] + m) * y;
      const r2 = ox * ox + oy * oy;
      if (r2 < T2) ee++;
      s += r2;
    }
    return ee / K - 1e-5 * Math.sqrt(s / K) * 3437.7 - 1e-6 * A;
  };

  for (let b = 0; b < NB; b++) {
    const V = (b / (NB - 1)) * VMAX;
    let bestA = 0, best = -Infinity;
    for (let A = 0; A <= Amax + 1e-9; A += 0.1) { const s = score(A, V); if (s > best) { best = s; bestA = A; } }
    const a0 = bestA;
    for (let A = Math.max(0, a0 - 0.1); A <= Math.min(Amax, a0 + 0.1); A += 0.02) {
      const s = score(A, V); if (s > best) { best = s; bestA = A; }
    }
    let rmax = 0;
    for (let k = 0; k < K; k++) {
      const m = bestA - V + dP[k], [x, y] = pts[k];
      const ox = (base[0] + m) * x + base[1] * y, oy = base[1] * x + (base[2] + m) * y;
      const i = (b * W + k + 1) * 4;
      data[i] = ox; data[i + 1] = oy;
      rmax = Math.max(rmax, Math.hypot(ox, oy));
    }
    data[b * W * 4] = rmax;
    data[b * W * 4 + 1] = bestA;
  }
  return data;
}

const luts = {};
function lutTexture(name, data) {
  let t = luts[name];
  if (!t || t.image.width !== K + 1) {
    if (t) t.dispose();
    t = luts[name] = new THREE.DataTexture(data, K + 1, NB, THREE.RGBAFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
  } else {
    t.image.data = data;
  }
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------
// Post-traitement : convolution par la tache image de la profondeur du pixel
// ---------------------------------------------------------------------------
const blurMaterial = new THREE.ShaderMaterial({
  depthTest: false,
  depthWrite: false,
  uniforms: {
    tColor: { value: null }, tDepth: { value: null },
    lutA: { value: null }, lutB: { value: null },
    invProj: { value: new THREE.Matrix4() },
    res: { value: new THREE.Vector2(1, 1) },
    pxPerRad: { value: 1000 },
    K: { value: K }, nBins: { value: NB }, vMax: { value: VMAX },
    splitF: { value: 0 }, enabledF: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tColor, tDepth, lutA, lutB;
    uniform mat4 invProj;
    uniform vec2 res;
    uniform float pxPerRad, nBins, vMax, splitF, enabledF;
    uniform int K;
    varying vec2 vUv;

    int binOf(vec2 uv) {
      float z = texture2D(tDepth, uv).x;
      vec4 p = invProj * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
      float v = 1.0 / max(length(p.xyz / p.w), 1e-3);       // vergence = 1 / distance
      return int(clamp(floor(v / vMax * (nBins - 1.0) + 0.5), 0.0, nBins - 1.0));
    }
    vec4 lut(bool useB, int x, int y) {
      return useB ? texelFetch(lutB, ivec2(x, y), 0) : texelFetch(lutA, ivec2(x, y), 0);
    }

    void main() {
      vec4 c = texture2D(tColor, vUv);
      bool useB = splitF > 0.5 && vUv.x > 0.5;
      if (enabledF > 0.5) {
        int b = binOf(vUv);
        float R = lut(useB, 0, b).x * pxPerRad;
        if (R > 0.5) {
          vec3 acc = c.rgb * 0.01;
          float wsum = 0.01;
          for (int k = 0; k < 128; k++) {
            if (k >= K) break;
            vec2 o = lut(useB, k + 1, b).xy * pxPerRad;
            vec2 uv = vUv + o / res;
            // un échantillon ne compte que si sa propre tache s'étend jusqu'ici :
            // évite que les objets nets du premier plan « bavent » sur le fond flou
            float Rs = lut(useB, 0, binOf(uv)).x * pxPerRad;
            float w = clamp(Rs - length(o) + 1.0, 0.0, 1.0);
            acc += texture2D(tColor, uv).rgb * w;
            wsum += w;
          }
          c.rgb = acc / wsum;
        }
      }
      if (splitF > 0.5 && abs(vUv.x - 0.5) * res.x < 1.5) c.rgb = vec3(1.0);
      gl_FragColor = vec4(c.rgb, 1.0);
      #include <colorspace_fragment>
    }
  `,
});
const postScene = new THREE.Scene();
const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMaterial);
postQuad.frustumCulled = false;
postScene.add(postQuad);
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

let sceneRT = null;
function ensureRT(w, h) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  if (sceneRT && sceneRT.width === w && sceneRT.height === h) return;
  if (sceneRT) { sceneRT.depthTexture.dispose(); sceneRT.dispose(); }
  sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
  sceneRT.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
  blurMaterial.uniforms.tColor.value = sceneRT.texture;
  blurMaterial.uniforms.tDepth.value = sceneRT.depthTexture;
}

// ---------------------------------------------------------------------------
// HUD 3D (VR et Cardboard) : rendu APRÈS le flou, donc toujours net
// ---------------------------------------------------------------------------
const hudScene = new THREE.Scene();
const hudCanvas = document.createElement('canvas');
hudCanvas.width = 1024; hudCanvas.height = 200;
const hudTex = new THREE.CanvasTexture(hudCanvas);
hudTex.colorSpace = THREE.SRGBColorSpace;
const hud = new THREE.Mesh(
  new THREE.PlaneGeometry(0.5, 0.098),
  new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthTest: false, depthWrite: false })
);
hud.visible = false;
hudScene.add(hud);
const HUD_OFFSET = new THREE.Vector3(0, 0.26, -0.9);

const fmtD = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;
const fmtRx = (o) => `${fmtD(o.sph)} / ${fmtD(o.cyl)} × ${o.axis}°`;
const lensSummary = (o) => `${fmtRx(o)} · ${PROFILES[o.profile][0]}${o.profile !== 'mono' ? ` ${fmtD(o.add)}` : ''}`;

function drawHud() {
  const ctx = hudCanvas.getContext('2d');
  ctx.clearRect(0, 0, 1024, 200);
  ctx.fillStyle = 'rgba(15,18,24,0.75)';
  ctx.beginPath(); ctx.roundRect(0, 0, 1024, 200, 30); ctx.fill();
  const v = P.view;
  ctx.fillStyle = '#fff'; ctx.font = 'bold 60px sans-serif';
  ctx.fillText(VIEWS.find((x) => x[0] === v)[1] + (v === 'nu' ? `  ${fmtRx(P.eye)}` : ''), 36, 82);
  ctx.fillStyle = '#cdd'; ctx.font = '34px sans-serif';
  const line = v === 'A' || v === 'B' ? lensSummary(P[v])
    : v === 'split' ? 'Gauche : lentille A · Droite : lentille B'
    : v === 'ref' ? 'Aucun flou (référence)' : `Pupille ${P.pupilMm} mm · ${P.age} ans`;
  ctx.fillText(line, 36, 155, 960);
  hudTex.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// UI HTML
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const refreshers = [];
let dirty = true;
const changed = () => { dirty = true; };

function slider(parent, label, min, max, step, obj, key, fmt) {
  const l = document.createElement('label');
  l.innerHTML = `<span class="row"><span>${label}</span><span class="val"></span></span>
    <input type="range" min="${min}" max="${max}" step="${step}">`;
  const input = l.querySelector('input'), val = l.querySelector('.val');
  const refresh = () => { input.value = obj[key]; val.textContent = fmt(obj[key]); };
  input.addEventListener('input', () => { obj[key] = +input.value; refresh(); changed(); });
  refresh(); refreshers.push(refresh);
  parent.appendChild(l);
}
function select(parent, label, options, obj, key) {
  const l = document.createElement('label');
  l.innerHTML = `${label}<select>${Object.entries(options).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select>`;
  const s = l.querySelector('select');
  const refresh = () => { s.value = obj[key]; };
  s.addEventListener('change', () => { obj[key] = s.value; changed(); });
  refresh(); refreshers.push(refresh);
  parent.appendChild(l);
}
const deg = (v) => `${v}°`;

slider($('eyeCtl'), 'Sphère', -10, 6, 0.25, P.eye, 'sph', fmtD);
slider($('eyeCtl'), 'Cylindre (astigmatisme)', -6, 0, 0.25, P.eye, 'cyl', fmtD);
slider($('eyeCtl'), 'Axe', 0, 180, 5, P.eye, 'axis', deg);
slider($('eyeCtl'), 'Pupille', 2, 8, 0.5, P, 'pupilMm', (v) => `${v} mm`);
slider($('eyeCtl'), 'Âge (accommodation)', 10, 75, 1, P, 'age', (v) => `${v} ans · ${accAmp().toFixed(1)} D`);
for (const id of ['A', 'B']) {
  const el = $('lens' + id);
  slider(el, 'Sphère', -10, 6, 0.25, P[id], 'sph', fmtD);
  slider(el, 'Cylindre', -6, 0, 0.25, P[id], 'cyl', fmtD);
  slider(el, 'Axe', 0, 180, 5, P[id], 'axis', deg);
  select(el, 'Profil', PROFILES, P[id], 'profile');
  slider(el, 'Addition / amplitude du profil', -2, 4, 0.25, P[id], 'add', fmtD);
}
document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => {
  Object.assign(P[b.dataset.copy], P.eye);
  refreshers.forEach((f) => f()); changed();
}));

const viewButtons = VIEWS.map(([v, label], i) => {
  const b = document.createElement('button');
  b.textContent = `${i + 1}. ${label}`;
  b.addEventListener('click', () => setView(v));
  $('views').appendChild(b);
  return b;
});
function setView(v) { P.view = v; changed(); }
function nextView() { setView(VIEWS[(VIEWS.findIndex((x) => x[0] === P.view) + 1) % VIEWS.length][0]); }
$('collapse').addEventListener('click', () => $('panel').classList.toggle('collapsed'));

function drawProfiles() {
  const c = $('profilePlot'), dpr = window.devicePixelRatio || 1;
  const w = c.width = c.clientWidth * dpr, h = c.height = c.clientHeight * dpr;
  const ctx = c.getContext('2d');
  const fA = (r) => PROFILES[P.A.profile][1](r, P.A.add), fB = (r) => PROFILES[P.B.profile][1](r, P.B.add);
  let lo = -0.5, hi = 0.5;
  for (let r = 0; r <= 4; r += 0.05) for (const f of [fA, fB]) { lo = Math.min(lo, f(r)); hi = Math.max(hi, f(r)); }
  lo -= 0.3; hi += 0.3;
  const X = (r) => (24 + (r / 4) * (w / dpr - 32)) * dpr, Y = (p) => h - ((p - lo) / (hi - lo)) * h;
  ctx.font = `${10 * dpr}px sans-serif`; ctx.fillStyle = '#889'; ctx.strokeStyle = '#ffffff22';
  for (let p = Math.ceil(lo); p <= hi; p++) {
    ctx.beginPath(); ctx.moveTo(X(0), Y(p)); ctx.lineTo(X(4), Y(p)); ctx.stroke();
    ctx.fillText(`${p > 0 ? '+' : ''}${p}`, 2 * dpr, Y(p) + 3 * dpr);
  }
  for (let r = 1; r <= 4; r++) ctx.fillText(`${r}mm`, X(r) - 22 * dpr, h - 3 * dpr);
  ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.strokeStyle = '#fff8';
  ctx.beginPath(); ctx.moveTo(X(P.pupilMm / 2), 0); ctx.lineTo(X(P.pupilMm / 2), h); ctx.stroke();
  ctx.setLineDash([]); ctx.lineWidth = 2 * dpr;
  for (const [f, col, off] of [[fA, '#4ea1ff', 0], [fB, '#ff9a3c', 0.02]]) {
    ctx.strokeStyle = col; ctx.beginPath();
    for (let r = 0; r <= 4; r += 0.02) ctx[r ? 'lineTo' : 'moveTo'](X(r), Y(f(r) + off));
    ctx.stroke();
  }
  ctx.lineWidth = 1;
}

function update() {
  const u = blurMaterial.uniforms;
  u.K.value = K;
  u.enabledF.value = P.view === 'ref' ? 0 : 1;
  u.splitF.value = P.view === 'split' ? 1 : 0;
  if (P.view === 'split') {
    u.lutA.value = lutTexture('A', computeLUT(P.A));
    u.lutB.value = lutTexture('B', computeLUT(P.B));
  } else if (P.view !== 'ref') {
    const lens = P.view === 'nu' ? null : P[P.view];
    u.lutA.value = u.lutB.value = lutTexture(P.view, computeLUT(lens));
  }
  viewButtons.forEach((b, i) => b.classList.toggle('on', VIEWS[i][0] === P.view));
  document.body.classList.toggle('split', P.view === 'split' && mode === 'desktop');
  refreshers.forEach((f) => f());
  drawProfiles();
  drawHud();
}

// ---------------------------------------------------------------------------
// Contrôles bureau : glisser pour regarder, WASD/ZQSD pour se déplacer
// ---------------------------------------------------------------------------
const clamp = THREE.MathUtils.clamp;
let yaw = 0, pitch = THREE.MathUtils.degToRad(-12);
const desktopPos = new THREE.Vector3(0, EYE_HEIGHT, 0);
const keys = new Set();
let dragging = false, lastX = 0, lastY = 0;

renderer.domElement.addEventListener('pointerdown', (e) => {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointerup', () => { dragging = false; });
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!dragging || (mode === 'cardboard' && hasGyro)) return;
  yaw -= (e.clientX - lastX) * 0.004;
  pitch = clamp(pitch - (e.clientY - lastY) * 0.004, -1.5, 1.5);
  lastX = e.clientX; lastY = e.clientY;
});
window.addEventListener('keydown', (e) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (e.code === 'Space') { nextView(); e.preventDefault(); }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= VIEWS.length) setView(VIEWS[n - 1][0]);
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

function updateDesktop(dt) {
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const speed = 3 * dt;
  desktopPos.x += (-Math.sin(yaw) * f + Math.cos(yaw) * s) * speed;
  desktopPos.z += (-Math.cos(yaw) * f - Math.sin(yaw) * s) * speed;
  camera.position.copy(desktopPos);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
}

// ---------------------------------------------------------------------------
// Mode Cardboard : écran partagé + gyroscope
// ---------------------------------------------------------------------------
let mode = 'desktop'; // 'desktop' | 'cardboard' | 'xr'
let hasGyro = false, yawOffset = null;
const stereo = new THREE.StereoCamera();
stereo.eyeSep = 0.064;
const devQ = new THREE.Quaternion(), qTmp = new THREE.Quaternion(), euler = new THREE.Euler();
const qScreenX = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° autour de X
const AXIS_Z = new THREE.Vector3(0, 0, 1), AXIS_Y = new THREE.Vector3(0, 1, 0);

function onOrientation(e) {
  if (e.alpha == null) return;
  hasGyro = true;
  const d2r = THREE.MathUtils.degToRad;
  const orient = d2r((screen.orientation && screen.orientation.angle) || window.orientation || 0);
  euler.set(d2r(e.beta), d2r(e.alpha), -d2r(e.gamma), 'YXZ');
  devQ.setFromEuler(euler).multiply(qScreenX).multiply(qTmp.setFromAxisAngle(AXIS_Z, -orient));
  if (yawOffset === null) yawOffset = -new THREE.Euler().setFromQuaternion(devQ, 'YXZ').y; // recentrage
  camera.quaternion.setFromAxisAngle(AXIS_Y, yawOffset).multiply(devQ);
}

async function enterCardboard() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      await DeviceOrientationEvent.requestPermission(); // iOS
    }
  } catch (_) { /* refusé : on garde le glisser-pour-regarder */ }
  try { await document.documentElement.requestFullscreen(); } catch (_) {}
  try { await screen.orientation.lock('landscape'); } catch (_) {}
  mode = 'cardboard';
  yawOffset = null;
  document.body.classList.add('cardboard');
  window.addEventListener('deviceorientation', onOrientation);
  onResize(); changed();
}
function exitCardboard() {
  mode = 'desktop';
  hasGyro = false;
  document.body.classList.remove('cardboard');
  window.removeEventListener('deviceorientation', onOrientation);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  onResize(); changed();
}
$('btnCardboard').addEventListener('click', enterCardboard);
$('cbExit').addEventListener('click', (e) => { e.stopPropagation(); exitCardboard(); });
renderer.domElement.addEventListener('click', () => { if (mode === 'cardboard') nextView(); });

// ---------------------------------------------------------------------------
// WebXR : gâchette = vue suivante
// ---------------------------------------------------------------------------
for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i);
  c.addEventListener('selectstart', nextView);
  scene.add(c);
}
renderer.xr.addEventListener('sessionstart', () => { mode = 'xr'; K = 48; changed(); });
renderer.xr.addEventListener('sessionend', () => { mode = 'desktop'; K = 96; onResize(); changed(); });

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------
function renderEye(eyeCam, w, h, bindOutput) {
  ensureRT(w, h);
  renderer.setRenderTarget(sceneRT);
  renderer.setClearColor(SKY, 1);
  renderer.clear();
  renderer.render(scene, eyeCam);

  const u = blurMaterial.uniforms;
  u.invProj.value.copy(eyeCam.projectionMatrix).invert();
  u.res.value.set(sceneRT.width, sceneRT.height);
  u.pxPerRad.value = eyeCam.projectionMatrix.elements[5] * sceneRT.height / 2;

  bindOutput();
  renderer.render(postScene, postCam);
  if (hud.visible) renderer.render(hudScene, eyeCam);
}

function placeHud() {
  hud.position.copy(HUD_OFFSET).applyQuaternion(camera.quaternion).add(camera.position);
  hud.quaternion.copy(camera.quaternion);
}

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = (mode === 'cardboard' ? window.innerWidth / 2 : window.innerWidth) / window.innerHeight;
  camera.updateProjectionMatrix();
  changed();
}
window.addEventListener('resize', onResize);

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (dirty) { dirty = false; update(); }
  const W = window.innerWidth, H = window.innerHeight, pr = renderer.getPixelRatio();

  if (mode === 'xr' && renderer.xr.isPresenting) {
    const xrTarget = renderer.getRenderTarget();
    renderer.xr.updateCamera(camera);          // met à jour la pose de la tête
    const xrCam = renderer.xr.getCamera();
    hud.visible = true; placeHud();
    renderer.xr.enabled = false;               // on pilote chaque œil à la main
    for (const eye of xrCam.cameras) {
      const vp = eye.viewport;
      renderEye(eye, vp.z, vp.w, () => {
        xrTarget.viewport.copy(vp);
        renderer.setRenderTarget(xrTarget);
      });
    }
    renderer.xr.enabled = true;
    return;
  }

  if (mode === 'cardboard') {
    if (!hasGyro) camera.rotation.set(pitch, yaw, 0, 'YXZ');
    camera.position.set(0, EYE_HEIGHT, 0);
    camera.updateMatrixWorld();
    stereo.update(camera);
    hud.visible = true; placeHud();
    const half = W / 2;
    renderEye(stereo.cameraL, half * pr, H * pr, () => { renderer.setRenderTarget(null); renderer.setViewport(0, 0, half, H); });
    renderEye(stereo.cameraR, half * pr, H * pr, () => { renderer.setRenderTarget(null); renderer.setViewport(half, 0, half, H); });
    return;
  }

  updateDesktop(dt);
  camera.updateMatrixWorld();
  hud.visible = false;
  renderEye(camera, W * pr, H * pr, () => { renderer.setRenderTarget(null); renderer.setViewport(0, 0, W, H); });
});
