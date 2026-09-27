export const LOCATION_DATA = {
  base: { name: 'Merkez Us', lat: 39.92184, lon: 32.85306 },
  zones: [
    { name: 'Kuzey Yolu', center: [39.950586, 32.85306] },
    { name: 'Kuzeydogu Kavsagi', center: [39.942166, 32.879564] },
    { name: 'Dogu Yolu', center: [39.92184, 32.890542] },
    { name: 'Guneydogu Yerlesimi', center: [39.901514, 32.879564] },
    { name: 'Guney Kapisi Yaklasimi', center: [39.893094, 32.85306] },
    { name: 'Guneybati Yolu', center: [39.901514, 32.826556] },
    { name: 'Bati Yerlesimi', center: [39.92184, 32.815578] },
    { name: 'Kuzeybati Yolu', center: [39.942166, 32.826556] },
  ],
};

export const METERS_TO_WORLD = 0.01; // 1 sahne birimi = 100 metre.
const EARTH_RADIUS_METERS = 6371000;
const DEG_TO_RAD = Math.PI / 180;

/** Yerel eşdikdörtgensel projeksiyon; birkaç kilometrelik demo alanı için.
 * Doğu +X, kuzey -Z. Yükseklik verisi olmadığı için Y her zaman 0.
 * Büyük alanlarda veya hassas ölçümlerde yerel ENU / uygun CRS kullanın.
 */
export function projectLatLon(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new RangeError('Geçerli enlem ve boylam gerekli.');
  }
  const { base } = LOCATION_DATA;
  const east = (lon - base.lon) * DEG_TO_RAD * EARTH_RADIUS_METERS * Math.cos(base.lat * DEG_TO_RAD);
  const north = (lat - base.lat) * DEG_TO_RAD * EARTH_RADIUS_METERS;
  return [east * METERS_TO_WORLD, 0, north === 0 ? 0 : -north * METERS_TO_WORLD];
}

export function unprojectXZ(x, z) {
  const { base } = LOCATION_DATA;
  return [
    base.lat - z / (METERS_TO_WORLD * EARTH_RADIUS_METERS * DEG_TO_RAD),
    base.lon + x / (METERS_TO_WORLD * EARTH_RADIUS_METERS * DEG_TO_RAD * Math.cos(base.lat * DEG_TO_RAD)),
  ];
}

export const ZONES = LOCATION_DATA.zones.map((zone, index) => {
  const position = projectLatLon(...zone.center);
  return {
    ...zone,
    id: `CAM-${String(index + 1).padStart(2, '0')}`,
    position,
    distanceKm: Math.hypot(position[0], position[2]) / METERS_TO_WORLD / 1000,
  };
});
