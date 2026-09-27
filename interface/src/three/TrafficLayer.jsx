import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { AdditiveBlending, DoubleSide, Vector3 } from 'three';
import { projectLatLon } from '../data/locations.js';
import { vehicleColor } from '../lib/agentApi.js';
import { separate } from '../lib/declutter.js';
import { sampleTerrainHeight } from '../lib/terrain.js';
import { useVehicles, vehicleStore } from '../store/vehicleStore.js';
import VehicleIcon, { modelRadius, NEON } from './VehicleIcon.jsx';

// Scene units are 100 m, so real-size vehicles would be sub-pixel. Models are ~1 unit
// long and scaled with camera distance to keep a near-constant on-screen size.
const SCALE_PER_DISTANCE = 0.0065;
const MIN_SCALE = 0.13;
const MAX_SCALE = 2.4;
const SELECTED_SCALE = 1.3;
const SEPARATION_PASSES = 10; // dense clusters (≤ ~110 vehicles) settle within this
const GLIDE_RATE = 5; // 1/s: a new 5-min CSV position is reached in ~0.6 s
const PULSING_LEVELS = ['YUKSEK'];
const CORNER_ORDER = ['top_left', 'top_right', 'bottom_right', 'bottom_left', 'top_left'];

function grounded(terrain, lat, lon, lift) {
  const position = projectLatLon(lat, lon);
  const y = sampleTerrainHeight(terrain, position[0], position[2]);
  if (y === null) return null; // DEM dışında: sahte kenar yüksekliğine kıstırma
  position[1] = y + lift;
  return position;
}

/** Seçili aracın izi (≤ sanal saat) ve tespit edildiği görüntülerin zemin izleri. */
function SelectedOverlay({ terrain, id }) {
  const entity = useVehicles((state) => state.vehicles[id]);
  const trail = useMemo(() => (entity?.points ?? [])
    .map(([, lat, lon]) => grounded(terrain, lat, lon, 0.05)).filter(Boolean), [terrain, entity]);
  const footprints = useMemo(() => (entity?.observations ?? []).flatMap((item) => {
    const points = CORNER_ORDER.map((name) => grounded(terrain, ...item.corners[name], 0.06));
    return points.every(Boolean) ? [{ key: item.image_id, points }] : [];
  }), [terrain, entity]);
  if (!entity) return null;
  const color = vehicleColor(entity);
  return (
    <group>
      {trail.length > 1 && <Line points={trail} color={color} lineWidth={2} transparent opacity={0.8} depthTest={false} depthWrite={false} />}
      {footprints.map((item) => <Line key={item.key} points={item.points} color="#e1cb8c" lineWidth={1.2}
        dashed dashSize={0.25} gapSize={0.15} transparent opacity={0.8} depthTest={false} depthWrite={false} />)}
    </group>
  );
}

/**
 * Araç katmanı. Konumlar vehicleStore.positions'tan okunur; her karede:
 * yumuşak geçiş (yeni CSV noktasına kayma) → mesafeye göre ölçek → çakışma ayrıştırma.
 * `displayRef` (id → {x, y, z}) kamera takibi için gerçek (ayrıştırılmamış) konumu taşır.
 */
export default function TrafficLayer({ terrain, reducedMotion, enabled, onPick, displayRef, zoomScale }) {
  const ids = useVehicles((state) => state.ids);
  const selectedId = useVehicles((state) => state.selectedId);
  const groups = useRef(new Map());
  const beacon = useRef(null);
  const work = useRef({ items: [], out: [], keys: [], probe: new Vector3() });
  const register = useCallback((id, object) => {
    if (object) groups.current.set(id, object); else groups.current.delete(id);
  }, []);

  // Sahneden düşen araçların geçiş durumunu temizle.
  useEffect(() => {
    const live = new Set(ids);
    for (const id of displayRef.current.keys()) if (!live.has(id)) displayRef.current.delete(id);
  }, [ids, displayRef]);

  useFrame(({ camera, clock }, delta) => {
    const pulse = reducedMotion ? 0.5 : (Math.sin(clock.elapsedTime * 6) + 1) / 2;
    for (const level of PULSING_LEVELS) {
      NEON[level].shell.emissiveIntensity = 0.35 + pulse * 0.55;
      NEON[level].halo.opacity = 0.25 + pulse * 0.45;
    }

    const { positions, vehicles, overrides } = vehicleStore.getState();
    const display = displayRef.current;
    const { items, out, keys, probe } = work.current;
    const glide = reducedMotion ? 1 : 1 - Math.exp(-delta * GLIDE_RATE);
    // Zoom in'de ikonun dünya boyutu zoom 1'deki gibi kalır (haritayla büyür);
    // zoom out'ta ekran boyutu sabit kalır, ikonlar tıklanabilir büyüklükte kalır.
    const zoomIn = Math.max(1, 1 / (zoomScale?.current ?? 1));
    keys.length = 0;
    for (const id of groups.current.keys()) {
      const position = positions[id];
      if (!position) continue;
      const [x, , z] = projectLatLon(position.lat, position.lon);
      let state = display.get(id);
      if (!state) { state = { x, y: 0, z, scale: MIN_SCALE }; display.set(id, state); }
      state.x += (x - state.x) * glide;
      state.z += (z - state.z) * glide;
      state.y = sampleTerrainHeight(terrain, state.x, state.z) ?? state.y;
      const distance = camera.position.distanceTo(probe.set(state.x, state.y, state.z));
      state.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, distance * zoomIn * SCALE_PER_DISTANCE)) * (id === selectedId ? SELECTED_SCALE : 1);
      const index = keys.length;
      items[index] ??= { x: 0, z: 0, r: 0 };
      out[index] ??= { x: 0, z: 0 };
      items[index].x = state.x; items[index].z = state.z;
      items[index].r = state.scale * modelRadius(overrides[id]?.cls ?? vehicles[id]?.cls);
      keys.push(id);
    }
    items.length = keys.length;
    out.length = keys.length;
    separate(items, out, SEPARATION_PASSES);

    for (let index = 0; index < keys.length; index++) {
      const id = keys[index];
      const state = display.get(id);
      const shownY = sampleTerrainHeight(terrain, out[index].x, out[index].z) ?? state.y;
      const heading = positions[id].heading_deg;
      const group = groups.current.get(id);
      group.position.set(out[index].x, shownY + 0.02, out[index].z);
      group.rotation.y = heading == null ? 0 : -heading * Math.PI / 180;
      group.scale.setScalar(state.scale);
      if (id === selectedId && beacon.current) {
        beacon.current.position.set(out[index].x, shownY, out[index].z);
        beacon.current.scale.setScalar(state.scale);
        beacon.current.rotation.y += delta * 1.5;
      }
    }
    if (beacon.current) beacon.current.visible = Boolean(selectedId && display.has(selectedId));
  });

  const beaconColor = useVehicles((state) => (state.vehicles[state.selectedId] ? vehicleColor(state.vehicles[state.selectedId]) : '#ffffff'));

  return (
    <group>
      {ids.map((id) => <VehicleIcon key={id} id={id} register={register} onPick={onPick} enabled={enabled} />)}
      <group ref={beacon} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.95, 1.15, 6]} />
          <meshBasicMaterial color={beaconColor} transparent opacity={0.8} side={DoubleSide} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh position={[0, 2.5, 0]}>
          <cylinderGeometry args={[0.06, 0.25, 5, 12, 1, true]} />
          <meshBasicMaterial color={beaconColor} transparent opacity={0.3} side={DoubleSide} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
      {selectedId && <SelectedOverlay terrain={terrain} id={selectedId} />}
    </group>
  );
}
