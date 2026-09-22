# ORBIT v0.2 — Live Satellite Layer

A lightweight 3D globe starter for the "one map for everything that moves" concept.

## What's live in v0.2

- 3D Earth with icon-first interaction (data appears after click)
- Live orbital elements from CelesTrak for:
  - `STATIONS` (ISS and other station-related objects)
  - `GPS-OPS` (operational GPS constellation)
- Client-side SGP4 propagation with `satellite.js`
- Satellite latitude / longitude / altitude / velocity updated locally
- Click satellite -> metadata panel
- Follow satellite camera
- Build/show one-orbit track on demand
- Search by satellite name, NORAD catalog number, or object ID
- CelesTrak responses cached in browser for 2 hours
- Existing aircraft / ship / rocket entities remain demo adapters for the next phases

## Why the cache matters

CelesTrak GP data updates about once every two hours and asks clients not to repeatedly download unchanged large data sets. v0.2 therefore caches each default group for two hours and can fall back to the previous cache if a refresh request fails.

## Run

```bash
npm install
npm run dev
```

Then open the Vite URL printed in the terminal.

## Build

```bash
npm run build
npm run preview
```

## Data flow

```text
CelesTrak OMM JSON
      ↓
2-hour browser cache
      ↓
satellite.js json2satrec
      ↓
SGP4 propagation(Date.now)
      ↓
ECI → geodetic lat/lon/altitude
      ↓
ORBIT universal entity
      ↓
Three.js globe sprite
```

## Current source policy

The default live set intentionally avoids loading the full `ACTIVE` or `STARLINK` groups on every client. Those sets can contain thousands of objects and CelesTrak explicitly limits repeat downloads between updates. A production build should normally put larger catalogs behind your own cached backend/edge layer and serve a compact normalized payload to clients.

## Next adapters

1. Starlink on-demand + backend cache
2. ADS-B aircraft feed
3. AIS / satellite-AIS vessel feed
4. Launch schedule + public rocket telemetry
5. Universal history/prediction/confidence engine

## Key files

- `src/main.js` — globe renderer and interaction
- `src/data/celestrak.js` — CelesTrak cache, normalization and SGP4 propagation
- `src/data/entities.js` — non-orbital demo entities
