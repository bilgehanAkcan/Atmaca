import test from 'node:test';
import assert from 'node:assert/strict';
import { DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, Vector3 } from 'three';
import { LOCATION_DATA, ZONES, projectLatLon, unprojectXZ } from '../src/data/locations.js';
import { contactPulse, createTerrainGrid, decodeTerrarium, latLonToPixel, sampleTerrainHeight, sampleTileElevation, surfaceDistanceMeters, TERRAIN_SEGMENTS, terrainTilePlan } from '../src/lib/terrain.js';
import { applyTerrainToGeometry } from '../src/lib/terrainGeometry.js';

test('Terrarium RGB metre değeri olarak çözülür; renk/gamma işlemi yoktur', () => {
  assert.equal(decodeTerrarium(128, 0, 0), 0);
  assert.equal(decodeTerrarium(137, 219, 68), 2523.265625);
  assert.equal(decodeTerrarium(127, 255, 0), -1);
});

test('Ankara projeksiyonu ters dönüşümde konumu korur', () => {
  for (const zone of ZONES) {
    const [x, , z] = projectLatLon(...zone.center);
    const [lat, lon] = unprojectXZ(x, z);
    assert.ok(Math.abs(lat - zone.center[0]) < 1e-10);
    assert.ok(Math.abs(lon - zone.center[1]) < 1e-10);
  }
  assert.equal(surfaceDistanceMeters(LOCATION_DATA.base.lat, LOCATION_DATA.base.lon), 0);
  assert.ok(Math.abs(surfaceDistanceMeters(...ZONES[0].center) - 3196.4) < 1);
});

test('Karolar arasında yükseklik örneklemesi süreklidir', () => {
  // At zoom zero, equator/prime meridian corresponds to global pixel (128,128).
  const pixels = new Float32Array(256 * 256);
  pixels[127 * 256 + 127] = 100;
  pixels[127 * 256 + 128] = 200;
  pixels[128 * 256 + 127] = 300;
  pixels[128 * 256 + 128] = 400;
  assert.deepEqual(latLonToPixel(0, 0, 0), [128, 128]);
  assert.equal(sampleTileElevation(new Map([['0/0/0', pixels]]), 0, 0, 0), 250);
  // At z=1 the same coordinate lies at the intersection of four tiles.
  const tiles = new Map([
    ['1/0/0', new Float32Array(65536).fill(100)], ['1/1/0', new Float32Array(65536).fill(200)],
    ['1/0/1', new Float32Array(65536).fill(300)], ['1/1/1', new Float32Array(65536).fill(400)],
  ]);
  assert.equal(sampleTileElevation(tiles, 0, 0, 1), 250);
  tiles.delete('1/1/1');
  assert.throws(() => sampleTileElevation(tiles, 0, 0, 1), /eksik/);
});

test('DEM ağı: orijin rakımdan bağımsız sıfırdır, tüm vertexler kapsanır', () => {
  const plan = terrainTilePlan();
  assert.ok(plan.length <= 16 && plan.length > 0); // fetchTerrain cache holds 24
  const tiles = new Map(plan.map((tile) => [tile.key, new Float32Array(65536).fill(912.5)]));
  const terrain = createTerrainGrid(tiles);
  assert.equal(terrain.baseElevation, 912.5);
  assert.equal(terrain.heights.length, (TERRAIN_SEGMENTS + 1) ** 2);
  assert.ok(terrain.heights.every((height) => height === 0));
  assert.equal(sampleTerrainHeight(terrain, 0, 0), 0);
  assert.equal(sampleTerrainHeight(terrain, terrain.size / 2, 0), 0);
  assert.equal(sampleTerrainHeight(terrain, terrain.size / 2 + 1, 0), null);
  assert.equal(sampleTerrainHeight(terrain, NaN, 0), null);
});

test('Araziye oturma yüksekliği gerçek Three.js üçgen raycast sonucuyla eşleşir', () => {
  const terrain = { size: 10, segments: 4, heights: Float32Array.from({ length: 25 }, (_, i) => Math.sin(i * 0.8) * 3) };
  const geometry = new PlaneGeometry(terrain.size, terrain.size, terrain.segments, terrain.segments);
  applyTerrainToGeometry(geometry, terrain);
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const mesh = new Mesh(geometry, material);
  mesh.updateMatrixWorld(true);
  const raycaster = new Raycaster();
  for (const [x, z] of [[-4.7, -4.6], [-3.1, -3.4], [-0.7, 1.2], [4.6, 4.8], [0, 0], [-5, -5], [5, 5]]) {
    raycaster.set(new Vector3(x, 100, z), new Vector3(0, -1, 0));
    const hit = raycaster.intersectObject(mesh)[0];
    assert.ok(hit, `No intersection at ${x},${z}`);
    assert.ok(Math.abs(sampleTerrainHeight(terrain, x, z) - hit.point.y) < 1e-6);
  }
  // StrictMode reruns must not rotate/deform the mesh twice.
  const before = geometry.attributes.position.array.slice();
  applyTerrainToGeometry(geometry, terrain);
  assert.deepEqual(geometry.attributes.position.array, before);
  geometry.dispose();
  material.dispose();
});

test('Simülasyon darbesi yaklaşırken hızlanır ve belirginleşir, üst sınırı vardır', () => {
  assert.ok(contactPulse(100).frequency > contactPulse(4000).frequency);
  assert.ok(contactPulse(100).minimum > contactPulse(4000).minimum);
  assert.equal(contactPulse(0).frequency, 2.5);
  assert.equal(contactPulse(8000).frequency, 0.5);
});
