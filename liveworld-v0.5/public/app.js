import * as satellite from 'https://cdn.jsdelivr.net/npm/satellite.js@7.1.0/+esm';

const { Cesium } = window;
if (!Cesium) throw new Error('CesiumJS CDN did not load.');

const ORBIT_GROUP = 'ACTIVE';
const ORBIT_ENDPOINT = `/api/celestrak/gp.php?GROUP=${ORBIT_GROUP}&FORMAT=JSON`;
const SURFACE_ORBIT_HIDE_M = 1_500_000;
const POSITION_APPLY_BATCH = 900;

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
  debris: 'ORBITAL OBJECT',
};

const state = {
  viewer: null,
  orbitObjects: [],
  orbitBillboards: null,
  selected: null,
  focusEntity: null,
  orbitLine: null,
  orbitLayerVisible: true,
  following: false,
  cameraHeight: Infinity,
  worker: null,
  firstPositionFrame: false,
  pendingFrame: null,
  sourceLoadedAt: null,
  catalogCounts: {},
};

const $ = (id) => document.getElementById(id);
const panel = $('panel');
const statusText = $('statusText');
const tooltip = $('tooltip');

function classifyOrbitObject(row) {
  const name = String(row.OBJECT_NAME || '').toUpperCase();
  if (/^(ISS\b|CSS\b|TIANGONG\b)/.test(name) || name.includes('SPACE STATION')) return 'station';
  if (/(CREW DRAGON|DRAGON|CYGNUS|SOYUZ|PROGRESS|TIANZHOU|SHENZHOU|STARLINER|HTV-X|HTV\b)/.test(name)) return 'spacecraft';
  if (/(\bDEB\b|DEBRIS|\bR\/B\b|ROCKET BODY)/.test(name)) return 'debris';
  return 'satellite';
}

function constellationOf(nameRaw) {
  const name = String(nameRaw || '').toUpperCase();
  if (name.startsWith('STARLINK')) return 'Starlink';
  if (name.startsWith('ONEWEB')) return 'OneWeb';
  if (/\bGPS\b|NAVSTAR/.test(name)) return 'GPS';
  if (/GALILEO/.test(name)) return 'Galileo';
  if (/GLONASS/.test(name)) return 'GLONASS';
  if (/BEIDOU|COMPASS/.test(name)) return 'BeiDou';
  if (/QZS|QZSS/.test(name)) return 'QZSS';
  if (/IRNSS|NAVIC/.test(name)) return 'NavIC';
  if (/KUIPER/.test(name)) return 'Kuiper';
  if (/QIANFAN|G60/.test(name)) return 'Qianfan';
  return 'Other';
}

function iconSize(category) {
  if (category === 'station') return 31;
  if (category === 'spacecraft') return 24;
  if (category === 'debris') return 12;
  return 14;
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

  try {
    const detailProvider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
      'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
      { enablePickFeatures: false }
    );
    const layer = viewer.imageryLayers.addImageryProvider(detailProvider);
    layer.brightness = 0.93;
    layer.contrast = 1.04;
    layer.saturation = 1.03;
  } catch (error) {
    console.warn('Detailed imagery unavailable; using bundled Blue Marble.', error);
  }

  state.orbitBillboards = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
  state.focusEntity = viewer.entities.add({
    id: 'liveworld:selected-orbital-object',
    show: false,
    position: Cesium.Cartesian3.fromDegrees(0, 0, 500000),
    billboard: {
      image: ICONS.satellite,
      width: 36,
      height: 36,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scaleByDistance: new Cesium.NearFarScalar(2.0e5, 1.2, 6.0e7, 0.75),
    },
  });

  state.viewer = viewer;
  installInteraction(viewer);
  updateCameraMode();
  viewer.camera.changed.addEventListener(updateCameraMode);
  return viewer;
}

async function fetchActiveCatalog() {
  statusText.textContent = 'Downloading worldwide active satellite catalog…';
  const response = await fetch(ORBIT_ENDPOINT, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`CelesTrak ACTIVE: HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('json')) throw new Error(`CelesTrak proxy returned ${contentType || 'non-JSON content'}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('CelesTrak ACTIVE returned invalid JSON.');
  state.sourceLoadedAt = new Date();
  return rows;
}

function uniqueRows(rows) {
  const seen = new Set();
  const clean = [];
  for (const row of rows) {
    const norad = String(row.NORAD_CAT_ID || '').trim();
    if (!norad || seen.has(norad)) continue;
    seen.add(norad);
    clean.push(row);
  }
  return clean;
}

async function buildCatalog(rows) {
  statusText.textContent = `Preparing ${rows.length.toLocaleString()} orbital objects…`;
  const counts = { satellite: 0, station: 0, spacecraft: 0, debris: 0, constellations: {} };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const category = classifyOrbitObject(row);
    const name = row.OBJECT_NAME || `NORAD ${row.NORAD_CAT_ID || ''}`;
    const constellation = constellationOf(name);
    const obj = {
      kind: 'orbit',
      index: i,
      category,
      constellation,
      row,
      name,
      norad: String(row.NORAD_CAT_ID || ''),
      objectId: row.OBJECT_ID || '',
      epoch: row.EPOCH || '',
      lat: NaN,
      lon: NaN,
      altitudeKm: NaN,
      speedKmS: NaN,
      updatedAt: null,
      hasPosition: false,
      satrec: null,
      billboard: null,
    };

    const size = iconSize(category);
    obj.billboard = state.orbitBillboards.add({
      id: obj,
      show: false,
      image: ICONS[category] || ICONS.satellite,
      width: size,
      height: size,
      position: Cesium.Cartesian3.ZERO,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      disableDepthTestDistance: 0,
      scaleByDistance: category === 'station'
        ? new Cesium.NearFarScalar(2.0e5, 1.2, 6.0e7, 0.65)
        : new Cesium.NearFarScalar(2.0e5, 1.0, 6.0e7, 0.38),
      translucencyByDistance: new Cesium.NearFarScalar(2.0e5, 1.0, 8.0e7, 0.58),
    });

    state.orbitObjects.push(obj);
    counts[category] = (counts[category] || 0) + 1;
    counts.constellations[constellation] = (counts.constellations[constellation] || 0) + 1;

    if (i && i % 700 === 0) {
      statusText.textContent = `Preparing catalog… ${i.toLocaleString()} / ${rows.length.toLocaleString()}`;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  state.catalogCounts = counts;
}

function startOrbitWorker(rows) {
  if (state.worker) state.worker.terminate();
  const worker = new Worker('/workers/orbit-worker.js?v=5', { type: 'module' });
  state.worker = worker;

  worker.addEventListener('message', (event) => {
    const message = event.data || {};
    if (message.type === 'ready') {
      statusText.textContent = `Orbit engine ready · propagating ${message.parsed.toLocaleString()} objects…`;
      return;
    }
    if (message.type === 'positions' && message.buffer) {
      const positions = new Float32Array(message.buffer);
      queuePositionFrame(positions, new Date(message.timestamp), message.valid || 0);
    }
  });

  worker.addEventListener('error', (event) => {
    console.error('Orbit worker failed', event);
    statusText.textContent = 'Catalog loaded · orbit propagation worker failed';
    showToast('Không khởi động được SGP4 worker. Reload trang để thử lại.');
  });

  worker.postMessage({ type: 'init', rows });
}

function queuePositionFrame(positions, timestamp, valid) {
  state.pendingFrame = { positions, timestamp, valid };
  applyPendingFrame();
}

function applyPendingFrame() {
  if (!state.pendingFrame || applyPendingFrame.running) return;
  applyPendingFrame.running = true;
  const frame = state.pendingFrame;
  state.pendingFrame = null;
  let index = 0;

  const step = () => {
    const end = Math.min(index + POSITION_APPLY_BATCH, state.orbitObjects.length);
    for (; index < end; index++) {
      const obj = state.orbitObjects[index];
      const offset = index * 4;
      const lon = frame.positions[offset];
      const lat = frame.positions[offset + 1];
      const altitudeKm = frame.positions[offset + 2];
      const speedKmS = frame.positions[offset + 3];

      if (![lon, lat, altitudeKm, speedKmS].every(Number.isFinite)) {
        obj.hasPosition = false;
        obj.billboard.show = false;
        continue;
      }

      obj.lon = lon;
      obj.lat = lat;
      obj.altitudeKm = altitudeKm;
      obj.speedKmS = speedKmS;
      obj.updatedAt = frame.timestamp;
      obj.hasPosition = true;
      obj.billboard.position = Cesium.Cartesian3.fromDegrees(lon, lat, altitudeKm * 1000);
      obj.billboard.show = true;
    }

    if (index < state.orbitObjects.length) {
      requestAnimationFrame(step);
      return;
    }

    applyPendingFrame.running = false;
    if (!state.firstPositionFrame) {
      state.firstPositionFrame = true;
      updateLiveStatus(frame.valid);
    }
    if (state.selected) syncSelectedFocus();
    updateOrbitVisibility();
    if (state.pendingFrame) applyPendingFrame();
  };

  requestAnimationFrame(step);
}

function updateLiveStatus(validCount) {
  const counts = state.catalogCounts;
  const top = Object.entries(counts.constellations || {})
    .filter(([name]) => name !== 'Other')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name, count]) => `${name} ${count.toLocaleString()}`)
    .join(' · ');
  statusText.textContent = `LIVE · ${validCount.toLocaleString()} / ${state.orbitObjects.length.toLocaleString()} active orbital objects · CelesTrak ACTIVE${top ? ` · ${top}` : ''}`;
}

function propagateSelected(obj, date) {
  try {
    if (!obj.satrec) obj.satrec = satellite.json2satrec(obj.row);
    const pv = satellite.propagate(obj.satrec, date);
    if (!pv?.position || !pv?.velocity) return null;
    const gmst = satellite.gstime(date);
    const geo = satellite.eciToGeodetic(pv.position, gmst);
    const lat = satellite.degreesLat(geo.latitude);
    const lon = satellite.degreesLong(geo.longitude);
    const altitudeKm = geo.height;
    const speedKmS = Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z);
    if (![lat, lon, altitudeKm, speedKmS].every(Number.isFinite)) return null;
    return { lat, lon, altitudeKm, speedKmS };
  } catch {
    return null;
  }
}

function syncSelectedFocus() {
  const obj = state.selected;
  if (!obj?.hasPosition) return;
  state.focusEntity.position = Cesium.Cartesian3.fromDegrees(obj.lon, obj.lat, obj.altitudeKm * 1000);
  state.focusEntity.billboard.image = ICONS[obj.category] || ICONS.satellite;
  const size = Math.max(32, iconSize(obj.category) + 10);
  state.focusEntity.billboard.width = size;
  state.focusEntity.billboard.height = size;
  state.focusEntity.show = true;
  updateSelectedPanel(obj);
}

function updateCameraMode() {
  if (!state.viewer) return;
  const carto = Cesium.Cartographic.fromCartesian(state.viewer.camera.positionWC);
  const h = Math.max(0, carto.height);
  state.cameraHeight = h;
  const name = $('viewModeName');
  const hint = $('viewModeHint');

  if (h > 3_500_000) {
    name.textContent = 'ORBIT VIEW';
    hint.textContent = state.firstPositionFrame ? `${state.orbitObjects.length.toLocaleString()} active catalog objects` : 'Loading global orbit catalog';
  } else if (h > 300_000) {
    name.textContent = 'EARTH VIEW';
    hint.textContent = 'Orbital objects fade as you approach the surface';
  } else {
    name.textContent = 'SURFACE VIEW';
    hint.textContent = 'Air · sea · rail · launch layers live here';
  }
  updateOrbitVisibility();
}

function updateOrbitVisibility() {
  if (!state.orbitBillboards) return;
  const surfaceMode = state.cameraHeight < SURFACE_ORBIT_HIDE_M;
  state.orbitBillboards.show = state.orbitLayerVisible && !surfaceMode;
  state.focusEntity.show = Boolean(state.selected?.hasPosition) && (state.orbitLayerVisible || state.following);
}

function pickedOrbitObject(picked) {
  if (!picked) return null;
  if (picked.id?.kind === 'orbit') return picked.id;
  if (picked.id === state.focusEntity && state.selected) return state.selected;
  return null;
}

function installInteraction(viewer) {
  const handler = viewer.screenSpaceEventHandler;

  handler.setInputAction((movement) => {
    const obj = pickedOrbitObject(viewer.scene.pick(movement.position));
    if (obj) selectObject(obj, false);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  handler.setInputAction((movement) => {
    const obj = pickedOrbitObject(viewer.scene.pick(movement.endPosition));
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
  if (!obj.hasPosition) {
    showToast(`${obj.name}: đang chờ vị trí SGP4 đầu tiên.`);
    return;
  }
  if (state.orbitLine) {
    state.viewer.entities.remove(state.orbitLine);
    state.orbitLine = null;
  }
  state.selected = obj;
  state.following = false;
  state.viewer.trackedEntity = undefined;
  panel.classList.add('open');
  syncSelectedFocus();

  if (!fly) return;
  const range = Math.max(650000, Math.min(8_000_000, obj.altitudeKm * 1000 * 1.1));
  state.viewer.flyTo(state.focusEntity, {
    duration: 1.45,
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-25), range),
  });
}

function updateSelectedPanel(obj) {
  if (!obj) return;
  $('entityType').textContent = TYPE_LABEL[obj.category] || 'ORBITAL OBJECT';
  $('entityName').textContent = obj.name;
  $('entityId').textContent = `NORAD ${obj.norad || '—'}${obj.objectId ? ` · ${obj.objectId}` : ''}${obj.constellation !== 'Other' ? ` · ${obj.constellation}` : ''}`;
  $('mAltitude').textContent = Number.isFinite(obj.altitudeKm) ? `${obj.altitudeKm.toLocaleString(undefined, { maximumFractionDigits: 0 })} km` : '—';
  $('mVelocity').textContent = Number.isFinite(obj.speedKmS) ? `${obj.speedKmS.toFixed(2)} km/s` : '—';
  $('mLat').textContent = Number.isFinite(obj.lat) ? `${Math.abs(obj.lat).toFixed(3)}° ${obj.lat >= 0 ? 'N' : 'S'}` : '—';
  $('mLon').textContent = Number.isFinite(obj.lon) ? `${Math.abs(obj.lon).toFixed(3)}° ${obj.lon >= 0 ? 'E' : 'W'}` : '—';
  $('mTime').textContent = obj.updatedAt ? obj.updatedAt.toLocaleTimeString([], { hour12: false }) : '—';
  $('mSource').textContent = `CelesTrak ${ORBIT_GROUP} · OMM/SGP4`;
  $('followBtn').textContent = state.following ? 'Stop follow' : 'Follow';
  $('trackBtn').textContent = state.orbitLine ? 'Hide orbit' : 'Show orbit';
}

function toggleFollow() {
  if (!state.selected?.hasPosition) return;
  state.following = !state.following;
  if (state.following) {
    const d = Math.max(200000, Math.min(3_000_000, state.selected.altitudeKm * 1000 * 0.42));
    state.focusEntity.viewFrom = new Cesium.Cartesian3(0, -d, d * 0.28);
    state.viewer.trackedEntity = state.focusEntity;
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
    const p = propagateSelected(state.selected, new Date(center + min * 60000));
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
  showToast._timer = setTimeout(() => { el.hidden = true; }, 3000);
}

function installUI() {
  $('panelClose').addEventListener('click', () => panel.classList.remove('open'));
  $('followBtn').addEventListener('click', toggleFollow);
  $('trackBtn').addEventListener('click', toggleOrbitLine);

  $('searchForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const raw = $('searchInput').value.trim();
    const q = raw.toLowerCase().replace(/^norad\s*/, '');
    if (!q) return;

    const exact = state.orbitObjects.find((x) => x.norad === q || x.objectId.toLowerCase() === q || x.name.toLowerCase() === q);
    const partial = state.orbitObjects.find((x) => x.name.toLowerCase().includes(q) || x.norad.includes(q));
    const match = exact || partial;
    if (!match) return showToast(`Không tìm thấy “${raw}” trong ACTIVE catalog.`);
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
      showToast(`${names[layer]}: adapter live sẽ được nối sau Space Catalog Engine.`);
    });
  });

  const clock = () => { $('clock').textContent = `${new Date().toISOString().slice(11, 19)} UTC`; };
  clock();
  setInterval(clock, 1000);
}

async function loadSpaceCatalog() {
  const rawRows = await fetchActiveCatalog();
  const rows = uniqueRows(rawRows);
  await buildCatalog(rows);
  statusText.textContent = `Catalog loaded · ${rows.length.toLocaleString()} active objects · starting SGP4 worker…`;
  startOrbitWorker(rows);
}

async function boot() {
  try {
    installUI();
    await createViewer();
    await loadSpaceCatalog();
  } catch (error) {
    console.error(error);
    $('fatal').hidden = false;
    $('fatalText').textContent = error?.message || String(error);
    statusText.textContent = 'Startup failed';
  }
}

boot();
