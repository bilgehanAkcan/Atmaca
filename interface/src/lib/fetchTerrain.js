import { createTerrainGrid, decodeTerrarium, terrainTilePlan, TILE_SIZE } from './terrain.js';

// Completed decoded tiles only: aborted StrictMode requests cannot poison cache.
const cache = new Map();
const TTL = 10 * 60 * 1000;
const MAX_CACHED_TILES = 24;

async function fetchTile(tile, signal) {
  const cached = cache.get(tile.key);
  if (cached && Date.now() - cached.time < TTL) return cached.heights;
  const response = await fetch(tile.url, { signal, mode: 'cors', credentials: 'omit' });
  if (!response.ok) throw new Error(`Arazi servisi HTTP ${response.status} döndürdü.`);
  const blob = await response.blob();
  signal.throwIfAborted();
  // Terrarium is numeric RGB, not a color photograph: avoid gamma conversion.
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  try {
    signal.throwIfAborted();
    if (bitmap.width !== TILE_SIZE || bitmap.height !== TILE_SIZE) throw new Error('Beklenmeyen arazi karosu boyutu.');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TILE_SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!context) throw new Error('Yükseklik çözümleme için Canvas 2D açılamadı.');
    context.drawImage(bitmap, 0, 0);
    const rgba = context.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
    const heights = new Float32Array(TILE_SIZE ** 2);
    for (let i = 0; i < heights.length; i++) {
      const offset = i * 4;
      const height = decodeTerrarium(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
      if (rgba[offset + 3] !== 255 || height < -12000 || height > 10000) throw new Error('Arazi karosunda eksik/geçersiz veri.');
      heights[i] = height;
    }
    if (cache.size >= MAX_CACHED_TILES) cache.delete(cache.keys().next().value);
    cache.set(tile.key, { heights, time: Date.now() });
    return heights;
  } finally {
    bitmap.close();
  }
}

export async function fetchTerrain(signal) {
  const plan = terrainTilePlan();
  const tiles = new Map();
  // At most four requests/decodes concurrently; no request per vertex.
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, plan.length) }, async () => {
    while (cursor < plan.length) {
      signal.throwIfAborted();
      const tile = plan[cursor++];
      tiles.set(tile.key, await fetchTile(tile, signal));
    }
  }));
  signal.throwIfAborted();
  return createTerrainGrid(tiles);
}
