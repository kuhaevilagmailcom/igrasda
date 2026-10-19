import * as THREE from '../vendor/three.module.js';

const $ = (id) => document.getElementById(id);
const asset = (path) => new URL(path, document.baseURI).href;
const state = {
  active: false, paused: false, night: 1, anomaly: false,
  x: 0, z: 8, y: 0, yaw: 0, pitch: 0, keys: Object.create(null),
  jumpVelocity: 0, voiceTimer: 0, stepTimer: 0, flickerTimer: 0,
  lastPulse: 0, lastVoice: 0, died: false, mishaDelay: 0,
  horrorBurstTimer: 0, horrorBurstDuration: 0, anomalyKind: 'normal',
};

// Первая ночь всегда эталонная. Дальше тип коридора выбирается случайно.
const normalNight = { anomaly: false, kind: 'normal' };
const anomalyPool = [
  { anomaly: true, kind: 'red' },
  { anomaly: true, kind: 'red' },
  { anomaly: true, kind: 'chairs' },
  { anomaly: true, kind: 'chairs' },
  { anomaly: true, kind: 'shadow' },
  { anomaly: true, kind: 'trail' },
  { anomaly: true, kind: 'final' },
  { anomaly: false, kind: 'normal' },
  { anomaly: false, kind: 'normal' },
];
let previousNightKind = 'normal';
function chooseNightConfig(night) {
  if (night === 1) return normalNight;
  // Убираем повтор одной и той же аномалии подряд, но обычная ночь может повториться.
  let options = anomalyPool.filter((item) => item.kind !== previousNightKind || item.kind === 'normal');
  if (!options.length) options = anomalyPool;
  const chosen = options[Math.floor(Math.random() * options.length)];
  previousNightKind = chosen.kind;
  return chosen;
}
const thoughts = [
  'Ты здесь не один. Продолжай идти.',
  'Этот коридор кажется длиннее, чем должен быть.',
  'Кажется, за стеной кто-то шевельнулся.',
  'Не доверяй первому впечатлению.',
  'Тишина здесь звучит слишком громко.',
  'Кто-то наблюдает за тобой из темноты.'
];
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111317);
scene.fog = new THREE.FogExp2(0x111317, 0.023);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 1.65, 8);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.65));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.28;
$('game').appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xa9b7c5, 0x241814, 1.0));
const ambientLight = new THREE.PointLight(0xc3c5ce, 0.7, 18, 1.5);
ambientLight.position.set(0, 2.7, 3);
scene.add(ambientLight);
const redLight = new THREE.PointLight(0xd42f32, 0, 18, 1.5);
redLight.position.set(0, 2.8, -12);
scene.add(redLight);
const doors = [];
const lights = [];
const blockers = [];
const clock = new THREE.Clock();
const loader = new THREE.TextureLoader();
const anomalyGroup = new THREE.Group();
scene.add(anomalyGroup);
let misha = null;
let mishaMat = null;
const mishaFrames = [];
let mishaFrameIndex = -1;
let mishaAnimTime = 0;
let activeVoiceClip = null;
let nextVoiceIndex = 0;
let introActive = false;
let introElapsed = 0;
let introCueIndex = -1;
const introDuration = 13.5;
const introCues = [
  { at: 0, kicker: 'АРХИВ № 228 · 03:17', text: 'Ты проснулся в старом доме. Дверь за спиной захлопнулась.' },
  { at: 3.2, kicker: 'ЗАПИСЬ ПОВРЕЖДЕНА', text: 'Коридор не заканчивается. Из темноты доносится чьё-то дыхание.' },
  { at: 6.4, kicker: 'ОБНАРУЖЕН ЧЕЛОВЕК', text: 'Его зовут Мишаня. Не подходи к нему и не стой на месте.' },
  { at: 9.6, kicker: 'ОН УЖЕ ИДЁТ', text: 'Впереди две двери. Замечай странности — ошибка вернёт тебя в начало.' },
  { at: 12.2, kicker: 'ВОСЕМЬ НОЧЕЙ', text: 'Восемь ночей в старом доме. Первую ночь Мишаня не появится — со второй начнётся охота.' }
];
let dust = null;
let dustPositions = null;
let elapsed = 0;
const audio = { ctx: null, master: null, drone: null, lastPulse: 0 };

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.84, metalness: 0.04, ...extra });
function addBox(w, h, d, x, y, z, color, group = scene, extra = {}) {
  const obj = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, extra));
  obj.position.set(x, y, z);
  obj.castShadow = true;
  obj.receiveShadow = true;
  group.add(obj);
  return obj;
}
function addCylinder(rt, rb, height, x, y, z, color, group = scene, radial = 10) {
  const obj = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, height, radial), mat(color));
  obj.position.set(x, y, z);
  obj.castShadow = true;
  obj.receiveShadow = true;
  group.add(obj);
  return obj;
}
function addSphere(r, x, y, z, color, group = scene, scale = [1, 1, 1]) {
  const obj = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), mat(color));
  obj.position.set(x, y, z);
  obj.scale.set(...scale);
  obj.castShadow = true;
  group.add(obj);
  return obj;
}
function addTextSign(text, x, y, z, rotationY = 0, width = 0.56, height = 0.28) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#28262a'; ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#a99983'; ctx.lineWidth = 6; ctx.strokeRect(6, 6, 244, 116);
  ctx.fillStyle = '#e3d8c6'; ctx.font = 'bold 62px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 66);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture }));
  sign.position.set(x, y, z); sign.rotation.y = rotationY; scene.add(sign); return sign;
}
function registerBlocker(x, z, hx, hz) { blockers.push({ x, z, hx, hz }); }
function addPoster(x, z, file, width = 0.86, height = 1.14) {
  const left = x < 0;
  const frame = addBox(0.1, height + 0.16, width + 0.16, x, 1.8, z, 0x342b27);
  frame.rotation.y = left ? Math.PI / 2 : -Math.PI / 2;
  const tex = loader.load(asset(file)); tex.colorSpace = THREE.SRGBColorSpace;
  const picture = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  picture.position.set(x + (left ? 0.06 : -0.06), 1.8, z);
  picture.rotation.y = left ? Math.PI / 2 : -Math.PI / 2;
  scene.add(picture);
}
function addSideDoor(side, z, number) {
  const x = side * 3.36;
  // Боковые двери оформлены как настоящие двери квартир, но не участвуют в выборе финального выхода.
  addBox(0.12, 2.48, 1.82, x, 1.3, z, number % 3 === 0 ? 0x443932 : 0x51453b);
  addBox(0.08, 2.58, 1.94, x + side * 0.075, 1.32, z, 0x292522);
  addBox(0.13, 2.35, 1.67, x - side * 0.08, 1.3, z, number % 2 ? 0x554337 : 0x3d3834);
  addBox(0.03, 0.52, 0.08, x - side * 0.16, 1.35, z + 0.51, 0xb28b54);
  addSphere(0.065, x - side * 0.19, 1.36, z + 0.51, 0xd2b16d);
  addBox(0.04, 0.04, 0.04, x - side * 0.15, 2.03, z, 0xd4cab5);
  addTextSign(String(number).padStart(2, '0'), x - side * 0.11, 2.33, z - 0.03, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0.38, 0.23);
  // дверной коврик и потёртая отделка рядом
  addBox(0.06, 0.025, 1.22, x - side * 0.12, 0.025, z + 1.2, 0x3b302b);
}
function addMainDoor(x, color, name, number) {
  const width = 1.68, z = -29.32;
  addBox(width + 0.24, 2.78, 0.17, x, 1.41, z - 0.02, 0x292725);
  addBox(width, 2.56, 0.16, x, 1.34, z + 0.09, color);
  addBox(width - 0.32, 1.54, 0.07, x, 1.05, z + 0.18, color === 0x355776 ? 0x2d4b64 : 0x842a31);
  addBox(width - 0.32, 0.06, 0.07, x, 1.86, z + 0.18, 0x211f20);
  addBox(0.06, 0.72, 0.07, x - 0.53, 1.05, z + 0.18, 0x211f20);
  addBox(0.06, 0.72, 0.07, x + 0.53, 1.05, z + 0.18, 0x211f20);
  const handleX = x + (x < 0 ? 0.58 : -0.58);
  addBox(0.045, 0.19, 0.08, handleX, 1.12, z + 0.22, 0xb8a478);
  addSphere(0.055, handleX, 1.1, z + 0.27, 0xd3bf8a);
  addSphere(0.065, x, 2.02, z + 0.19, 0x171717);
  addTextSign(String(number), x, 2.46, z + 0.2, 0, 0.38, 0.22);
  addBox(width + 0.6, 0.08, 0.32, x, 2.88, z + 0.04, 0x35302d);
  const lightMat = mat(color, { emissive: color, emissiveIntensity: 0.22 });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.1, 0.16), lightMat);
  lamp.position.set(x, 2.94, z + 0.24); scene.add(lamp);
  const doorObj = new THREE.Mesh(new THREE.BoxGeometry(width, 2.56, 0.16), mat(color));
  doorObj.position.set(x, 1.34, z + 0.09);
  doorObj.userData = { name, isRed: name === 'КРАСНАЯ ДВЕРЬ' };
  doorObj.visible = false; // hit target remains exact, visible door consists of detailed panels above
  scene.add(doorObj); doors.push(doorObj);
  addBox(2.2, 0.035, 0.88, x, 0.025, -26.2, name === 'КРАСНАЯ ДВЕРЬ' ? 0x51272a : 0x283541);
}

function buildRoom() {
  // Основа длинного подъезда с плиткой, потолком, плинтусами и панелями.
  addBox(7.25, 0.24, 44, 0, -0.12, -9.5, 0x3a3634);
  addBox(7.25, 0.16, 44, 0, 3.58, -9.5, 0x26272a);
  addBox(0.18, 3.58, 44, -3.6, 1.79, -9.5, 0x5a5350);
  addBox(0.18, 3.58, 44, 3.6, 1.79, -9.5, 0x5a5350);
  addBox(0.22, 0.22, 44, -3.42, 0.13, -9.5, 0x282321);
  addBox(0.22, 0.22, 44, 3.42, 0.13, -9.5, 0x282321);
  addBox(7.2, 0.08, 0.18, 0, 0.03, 12.3, 0x1b1c1e);
  // Квадратная советская плитка — не плоская однотонная дорожка.
  const tileColors = [0x4c4845, 0x45413e, 0x504944, 0x403d3b];
  for (let z = 11.5, row = 0; z > -31; z -= 1.38, row++) {
    for (let x = -2.44, col = 0; x <= 2.44; x += 1.22, col++) {
      const tile = addBox(1.17, 0.025, 1.32, x, 0.012, z - 0.65, tileColors[(row + col * 3) % tileColors.length]);
      tile.material.roughness = 0.96;
    }
  }
  // Обои и вертикальные стыки панелей.
  for (let z = 10; z > -30; z -= 2.35) {
    addBox(0.025, 2.62, 0.035, -3.485, 1.87, z, 0x716761);
    addBox(0.025, 2.62, 0.035, 3.485, 1.87, z, 0x716761);
    addBox(0.026, 0.055, 0.035, -3.48, 2.88, z, 0x877a6d);
    addBox(0.026, 0.055, 0.035, 3.48, 2.88, z, 0x877a6d);
  }
  // Старые трубы, кабель-канал и разводка вдоль потолка.
  for (const x of [-3.15, 3.15]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 42, 9), mat(0x353637));
    pipe.rotation.x = Math.PI / 2; pipe.position.set(x, 3.18, -9.5); scene.add(pipe);
    addBox(0.09, 0.08, 42, x * 0.91, 3.43, -9.5, 0x3b3a3a);
  }
  // Потолочные светильники, световые пятна и заведомо тусклый свет в конце.
  for (let z = 8; z > -27; z -= 5.3) {
    addBox(1.0, 0.075, 0.42, 0, 3.43, z, 0x383b3b);
    const lamp = addBox(0.82, 0.035, 0.29, 0, 3.37, z, 0xb9c0b8, scene, { emissive: 0xc4d7c9, emissiveIntensity: 0.95 });
    const light = new THREE.PointLight(0xd5dfd4, 2.4, 8.4, 1.65);
    light.position.set(0, 3.08, z); scene.add(light); lights.push({ light, lamp, base: 2.4, offset: Math.random() * 5 });
  }
  // Двери соседей вдоль коридора.
  let apartment = 21;
  for (let z = 6; z > -24; z -= 6) {
    addSideDoor(-1, z, apartment++);
    addSideDoor(1, z - 2.4, apartment++);
  }
  // Панно, фотографии и старые объявления в рамках.
  addPoster(-3.485, 3.2, 'assets/wall-selfie.png', 0.92, 1.18);
  addPoster(3.485, 0.4, 'assets/wall-outdoor.png', 0.92, 1.18);
  addPoster(-3.485, -5.5, 'assets/hero-arms.png', 0.86, 1.13);
  addPoster(3.485, -10.5, 'assets/menu-horror.png', 0.91, 1.17);
  addPoster(-3.485, -16, 'assets/hero-calm.png', 0.88, 1.14);
  addPoster(3.485, -21.3, 'assets/hero-close.png', 0.9, 1.2);
  // Светоотражающие номера этажей и табличка у выхода.
  addTextSign('13', 0, 2.76, -3, 0, 0.54, 0.28);
  addTextSign('ЛИФТ', 0, 2.98, -25.7, 0, 1.0, 0.3);
  // Домашние вещи: обувница, обувь, зонты, коробки, цветы, стул и столик.
  addBox(1.12, 0.74, 0.46, -2.52, 0.38, 5.1, 0x49382e); registerBlocker(-2.52, 5.1, 0.65, 0.35);
  addBox(1.17, 0.055, 0.51, -2.52, 0.78, 5.1, 0x6a5140);
  for (let i = 0; i < 3; i++) {
    addBox(0.22, 0.095, 0.34, -2.91 + i * 0.36, 0.12, 4.81, [0x292d31, 0x5a4638, 0x353333][i]);
  }
  addBox(0.55, 0.72, 0.55, 2.52, 0.37, 1.5, 0x4b3c32); registerBlocker(2.52, 1.5, 0.36, 0.36);
  addBox(0.65, 0.055, 0.66, 2.52, 0.76, 1.5, 0x6d5948);
  for (let i = 0; i < 3; i++) addBox(0.42, 0.03, 0.47, 2.52, 0.25 + i * 0.2, 1.5, 0x302d2b);
  // Ваза и ветки на комоде.
  addCylinder(0.12, 0.17, 0.35, 2.52, 0.99, 1.5, 0x77716a);
  for (let i = 0; i < 5; i++) {
    const leaf = addSphere(0.15, 2.52 + Math.sin(i * 2.1) * 0.23, 1.32 + (i % 3) * 0.16, 1.5 + Math.cos(i * 2.1) * 0.2, 0x3c5941);
    leaf.scale.set(0.55, 1.35, 0.4);
  }
  // Припаркованная детская коляска / тележка и пара коробок вдоль стены.
  addBox(0.86, 0.1, 0.65, -2.56, 0.48, -7.3, 0x302e2b); registerBlocker(-2.56, -7.3, 0.55, 0.45);
  addBox(0.1, 0.78, 0.1, -2.9, 0.88, -7.48, 0x494441);
  addBox(0.1, 0.78, 0.1, -2.22, 0.88, -7.48, 0x494441);
  addSphere(0.16, -2.87, 0.2, -7.48, 0x151515); addSphere(0.16, -2.25, 0.2, -7.48, 0x151515);
  addBox(0.56, 0.48, 0.46, -2.75, 0.25, -8.2, 0x5c4b3b); registerBlocker(-2.75, -8.2, 0.34, 0.3);
  addBox(0.47, 0.42, 0.44, -2.28, 0.22, -8.05, 0x66513e); registerBlocker(-2.28, -8.05, 0.3, 0.28);
  // Радиаторы отопления и стояки.
  for (const z of [0, -12, -20]) {
    addBox(0.27, 0.84, 1.52, 3.22, 0.63, z, 0x77716b);
    for (let i = 0; i < 7; i++) addBox(0.08, 0.72, 0.08, 3.05, 0.65, z - 0.58 + i * 0.19, 0x99928a);
  }
  // Пожарный щит с огнетушителем.
  addBox(0.16, 0.85, 0.58, -3.23, 1.05, -12, 0x4c463f);
  addBox(0.09, 0.65, 0.18, -3.1, 0.88, -12, 0x8d2428);
  addBox(0.1, 0.12, 0.19, -3.1, 1.28, -12, 0xc9c0ad);
  // Коврик, ведро, швабра и мокрое пятно — детали у стен, центр прохода оставлен свободным.
  addBox(1.55, 0.025, 2.0, 0, 0.02, -15, 0x62584d);
  addBox(0.38, 0.06, 0.38, 2.68, 0.04, -17.5, 0x4a443d);
  addCylinder(0.18, 0.23, 0.42, 2.68, 0.25, -17.5, 0x47494a); registerBlocker(2.68, -17.5, 0.25, 0.28);
  const mop = addCylinder(0.028, 0.028, 1.6, 2.92, 0.84, -17.4, 0x76634f); mop.rotation.z = -0.12;
  addBox(1.25, 0.018, 0.7, -0.8, 0.036, -22.4, 0x292e30);
  // Закрытая торцевая стена. Между двумя дверями — узкое тёмное стекло.
  addBox(7.25, 3.58, 0.2, 0, 1.79, -29.6, 0x504845);
  addBox(1.25, 1.78, 0.12, 0, 1.98, -29.28, 0x282b31);
  addBox(1.03, 1.56, 0.045, 0, 1.98, -29.18, 0x19252b, scene, { emissive: 0x17252e, emissiveIntensity: 0.18 });
  addBox(0.05, 1.58, 0.055, 0, 1.98, -29.12, 0x4c514e);
  addBox(1.05, 0.05, 0.055, 0, 1.98, -29.12, 0x4c514e);
  addMainDoor(-1.65, 0x355776, 'СИНЯЯ ДВЕРЬ', 47);
  addMainDoor(1.65, 0x9d3036, 'КРАСНАЯ ДВЕРЬ', 48);
  createDust();
}
function createDust() {
  const count = 240;
  dustPositions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    dustPositions[i * 3] = (Math.random() - 0.5) * 6.2;
    dustPositions[i * 3 + 1] = 0.4 + Math.random() * 2.8;
    dustPositions[i * 3 + 2] = 10 - Math.random() * 39;
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  dust = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xc1b7a7, size: 0.025, transparent: true, opacity: 0.34, sizeAttenuation: true }));
  scene.add(dust);
}
function addChair(x, z) {
  addBox(0.52, 0.12, 0.52, x, 0.55, z, 0x5a4335, anomalyGroup);
  for (const dx of [-0.2, 0.2]) for (const dz of [-0.19, 0.19]) addBox(0.055, 0.5, 0.055, x + dx, 0.29, z + dz, 0x3b3029, anomalyGroup);
  addBox(0.52, 0.62, 0.09, x, 0.88, z - 0.2, 0x4d3b31, anomalyGroup);
}
function makeMishaCutout() {
  const files = ['hero-neutral.png', 'hero-arms.png', 'hero-calm.png', 'hero-pointing.png'];
  files.forEach((file, frameIndex) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(0, 0, c.width, c.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2];
          if (Math.max(r, g, b) - Math.min(r, g, b) < 24 && r > 142 && g > 142 && b > 142) pixels.data[i + 3] = 0;
        }
        ctx.putImageData(pixels, 0, 0);
        const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
        mishaFrames[frameIndex] = tex;
        if (frameIndex === 0 || mishaFrameIndex < 0) {
          mishaMat.map = tex; mishaMat.needsUpdate = true; mishaFrameIndex = frameIndex;
        }
      } catch (err) { console.warn('Не удалось подготовить анимацию Мишани.', err); }
    };
    img.onerror = () => console.warn(`Не удалось загрузить позу Мишани: ${file}`);
    img.src = asset(`assets/${file}`);
  });
}
function animateMisha(dt, walking = true) {
  if (!misha || !misha.visible) return;
  mishaAnimTime += dt * (walking ? 1 : 0.28);
  const phase = mishaAnimTime * (walking ? 8.2 : 1.4);
  misha.position.y = (misha.userData.baseY ?? 1.48) + (walking ? Math.abs(Math.sin(phase)) * 0.055 : Math.sin(phase) * 0.018);
  // Не меняем rotation.z напрямую после lookAt(): смешивание Euler и quaternion
  // могло заваливать плоскость Мишани набок и визуально переворачивать персонажа.
  // На дистанции чередуются полнофигурные позы; вблизи он иногда резко меняет жест.
  const poses = walking
    ? (Number(misha.userData.distance ?? 99) < 5 ? [0, 3, 0, 2, 0, 3] : [0, 1, 0, 1])
    : [0];
  const frame = poses[Math.floor(mishaAnimTime / (walking ? 0.34 : 1.0)) % poses.length];
  if (mishaFrames[frame] && frame !== mishaFrameIndex) {
    mishaMat.map = mishaFrames[frame];
    mishaMat.needsUpdate = true;
    mishaFrameIndex = frame;
  }
}

function spawnMisha(visible = true, z = 3.1, x = 0) {
  if (!misha) {
    mishaMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    misha = new THREE.Mesh(new THREE.PlaneGeometry(1.85, 2.95), mishaMat); scene.add(misha); makeMishaCutout();
  }
  misha.visible = visible;
  misha.userData.baseY = 1.48;
  misha.position.set(x, 1.48, z);
  misha.rotation.set(0, 0, 0);
  mishaAnimTime = 0;
}
function hideMisha() { if (misha) misha.visible = false; }
function clearAnomaly() { anomalyGroup.clear(); redLight.intensity = 0; hideMisha(); }
function setHorrorMood() {
  const body = document.body;
  body.classList.toggle('horror-night-2', state.active && !state.paused && state.night === 2);
  body.classList.toggle('horror-night-3', state.active && !state.paused && state.night === 3);
  body.classList.remove('horror-burst', 'horror-danger');
  state.horrorBurstDuration = 0;
  state.horrorBurstTimer = state.night === 2 ? 5 + Math.random() * 4 : state.night === 3 ? 2.8 + Math.random() * 2.7 : 0;
}
function clearHorrorMood() {
  document.body.classList.remove('horror-night-2', 'horror-night-3', 'horror-burst', 'horror-danger');
  state.horrorBurstDuration = 0;
  state.horrorBurstTimer = 0;
}

function setupRound() {
  if (activeVoiceClip) { activeVoiceClip.pause(); activeVoiceClip.currentTime = 0; activeVoiceClip = null; }
  clearTimeout(say.timer);
  $('misha-dialogue').classList.add('hidden');
  clearAnomaly();
  setHorrorMood();
  const config = chooseNightConfig(state.night);
  state.anomaly = config.anomaly;
  state.anomalyKind = config.kind;
  doors.forEach((door) => { door.userData.correct = state.anomaly ? door.userData.isRed : !door.userData.isRed; });
  if (['red', 'final'].includes(config.kind)) {
    // Ночь 2 и финал: аварийная красная лампа заливает дальнюю часть коридора.
    redLight.intensity = config.kind === 'final' ? 8.2 : 6.4;
    const emergencyLamp = addBox(0.72, 0.12, 0.2, 0, 3.18, -12, 0xe02028, anomalyGroup, { emissive: 0xff0712, emissiveIntensity: 2.5, roughness: 0.35 });
    emergencyLamp.material.toneMapped = false;
    const glow = new THREE.PointLight(0xff1420, config.kind === 'final' ? 4.2 : 2.8, 11, 1.6);
    glow.position.set(0, 3.05, -12); anomalyGroup.add(glow);
  }
  if (config.kind === 'chairs') {
    // Ночь 3: три стула перегораживают проход.
    addChair(-1.12, -10.1); addChair(0.18, -11.25); addChair(1.16, -10.15);
    addBox(1.24, 0.028, 0.12, 0.15, 0.035, -12.8, 0x71604e, anomalyGroup);
    addBox(0.82, 0.024, 0.09, -0.48, 0.035, -9.35, 0x88725b, anomalyGroup);
  }
  if (config.kind === 'shadow') {
    // Ночь 4: отдельная холодная аномалия — силуэт висит в глубине коридора.
    const coldGlow = new THREE.PointLight(0x45a9ff, 3.1, 12, 1.7);
    coldGlow.position.set(-1.15, 2.2, -17.2); anomalyGroup.add(coldGlow);
    const shadowBody = addBox(0.72, 1.65, 0.22, -1.15, 1.1, -17.2, 0x03070d, anomalyGroup, { emissive: 0x071323, emissiveIntensity: 0.35 });
    shadowBody.rotation.z = -0.08;
    addSphere(0.32, -1.15, 2.12, -17.2, 0x020408, anomalyGroup, [0.82, 1.12, 0.72]);
    addBox(0.13, 1.1, 0.14, -1.58, 0.85, -17.15, 0x030609, anomalyGroup).rotation.z = -0.18;
    addBox(0.13, 1.1, 0.14, -0.72, 0.85, -17.15, 0x030609, anomalyGroup).rotation.z = 0.18;
    for (const x of [-2.6, 2.6]) {
      const lamp = addBox(0.16, 0.08, 0.16, x, 3.36, -17.2, 0x3c9ee8, anomalyGroup, { emissive: 0x168bff, emissiveIntensity: 1.8 });
      lamp.material.toneMapped = false;
    }
  }
  if (config.kind === 'trail') {
    // Ночь 5: следы ведут к портрету, но фигура уже кажется ближе.
    const tex = loader.load(asset('assets/hero-close.png')); tex.colorSpace = THREE.SRGBColorSpace;
    const portrait = new THREE.Mesh(new THREE.PlaneGeometry(1.62, 2.2), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    portrait.position.set(3.36, 1.84, -11.7); portrait.rotation.y = -Math.PI / 2; anomalyGroup.add(portrait);
    const stainMat = mat(0x3b080d, { roughness: 0.98 });
    for (let i = 0; i < 9; i++) {
      const side = i % 2 === 0 ? -0.22 : 0.22;
      const stain = new THREE.Mesh(new THREE.CircleGeometry(0.12 + (i % 3) * 0.035, 10), stainMat);
      stain.rotation.x = -Math.PI / 2;
      stain.position.set(side, 0.045, -7.8 - i * 1.35);
      stain.scale.set(0.8, 1.55, 1);
      anomalyGroup.add(stain);
    }
    addBox(1.3, 2.9, 0.05, 0, 1.46, -14.5, 0x020204, anomalyGroup);
    const whisperGlow = new THREE.PointLight(0x9b1226, 1.3, 8, 1.8);
    whisperGlow.position.set(0, 1.4, -10); anomalyGroup.add(whisperGlow);
  }
  if (config.kind === 'final') {
    // Ночь 6 объединяет мотивы, но усиливает их: красный свет и огромный портрет.
    const tex = loader.load(asset('assets/hero-close.png')); tex.colorSpace = THREE.SRGBColorSpace;
    const portrait = new THREE.Mesh(new THREE.PlaneGeometry(2.25, 2.8), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    portrait.position.set(3.36, 1.84, -11.7); portrait.rotation.y = -Math.PI / 2; anomalyGroup.add(portrait);
    addBox(1.3, 2.9, 0.05, 0, 1.46, -14.5, 0x020204, anomalyGroup);
    addChair(-0.9, -10.1); addChair(0.9, -11.25);
  }
  // Мишаня присутствует на каждом уровне с самого начала раунда.
  // Он начинает позади игрока, давая несколько секунд на ориентирование, а затем идёт в погоню.
  // С каждой ночью стартовая дистанция немного сокращается, а давление на игрока растёт.
  const mishaGap = Math.max(3.8, 5.25 - (state.night - 1) * 0.24 + (Math.random() - 0.5) * 0.8);
  const mishaLane = (Math.random() - 0.5) * 1.8;
  const mishaZ = Math.min(12.75, state.z + mishaGap);
  spawnMisha(state.active && state.night >= 2, mishaZ, mishaLane);
  state.mishaDelay = state.active ? Math.max(1.2, 2.6 - (state.night - 1) * 0.24) : 0;
  state.voiceTimer = (state.night >= 3 ? 1.2 : state.night === 2 || state.night === 5 ? 1.6 : 2.0) + Math.random() * 1.8;
  state.lastPulse = 0;
  state.lastVoice = 0;
  if (state.active) $('misha-dialogue').classList.add('hidden');
  updateHud();
}
function updateHud() {
  $('night').textContent = `НОЧЬ ${String(state.night).padStart(2, '0')} / 08`;
  document.querySelectorAll('#night-progress .night-step').forEach((step, index) => {
    step.classList.toggle('completed', index + 1 < state.night);
    step.classList.toggle('current', index + 1 === state.night);
    step.setAttribute('aria-current', index + 1 === state.night ? 'step' : 'false');
  });
  $('objective').textContent = 'Осмотри коридор. Замечай детали и решай сам, какой выход выбрать.';
}
function say(text, duration = 4600, voice = false) {
  $('misha-text').textContent = text;
  $('misha-speaker').textContent = voice ? 'МИШАНЯ ГОВОРИТ' : 'ГОЛОС ИЗ ТЕМНОТЫ';
  $('misha-dialogue').classList.toggle('voice-caption', voice);
  $('misha-dialogue').classList.remove('hidden');
  clearTimeout(say.timer);
  say.timer = setTimeout(() => $('misha-dialogue').classList.add('hidden'), duration);
}
function startAudio() {
  if (audio.ctx) { if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {}); return; }
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audio.ctx = new AudioContextClass();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = (Number($('volume').value) / 100) * 0.22;
    audio.master.connect(audio.ctx.destination);
    audio.drone = audio.ctx.createOscillator();
    const gain = audio.ctx.createGain(); gain.gain.value = 0.075;
    audio.drone.type = 'sawtooth'; audio.drone.frequency.value = 42;
    audio.drone.connect(gain).connect(audio.master); audio.drone.start();
    audio.droneGain = gain;
  } catch (err) { console.warn('Web Audio недоступен; игровые звуки будут работать через MP3.', err); }
}
function setDrone(enabled) {
  if (audio.droneGain && audio.ctx) audio.droneGain.gain.setTargetAtTime(enabled ? 0.075 : 0, audio.ctx.currentTime, 0.25);
}
function setGameVolume() {
  const vol = Number($('volume').value) / 100;
  if (audio.master && audio.ctx) audio.master.gain.setTargetAtTime(vol * 0.22, audio.ctx.currentTime, 0.05);
  try { localStorage.setItem('mishanya-volume', String($('volume').value)); } catch {}
  window.dispatchEvent(new CustomEvent('mishanya-volume', { detail: vol }));
}
function playClip(file, multiplier = 1, loop = false) {
  const clip = new Audio(asset(`audio/${file}`));
  clip.volume = Math.max(0, Math.min(1, Number($('volume').value) / 100 * multiplier));
  clip.loop = loop; clip.preload = 'auto';
  clip.play().catch(() => {});
  return clip;
}
const voiceDurations = [1776, 3631, 2194, 1175, 1045, 2978];
const voiceCaptions = [
  'Сука, сука, иди сюда, еблан!',
  'Привет, бро! Я Миша 228, я нахуй такой злой!',
  'Я тебя съееем!',
  'Хахахахаха!',
  'Гондонище!',
  'Пидорас, я тебя убью нахуй!'
];
function speakMisha() {
  if (activeVoiceClip && !activeVoiceClip.paused && !activeVoiceClip.ended) return;
  if (activeVoiceClip) { activeVoiceClip.pause(); activeVoiceClip.currentTime = 0; }
  // Play the six supplied lines in order, then loop back to the first one.
  const index = (nextVoiceIndex % voiceCaptions.length) + 1;
  nextVoiceIndex = (nextVoiceIndex + 1) % voiceCaptions.length;
  const clip = playClip(`golos misha (${index}).mp3`, 0.9);
  activeVoiceClip = clip;
  // Субтитр живёт примерно столько же, сколько реплика; следующая фраза не накладывается поверх неё.
  say(voiceCaptions[index - 1], voiceDurations[index - 1] + 450, true);
  clip.addEventListener('ended', () => {
    if (activeVoiceClip !== clip) return;
    activeVoiceClip = null;
    state.voiceTimer = (state.night >= 3 ? 0.9 : 1.5) + Math.random() * (state.night >= 3 ? 1.5 : 2.1);
  }, { once: true });
  clip.addEventListener('error', () => { if (activeVoiceClip === clip) activeVoiceClip = null; }, { once: true });
}
function pulse(freq = 55, duration = 0.25, volume = 0.12) {
  if (!audio.ctx || !audio.master) return;
  const o = audio.ctx.createOscillator(), g = audio.ctx.createGain(), t = audio.ctx.currentTime;
  o.type = 'sine'; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(volume, t); g.gain.exponentialRampToValueAtTime(0.001, t + duration);
  o.connect(g).connect(audio.master); o.start(t); o.stop(t + duration);
}
function footstep() { pulse(70 + Math.random() * 25, 0.075, 0.065); }
function smoothstep(value) { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); }
function setIntroCue(index) {
  if (index === introCueIndex || !introCues[index]) return;
  introCueIndex = index;
  const cue = introCues[index];
  const caption = $('intro-caption');
  const kicker = $('intro-kicker');
  const subtitle = $('intro-subtitle');
  // Keep the narration visible even if another stylesheet or animation leaves it hidden.
  caption.classList.remove('hidden');
  caption.style.display = 'block';
  caption.style.visibility = 'visible';
  caption.style.opacity = '1';
  kicker.textContent = cue.kicker;
  subtitle.textContent = cue.text;
  subtitle.style.display = 'block';
  subtitle.style.visibility = 'visible';
  subtitle.style.opacity = '1';
  caption.classList.remove('intro-caption-change');
  void caption.offsetWidth;
  caption.classList.add('intro-caption-change');
}
function start() {
  nextVoiceIndex = 0;
  startAudio(); setDrone(true);
  state.active = false; state.paused = false; state.night = 1;
  state.x = 0; state.z = 8; state.y = 0; state.yaw = 0; state.pitch = 0; state.jumpVelocity = 0;
  state.voiceTimer = 2.2 + Math.random() * 1.4; state.stepTimer = 0; state.died = false;
  state.keys = Object.create(null);
  $('menu').classList.remove('visible'); $('settings').classList.add('hidden'); $('settings').classList.remove('visible');
  $('pause').classList.add('hidden'); $('notice').classList.add('hidden');
  $('hud').classList.add('hidden'); $('crosshair').classList.add('hidden'); $('misha-dialogue').classList.add('hidden');
  clearHorrorMood();
  setupRound();
  // Отдельный постановочный кадр: Мишаня виден в самом коридоре, прежде чем начнётся погоня.
  spawnMisha(true, -16.2, 0.72);
  introActive = true; introElapsed = 0; introCueIndex = -1;
  camera.position.set(0, 1.72, 12.5);
  camera.lookAt(0, 1.48, -20);
  $('intro-cutscene').classList.remove('hidden');
  setIntroCue(0);
  window.dispatchEvent(new Event('mishanya-started'));
}
function updateIntro(dt) {
  if (!introActive) return;
  introElapsed += Math.min(dt, 0.05);
  const t = introElapsed;
  const cueIndex = introCues.reduce((current, cue, index) => t >= cue.at ? index : current, 0);
  setIntroCue(cueIndex);
  const mishaProgress = smoothstep(t / introDuration);
  if (misha) {
    misha.position.x = 0.72 + Math.sin(t * 0.82) * 0.14;
    misha.position.z = -16.2 + 8.4 * mishaProgress;
    misha.userData.distance = Math.hypot(camera.position.x - misha.position.x, camera.position.z - misha.position.z);
    // В заставке тоже поворачиваем спрайт только по вертикали — без наклона и кувырков.
    misha.rotation.set(0, Math.atan2(camera.position.x - misha.position.x, camera.position.z - misha.position.z), 0);
    animateMisha(dt, true);
    // Жёстко сбрасываем наклон спрайта каждый кадр: он может быть только вертикальным.
    misha.rotation.x = 0;
    misha.rotation.z = 0;
    misha.scale.set(1, 1, 1);
  }
  if (t < 4.5) {
    const p = smoothstep(t / 4.5);
    camera.position.set(Math.sin(t * 0.72) * 0.035, 1.72 + Math.sin(t * 0.9) * 0.025, 12.5 + (2.5 - 12.5) * p);
    camera.lookAt(0.05 * p, 1.48, -20 + 9 * p);
  } else if (t < 7.5) {
    const p = smoothstep((t - 4.5) / 3);
    camera.position.set(-1.0 * p, 1.72 + Math.sin(t * 1.15) * 0.025, 2.5 + (-1.0 - 2.5) * p);
    camera.lookAt(0.08 + 0.64 * p, 1.45, -11 + 2.4 * p);
  } else {
    const p = smoothstep((t - 7.5) / (introDuration - 7.5));
    camera.position.set(-1 + 0.62 * p, 1.72 + Math.sin(t * 1.4) * 0.018, -1 + (-1.3) * p);
    camera.lookAt(misha ? misha.position.x : 0.72, 1.43, misha ? misha.position.z - 0.2 : -7.5);
  }
  $('intro-timecode').textContent = `REC  00:${String(Math.min(59, Math.floor(t))).padStart(2, '0')}`;
  $('intro-progress-bar').style.transform = `scaleX(${Math.min(1, t / introDuration)})`;
  if (t >= introDuration) finishIntro(false);
}
function finishIntro(fromUser = false) {
  if (!introActive) return;
  introActive = false;
  $('intro-cutscene').classList.add('hidden');
  state.active = true; state.paused = false; state.night = 1;
  state.x = 0; state.z = 8; state.y = 0; state.yaw = 0; state.pitch = 0; state.jumpVelocity = 0;
  state.voiceTimer = 1.8 + Math.random() * 1.7; state.stepTimer = 0; state.died = false;
  state.keys = Object.create(null);
  camera.position.set(state.x, 1.65, state.z);
  camera.rotation.set(0, 0, 0, 'YXZ');
  $('hud').classList.remove('hidden'); $('crosshair').classList.remove('hidden'); $('misha-dialogue').classList.add('hidden');
  setupRound(); updateHud(); setDrone(true);
  if (fromUser && renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock();
}

function pauseGame() {
  if (!state.active || state.paused) return;
  state.paused = true; state.keys = Object.create(null);
  document.body.classList.remove('horror-burst', 'horror-danger');
  $('pause').classList.remove('hidden'); $('pause').classList.add('visible');
  if (document.pointerLockElement) document.exitPointerLock();
}
function notice(title, text, button, handler) {
  state.paused = true; state.keys = Object.create(null);
  if (document.pointerLockElement) document.exitPointerLock();
  $('notice-title').textContent = title; $('notice-text').textContent = text;
  $('notice-button').textContent = button; $('notice-button').onclick = handler;
  $('notice').classList.remove('hidden');
}
function continueRound() {
  $('notice').classList.add('hidden'); $('pause').classList.add('hidden');
  state.paused = false;
  if (renderer.domElement.requestPointerLock && state.active) renderer.domElement.requestPointerLock();
}
function resetToFirstNight() {
  state.night = 1; state.x = 0; state.z = 8; state.y = 0; state.yaw = 0; state.pitch = 0; state.jumpVelocity = 0;
  setupRound(); updateHud();
}
function chooseDoor(door) {
  if (state.paused || !state.active) return;
  if (door.userData.correct) {
    if (state.night === 8) {
      state.active = false; state.paused = true; setDrone(false);
      $('hud').classList.add('hidden'); $('crosshair').classList.add('hidden');
      $('misha-dialogue').classList.add('hidden');
      clearHorrorMood();
      window.dispatchEvent(new Event('mishanya-finale'));
      return;
    }
    state.night++;
    state.x = 0; state.z = 8; state.y = 0; state.yaw = 0; state.pitch = 0;
    setupRound();
    notice('ВЕРНО', 'Коридор не смог тебя обмануть. Вдохни и иди дальше.', 'Продолжить', continueRound);
  } else {
    playClip('death-bong.mp3', 0.9);
    resetToFirstNight();
    notice('ТЫ ПРОИГРАЛ', 'Ты выбрал не ту дверь. Коридор сбросил прогресс — попробуй ещё раз.', 'Попробовать снова', continueRound);
  }
}
function toMenu() {
  introActive = false; $('intro-cutscene').classList.add('hidden');
  if (activeVoiceClip) { activeVoiceClip.pause(); activeVoiceClip.currentTime = 0; activeVoiceClip = null; }
  clearTimeout(say.timer);
  state.active = false; state.paused = false; state.keys = Object.create(null); setDrone(false);
  $('notice').classList.add('hidden'); $('pause').classList.add('hidden');
  $('hud').classList.add('hidden'); $('crosshair').classList.add('hidden'); $('misha-dialogue').classList.add('hidden');
  $('settings').classList.add('hidden'); $('settings').classList.remove('visible'); $('menu').classList.add('visible'); hideMisha(); clearHorrorMood();
  window.dispatchEvent(new Event('mishanya-menu'));
}
function nearbyDoor() {
  // Не разрешаем выбирать обе двери с центра прохода: нужно подойти именно к нужной.
  const candidates = doors
    .map((door) => ({ door, dx: Math.abs(camera.position.x - door.position.x), distance: Math.hypot(camera.position.x - door.position.x, camera.position.z - door.position.z) }))
    .filter((item) => item.dx < 1.4 && item.distance < 3.35)
    .sort((a, b) => a.distance - b.distance);
  return candidates[0]?.door ?? null;
}
function canOccupy(x, z) {
  if (x < -3.02 || x > 3.02 || z < -27.0 || z > 8.4) return false;
  for (const b of blockers) if (Math.abs(x - b.x) < b.hx + 0.26 && Math.abs(z - b.z) < b.hz + 0.26) return false;
  if (state.anomalyKind === 'chairs' && [[-1.05, -10.5], [0.2, -11.1], [1.18, -10.35]].some(([bx, bz]) => Math.abs(x - bx) < 0.48 && Math.abs(z - bz) < 0.48)) return false;
  if (['trail', 'final'].includes(state.anomalyKind) && Math.abs(x) < 0.8 && Math.abs(z + 14.5) < 0.22) return false;
  return true;
}
function endGameWithDeath() {
  if (state.died) return;
  state.died = true;
  playClip('death-bong.mp3', 0.95);
  pulse(38, 0.6, 0.16);
  resetToFirstNight();
  notice('ТЫ ПИДОРАС АВЫАЖБЫВДЛЖАЬВЫ', 'Мишаня тебя поймал. Попробуй ещё раз.', 'Попробовать снова', continueRound);
  setTimeout(() => { state.died = false; }, 900);
}
function update(delta) {
  if (!state.active || state.paused) return;
  const dt = Math.min(delta, 0.05);
  elapsed += dt;
  let sx = (state.keys.KeyD ? 1 : 0) - (state.keys.KeyA ? 1 : 0);
  let sz = (state.keys.KeyW ? 1 : 0) - (state.keys.KeyS ? 1 : 0);
  const running = !!(state.keys.ShiftLeft || state.keys.ShiftRight);
  const moving = sx !== 0 || sz !== 0;
  const speed = running ? 5.2 : 2.85;
  if (moving) {
    const len = Math.hypot(sx, sz); sx /= len; sz /= len;
    const nx = state.x + (Math.cos(state.yaw) * sx - Math.sin(state.yaw) * sz) * speed * dt;
    const nz = state.z + (Math.sin(state.yaw) * sx - Math.cos(state.yaw) * sz) * speed * dt;
    if (canOccupy(nx, state.z)) state.x = nx;
    if (canOccupy(state.x, nz)) state.z = nz;
    state.stepTimer -= dt;
    if (state.stepTimer <= 0) { footstep(); state.stepTimer = running ? 0.28 : 0.43; }
  } else state.stepTimer = 0;
  if (state.jumpVelocity !== 0 || state.y > 0) {
    state.y += state.jumpVelocity * dt;
    state.jumpVelocity -= 10.5 * dt;
    if (state.y <= 0) { state.y = 0; state.jumpVelocity = 0; }
  }
  camera.position.set(state.x, 1.65 + state.y, state.z);
  camera.rotation.set(state.pitch, state.yaw, 0, 'YXZ');

  if (misha && state.mishaDelay > 0) state.mishaDelay = Math.max(0, state.mishaDelay - dt);
  if (misha?.visible && state.mishaDelay <= 0) {
    // Небольшое боковое смещение и ускорение с поворотом делают погоню менее механической.
    const phase = elapsed * 2.0 + state.night * 0.7;
    const targetX = state.x + Math.sin(phase) * 0.22;
    const dx = targetX - misha.position.x, dz = state.z - misha.position.z;
    const distance = Math.hypot(dx, dz) || 1;
    misha.userData.distance = distance;
    const pressure = (state.night - 1) * 0.12;
    const chaseSpeed = running ? 1.78 + pressure : 2.48 + pressure;
    misha.position.x += (dx / distance) * dt * chaseSpeed;
    misha.position.z += (dz / distance) * dt * chaseSpeed;
    // Billboard rotates only around the vertical axis. Full lookAt() can pitch the
    // flat sprite when camera height changes and make the image appear to flip.
    misha.rotation.set(0, Math.atan2(camera.position.x - misha.position.x, camera.position.z - misha.position.z), 0);
    animateMisha(dt, true);
    if (distance < 7 && performance.now() - state.lastPulse > Math.max(250, distance * 110)) {
      state.lastPulse = performance.now(); pulse(48 + distance * 4, 0.24, 0.13);
    }
    if (distance < 1.05) { endGameWithDeath(); return; }
    state.voiceTimer -= dt;
    const voiceGap = state.night === 3 ? 1250 : state.night === 2 || state.night === 5 ? 1750 : 2300;
    const voicePlaying = activeVoiceClip && !activeVoiceClip.paused && !activeVoiceClip.ended;
    if (distance < 18 && state.voiceTimer <= 0 && !voicePlaying && performance.now() - state.lastVoice > voiceGap) {
      state.lastVoice = performance.now();
      state.voiceTimer = (state.night >= 3 ? 1.0 : 1.5) + Math.random() * (state.night >= 3 ? 1.6 : 2.2);
      speakMisha();
    }
  } else if (misha?.visible) {
    misha.rotation.set(0, Math.atan2(camera.position.x - misha.position.x, camera.position.z - misha.position.z), 0);
    animateMisha(dt, false);
  }
  for (const item of lights) {
    item.offset -= dt;
    if (item.offset <= 0) {
      item.offset = 1.1 + Math.random() * 5.5;
      item.light.intensity = item.base * (Math.random() > 0.45 ? 1 : 0.25);
    }
    item.light.intensity = THREE.MathUtils.lerp(item.light.intensity, item.base * 0.72, dt * 0.55);
  }
  if (dust) dust.rotation.y = Math.sin(elapsed * 0.05) * 0.025;

  // На второй и третьей ночах VHS-сбой иногда срывается в короткую тряску.
  if (state.night === 2 || state.night === 3) {
    state.horrorBurstTimer -= dt;
    if (state.horrorBurstTimer <= 0) {
      document.body.classList.add('horror-burst');
      state.horrorBurstDuration = state.night === 3 ? 0.30 : 0.20;
      state.horrorBurstTimer = state.night === 3 ? 3.2 + Math.random() * 3.1 : 7 + Math.random() * 5.5;
    }
    if (state.horrorBurstDuration > 0) {
      state.horrorBurstDuration -= dt;
      if (state.horrorBurstDuration <= 0) document.body.classList.remove('horror-burst');
    }
    const mishaDistance = misha?.visible ? Math.hypot(state.x - misha.position.x, state.z - misha.position.z) : 99;
    document.body.classList.toggle('horror-danger', mishaDistance < (state.night === 3 ? 7.5 : 5.5));
  } else {
    document.body.classList.remove('horror-burst', 'horror-danger');
  }
}

buildRoom();
setupRound();
try {
  const saved = localStorage.getItem('mishanya-volume');
  if (saved !== null) $('volume').value = String(Math.max(0, Math.min(100, Number(saved))));
  const volumeOutput = $('volume-value');
  if (volumeOutput) volumeOutput.value = `${$('volume').value}%`;
} catch {}
$('start').addEventListener('click', () => {
  try { start(); }
  catch (error) {
    console.error('Не удалось начать игру:', error);
    window.dispatchEvent(new CustomEvent('mishanya-boot-error', { detail: error?.message || 'Ошибка при старте игры' }));
  }
});
$('intro-skip').addEventListener('click', () => finishIntro(true));
$('resume').addEventListener('click', continueRound);
$('exit').addEventListener('click', toMenu);
$('open-settings').addEventListener('click', () => { $('menu').classList.remove('visible'); $('settings').classList.remove('hidden'); $('settings').classList.add('visible'); });
$('close-settings').addEventListener('click', () => { $('settings').classList.add('hidden'); $('settings').classList.remove('visible'); $('menu').classList.add('visible'); });
$('volume').addEventListener('input', setGameVolume);
$('misha-dialogue').addEventListener('click', () => $('misha-dialogue').classList.add('hidden'));
renderer.domElement.addEventListener('click', () => {
  if (state.active && !state.paused && document.pointerLockElement !== renderer.domElement && renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock();
});
document.addEventListener('keydown', (e) => {
  if (introActive && ['Space', 'Escape', 'Enter'].includes(e.code)) {
    e.preventDefault(); finishIntro(true); return;
  }
  state.keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyE' && state.active && !state.paused) { const door = nearbyDoor(); if (door) chooseDoor(door); }
  if (e.code === 'Space' && state.active && !state.paused && state.y === 0 && state.jumpVelocity === 0) state.jumpVelocity = 4.1;
  if (e.code === 'Escape' && state.active && !state.paused) pauseGame();
}, { passive: false });
document.addEventListener('keyup', (e) => { state.keys[e.code] = false; });
window.addEventListener('blur', () => { state.keys = Object.create(null); });
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === renderer.domElement && !state.paused) {
    state.yaw -= e.movementX * 0.0022;
    state.pitch = THREE.MathUtils.clamp(state.pitch - e.movementY * 0.0022, -1.0, 1.0);
  }
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state.active && !state.paused) {
    state.paused = true; state.keys = Object.create(null);
    $('pause').classList.remove('hidden'); $('pause').classList.add('visible');
  }
});
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.65));
});
window.__mishanyaGameReady = true;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  try {
    if (introActive) updateIntro(dt); else update(dt);
    renderer.render(scene, camera);
  } catch (error) {
    console.error('Ошибка игрового цикла:', error);
    if (!state.active && !introActive) {
      window.dispatchEvent(new CustomEvent('mishanya-boot-error', { detail: error?.message || 'Ошибка подготовки игры' }));
    }
  }
}
loop();
