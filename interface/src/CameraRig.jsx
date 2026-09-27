import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { MathUtils, Vector3 } from 'three';
import { TERRAIN_SIZE } from './lib/terrain.js';

const DEFAULT_VIEW_OFFSET = [15, 15, 21];
const FOLLOW_RATE = 3; // 1/s
const ZOOM_RATE = 8; // 1/s
const HALF_TERRAIN = TERRAIN_SIZE / 2;
// Eğik bakışta dikey sürükleme zeminde daha uzun yol alır; çok yatık açıda sıçramayı sınırlar.
const MIN_ELEVATION_SIN = 0.3;
const FLIGHTS = ['framing', 'diving', 'backing', 'returning'];

/**
 * follow(): odakta izlenecek güncel hedef (Vector3) ya da null; kamera onunla birlikte kayar.
 * zoom: bakış noktasına uzaklığı 1/zoom ile ölçekler; dalış ve takip zoom 1'deki konum
 * (rig) üzerinde çalışır, gerçek kamera her karede ondan türetilir.
 * pan: haritanın biriktirdiği sürükleme pikselleri ({ dx, dy }); her karede tüketilir ve
 * zeminde kaydırmaya çevrilir. Odakta kaydırma, takip hedefine eklenen bir ofset olur.
 * viewReset: her değişiminde kaydırma sıfırlanır (kuş bakışında üs merkeze döner).
 * zoomScale: (opsiyonel ref) her karede yumuşatılmış 1/zoom değeri yazılır.
 */
export default function CameraRig({ phase, zone, onArrived, reducedMotion, follow, zoom = 1, pan, viewReset = 0, zoomScale }) {
  const { camera, size } = useThree();
  const lookAt = useRef(new Vector3());
  const rig = useRef(new Vector3());
  const scale = useRef(1 / zoom);
  const offset = useRef(new Vector3());
  const animation = useRef(null);
  const initialized = useRef(false);
  const followDelta = useRef(new Vector3());
  const panOffset = useRef(new Vector3());
  const panMove = useRef(new Vector3());
  const screenRight = useRef(new Vector3());
  const screenUp = useRef(new Vector3());
  const viewDirection = useRef(new Vector3());
  const followTarget = useRef(new Vector3());
  const home = useMemo(() => {
    // Fit the terrain radius with padding, including narrow viewports (38° FOV).
    const aspect = size.width / Math.max(size.height, 1);
    const height = (TERRAIN_SIZE / 2) * 1.08 / Math.tan(19 * Math.PI / 180)
      / Math.max(0.1, Math.min(1, aspect));
    return new Vector3(0, height, TERRAIN_SIZE * 0.12);
  }, [size.width, size.height]);

  useEffect(() => { panOffset.current.set(0, 0, 0); }, [phase]);
  useEffect(() => {
    if (!viewReset) return;
    panOffset.current.set(0, 0, 0);
    if (phase === 'overview') {
      rig.current.copy(home);
      lookAt.current.set(0, 0, 0);
    }
  }, [viewReset]); // Yalnızca açık sıfırlamada; faz değişimi yukarıda ele alınır.

  // Biriken sürükleme piksellerini, bakış noktası arazi içinde kalacak şekilde zeminde kaydırır.
  const applyPan = () => {
    const pending = pan?.current;
    if (!pending || (!pending.dx && !pending.dy)) return;
    const { dx, dy } = pending;
    pending.dx = 0; pending.dy = 0;
    const distance = camera.position.distanceTo(lookAt.current);
    const worldPerPixel = 2 * distance * Math.tan(MathUtils.degToRad(camera.fov / 2)) / Math.max(size.height, 1);
    camera.getWorldDirection(viewDirection.current);
    const verticalPerPixel = worldPerPixel / Math.max(MIN_ELEVATION_SIN, -viewDirection.current.y);
    screenRight.current.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    screenUp.current.setFromMatrixColumn(camera.matrixWorld, 1).setY(0).normalize();
    panMove.current.copy(screenRight.current).multiplyScalar(-dx * worldPerPixel)
      .addScaledVector(screenUp.current, dy * verticalPerPixel);
    const x = MathUtils.clamp(lookAt.current.x + panMove.current.x, -HALF_TERRAIN, HALF_TERRAIN);
    const z = MathUtils.clamp(lookAt.current.z + panMove.current.z, -HALF_TERRAIN, HALF_TERRAIN);
    panMove.current.set(x - lookAt.current.x, 0, z - lookAt.current.z);
    rig.current.add(panMove.current);
    lookAt.current.add(panMove.current);
    if (phase === 'focused') panOffset.current.add(panMove.current);
  };

  useEffect(() => {
    if (!initialized.current || phase === 'overview') {
      rig.current.copy(home);
      lookAt.current.set(0, 0, 0);
      initialized.current = true;
      animation.current = null;
      return;
    }
    if (!FLIGHTS.includes(phase)) {
      animation.current = null;
      return;
    }
    let target;
    let destination;
    if (phase === 'diving') {
      target = new Vector3(...zone.position);
      destination = target.clone().add(new Vector3(...(zone.viewOffset ?? DEFAULT_VIEW_OFFSET)));
    } else if (phase === 'returning' || !zone.frame) {
      target = new Vector3();
      destination = home.clone();
    } else {
      // framing / backing: aracın izinin kuş bakışı kadrajı.
      target = new Vector3(...zone.frame.look);
      destination = target.clone().add(new Vector3(...zone.frame.offset));
    }
    animation.current = {
      elapsed: 0,
      duration: reducedMotion ? 0.01 : 2.2,
      from: rig.current.clone(),
      fromLook: lookAt.current.clone(),
      destination,
      target,
    };
    return () => { animation.current = null; };
  }, [camera, home, phase, zone, reducedMotion]);

  useFrame((_state, delta) => {
    const wanted = 1 / zoom;
    scale.current = reducedMotion ? wanted : scale.current + (wanted - scale.current) * (1 - Math.exp(-delta * ZOOM_RATE));
    if (zoomScale) zoomScale.current = scale.current; // araç ölçeği yumuşatılmış zoom'u izler
    const flight = animation.current;
    if (flight) {
      flight.elapsed += delta;
      const t = Math.min(flight.elapsed / flight.duration, 1);
      const smooth = t * t * t * (t * (t * 6 - 15) + 10);
      rig.current.lerpVectors(flight.from, flight.destination, smooth);
      lookAt.current.lerpVectors(flight.fromLook, flight.target, smooth);
      if (t === 1) {
        animation.current = null;
        onArrived(); // Panel, gerçek kamera animasyonunun bitişiyle açılır.
      }
    } else {
      if (phase === 'overview' || phase === 'preview' || phase === 'focused') applyPan();
      const followed = phase === 'focused' && follow ? follow() : null;
      const target = followed ? followTarget.current.copy(followed).add(panOffset.current) : null;
      if (target) {
        const step = reducedMotion ? 1 : 1 - Math.exp(-delta * FOLLOW_RATE);
        followDelta.current.subVectors(target, lookAt.current).multiplyScalar(step);
        rig.current.add(followDelta.current);
        lookAt.current.add(followDelta.current);
      }
    }
    offset.current.subVectors(rig.current, lookAt.current).multiplyScalar(scale.current);
    camera.position.copy(lookAt.current).add(offset.current);
    camera.lookAt(lookAt.current);
  });
  return null;
}
