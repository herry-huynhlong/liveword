// Non-orbital demo entities. Satellites are loaded live from CelesTrak in v0.2.
export const entities = [
  {
    id: 'air-vn123',
    type: 'aircraft',
    name: 'VN123',
    icon: '✈',
    lat: 13.2,
    lon: 108.7,
    altitudeKm: 10.7,
    speed: '825 km/h',
    headingDeg: 17,
    status: 'Airborne · demo',
    source: 'Mock · ADS-B adapter next',
    observedAgo: 'demo data'
  },
  {
    id: 'air-sq12',
    type: 'aircraft',
    name: 'SQ12',
    icon: '✈',
    lat: 24.2,
    lon: 143.0,
    altitudeKm: 11.4,
    speed: '901 km/h',
    headingDeg: 63,
    status: 'Airborne · demo',
    source: 'Mock · ADS-B adapter next',
    observedAgo: 'demo data'
  },
  {
    id: 'ship-ever',
    type: 'ship',
    name: 'EVER GIVEN',
    icon: '🚢',
    lat: 17.9,
    lon: -148.4,
    altitudeKm: 0.018,
    speed: '17.4 kn',
    headingDeg: 282,
    status: 'Under way · demo',
    source: 'Mock · AIS/S-AIS adapter next',
    observedAgo: 'demo data'
  },
  {
    id: 'rocket-demo',
    type: 'rocket',
    name: 'STARSHIP FLIGHT',
    icon: '🚀',
    lat: 26.0,
    lon: -97.2,
    altitudeKm: 85,
    speed: '6,740 km/h',
    headingDeg: 95,
    status: 'Mission demo',
    source: 'Mock · launch/telemetry adapter next',
    observedAgo: 'demo data'
  }
];
