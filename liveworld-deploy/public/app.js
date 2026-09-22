import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as satellite from 'satellite.js';

const EARTH_RADIUS_KM = 6378.137;
const API_GROUPS = ['STATIONS', 'GPS-OPS'];
const state = {
  entities: [],
  selected: null,
  follow: false,
  track: null,
  satelliteVisible: true,
  lastTick: 0,
};

const $ = (id) => document.getElementById(id);
const canvas = $('globe');
const statusText = $('statusText');
const panel = $('panel');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02070d);
scene.fog = new THREE.FogExp2(0x02070d, 0.012);

const camera = new THREE.PerspectiveCamera(44, innerWidth / innerHeight, 0.01, 80);
camera.position.set(0, 0.5, 3.35);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.enablePan = false;
controls.minDistance = 1.42;
controls.maxDistance = 12;
controls.rotateSpeed = 0.42;
controls.zoomSpeed = 0.8;

scene.add(new THREE.AmbientLight(0x83a8c7, 0.46));
const sun = new THREE.DirectionalLight(0xffffff, 3.2);
sun.position.set(5, 2.5, 4);
scene.add(sun);
const rim = new THREE.DirectionalLight(0x4aa9ff, 1.1);
rim.position.set(-4, -1, -3);
scene.add(rim);

createStars();
const earth = createEarth();
scene.add(earth);

const objectGroup = new THREE.Group();
scene.add(objectGroup);
const orbitGroup = new THREE.Group();
scene.add(orbitGroup);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function createStars() {
  const count = 1700;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 18 + Math.random() * 35;
    const theta = Math.random() * Math.PI * 2;
    const u = Math.random() * 2 - 1;
    const s = Math.sqrt(1 - u * u);
    positions[i*3] = r * s * Math.cos(theta);
    positions[i*3+1] = r * u;
    positions[i*3+2] = r * s * Math.sin(theta);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0xb9d7ef, size: 0.028, transparent: true, opacity: 0.62, depthWrite: false });
  scene.add(new THREE.Points(geometry, material));
}

function createEarth() {
  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(1, 96, 64);
  const material = new THREE.MeshPhongMaterial({
    color: 0x0d3552,
    emissive: 0x020b13,
    specular: 0x5ea7cb,
    shininess: 18,
  });
  const sphere = new THREE.Mesh(geometry, material);
  group.add(sphere);

  const gridMat = new THREE.LineBasicMaterial({ color: 0x6f9bb5, transparent: true, opacity: 0.15 });
  for (let lat = -60; lat <= 60; lat += 30) {
    const pts = [];
    for (let lon = -180; lon <= 180; lon += 4) pts.push(latLonToVector(lat, lon, 1.004));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
  }
  for (let lon = -150; lon <= 180; lon += 30) {
    const pts = [];
    for (let lat = -90; lat <= 90; lat += 3) pts.push(latLonToVector(lat, lon, 1.004));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
  }

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.025, 64, 48),
    new THREE.MeshBasicMaterial({ color: 0x49b5ff, transparent: true, opacity: 0.055, side: THREE.BackSide, blending: THREE.AdditiveBlending })
  );
  atmosphere.scale.setScalar(1.045);
  group.add(atmosphere);
  return group;
}

function latLonToVector(latDeg, lonDeg, radius = 1) {
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);
  return new THREE.Vector3(
    radius * Math.cos(lat) * Math.sin(lon),
    radius * Math.sin(lat),
    radius * Math.cos(lat) * Math.cos(lon)
  );
}

function makeIconTexture(symbol, tint = '#dff6ff') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 128, 128);
  x.beginPath();
  x.arc(64, 64, 44, 0, Math.PI * 2);
  x.fillStyle = 'rgba(2,9,16,.76)';
  x.fill();
  x.lineWidth = 3;
  x.strokeStyle = 'rgba(117,213,255,.64)';
  x.stroke();
  x.fillStyle = tint;
  x.font = '48px "Segoe UI Symbol", "Apple Color Emoji", sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(symbol, 64, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const satelliteTexture = makeIconTexture('✦');

function addEntity(omm, groupName) {
  let satrec;
  try { satrec = satellite.json2satrec(omm); } catch { return null; }
  const material = new THREE.SpriteMaterial({ map: satelliteTexture, transparent: true, depthWrite: false, sizeAttenuation: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(groupName === 'GPS-OPS' ? 0.16 : 0.105);
  sprite.userData.kind = 'entity';
  objectGroup.add(sprite);
  const entity = {
    kind: 'satellite',
    group: groupName,
    name: omm.OBJECT_NAME || `NORAD ${omm.NORAD_CAT_ID || ''}`,
    norad: String(omm.NORAD_CAT_ID || ''),
    objectId: omm.OBJECT_ID || '',
    omm,
    satrec,
    sprite,
    lat: 0,
    lon: 0,
    altitude: 0,
    speed: 0,
    valid: false,
  };
  sprite.userData.entity = entity;
  state.entities.push(entity);
  updateEntity(entity, new Date());
  return entity;
}

function updateEntity(entity, date) {
  const pv = satellite.propagate(entity.satrec, date);
  if (!pv || !pv.position || !pv.velocity) {
    entity.valid = false;
    entity.sprite.visible = false;
    return;
  }
  const gmst = satellite.gstime(date);
  const geo = satellite.eciToGeodetic(pv.position, gmst);
  const lat = satellite.degreesLat(geo.latitude);
  const lon = satellite.degreesLong(geo.longitude);
  const alt = geo.height;
  if (![lat, lon, alt].every(Number.isFinite) || alt < -100) {
    entity.valid = false;
    entity.sprite.visible = false;
    return;
  }
  entity.valid = true;
  entity.lat = lat;
  entity.lon = lon;
  entity.altitude = alt;
  entity.speed = Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z);
  const radius = 1 + Math.max(0, alt) / EARTH_RADIUS_KM;
  entity.sprite.position.copy(latLonToVector(lat, lon, radius));
  entity.sprite.visible = state.satelliteVisible;
}

async function fetchGroup(group) {
  const url = `/api/celestrak/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=JSON`;
  const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`${group}: HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error(`${group}: invalid JSON payload`);
  return data;
}

async function loadSatellites() {
  statusText.textContent = 'Loading live orbital elements…';
  const results = await Promise.allSettled(API_GROUPS.map(async g => [g, await fetchGroup(g)]));
  let added = 0;
  let failed = 0;
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn(result.reason);
      failed++;
      continue;
    }
    const [group, rows] = result.value;
    for (const row of rows) if (addEntity(row, group)) added++;
  }
  if (!added) {
    statusText.textContent = '3D globe OK · satellite feed unavailable';
    throw new Error('Không lấy được CelesTrak qua /api/celestrak/. Kiểm tra Nginx proxy trong gói deploy.');
  }
  statusText.textContent = `LIVE · ${added} satellites · CelesTrak${failed ? ` · ${failed} feed failed` : ''}`;
}

function updateSelectedPanel(entity) {
  if (!entity) return;
  $('entityType').textContent = entity.group === 'GPS-OPS' ? 'GPS SATELLITE' : 'ORBITAL OBJECT';
  $('entityName').textContent = entity.name;
  $('entityId').textContent = `NORAD ${entity.norad || '—'}${entity.objectId ? ` · ${entity.objectId}` : ''}`;
  $('mAltitude').textContent = Number.isFinite(entity.altitude) ? `${entity.altitude.toLocaleString(undefined,{maximumFractionDigits:0})} km` : '—';
  $('mVelocity').textContent = Number.isFinite(entity.speed) ? `${entity.speed.toFixed(2)} km/s` : '—';
  $('mLat').textContent = Number.isFinite(entity.lat) ? `${Math.abs(entity.lat).toFixed(3)}° ${entity.lat >= 0 ? 'N' : 'S'}` : '—';
  $('mLon').textContent = Number.isFinite(entity.lon) ? `${Math.abs(entity.lon).toFixed(3)}° ${entity.lon >= 0 ? 'E' : 'W'}` : '—';
  $('mTime').textContent = new Date().toLocaleTimeString([], { hour12:false });
  $('mSource').textContent = `CelesTrak ${entity.group} · SGP4`;
  $('followBtn').textContent = state.follow ? 'Stop follow' : 'Follow';
  $('trackBtn').textContent = state.track ? 'Hide orbit' : 'Show orbit';
}

function selectEntity(entity, fly = false) {
  state.selected = entity;
  panel.classList.add('open');
  updateSelectedPanel(entity);
  if (fly) focusEntity(entity);
}

function focusEntity(entity) {
  if (!entity?.valid) return;
  const p = entity.sprite.position.clone();
  const d = Math.max(0.5, p.length() * 0.42);
  camera.position.copy(p.clone().normalize().multiplyScalar(p.length() + d));
  controls.target.copy(p);
  controls.update();
}

function buildOrbit(entity) {
  clearOrbit();
  if (!entity) return;
  const meanMotion = Number(entity.omm.MEAN_MOTION) || 15;
  const periodMinutes = THREE.MathUtils.clamp(1440 / meanMotion, 85, 900);
  const samples = 180;
  const now = Date.now();
  const pts = [];
  for (let i=0; i<=samples; i++) {
    const offset = (i / samples - 0.5) * periodMinutes * 60 * 1000;
    const date = new Date(now + offset);
    const pv = satellite.propagate(entity.satrec, date);
    if (!pv?.position) continue;
    const gmst = satellite.gstime(date);
    const geo = satellite.eciToGeodetic(pv.position, gmst);
    const lat = satellite.degreesLat(geo.latitude);
    const lon = satellite.degreesLong(geo.longitude);
    const alt = geo.height;
    if (![lat, lon, alt].every(Number.isFinite)) continue;
    pts.push(latLonToVector(lat, lon, 1 + Math.max(0, alt) / EARTH_RADIUS_KM));
  }
  if (pts.length < 2) return;
  const geometry = new THREE.BufferGeometry().setFromPoints(pts);
  const material = new THREE.LineBasicMaterial({ color: 0x75d5ff, transparent:true, opacity:.45 });
  state.track = new THREE.Line(geometry, material);
  orbitGroup.add(state.track);
  updateSelectedPanel(entity);
}

function clearOrbit() {
  if (!state.track) return;
  orbitGroup.remove(state.track);
  state.track.geometry.dispose();
  state.track.material.dispose();
  state.track = null;
  if (state.selected) updateSelectedPanel(state.selected);
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(objectGroup.children, false);
  if (!hits.length) return;
  const entity = hits[0].object.userData.entity;
  if (entity) selectEntity(entity);
}

function searchEntity(query) {
  const q = query.trim().toLowerCase().replace(/^norad\s*/,'');
  if (!q) return null;
  let found = state.entities.find(e => e.norad === q);
  if (!found) found = state.entities.find(e => e.name.toLowerCase() === q);
  if (!found) found = state.entities.find(e => e.name.toLowerCase().includes(q) || e.objectId.toLowerCase().includes(q));
  return found || null;
}

$('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('searchInput').value;
  const found = searchEntity(q);
  if (found) {
    statusText.textContent = `Found · ${found.name}`;
    selectEntity(found, true);
  } else {
    statusText.textContent = `No match for “${q.trim()}” in loaded layers`;
  }
});
$('panelClose').addEventListener('click', () => {
  panel.classList.remove('open');
  state.follow = false;
  controls.enabled = true;
});
$('followBtn').addEventListener('click', () => {
  if (!state.selected) return;
  state.follow = !state.follow;
  controls.enabled = !state.follow;
  updateSelectedPanel(state.selected);
});
$('trackBtn').addEventListener('click', () => {
  if (!state.selected) return;
  state.track ? clearOrbit() : buildOrbit(state.selected);
});
$('satLayer').addEventListener('click', (e) => {
  state.satelliteVisible = !state.satelliteVisible;
  e.currentTarget.classList.toggle('active', state.satelliteVisible);
  for (const entity of state.entities) entity.sprite.visible = entity.valid && state.satelliteVisible;
});
canvas.addEventListener('pointerdown', onPointerDown);

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
  renderer.setSize(innerWidth, innerHeight, false);
});

function tickClock() {
  $('clock').textContent = `${new Date().toISOString().slice(11,19)} UTC`;
}
setInterval(tickClock, 1000);
tickClock();

function animate(t) {
  requestAnimationFrame(animate);
  if (t - state.lastTick > 500) {
    const now = new Date();
    for (const entity of state.entities) updateEntity(entity, now);
    if (state.selected) updateSelectedPanel(state.selected);
    state.lastTick = t;
  }
  if (state.follow && state.selected?.valid) {
    const p = state.selected.sprite.position.clone();
    const offset = p.clone().normalize().multiplyScalar(Math.max(0.45, p.length() * 0.28));
    const desired = p.clone().add(offset);
    camera.position.lerp(desired, 0.045);
    controls.target.lerp(p, 0.08);
    camera.lookAt(controls.target);
  } else {
    controls.update();
  }
  earth.rotation.y += 0.000035;
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

loadSatellites().catch((err) => {
  console.error(err);
  const fatal = $('fatal');
  fatal.hidden = false;
  $('fatalText').textContent = `${err.message} Globe vẫn chạy; chỉ feed live đang lỗi.`;
});
