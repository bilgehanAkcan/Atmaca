import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, Line, PerspectiveCamera } from '@react-three/drei';
import { useReducedMotion } from 'framer-motion';
import { Color, DoubleSide, NormalBlending, Vector3 } from 'three';
import CameraRig from './CameraRig.jsx';
import { fetchTerrain } from './lib/fetchTerrain.js';
import { applyTerrainToGeometry } from './lib/terrainGeometry.js';
import { DRAG_TOLERANCE_PX } from './lib/mapInput.js';
import { TERRAIN_SIZE } from './lib/terrain.js';
import { projectLatLon } from './data/locations.js';
import { vehicleStore } from './store/vehicleStore.js';
import TrafficLayer from './three/TrafficLayer.jsx';
import ZoneLayer, { ZONE_LEGEND } from './three/ZoneLayer.jsx';

const NOOP = () => {};
const REFERENCE_RINGS = [20, 40, 60, 80].map((radius) => Array.from({ length: 97 }, (_, i) => {
  const angle = i / 96 * Math.PI * 2;
  return [Math.cos(angle) * radius, 0.02, Math.sin(angle) * radius];
}));

const VERTEX_SHADER = `
  varying vec2 vGround;
  void main() {
    vGround = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uRadius;
  varying vec2 vGround;
  void main() {
    float radius = length(vGround);
    float edgeFade = pow(max(0.0, 1.0 - radius / uRadius), 0.65);
    float alpha = edgeFade * 0.3;
    if (alpha < 0.008) discard;
    gl_FragColor = vec4(uColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
// A continuous band on the DEM surface, independent of sparse wireframe edges.
// Terrain edge fading must not multiply the radar's own falloff a second time.
const RADAR_FRAGMENT_SHADER = `
  uniform vec3 uPulseColor;
  uniform float uTime;
  uniform float uRadius;
  uniform float uMotion;
  varying vec2 vGround;
  void main() {
    float radius = length(vGround);
    float progress = mix(0.42, fract(uTime / 8.0), uMotion);
    float waveRadius = progress * uRadius;
    float delta = radius - waveRadius;
    float core = 1.0 - smoothstep(0.25, 0.9, abs(delta));
    float trail = (1.0 - smoothstep(0.0, 2.8, -delta)) * step(delta, 0.0);
    float envelope = (1.0 - 0.6 * progress) * (1.0 - smoothstep(0.85, 1.0, progress));
    float alpha = (core * 0.72 + trail * 0.14) * envelope;
    if (radius > uRadius || alpha < 0.008) discard;
    gl_FragColor = vec4(uPulseColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function useTerrain(retry) {
  const [state, setState] = useState({ status: 'loading', terrain: null, error: null });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ status: 'loading', terrain: null, error: null });
    const timeout = setTimeout(() => controller.abort(new DOMException('Arazi verisi zaman aşımına uğradı.', 'TimeoutError')), 20000);
    fetchTerrain(controller.signal).then((terrain) => {
      if (active) setState({ status: 'ready', terrain, error: null });
    }).catch((error) => {
      if (active) {
        setState({ status: 'error', terrain: null, error: error.message || 'Arazi verisi alınamadı.' });
        controller.abort(); // Stop sibling tile requests on the first failure.
      }
    }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [retry]);
  return state;
}

function TerrainLayer({ terrain, uniforms, pulse = false }) {
  const geometry = useRef(null);
  useLayoutEffect(() => {
    applyTerrainToGeometry(geometry.current, terrain);
  }, [terrain]);
  return (
    <mesh renderOrder={pulse ? 1 : 0}>
      <planeGeometry ref={geometry} args={[terrain.size, terrain.size, terrain.segments, terrain.segments]} />
      <shaderMaterial uniforms={uniforms} vertexShader={VERTEX_SHADER}
        fragmentShader={pulse ? RADAR_FRAGMENT_SHADER : FRAGMENT_SHADER}
        wireframe={!pulse} transparent depthWrite={false} side={DoubleSide}
        polygonOffset={pulse} polygonOffsetFactor={-1} polygonOffsetUnits={-1}
        blending={NormalBlending} toneMapped={false} />
    </mesh>
  );
}

function HolographicTerrain({ terrain, reducedMotion }) {
  const uniforms = useMemo(() => ({
    uTime: { value: 0 }, uColor: { value: new Color('#343d2d') },
    uPulseColor: { value: new Color('#c9b56f') },
    uRadius: { value: terrain.size / 2 }, uMotion: { value: reducedMotion ? 0 : 1 },
  }), [terrain.size, reducedMotion]);
  useFrame(({ clock }) => { uniforms.uTime.value = clock.elapsedTime; });
  return <>
    <TerrainLayer terrain={terrain} uniforms={uniforms} />
    <TerrainLayer terrain={terrain} uniforms={uniforms} pulse />
  </>;
}

function ReferenceGrid({ terrain }) {
  // Place the reference plane below the lowest elevation; never cut through hills.
  const floor = useMemo(() => terrain
    ? terrain.heights.reduce((lowest, height) => Math.min(lowest, height), 0) - 0.5
    : -0.5, [terrain]);
  return (
    <group position={[0, floor, 0]}>
      <gridHelper args={[TERRAIN_SIZE * 1.6, Math.round(TERRAIN_SIZE * 1.6 / 5), '#4d5b3d', '#303927']}
        material-transparent material-opacity={0.3} material-depthWrite={false} />
      {REFERENCE_RINGS.map((points, index) => <Line key={index} points={points}
        color="#424d34" transparent opacity={0.14} dashed dashSize={0.5} gapSize={0.7} />)}
    </group>
  );
}

// Araca yakın dalış (~450 m); 3D modeller bu mesafede okunur.
const VEHICLE_VIEW_OFFSET = [2, 2.6, 3.2];
// Bakış noktasını ekran-sağına kaydırır; araç, sağdaki optik gözlem panelinin solunda kalır.
const PANEL_SHIFT = [0.62, 0, -0.39];
// Özet kartı adımı: iz + aracın güncel konumu kuş bakışı kadrajlanır (38° FOV).
const FRAME_MIN_EXTENT = 12; // ~1,2 km; kısa izler aşırı yakınlaşmaz
const FRAME_PADDING = 1.6;
const FRAME_TILT = 0.15; // kuş bakışındaki hafif eğim (home ile aynı yön)
const FRAME_CARD_SHIFT = 0.12; // bakışı kuzeye kaydırır; iz, üstteki kartın altında kalır
const FLIGHT_PHASES = ['framing', 'diving', 'backing', 'returning'];

function trailFrame(id, state, size) {
  const points = vehicleStore.getState().vehicles[id]?.points ?? [];
  let minX = state.x, maxX = state.x, minZ = state.z, maxZ = state.z;
  for (const [, lat, lon] of points) {
    const [x, , z] = projectLatLon(lat, lon);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const extent = Math.max(maxX - minX, maxZ - minZ, FRAME_MIN_EXTENT);
  const aspect = size.width / Math.max(size.height, 1);
  const height = Math.min(TERRAIN_SIZE * 1.5,
    extent / 2 * FRAME_PADDING / Math.tan(19 * Math.PI / 180) / Math.max(0.1, Math.min(1, aspect)));
  return {
    look: [(minX + maxX) / 2, state.y, (minZ + maxZ) / 2 - extent * FRAME_CARD_SHIFT],
    offset: [0, height, height * FRAME_TILT],
  };
}

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 6;
const ZOOM_STEP = 1.25;
const WHEEL_STEP = 1.1;
export const clampZoom = (value) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));

function Scene({ terrain, phase, target, onSelect, onArrived, reducedMotion, zoom, showZones, pan, viewReset }) {
  // id → { x, y, z }: araçların yumuşatılmış gerçek konumu (TrafficLayer yazar, kamera okur).
  const displayRef = useRef(new Map());
  const followPoint = useRef(new Vector3());
  const zoomScale = useRef(1);
  const size = useThree((three) => three.size);
  const pick = useCallback((id) => {
    const state = displayRef.current.get(id);
    if (!state) return;
    onSelect({ id, name: id, position: [state.x + PANEL_SHIFT[0], state.y, state.z + PANEL_SHIFT[2]], viewOffset: VEHICLE_VIEW_OFFSET, frame: trailFrame(id, state, size) });
  }, [onSelect, size]);
  // Agent'ın seçim istekleri (show_vehicle) aynı tıklama yolundan geçer.
  const pickRef = useRef(pick);
  pickRef.current = pick;
  useEffect(() => vehicleStore.subscribe((state, previous) => {
    if (state.pickRequest && state.pickRequest !== previous.pickRequest) pickRef.current(state.pickRequest.id);
  }), []);
  const follow = useCallback(() => {
    const state = target && displayRef.current.get(target.id);
    return state ? followPoint.current.set(state.x + PANEL_SHIFT[0], state.y, state.z + PANEL_SHIFT[2]) : null;
  }, [target]);
  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 140, 12]} fov={38} near={0.1} far={900} />
      <color attach="background" args={['#11160f']} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[40, 90, 30]} intensity={0.8} />
      <CameraRig phase={phase} zone={target} onArrived={onArrived} reducedMotion={reducedMotion} follow={follow} zoom={zoom} pan={pan} viewReset={viewReset} zoomScale={zoomScale} />
      <ReferenceGrid terrain={terrain} />
      {terrain && <>
        <HolographicTerrain terrain={terrain} reducedMotion={reducedMotion} />
        {showZones && <ZoneLayer terrain={terrain} />}
        <TrafficLayer terrain={terrain} reducedMotion={reducedMotion} displayRef={displayRef} zoomScale={zoomScale}
          enabled={phase === 'overview' || phase === 'preview' || phase === 'focused'} onPick={pick} />
        <group position={[0, 0, 0]}>
          <mesh position={[0, 0.6, 0]}><boxGeometry args={[0.7, 1.2, 0.7]} /><meshBasicMaterial color="#d6ce9d" /></mesh>
          <Html center position={[0, 3.5, 0]} zIndexRange={[15, 0]} style={{ pointerEvents: 'none' }}>
            <div className="base-label"><span>HQ / 00</span>MERKEZ ÜS</div>
          </Html>
        </group>
      </>}
    </>
  );
}

class MapErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className="webgl-fallback">3D sahne başlatılamadı. Donanım hızlandırmayı kontrol edip uygulamayı yeniden açın.</div> : this.props.children;
  }
}

/** Includes Canvas. Parent must have an explicit height. Vehicles come from vehicleStore
 * (fed by the sim store's time-filtered /api/scene); onSelect receives a vehicle target.
 * Existing App owns dive/panel transitions.
 */
export default function TacticalRadarMap({
  phase = 'overview', target = null,
  onSelect = NOOP, onArrived = NOOP, onTerrainStatus = NOOP, reducedMotion: motionPreference,
}) {
  const prefersReducedMotion = useReducedMotion();
  const reducedMotion = motionPreference ?? prefersReducedMotion;
  const [retry, setRetry] = useState(0);
  const state = useTerrain(retry);
  const retryFetch = useCallback(() => setRetry((value) => value + 1), []);
  useEffect(() => { onTerrainStatus(state.status); }, [state.status, onTerrainStatus]);
  const [zoom, setZoom] = useState(1);
  const [showZones, setShowZones] = useState(true);
  const zoomBy = useCallback((factor) => setZoom((value) => clampZoom(value * factor)), []);
  // Dalış ve dönüş kendi kadrajıyla başlar.
  useEffect(() => { if (FLIGHT_PHASES.includes(phase)) setZoom(1); }, [phase]);
  const onWheel = useCallback((event) => {
    if (event.deltaY) zoomBy(event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP);
  }, [zoomBy]);
  const flying = FLIGHT_PHASES.includes(phase);
  // Sürükleme pikselleri kameraya ref ile akar; her pointermove'da yeniden render olmaz.
  const pan = useRef({ dx: 0, dy: 0 });
  const [dragging, setDragging] = useState(false);
  const [viewReset, setViewReset] = useState(0);
  const resetView = useCallback(() => { setZoom(1); setViewReset((value) => value + 1); }, []);
  const onPointerDown = useCallback((event) => {
    if (flying || event.button !== 0 || event.target.tagName !== 'CANVAS') return;
    let last = { x: event.clientX, y: event.clientY };
    let moved = 0;
    const onMove = (move) => {
      const dx = move.clientX - last.x, dy = move.clientY - last.y;
      last = { x: move.clientX, y: move.clientY };
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved < DRAG_TOLERANCE_PX) return;
      pan.current.dx += dx;
      pan.current.dy += dy;
      setDragging(true);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDragging(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [flying]);
  return (
    <div className={`tactical-radar-map ${dragging ? 'dragging' : ''}`} onWheel={flying ? undefined : onWheel} onPointerDown={onPointerDown}>
      <MapErrorBoundary>
        <Canvas dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: 'high-performance' }}
          fallback={<div className="webgl-fallback">Bu ortam WebGL desteklemiyor.</div>}>
          <Scene {...{ phase, target, onSelect, onArrived, reducedMotion, zoom, showZones, pan, viewReset }} terrain={state.terrain} />
        </Canvas>
      </MapErrorBoundary>
      <div className={`zone-legend ${showZones ? '' : 'collapsed'}`}>
        <button onClick={() => setShowZones((value) => !value)} aria-pressed={showZones}
          title="Bölge merkezleri üs çevresinde kesikli çizgiyle birleştirilir">
          <span className="zone-legend-title">BÖLGELER</span><span>{showZones ? 'GİZLE' : 'GÖSTER'}</span>
        </button>
        {showZones && <ul>{ZONE_LEGEND.map((zone) => <li key={zone.name}><i style={{ '--zone': zone.color }} />{zone.label}</li>)}</ul>}
      </div>
      <div className="map-zoom" role="group" aria-label="Harita yakınlaştırma">
        <button onClick={() => zoomBy(ZOOM_STEP)} disabled={flying || zoom >= ZOOM_MAX} aria-label="Yakınlaştır" title="Yakınlaştır (fare tekerleği)">+</button>
        <button className="map-zoom-level" onClick={resetView} disabled={flying} aria-label="Görünümü sıfırla" title="Varsayılan görünüm: yakınlaştırmayı ve kaydırmayı sıfırlar">{zoom.toFixed(1)}×</button>
        <button onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={flying || zoom <= ZOOM_MIN} aria-label="Uzaklaştır" title="Uzaklaştır (fare tekerleği)">−</button>
      </div>
      <div className={`terrain-status terrain-${state.status}`} role="status">
        {state.status === 'error' && <><span>{state.error} Arazi yüklenemedi.</span><button onClick={retryFetch}>Yeniden dene</button></>}
      </div>
      <details className="terrain-attribution"><summary>Arazi verisi: Mapzen / Tilezen · Kaynaklar</summary>
        <p>USGS SRTM / GMTED2010; AB tarafından finanse edilen Copernicus EU-DEM katmanları; NOAA ETOPO1. AWS Open Data üzerinden sunulur. Yeniden örneklenmiş yükseklik modeli; canlı sensör ölçümü değildir.</p>
      </details>
    </div>
  );
}
