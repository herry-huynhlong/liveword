import {
  json2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLat,
  degreesLong
} from 'satellite.js';

const GP_BASE = 'https://celestrak.org/NORAD/elements/gp.php';
const CACHE_PREFIX = 'orbit:celestrak:v2:';
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

const NUMERIC_FIELDS = [
  'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'EPHEMERIS_TYPE', 'NORAD_CAT_ID',
  'ELEMENT_SET_NO', 'REV_AT_EPOCH', 'BSTAR', 'MEAN_MOTION_DOT',
  'MEAN_MOTION_DDOT'
];

function readCache(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.data)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(key, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
      savedAt: Date.now(),
      data
    }));
  } catch {
    // Storage can be unavailable in privacy modes; live data still works.
  }
}

async function fetchGroup(group) {
  const cacheKey = `group:${group.toLowerCase()}`;
  const cached = readCache(cacheKey);

  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
    return { rows: cached.data, transport: 'cache', cachedAt: cached.savedAt };
  }

  const url = `${GP_BASE}?GROUP=${encodeURIComponent(group)}&FORMAT=JSON`;

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`CelesTrak ${response.status}: ${body.slice(0, 160)}`);
    }

    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Unexpected CelesTrak payload');
    writeCache(cacheKey, rows);
    return { rows, transport: 'network', cachedAt: Date.now() };
  } catch (error) {
    if (cached) {
      return {
        rows: cached.data,
        transport: 'stale-cache',
        cachedAt: cached.savedAt,
        warning: error.message
      };
    }
    throw error;
  }
}

function coerceOmm(raw) {
  const omm = { ...raw };
  for (const key of NUMERIC_FIELDS) {
    if (omm[key] !== undefined && omm[key] !== null && omm[key] !== '') {
      const n = Number(omm[key]);
      if (Number.isFinite(n)) omm[key] = n;
    }
  }
  return omm;
}

function toSatelliteEntity(raw, group) {
  const omm = coerceOmm(raw);
  const satrec = json2satrec(omm);
  const noradId = String(omm.NORAD_CAT_ID ?? '').trim();
  const epoch = new Date(omm.EPOCH);

  return {
    id: `sat-${noradId || omm.OBJECT_ID || omm.OBJECT_NAME}`,
    type: 'satellite',
    name: omm.OBJECT_NAME || `NORAD ${noradId}`,
    icon: '🛰',
    lat: 0,
    lon: 0,
    altitudeKm: 0,
    speed: '—',
    headingDeg: null,
    status: group === 'GPS-OPS' ? 'GPS operational orbit' : 'Orbital object',
    source: 'CelesTrak GP · SGP4',
    observedAgo: 'propagating…',
    path: true,
    live: true,
    metadata: {
      noradId,
      objectId: omm.OBJECT_ID || '—',
      epoch: Number.isNaN(epoch.getTime()) ? null : epoch,
      inclinationDeg: Number(omm.INCLINATION),
      meanMotion: Number(omm.MEAN_MOTION),
      group
    },
    satellite: { omm, satrec }
  };
}

export async function loadDefaultSatellites() {
  // Keep the default set intentionally small. CelesTrak asks clients not to
  // repeatedly download large groups such as ACTIVE/STARLINK between updates.
  const groups = ['STATIONS', 'GPS-OPS'];
  const settled = await Promise.allSettled(groups.map(fetchGroup));
  const byId = new Map();
  const diagnostics = [];

  settled.forEach((result, index) => {
    const group = groups[index];
    if (result.status === 'rejected') {
      diagnostics.push({ group, ok: false, error: result.reason?.message || String(result.reason) });
      return;
    }

    diagnostics.push({
      group,
      ok: true,
      count: result.value.rows.length,
      transport: result.value.transport,
      warning: result.value.warning
    });

    for (const row of result.value.rows) {
      try {
        const entity = toSatelliteEntity(row, group);
        if (entity.metadata.noradId) byId.set(entity.metadata.noradId, entity);
      } catch {
        // Skip malformed orbital records rather than breaking the entire globe.
      }
    }
  });

  return { entities: [...byId.values()], diagnostics };
}

export function propagateSatellite(entity, date = new Date()) {
  if (!entity?.satellite?.satrec) return null;
  const state = propagate(entity.satellite.satrec, date);
  if (!state?.position || !state?.velocity) return null;

  const gmst = gstime(date);
  const geodetic = eciToGeodetic(state.position, gmst);
  const speedKms = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);

  return {
    lat: degreesLat(geodetic.latitude),
    lon: degreesLong(geodetic.longitude),
    altitudeKm: geodetic.height,
    speedKms,
    state
  };
}

export function buildSatelliteTrack(entity, centerDate = new Date()) {
  const meanMotion = entity?.metadata?.meanMotion;
  const periodMinutes = Number.isFinite(meanMotion) && meanMotion > 0
    ? 1440 / meanMotion
    : 100;

  // One orbital period, bounded so a malformed record cannot create huge work.
  const durationMinutes = Math.min(720, Math.max(80, periodMinutes));
  const points = [];
  const samples = 180;
  const startMs = centerDate.getTime() - (durationMinutes * 60_000) / 2;

  for (let i = 0; i <= samples; i++) {
    const date = new Date(startMs + (durationMinutes * 60_000 * i) / samples);
    const p = propagateSatellite(entity, date);
    if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.altitudeKm)) {
      points.push(p);
    }
  }

  return points;
}

export function formatElementAge(entity, now = new Date()) {
  const epoch = entity?.metadata?.epoch;
  if (!(epoch instanceof Date) || Number.isNaN(epoch.getTime())) return 'orbital epoch unknown';
  const minutes = Math.max(0, Math.round((now - epoch) / 60_000));
  if (minutes < 60) return `elements ${minutes} min old`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `elements ${hours} h old`;
  return `elements ${Math.round(hours / 24)} d old`;
}
