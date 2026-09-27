import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { ZONES } from '../data/locations.js';
import { sampleTerrainHeight } from '../lib/terrain.js';

// zones.json sırası (K, KD, D, GD, G, GB, B, KB) için; komşular ayrışır. Araçların
// risk renklerinden (yeşil, sarı, turuncu, kırmızı) ve üs renginden kaçınır.
const ZONE_PALETTE = ['#f2f2f2', '#3fd7e6', '#ff6fbf', '#6f8cff', '#b58a64', '#c79bff', '#4aa8ff', '#e8a6ff'];
const ZONE_LABELS = {
  'Kuzey Yolu': 'Kuzey Yolu',
  'Kuzeydogu Kavsagi': 'Kuzeydoğu Kavşağı',
  'Dogu Yolu': 'Doğu Yolu',
  'Guneydogu Yerlesimi': 'Güneydoğu Yerleşimi',
  'Guney Kapisi Yaklasimi': 'Güney Kapısı Yaklaşımı',
  'Guneybati Yolu': 'Güneybatı Yolu',
  'Bati Yerlesimi': 'Batı Yerleşimi',
  'Kuzeybati Yolu': 'Kuzeybatı Yolu',
};
const BOUNDARY_COLOR = '#d6ce9d';
const SAMPLE_STEP = 0.5; // sahne birimi (50 m); kesikli çizgi araziyi bu aralıkla izler
const LIFT = 0.12;
// Bölgenin rengi yalnızca merkez işaretinde; kuş bakışında seçilebilecek boyutta.
const MARKER_SIZE = 1.1;

export const ZONE_LEGEND = ZONES.map((zone, index) => ({
  name: zone.name,
  label: ZONE_LABELS[zone.name] ?? zone.name,
  color: ZONE_PALETTE[index % ZONE_PALETTE.length],
}));

function groundY(terrain, x, z) {
  return (sampleTerrainHeight(terrain, x, z) ?? 0) + LIFT;
}

/** Sınır parçasını arazi yüzeyine oturan noktalara böler. */
function drape(terrain, [x1, z1], [x2, z2]) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / SAMPLE_STEP));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps, x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
    return [x, groundY(terrain, x, z), z];
  });
}

export default function ZoneLayer({ terrain }) {
  const zones = useMemo(() => ZONES.map((zone, index) => {
    const [x, , z] = zone.position;
    return { ...zone, ...ZONE_LEGEND[index], center: [x, groundY(terrain, x, z), z] };
  }), [terrain]);
  // Merkezler üs çevresindeki açıya göre sıralanıp komşular birleştirilir: kapalı çokgen.
  const outline = useMemo(() => {
    const ring = [...ZONES].sort((first, second) => Math.atan2(first.position[2], first.position[0])
      - Math.atan2(second.position[2], second.position[0]));
    return ring.map((zone, index) => {
      const next = ring[(index + 1) % ring.length];
      return {
        key: `${zone.name}-${next.name}`,
        points: drape(terrain, [zone.position[0], zone.position[2]], [next.position[0], next.position[2]]),
      };
    });
  }, [terrain]);
  return <>
    {outline.map((edge) => (
      <Line key={edge.key} points={edge.points} color={BOUNDARY_COLOR} lineWidth={1.3}
        dashed dashSize={1.2} gapSize={0.8} transparent opacity={0.75} />
    ))}
    {zones.map((zone) => (
      <mesh key={zone.name} position={[zone.center[0], zone.center[1] + MARKER_SIZE, zone.center[2]]} rotation={[0, Math.PI / 4, 0]}>
        <octahedronGeometry args={[MARKER_SIZE]} />
        <meshBasicMaterial color={zone.color} transparent opacity={0.9} />
      </mesh>
    ))}
  </>;
}
