import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { entities as demoEntities } from './data/entities.js';
import {
  loadDefaultSatellites,
  propagateSatellite,
  buildSatelliteTrack,
  formatElementAge
} from './data/celestrak.js';
import './style.css';

const canvas = document.querySelector('#globe');
const panel = document.querySelector('#entity-panel');
const panelName = document.querySelector('#entity-name');
const panelType = document.querySelector('#entity-type');
const panelStatus = document.querySelector('#entity-status');
const panelAge = document.querySelector('#entity-age');
const panelStats = document.querySelector('#entity-stats');
const followBtn = document.querySelector('#follow-btn');
const orbitBtn = document.querySelector('#orbit-btn');
const closePanel = document.querySelector('#close-panel');
const searchForm = document.querySelector('#search-form');
const searchInput = document.querySelector('#search-input');
const clock = document.querySelector('#clock');
const toast = document.querySelector('#toast');

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05070b, 0.018);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.01, 300);
camera.position.set(0, 0.5, 7.4);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.minDistance = 2.75;
controls.maxDistance = 18;
controls.enablePan = false;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.12;

scene.add(new THREE.AmbientLight(0x8cb4d8, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 3.1);
sun.position.set(5, 2, 4);
scene.add(sun);
const rim = new THREE.DirectionalLight(0x4aa8ff, 1.2);
rim.position.set(-4, -1, -5);
scene.add(rim);

const EARTH_RADIUS = 2;

const earthTexture = new THREE.TextureLoader().load(
  'https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg',
  () => {},
  undefined,
  () => showToast('Không tải được Earth texture — globe vẫn hoạt động.')
);
earthTexture.colorSpace = THREE.SRGBColorSpace;

const earth = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_RADIUS, 96, 64),
  new THREE.MeshPhongMaterial({
    map: earthTexture,
    color: 0xffffff,
    specular: 0x24405c,
    shininess: 8
  })
);
scene.add(earth);

const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_RADIUS * 1.018, 72, 48),
  new THREE.MeshBasicMaterial({
    color: 0x65b8ff,
    transparent: true,
    opacity: 0.065,
    side: THREE.BackSide
  })
);
scene.add(atmosphere);
scene.add(makeStars(1800));

function makeStars(count) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const radius = 35 + Math.random() * 80;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi);
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.045,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.75
    })
  );
}

function latLonToVector3(lat, lon, altitudeKm = 0) {
  // Orbital altitude is deliberately compressed for readability.
  const orbitalScale = altitudeKm > 40 ? altitudeKm / 1800 : altitudeKm / 3000;
  const radius = EARTH_RADIUS + Math.min(1.35, Math.max(0, orbitalScale));
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon + 180);

  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

function makeIconTexture(icon, type) {
  const canvas2d = document.createElement('canvas');
  canvas2d.width = 192;
  canvas2d.height = 192;
  const ctx = canvas2d.getContext('2d');

  ctx.clearRect(0, 0, 192, 192);
  ctx.beginPath();
  ctx.arc(96, 96, 72, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(7, 12, 18, .82)';
  ctx.fill();
  ctx.lineWidth = type === 'satellite' ? 5 : 4;
  ctx.strokeStyle = type === 'satellite'
    ? 'rgba(141,215,255,.82)'
    : 'rgba(255,255,255,.22)';
  ctx.stroke();
  ctx.font = '88px system-ui, Apple Color Emoji, Segoe UI Emoji, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(icon, 96, 101);

  const texture = new THREE.CanvasTexture(canvas2d);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const entityGroup = new THREE.Group();
scene.add(entityGroup);

const objectMap = new Map();
const liveSatelliteSprites = new Set();
let selected = null;
let followed = null;

function isLayerVisible(type) {
  return document.querySelector(`.layer[data-layer="${type}"]`)?.classList.contains('active') ?? true;
}

function addEntity(entity) {
  if (!entity?.id || objectMap.has(entity.id)) return objectMap.get(entity.id) || null;

  if (entity.type === 'satellite') {
    const live = propagateSatellite(entity, new Date());
    if (!live) return null;
    Object.assign(entity, {
      lat: live.lat,
      lon: live.lon,
      altitudeKm: live.altitudeKm,
      speed: `${live.speedKms.toFixed(2)} km/s`,
      observedAgo: formatElementAge(entity)
    });
  }

  const texture = makeIconTexture(entity.icon, entity.type);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false
  }));

  const initialPosition = latLonToVector3(entity.lat, entity.lon, entity.altitudeKm);
  sprite.position.copy(initialPosition);
  sprite.userData.entity = entity;
  sprite.userData.basePosition = initialPosition.clone();
  sprite.userData.targetPosition = initialPosition.clone();
  sprite.userData.path = null;

  const scale = entity.type === 'satellite' ? 0.34 : entity.type === 'rocket' ? 0.42 : 0.31;
  sprite.scale.set(scale, scale, 1);
  sprite.visible = isLayerVisible(entity.type);

  entityGroup.add(sprite);
  objectMap.set(entity.id, sprite);
  if (entity.type === 'satellite' && entity.live) liveSatelliteSprites.add(sprite);
  return sprite;
}

for (const entity of demoEntities) addEntity(entity);

function createSatelliteTrack(sprite) {
  const entity = sprite?.userData?.entity;
  if (!entity || entity.type !== 'satellite') return null;
  if (sprite.userData.path) return sprite.userData.path;

  const propagated = buildSatelliteTrack(entity, new Date());
  if (propagated.length < 2) return null;

  const points = propagated.map(p => latLonToVector3(p.lat, p.lon, p.altitudeKm));
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color: 0x6fbef0,
      transparent: true,
      opacity: 0.28
    })
  );
  line.visible = false;
  scene.add(line);
  sprite.userData.path = line;
  return line;
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let dragging = false;
let pointerDown = null;

renderer.domElement.addEventListener('pointerdown', event => {
  dragging = false;
  pointerDown = [event.clientX, event.clientY];
});

renderer.domElement.addEventListener('pointermove', event => {
  if (pointerDown && Math.hypot(event.clientX - pointerDown[0], event.clientY - pointerDown[1]) > 5) {
    dragging = true;
  }
});

renderer.domElement.addEventListener('pointerup', event => {
  pointerDown = null;
  if (dragging) return;

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const hit = raycaster.intersectObjects(entityGroup.children.filter(object => object.visible), false)[0];
  if (hit) selectEntity(hit.object);
});

function renderPanel(sprite) {
  if (!sprite) return;
  const entity = sprite.userData.entity;
  panelType.textContent = entity.type;
  panelName.textContent = `${entity.icon} ${entity.name}`;
  panelStatus.textContent = entity.status;
  panelAge.textContent = entity.observedAgo;
  panelStats.innerHTML = '';

  const stats = [
    ['Latitude', `${entity.lat.toFixed(3)}°`],
    ['Longitude', `${entity.lon.toFixed(3)}°`],
    ['Altitude', entity.altitudeKm >= 1 ? `${Math.round(entity.altitudeKm).toLocaleString()} km` : 'Surface'],
    ['Speed', entity.speed]
  ];

  if (entity.type === 'satellite') {
    stats.push(
      ['NORAD', entity.metadata?.noradId || '—'],
      ['Inclination', Number.isFinite(entity.metadata?.inclinationDeg) ? `${entity.metadata.inclinationDeg.toFixed(2)}°` : '—'],
      ['Source', entity.source]
    );
  } else {
    stats.push(
      ['Heading', `${entity.headingDeg ?? 0}°`],
      ['Source', entity.source]
    );
  }

  for (const [key, value] of stats) {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = key;
    dd.textContent = value;
    row.append(dt, dd);
    panelStats.append(row);
  }

  orbitBtn.disabled = entity.type !== 'satellite';
  orbitBtn.textContent = sprite.userData.path?.visible ? 'Hide track' : 'Show track';
  followBtn.textContent = followed === sprite ? 'Unfollow' : 'Follow';
}

function selectEntity(sprite) {
  selected = sprite;
  renderPanel(sprite);
  panel.classList.remove('hidden');
  controls.autoRotate = false;
}

followBtn.addEventListener('click', () => {
  if (!selected) return;
  followed = followed === selected ? null : selected;
  followBtn.textContent = followed ? 'Unfollow' : 'Follow';
  if (!followed) controls.target.set(0, 0, 0);
});

orbitBtn.addEventListener('click', () => {
  if (!selected || selected.userData.entity.type !== 'satellite') return;
  const path = createSatelliteTrack(selected);
  if (!path) return showToast('Không dựng được orbital track cho object này.');
  path.visible = !path.visible;
  orbitBtn.textContent = path.visible ? 'Hide track' : 'Show track';
});

closePanel.addEventListener('click', () => {
  panel.classList.add('hidden');
  selected = null;
});

searchForm.addEventListener('submit', event => {
  event.preventDefault();
  const query = searchInput.value.trim().toLowerCase();
  if (!query) return;
  const noradQuery = query.match(/(?:norad\s*)?(\d{4,8})/)?.[1] || null;

  const hit = [...objectMap.values()].find(object => {
    const entity = object.userData.entity;
    return entity.name.toLowerCase().includes(query)
      || entity.metadata?.noradId === query
      || (noradQuery && entity.metadata?.noradId === noradQuery)
      || entity.metadata?.objectId?.toLowerCase?.().includes(query);
  });

  if (!hit) {
    return showToast('Chưa có object này trong tập đang tải. Starlink on-demand sẽ thêm ở bước kế tiếp.');
  }

  selectEntity(hit);
  followed = hit;
  followBtn.textContent = 'Unfollow';
});

document.querySelectorAll('.layer').forEach(button => {
  button.addEventListener('click', () => {
    button.classList.toggle('active');
    const type = button.dataset.layer;
    const visible = button.classList.contains('active');

    for (const object of objectMap.values()) {
      if (object.userData.entity.type !== type) continue;
      object.visible = visible;
      if (!visible && object.userData.path) object.userData.path.visible = false;
    }
  });
});

function showToast(message, duration = 2600) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), duration);
}

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
}
addEventListener('resize', resize);

function animateDemoEntity(sprite, time) {
  const entity = sprite.userData.entity;
  if (entity.live) return;

  if (entity.type === 'aircraft' || entity.type === 'ship') {
    const speed = entity.type === 'aircraft' ? 0.000005 : 0.0000014;
    sprite.position.copy(sprite.userData.basePosition).applyAxisAngle(new THREE.Vector3(0, 1, 0), time * speed);
  } else if (entity.type === 'rocket') {
    const pulse = 1 + Math.sin(time * 0.0016) * 0.04;
    sprite.scale.set(0.42 * pulse, 0.42 * pulse, 1);
  }
}

function updateLiveSatellites(now = new Date()) {
  for (const sprite of liveSatelliteSprites) {
    const entity = sprite.userData.entity;
    const propagated = propagateSatellite(entity, now);
    if (!propagated) continue;

    entity.lat = propagated.lat;
    entity.lon = propagated.lon;
    entity.altitudeKm = propagated.altitudeKm;
    entity.speed = `${propagated.speedKms.toFixed(2)} km/s`;
    entity.observedAgo = formatElementAge(entity, now);
    sprite.userData.targetPosition.copy(latLonToVector3(entity.lat, entity.lon, entity.altitudeKm));
  }

  if (selected?.userData.entity.type === 'satellite') renderPanel(selected);
}

function updateClock() {
  const date = new Date();
  clock.textContent = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short'
  }).format(date).toUpperCase();
}
updateClock();
setInterval(updateClock, 1000);
setInterval(() => updateLiveSatellites(new Date()), 500);

async function loadSatellites() {
  showToast('Đang tải orbital data thật từ CelesTrak…', 5000);

  try {
    const { entities, diagnostics } = await loadDefaultSatellites();
    let added = 0;
    for (const entity of entities) {
      if (addEntity(entity)) added++;
    }
    updateLiveSatellites(new Date());

    const fallbackCount = diagnostics.filter(item => item.transport === 'stale-cache').length;
    const failedCount = diagnostics.filter(item => !item.ok).length;
    const suffix = fallbackCount
      ? ` · ${fallbackCount} group dùng cache cũ`
      : failedCount
        ? ` · ${failedCount} group lỗi`
        : '';
    showToast(`Live: ${added} satellites từ CelesTrak${suffix}`, 4200);
  } catch (error) {
    console.error(error);
    showToast('Satellite feed chưa tải được. Demo air/sea/rocket vẫn hoạt động.', 5200);
  }
}
loadSatellites();

function animate(time) {
  requestAnimationFrame(animate);

  for (const sprite of entityGroup.children) {
    if (sprite.userData.entity.live) {
      sprite.position.lerp(sprite.userData.targetPosition, 0.18);
    } else {
      animateDemoEntity(sprite, time);
    }
  }

  if (followed?.visible) {
    const position = followed.position.clone();
    controls.target.lerp(position, 0.065);
    const desired = position.clone().normalize().multiplyScalar(
      Math.max(EARTH_RADIUS + 1.4, position.length() + 1.25)
    );
    camera.position.lerp(desired, 0.025);
  }

  controls.update();
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);
