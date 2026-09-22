# LIVEWORLD v0.5 — Worldwide Space Catalog Engine

v0.5 replaces the tiny `STATIONS + GPS-OPS` prototype feed with CelesTrak's worldwide `ACTIVE` GP catalog. CelesTrak documents the Active list as 10,000+ satellites, so the actual count shown by LIVEWORLD is read from the feed at runtime instead of hard-coded.

## What changed

- `GROUP=ACTIVE&FORMAT=JSON` as the primary public worldwide orbital feed.
- OMM/JSON rather than legacy fixed-width TLE.
- Browser Web Worker runs SGP4 away from the UI thread.
- Position frame updates every 5 seconds; the main thread applies them in small batches to avoid a long UI freeze.
- One Cesium `BillboardCollection` batches thousands of satellite icons on the GPU.
- Satellite, station, and crew/cargo spacecraft use different icons.
- Search now covers the whole ACTIVE catalog by name, COSPAR Object ID, or NORAD ID.
- Surface LOD hides the global orbital collection when the camera descends below ~1,500 km, preserving the visual space for future Air / Sea / Rail / Launch layers.
- CelesTrak origin-cache example included: 2-hour cache, cache lock, stale-on-error.

## Deploy static files

```bash
unzip liveworld-v0.5.zip
cd liveworld-v0.5
chmod +x deploy.sh
./deploy.sh
```

## Required Nginx cache for the large ACTIVE feed

CelesTrak's 2026 usage policy says GP data updates once every 2 hours and specifically notes rate limiting for large datasets such as Active and Starlink. Do not make every visitor pull ACTIVE directly from CelesTrak.

1. Install cache zone:

```bash
sudo cp nginx/liveworld-cache.conf /etc/nginx/conf.d/liveworld-cache.conf
sudo mkdir -p /var/cache/nginx/liveworld-celestrak
sudo chown -R www-data:www-data /var/cache/nginx/liveworld-celestrak
```

2. Merge the `/api/celestrak/` location from `nginx/liveword.conf.example` into your current HTTPS server block, or replace the site config if it matches your setup.

3. Test and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

4. Test the large public catalog through your origin:

```bash
curl -sS -D - \
  'https://liveword.longh.org/api/celestrak/gp.php?GROUP=ACTIVE&FORMAT=JSON' \
  -o /tmp/liveworld-active.json

python3 - <<'PY'
import json
p='/tmp/liveworld-active.json'
d=json.load(open(p))
print('objects:', len(d))
print('first:', d[0].get('OBJECT_NAME'), d[0].get('NORAD_CAT_ID'))
PY
```

Run the curl twice. On the second successful request you should normally see:

```text
X-Liveworld-Cache: HIT
```

## Why OMM/JSON

The public catalog passed the old 5-digit NORAD catalog-number limit in 2026. OMM/JSON supports the modern catalog IDs and is the correct foundation for LIVEWORLD.

## Source roadmap after v0.5

v0.5 deliberately does **not** pretend to have operator feeds that require credentials. Next source adapters should be added with source priority rather than averaging coordinates:

1. CelesTrak SupGP / operator-derived ephemerides where available (e.g. Starlink supplemental data).
2. Space-Track GP / SATCAT once a LIVEWORLD server account is configured.
3. ESA DISCOS / UNOOSA / SatNOGS for metadata enrichment, not as fake real-time position feeds.
4. Official GNSS products for Galileo / GPS / GLONASS / BeiDou / QZSS / NavIC where useful.

The frontend entity model is intentionally source-agnostic so those sources can replace or enrich the current CelesTrak orbit state later.
