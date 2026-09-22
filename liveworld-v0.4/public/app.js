import * as satellite from 'https://cdn.jsdelivr.net/npm/satellite.js@7.1.0/+esm';

const { Cesium } = window;
if (!Cesium) throw new Error('CesiumJS CDN did not load.');

const API_GROUPS = ['STATIONS', 'GPS-OPS'];
const EARTH_RADIUS_KM = 6378.137;
const ICONS = {
  satellite: '/assets/icons/satellite.svg',
  station: '/assets/icons/station.svg',
  spacecraft: '/assets/icons/spacecraft.svg',
  debris: '/assets/icons/debris.svg',
};
const TYPE_LABEL = {
  satellite: 'SATELLITE',
  station: 'SPACE STATION',
  spacecraft: 'SPACECRAFT',
  debris: 'ORBITAL DEBRIS',
};

const state = {
  viewer: null,
  orbitObjects: [],
  selected: null,
  orbitLine: null,
  orbitLayerVisible: true,
  following: false,
  detailImagery: false,
  cameraHeight: Infinity,
};

const $ = (id) => document.getElementById(id);
const panel = $('panel');
const statusText = $('statusText');
const tooltip = $('tooltip');

function classifyOrbitObject(row, group) {
  const name = String(row.OBJECT_NAME || '').toUpperCase();
  if (/^(ISS\b|CSS\b|TIANGONG\b)/.test(name) || name.includes('SPACE STATION')) return 'station';
  if (/(CREW DRAGON|DRAGON|CYGNUS|SOYUZ|PROGRESS|TIANZHOU|SHENZHOU|STARLINER)/.test(name)) return 'spacecraft';
  if (/(DEB\b|DEBRIS|R\/B\b|ROCKET BODY)/.test(name)) return 'debris';
  if (group === 'GPS-OPS') return 'satellite';
  return 'satellite';
}

async function createViewer() {
  const localBlueMarble = await Cesium.SingleTileImageryProvider.fromUrl('/assets/earth-blue-marble.jpg', {
    rectangle: Cesium.Rectangle.MAX_VALUE,
    credit: 'Blue Marble imagery',
  });

  const viewer = new Cesium.Viewer('cesiumContainer', {
    animation: false,
    baseLayerPicker: false,
    baseLayer: new Cesium.ImageryLayer(localBlueMarble),
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    scene3DOnly: true,
    shouldAnimate: true,
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
  });

  const scene = viewer.scene;
  scene.backgroundColor = Cesium.Color.fromCssColorString('#02060b');
  scene.globe.enableLighting = true;
  scene.globe.showGroundAtmosphere = true;
  scene.globe.dynamicAtmosphereLighting = true;
  scene.globe.dynamicAtmosphereLightingFromSun = true;
  scene.globe.depthTestAgainstTerrain = true;
  scene.skyAtmosphere.show = true;
  scene.sun.show = true;
  scene.moon.show = true;
  scene.fog.enabled = true;
  scene.highDynamicRange = true;

  const controller = scene.screenSpaceCameraController;
  controller.enableCollisionDetection = true;
  controller.minimumZoomDistance = 2200;
  controller.maximumZoomDistance = 100000000;
  controller.inertiaZoom = 0.72;
  controller.inertiaSpin = 0.82;

  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(105, 18, 20500000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
  });

  // High-resolution world imagery when available. Blue Marble remains a guaranteed fallback.
  try {
    const detailProvider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
      'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
      { enablePickFeatures: false }
    );
    const layer = viewer.imageryLayers.addImageryProvider(detailProvider);
    layer.brightness = 0.93;
    layer.contrast = 1.04;
    layer.saturation = 1.03;
    state.detailImagery = true;
  } catch (error) {
    console.warn('Detailed imagery unavailable; using bundled Blue Marble.', error);
  }

  state.viewer = viewer;
  installInteraction(viewer);
  updateCameraMode();
  viewer.camera.changed.addEventListener(updateCameraMode);
  return viewer;
}

async function fetchGroup(group) {
  const url = `/api/celestrak/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=JSON`;
  const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`${group}: HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error(`${group}: invalid JSON`);
  return data;
}

function propagate(satrec, date) {
  const pv = satellite.propagate(satrec, date);
  if (!pv?.position || !pv?.velocity) return null;
  const gmst = satellite.gstime(date);
  const geo = satellite.eciToGeodetic(pv.position, gmst);
  const lat = satellite.degreesLat(geo.latitude);
  const lon = satellite.degreesLong(geo.longitude);
  const altitudeKm = geo.height;
  const speedKmS = Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z);
  if (![lat, lon, altitudeKm, speedKmS].every(Number.isFinite) || altitudeKm < -100) return null;
  return { lat, lon, altitudeKm, speedKmS };
}

function createOrbitEntity(row, group) {
  let satrec;
  try { satrec = satellite.json2satrec(row); } catch { return null; }
  const now = new Date();
  const pos = propagate(satrec, now);
  if (!pos) return null;

  const category = classifyOrbitObject(row, group);
  const size = category === 'station' ? 34 : category === 'spacecraft' ? 27 : category === 'debris' ? 15 : 23;
  const name = row.OBJECT_NAME || `NORAD ${row.NORAD_CAT_ID || ''}`;
  const norad = String(row.NORAD_CAT_ID || '');

  const cesiumEntity = state.viewer.entities.add({
    id: `orbit:${norad || crypto.randomUUID()}`,
    name,
    position: Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.altitudeKm * 1000),
    billboard: {
      image: ICONS[category],
      width: size,
      height: size,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      scaleByDistance: new Cesium.NearFarScalar(2.0e5, 1.25, 5.0e7, 0.65),
      translucencyByDistance: new Cesium.NearFarScalar(2.0e5, 1.0, 7.0e7, 0.55),
      disableDepthTestDistance: 0,
    },
  });

  const obj = {
    group, category, row, satrec, cesiumEntity,
    name, norad, objectId: row.OBJECT_ID || '',
    ...pos, updatedAt: now,
  };
  cesiumEntity.liveworld = obj;
  state.orbitObjects.push(obj);
  return obj;
}

async function loadOrbitObjects() {
  statusText.textContent = 'Loading orbital objects…';
  const results = await Promise.allSettled(API_GROUPS.map(async (group) => [group, await fetchGroup(group)]));
  let failed = 0;
  for (const result of results) {
    if (result.status === 'rejected') {
      failed++;
      console.warn(result.reason);
      continue;
    }
    const [group, rows] = result.value;
    for (const row of rows) createOrbitEntity(row, group);
  }

  const counts = state.orbitObjects.reduce((a, x) => ((a[x.category] = (a[x.category] || 0) + 1), a), {});
  if (!state.orbitObjects.length) {
    statusText.textContent = 'Earth live · orbital feed unavailable';
    showToast('Không lấy được CelesTrak. Globe vẫn hoạt động bình thường.');
    return;
  }
  statusText.textContent = `LIVE · ${state.orbitObjects.length} orbital objects · ${counts.station || 0} station components · CelesTrak${failed ? ' · partial feed' : ''}`;
  updateOrbitVisibility();
}

function updateOrbitObjects() {
  const now = new Date();
  for (const obj of state.orbitObjects) {
    const p = propagate(obj.satrec, now);
    if (!p) {
      obj.cesiumEntity.show = false;
      continue;
    }
    Object.assign(obj, p, { updatedAt: now });
    obj.cesiumEntity.position = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.altitudeKm * 1000);
  }
  if (state.selected) updateSelectedPanel(state.selected);
  updateOrbitVisibility();
}

function updateCameraMode() {
  if (!state.viewer) return;
  const carto = Cesium.Cartographic.fromCartesian(state.viewer.camera.positionWC);
  const h = Math.max(0, carto.height);
  state.cameraHeight = h;
  const name = $('viewModeName');
  const hint = $('viewModeHint');
  if (h > 3500000) {
    name.textContent = 'ORBIT VIEW';
    hint.textContent = 'Satellites · stations · spacecraft';
  } else if (h > 300000) {
    name.textContent = 'EARTH VIEW';
    hint.textContent = 'Zoom tiếp để vào surface layer';
  } else {
    name.textContent = 'SURFACE VIEW';
    hint.textContent = 'Air · sea · rail · launch objects appear here';
  }
  updateOrbitVisibility();
}

function updateOrbitVisibility() {
  if (!state.viewer) return;
  const closeToSurface = state.cameraHeight < 1800000;
  for (const obj of state.orbitObjects) {
    const selected = state.selected === obj;
    obj.cesiumEntity.show = state.orbitLayerVisible && (!closeToSurface || selected || state.following);
  }
}

function installInteraction(viewer) {
  const handler = viewer.screenSpaceEventHandler;

  handler.setInputAction((movement) => {
    const picked = viewer.scene.pick(movement.position);
    const entity = picked?.id;
    if (entity?.liveworld) selectObject(entity.liveworld, false);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  handler.setInputAction((movement) => {
    const picked = viewer.scene.pick(movement.endPosition);
    const obj = picked?.id?.liveworld;
    if (!obj) {
      tooltip.hidden = true;
      viewer.canvas.style.cursor = '';
      return;
    }
    tooltip.textContent = obj.name;
    tooltip.style.left = `${movement.endPosition.x}px`;
    tooltip.style.top = `${movement.endPosition.y}px`;
    tooltip.hidden = false;
    viewer.canvas.style.cursor = 'pointer';
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
}

function selectObject(obj, fly = true) {
  state.selected = obj;
  panel.classList.add('open');
  updateSelectedPanel(obj);
  if (!fly) return;
  const range = Math.max(650000, Math.min(8000000, obj.altitudeKm * 1000 * 1.1));
  state.viewer.flyTo(obj.cesiumEntity, {
    duration: 1.55,
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-25), range),
  });
}

function updateSelectedPanel(obj) {
  if (!obj) return;
  $('entityType').textContent = TYPE_LABEL[obj.category] || 'ORBITAL OBJECT';
  $('entityName').textContent = obj.name;
  $('entityId').textContent = `NORAD ${obj.norad || '—'}${obj.objectId ? ` · ${obj.objectId}` : ''}`;
  $('mAltitude').textContent = `${obj.altitudeKm.toLocaleString(undefined, { maximumFractionDigits: 0 })} km`;
  $('mVelocity').textContent = `${obj.speedKmS.toFixed(2)} km/s`;
  $('mLat').textContent = `${Math.abs(obj.lat).toFixed(3)}° ${obj.lat >= 0 ? 'N' : 'S'}`;
  $('mLon').textContent = `${Math.abs(obj.lon).toFixed(3)}° ${obj.lon >= 0 ? 'E' : 'W'}`;
  $('mTime').textContent = obj.updatedAt.toLocaleTimeString([], { hour12: false });
  $('mSource').textContent = `CelesTrak ${obj.group} · SGP4`;
  $('followBtn').textContent = state.following ? 'Stop follow' : 'Follow';
  $('trackBtn').textContent = state.orbitLine ? 'Hide orbit' : 'Show orbit';
}

function toggleFollow() {
  if (!state.selected) return;
  state.following = !state.following;
  if (state.following) {
    const d = Math.max(200000, Math.min(3000000, state.selected.altitudeKm * 1000 * 0.42));
    state.selected.cesiumEntity.viewFrom = new Cesium.Cartesian3(0, -d, d * 0.28);
    state.viewer.trackedEntity = state.selected.cesiumEntity;
  } else {
    state.viewer.trackedEntity = undefined;
  }
  updateSelectedPanel(state.selected);
  updateOrbitVisibility();
}

function toggleOrbitLine() {
  if (!state.selected) return;
  if (state.orbitLine) {
    state.viewer.entities.remove(state.orbitLine);
    state.orbitLine = null;
    updateSelectedPanel(state.selected);
    return;
  }
  const positions = [];
  const center = Date.now();
  for (let min = -100; min <= 100; min += 2) {
    const p = propagate(state.selected.satrec, new Date(center + min * 60000));
    if (p) positions.push(Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.altitudeKm * 1000));
  }
  state.orbitLine = state.viewer.entities.add({
    polyline: {
      positions,
      width: 1.4,
      material: Cesium.Color.fromCssColorString('#75d5ff').withAlpha(0.55),
      arcType: Cesium.ArcType.NONE,
    },
  });
  updateSelectedPanel(state.selected);
}

function showToast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { el.hidden = true; }, 2800);
}

function installUI() {
  $('panelClose').addEventListener('click', () => panel.classList.remove('open'));
  $('followBtn').addEventListener('click', toggleFollow);
  $('trackBtn').addEventListener('click', toggleOrbitLine);

  $('searchForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const q = $('searchInput').value.trim().toLowerCase().replace(/^norad\s*/, '');
    if (!q) return;
    const exact = state.orbitObjects.find((x) => x.norad === q || x.objectId.toLowerCase() === q || x.name.toLowerCase() === q);
    const partial = state.orbitObjects.find((x) => x.name.toLowerCase().includes(q) || x.norad.includes(q));
    const match = exact || partial;
    if (!match) return showToast(`Không tìm thấy “${$('searchInput').value.trim()}” trong layer hiện tại.`);
    selectObject(match, true);
  });

  document.querySelectorAll('.layer').forEach((button) => {
    button.addEventListener('click', () => {
      const layer = button.dataset.layer;
      if (layer === 'orbit') {
        state.orbitLayerVisible = !state.orbitLayerVisible;
        button.classList.toggle('active', state.orbitLayerVisible);
        updateOrbitVisibility();
        return;
      }
      document.querySelectorAll('.layer').forEach((x) => { if (x.dataset.layer !== 'orbit') x.classList.remove('active'); });
      button.classList.add('active');
      const names = { air: 'Aircraft / ADS-B', sea: 'Ships / AIS', rail: 'High-speed rail', launch: 'Rocket / launch telemetry' };
      showToast(`${names[layer]}: visual layer đã sẵn sàng, live data adapter sẽ được nối ở bước tiếp theo.`);
    });
  });

  const clock = () => { $('clock').textContent = `${new Date().toISOString().slice(11,19)} UTC`; };
  clock();
  setInterval(clock, 1000);
}

async function boot() {
  try {
    installUI();
    await createViewer();
    await loadOrbitObjects();
    setInterval(updateOrbitObjects, 1000);
  } catch (error) {
    console.error(error);
    $('fatal').hidden = false;
    $('fatalText').textContent = error?.message || String(error);
    statusText.textContent = 'Startup failed';
  }
}

boot();
