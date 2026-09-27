import { useCallback, useMemo, useState } from 'react';
import { Edges } from '@react-three/drei';
import { AdditiveBlending, BoxGeometry, CircleGeometry, Color, CylinderGeometry, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, RingGeometry } from 'three';
import { VEHICLE_LEVEL_COLORS, vehicleLevel } from '../lib/agentApi.js';
import { DRAG_TOLERANCE_PX } from '../lib/mapInput.js';
import { useVehicles } from '../store/vehicleStore.js';

// Updates older than one tracks.csv step (5 min) mean the trace has ended.
export const STALE_MIN = 5;

function neonSet(hex, dim) {
  return {
    color: hex,
    shell: new MeshStandardMaterial({ color: '#0b0f0a', emissive: new Color(hex), emissiveIntensity: dim ? 0.12 : 0.45, roughness: 0.5, metalness: 0.2, toneMapped: false }),
    glow: new MeshBasicMaterial({ color: new Color(hex), transparent: dim, opacity: dim ? 0.35 : 1, toneMapped: false }),
    halo: new MeshBasicMaterial({ color: new Color(hex), transparent: true, opacity: dim ? 0.12 : 0.45, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false }),
  };
}

/** Shared neon materials per risk level (+ dim variants); TrafficLayer pulses YUKSEK. */
export const NEON = Object.fromEntries(Object.entries(VEHICLE_LEVEL_COLORS).map(([level, hex]) => [level, neonSet(hex, false)]));
export const NEON_DIM = Object.fromEntries(Object.entries(VEHICLE_LEVEL_COLORS).map(([level, hex]) => [level, neonSet(hex, true)]));

const box = (w, h, l) => new BoxGeometry(w, h, l);
const WHEEL = new CylinderGeometry(0.075, 0.075, 0.06, 12).rotateZ(Math.PI / 2);
const HALO_RADIUS = 0.75;
const GAP = 0.05; // halos never touch
const HALO = new RingGeometry(0.55, HALO_RADIUS, 32).rotateX(-Math.PI / 2);
// Hover: bilgi paneli yerine aracın çevresinde parlak çember ve zemin ışığı.
const HOVER_RING = new RingGeometry(0.84, 1.0, 48).rotateX(-Math.PI / 2);
const HOVER_GLOW = new CircleGeometry(0.84, 48).rotateX(-Math.PI / 2);
const glowMaterial = (hex, opacity) => new MeshBasicMaterial({ color: new Color(hex), transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
const HOVER = Object.fromEntries(Object.entries(VEHICLE_LEVEL_COLORS).map(([level, hex]) => [level, { ring: glowMaterial(hex, 0.95), glow: glowMaterial(hex, 0.22) }]));

// Forward is -Z (north at heading 0). Parts: [geometry, position, material slot, outlined].
// `radius` is the half-length used by the declutter pass (model units, before scaling).
const MODELS = {
  car: {
    radius: 0.55,
    parts: [[box(0.46, 0.16, 1.0), [0, 0.13, 0], 'shell', true], [box(0.4, 0.13, 0.5), [0, 0.275, 0.05], 'shell', true],
      [box(0.36, 0.02, 0.06), [0, 0.35, -0.2], 'glow', false]],
    wheels: [[-0.24, -0.32], [0.24, -0.32], [-0.24, 0.32], [0.24, 0.32]],
  },
  truck: {
    radius: 0.85,
    parts: [[box(0.44, 0.08, 1.5), [0, 0.1, -0.1], 'shell', false], [box(0.5, 0.36, 0.34), [0, 0.3, -0.64], 'shell', true],
      [box(0.56, 0.5, 1.05), [0, 0.39, 0.12], 'shell', true], [box(0.4, 0.03, 0.05), [0, 0.5, -0.8], 'glow', false]],
    wheels: [[-0.24, -0.62], [0.24, -0.62], [-0.26, 0.05], [0.26, 0.05], [-0.26, 0.45], [0.26, 0.45]],
  },
  bus: {
    radius: 1.05,
    parts: [[box(0.56, 0.5, 2.0), [0, 0.33, 0], 'shell', true], [box(0.58, 0.1, 1.8), [0, 0.42, 0.02], 'glow', false]],
    wheels: [[-0.27, -0.65], [0.27, -0.65], [-0.27, 0.65], [0.27, 0.65]],
  },
};
// Görev tanımı: van da kamyon modeliyle, biraz küçük çizilir; sınıfı bilinmeyen araba sayılır.
const CLASS_MODEL = { car: ['car', 1], van: ['truck', 0.8], truck: ['truck', 1], bus: ['bus', 1], unknown: ['car', 1] };
export const CLASS_LABELS = { car: 'Araba', van: 'Van', truck: 'Kamyon', bus: 'Otobüs', unknown: 'Sınıf bilinmiyor' };

/** Declutter radius of a class at scale 1. */
export function modelRadius(cls) {
  const [name, scale] = CLASS_MODEL[cls] ?? CLASS_MODEL.unknown;
  return Math.max(MODELS[name].radius * scale, HALO_RADIUS) + GAP;
}

/**
 * Sınıfına uygun 3D araç; kategori 1 yeşil, kategori 2 kırmızı neon, sinyali kesilen
 * araç soluk. Konum, yön ve ölçek her karede TrafficLayer tarafından `register`
 * ile alınan gruba yazılır; bu bileşen yalnızca görünümü ve etkileşimi taşır.
 */
export default function VehicleIcon({ id, register, onPick, enabled }) {
  const entity = useVehicles((state) => state.vehicles[id]);
  const override = useVehicles((state) => state.overrides[id]);
  const selected = useVehicles((state) => state.selectedId === id);
  const [hovered, setHovered] = useState(false);
  const view = useMemo(() => ({ ...entity, ...override }), [entity, override]);
  const setGroup = useCallback((object) => register(id, object), [id, register]);
  if (!entity || view.hidden) return null;

  const [modelName, modelScale] = CLASS_MODEL[view.cls] ?? CLASS_MODEL.unknown;
  const model = MODELS[modelName];
  const stale = entity.stale_min >= STALE_MIN;
  const level = vehicleLevel(view);
  const neon = (stale ? NEON_DIM : NEON)[level];
  const hover = (value) => (event) => { event.stopPropagation(); setHovered(value); document.body.style.cursor = value && enabled ? 'pointer' : ''; };
  // Harita sürüklenip bırakıldığında (delta > tolerans) araç seçilmez.
  const pick = (event) => { event.stopPropagation(); if (enabled && event.delta <= DRAG_TOLERANCE_PX) onPick(id); };

  return (
    <group ref={setGroup} onPointerOver={hover(true)} onPointerOut={hover(false)} onClick={pick}>
      <mesh geometry={HALO} material={neon.halo} position={[0, 0.01, 0]} />
      <group scale={modelScale}>
        {model.parts.map(([geometry, offset, slot, outlined], index) => (
          <mesh key={index} geometry={geometry} material={neon[slot]} position={offset}>
            {outlined && <Edges color={selected ? '#ffffff' : neon.color} threshold={20} />}
          </mesh>
        ))}
        {model.wheels.map(([x, z], index) => <mesh key={`w${index}`} geometry={WHEEL} material={neon.shell} position={[x, 0.075, z]} />)}
      </group>
      {hovered && enabled && <>
        <mesh geometry={HOVER_GLOW} material={HOVER[level].glow} position={[0, 0.015, 0]} />
        <mesh geometry={HOVER_RING} material={HOVER[level].ring} position={[0, 0.02, 0]} />
      </>}
    </group>
  );
}
