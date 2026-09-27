import { LOCATION_DATA, METERS_TO_WORLD, unprojectXZ } from '../data/locations.js';

// 20 × 20 km; visible radius 10 km covers every tracks.csv point (max ±8 km); 1 unit = 100 m.
export const TERRAIN_SIZE = 200;
export const TERRAIN_SEGMENTS = 96; // 9,409 vertex / 18,432 triangle; ~210 m cells as before.
export const TILE_ZOOM = 12;
export const TILE_SIZE = 256;
export const TERRAIN_ENDPOINT = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

export function decodeTerrarium(red, green, blue) {
  return red * 256 + green + blue / 256 - 32768;
}

/** Web Mercator global pixel coordinates; integer coordinates denote pixel edges. */
export function latLonToPixel(lat, lon, zoom = TILE_ZOOM) {
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180;
  const size = TILE_SIZE * 2 ** zoom;
  return [(lon + 180) / 360 * size, (1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2 * size];
}

export function terrainTilePlan(size = TERRAIN_SIZE, zoom = TILE_ZOOM) {
  const nw = latLonToPixel(...unprojectXZ(-size / 2, -size / 2), zoom);
  const se = latLonToPixel(...unprojectXZ(size / 2, size / 2), zoom);
  // Include the adjacent pixels needed for seamless bilinear tile sampling.
  const minX = Math.floor((nw[0] - 0.5) / TILE_SIZE);
  const minY = Math.floor((nw[1] - 0.5) / TILE_SIZE);
  const maxX = Math.floor((se[0] + 0.5) / TILE_SIZE);
  const maxY = Math.floor((se[1] + 0.5) / TILE_SIZE);
  const tiles = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      tiles.push({ x, y, key: `${zoom}/${x}/${y}`, url: `${TERRAIN_ENDPOINT}/${zoom}/${x}/${y}.png` });
    }
  }
  return tiles;
}

export function sampleTileElevation(tiles, lat, lon, zoom = TILE_ZOOM) {
  const [px, py] = latLonToPixel(lat, lon, zoom).map((v) => v - 0.5);
  const x0 = Math.floor(px), y0 = Math.floor(py);
  const tx = px - x0, ty = py - y0;
  const read = (x, y) => {
    const tileX = Math.floor(x / TILE_SIZE), tileY = Math.floor(y / TILE_SIZE);
    const tile = tiles.get(`${zoom}/${tileX}/${tileY}`);
    if (!tile) throw new Error('Arazi karosu eksik.');
    const value = tile[(y - tileY * TILE_SIZE) * TILE_SIZE + x - tileX * TILE_SIZE];
    if (!Number.isFinite(value)) throw new Error('Arazi verisinde geçersiz yükseklik.');
    return value;
  };
  const top = read(x0, y0) * (1 - tx) + read(x0 + 1, y0) * tx;
  const bottom = read(x0, y0 + 1) * (1 - tx) + read(x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Matches PlaneGeometry's NW/SW/NE and SW/SE/NE triangles exactly.
 * Bilinear interpolation here would float above/below a non-planar mesh cell.
 */
export function sampleTerrainHeight(terrain, x, z) {
  const { size, segments, heights } = terrain;
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > size / 2 || Math.abs(z) > size / 2) return null;
  const gx = (x / size + 0.5) * segments, gz = (z / size + 0.5) * segments;
  const ix = Math.min(Math.floor(gx), segments - 1), iz = Math.min(Math.floor(gz), segments - 1);
  const u = gx - ix, v = gz - iz, stride = segments + 1;
  const a = heights[iz * stride + ix];
  const b = heights[(iz + 1) * stride + ix];
  const d = heights[iz * stride + ix + 1];
  const c = heights[(iz + 1) * stride + ix + 1];
  return u + v <= 1
    ? a + (d - a) * u + (b - a) * v
    : c + (b - c) * (1 - u) + (d - c) * (1 - v);
}

export function createTerrainGrid(tiles, { segments = TERRAIN_SEGMENTS, size = TERRAIN_SIZE, zoom = TILE_ZOOM } = {}) {
  const { base } = LOCATION_DATA;
  const baseElevation = sampleTileElevation(tiles, base.lat, base.lon, zoom);
  const heights = new Float32Array((segments + 1) ** 2);
  for (let row = 0; row <= segments; row++) {
    for (let col = 0; col <= segments; col++) {
      const x = (col / segments - 0.5) * size;
      const z = (row / segments - 0.5) * size;
      const elevation = sampleTileElevation(tiles, ...unprojectXZ(x, z), zoom);
      // Physical vertical scale; no hidden exaggeration. Base surface is y=0.
      heights[row * (segments + 1) + col] = (elevation - baseElevation) * METERS_TO_WORLD;
    }
  }
  return { heights, size, segments, baseElevation, fetchedAt: new Date().toISOString() };
}

export function surfaceDistanceMeters(lat, lon) {
  const rad = Math.PI / 180, { base } = LOCATION_DATA;
  const a = Math.sin((lat - base.lat) * rad / 2) ** 2
    + Math.cos(base.lat * rad) * Math.cos(lat * rad) * Math.sin((lon - base.lon) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

// Display-only simulation animation, not a threat assessment.
export function contactPulse(distanceMeters) {
  const proximity = 1 - Math.min(1, Math.max(0, distanceMeters / 5000));
  return { frequency: 0.5 + proximity * 2, minimum: 0.2 + proximity * 0.25 };
}
