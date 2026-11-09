// Scène procédurale (aucun asset externe)
import * as THREE from 'three';

export function buildScene(scene, renderer, EYE_HEIGHT) {
function rng(seed) { // PRNG déterministe
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}
const rand = rng(42);

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

// Ciel (dégradé par couleurs de sommets)
{
  const g = new THREE.SphereGeometry(450, 32, 16);
  const top = new THREE.Color(0x4f86c6), horizon = new THREE.Color(0xdde8f0);
  const pos = g.attributes.position, colors = [];
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, pos.getY(i) / 450);
    const c = horizon.clone().lerp(top, Math.pow(t, 0.6));
    colors.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false })));
}

scene.add(new THREE.HemisphereLight(0xdfefff, 0x55603a, 1.6));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.8);
sun.position.set(30, 60, 20);
scene.add(sun);

// Sol herbeux
{
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#5d8a3a'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) {
      const l = 30 + rand() * 25;
      ctx.fillStyle = `hsl(${90 + rand() * 20},45%,${l}%)`;
      ctx.fillRect(rand() * w, rand() * h, 2, 2);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(250, 250);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshLambertMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
}

// Route avec marquage (utile pour voir le flou augmenter avec la distance)
{
  const road = new THREE.Mesh(new THREE.PlaneGeometry(6, 400), new THREE.MeshLambertMaterial({ color: 0x3b3d40 }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.005, -200);
  scene.add(road);
  const white = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  for (const x of [-2.8, 2.8]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 400), white);
    line.rotation.x = -Math.PI / 2;
    line.position.set(x, 0.01, -200);
    scene.add(line);
  }
  const dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.12, 3), white, 70);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  for (let i = 0; i < 70; i++) {
    m.compose(new THREE.Vector3(0, 0.01, -2 - i * 6), q, new THREE.Vector3(1, 1, 1));
    dash.setMatrixAt(i, m);
  }
  scene.add(dash);
}

// Panneaux de distance : placés à exactement d mètres de l'œil, taille angulaire constante
{
  const dists = [1, 2, 3, 5, 10, 20, 50];
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x777777 });
  dists.forEach((d, i) => {
    const side = i % 2 ? 1 : -1;
    const ang = THREE.MathUtils.degToRad(16) * side;
    const w = 0.14 * d, h = 0.09 * d;
    const tex = canvasTexture(512, 330, (ctx, W, H) => {
      ctx.fillStyle = '#fdfdf6'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#1b4f9c'; ctx.lineWidth = 14; ctx.strokeRect(7, 7, W - 14, H - 14);
      ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold 150px sans-serif'; ctx.fillText(`${d} m`, W / 2, H * 0.42);
      ctx.font = 'bold 40px sans-serif'; ctx.fillText('E  F  P  T  O  Z', W / 2, H * 0.8);
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex }));
    const y = Math.max(EYE_HEIGHT, h / 2 + 0.4);
    panel.position.set(Math.sin(ang) * d, y, -Math.cos(ang) * d);
    panel.lookAt(0, EYE_HEIGHT, 0);
    scene.add(panel);
    const poleH = y - h / 2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.008 * d, 0.008 * d, poleH, 8), poleMat);
    pole.position.set(panel.position.x, poleH / 2, panel.position.z);
    scene.add(pole);
  });
}

// Échelle de Snellen à 6 m (rangées 6/60 → 6/6)
{
  const sloan = 'CDHKNORSVZ';
  const rows = [60, 36, 24, 18, 12, 9, 6];
  const W = 1.0, H = 1.4, px = 2048 / W; // 2 px par mm
  const tex = canvasTexture(2048, 2868, (ctx, cw, ch) => {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    let y = 80;
    for (const r of rows) {
      const hMeters = 0.00873 * (r / 6); // hauteur de lettre 6/6 = 8,73 mm à 6 m
      const hp = hMeters * px;
      ctx.font = `bold ${hp * 1.38}px sans-serif`; // ~hauteur de capitale
      const n = Math.min(8, Math.max(1, Math.floor(1700 / (hp * 1.6))));
      let s = '';
      for (let i = 0; i < n; i++) s += sloan[Math.floor(rand() * sloan.length)] + ' ';
      y += hp + Math.max(40, hp * 0.6);
      ctx.fillText(s.trim(), cw / 2, y);
      ctx.font = '36px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(`6/${r}`, 30, y);
      ctx.textAlign = 'center';
    }
  });
  const chart = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshLambertMaterial({ map: tex }));
  chart.position.set(1.0, 1.5, -6);
  chart.lookAt(0, EYE_HEIGHT, 0);
  scene.add(chart);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(W + 0.08, H + 0.08, 0.03), new THREE.MeshLambertMaterial({ color: 0x333333 }));
  frame.position.copy(chart.position); frame.quaternion.copy(chart.quaternion);
  frame.translateZ(-0.02);
  scene.add(frame);
}

// Table + carte de lecture (vision de près, ~45 cm)
{
  const wood = new THREE.MeshLambertMaterial({ color: 0x8a5a33 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.55), wood);
  top.position.set(0, 0.76, -0.6);
  scene.add(top);
  for (const [x, z] of [[-0.4, -0.37], [0.4, -0.37], [-0.4, -0.83], [0.4, -0.83]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.74, 0.04), wood);
    leg.position.set(x, 0.37, z);
    scene.add(leg);
  }
  const text = [
    [44, 'Lecture de près'],
    [30, 'La myopie rend flous les objets éloignés,'],
    [30, 'tandis que les objets proches restent nets.'],
    [22, 'Au-delà du punctum remotum (1 / myopie en mètres),'],
    [22, "l'image se forme devant la rétine : le flou augmente."],
    [16, "Avec l'âge, l'accommodation diminue (presbytie) : même"],
    [16, 'un myope finit par voir flou de très près.'],
    [12, 'Ce texte très fin sert à tester la limite de résolution du casque.'],
  ];
  const tex = canvasTexture(1024, 720, (ctx, W) => {
    ctx.fillStyle = '#fbf8ef'; ctx.fillRect(0, 0, W, 720);
    ctx.fillStyle = '#111';
    let y = 30;
    for (const [s, t] of text) {
      ctx.font = `${s >= 40 ? 'bold ' : ''}${s * 1.6}px Georgia, serif`;
      y += s * 1.6 * 1.45;
      ctx.fillText(t, 40, y);
    }
  });
  const card = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.197), new THREE.MeshLambertMaterial({ map: tex }));
  card.position.set(0, 1.25, -0.38);
  card.lookAt(0, EYE_HEIGHT, 0);
  scene.add(card);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.47), new THREE.MeshLambertMaterial({ color: 0x222222 }));
  stand.position.set(0, 1.015, -0.45);
  scene.add(stand);
}

// Arbres, maisons, montagnes
{
  const N = 160;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.2, 2, 6), new THREE.MeshLambertMaterial({ color: 0x5a3b22 }), N);
  const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(1.4, 4, 8), new THREE.MeshLambertMaterial({ color: 0x2f6b2c }), N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    const x = side * (5 + rand() * 40), z = -8 - rand() * 180, s = 0.7 + rand() * 0.8;
    one.set(s, s, s);
    m.compose(new THREE.Vector3(x, 1 * s, z), q, one); trunks.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x, 3.8 * s, z), q, one); crowns.setMatrixAt(i, m);
  }
  scene.add(trunks, crowns);

  const wallColors = [0xe9dcc4, 0xd8b38a, 0xc9d3dc, 0xf0efe8];
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1;
    const w = 6 + rand() * 4, h = 4 + rand() * 4, d = 7;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: wallColors[i % 4] }));
    body.position.y = h / 2;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.75, 3, 4), new THREE.MeshLambertMaterial({ color: 0x8e3b2e }));
    roof.position.y = h + 1.5; roof.rotation.y = Math.PI / 4;
    const win = new THREE.MeshLambertMaterial({ color: 0x24384f });
    for (let k = -1; k <= 1; k += 2) {
      const wnd = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), win);
      wnd.position.set(k * w * 0.25, h * 0.6, d / 2 + 0.01);
      g.add(wnd);
    }
    g.add(body, roof);
    g.position.set(side * (10 + rand() * 4), 0, -15 - i * 9);
    g.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    scene.add(g);
  }

  const mountMat = new THREE.MeshLambertMaterial({ color: 0x6d7f95 });
  for (let i = 0; i < 9; i++) {
    const a = THREE.MathUtils.degToRad(-70 + i * 17 + rand() * 6);
    const r = 300 + rand() * 80, h = 60 + rand() * 60;
    const mnt = new THREE.Mesh(new THREE.ConeGeometry(70 + rand() * 40, h, 7), mountMat);
    mnt.position.set(Math.sin(a) * r, h / 2 - 2, -Math.cos(a) * r);
    scene.add(mnt);
  }
}
}
