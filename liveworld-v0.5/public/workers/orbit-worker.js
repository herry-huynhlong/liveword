import * as satellite from 'https://cdn.jsdelivr.net/npm/satellite.js@7.1.0/+esm';

let satrecs = [];
let timer = null;
const UPDATE_MS = 5000;

function propagateOne(satrec, date) {
  try {
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
  } catch {
    return null;
  }
}

function tick() {
  if (!satrecs.length) return;
  const now = new Date();
  const positions = new Float32Array(satrecs.length * 4);
  let valid = 0;

  for (let i = 0; i < satrecs.length; i++) {
    const offset = i * 4;
    const satrec = satrecs[i];
    if (!satrec) {
      positions[offset] = NaN;
      positions[offset + 1] = NaN;
      positions[offset + 2] = NaN;
      positions[offset + 3] = NaN;
      continue;
    }
    const p = propagateOne(satrec, now);
    if (!p) {
      positions[offset] = NaN;
      positions[offset + 1] = NaN;
      positions[offset + 2] = NaN;
      positions[offset + 3] = NaN;
      continue;
    }
    positions[offset] = p.lon;
    positions[offset + 1] = p.lat;
    positions[offset + 2] = p.altitudeKm;
    positions[offset + 3] = p.speedKmS;
    valid++;
  }

  postMessage({
    type: 'positions',
    timestamp: now.getTime(),
    valid,
    buffer: positions.buffer,
  }, [positions.buffer]);
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type !== 'init' || !Array.isArray(message.rows)) return;

  satrecs = message.rows.map((row) => {
    try { return satellite.json2satrec(row); } catch { return null; }
  });

  const parsed = satrecs.reduce((count, item) => count + (item ? 1 : 0), 0);
  postMessage({ type: 'ready', total: satrecs.length, parsed, updateMs: UPDATE_MS });

  if (timer) clearInterval(timer);
  tick();
  timer = setInterval(tick, UPDATE_MS);
};
