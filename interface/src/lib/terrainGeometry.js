/** Mutate the declared R3F PlaneGeometry once per DEM, never per animation frame. */
export function applyTerrainToGeometry(geometry, terrain) {
  const positions = geometry.attributes.position;
  const stride = terrain.segments + 1;
  if (positions.count !== stride ** 2) throw new Error('Arazi ve mesh segment sayıları uyuşmuyor.');
  for (let i = 0; i < positions.count; i++) {
    const x = ((i % stride) / terrain.segments - 0.5) * terrain.size;
    const z = (Math.floor(i / stride) / terrain.segments - 0.5) * terrain.size;
    positions.setXYZ(i, x, terrain.heights[i], z);
  }
  positions.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}
