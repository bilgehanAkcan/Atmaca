import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import TacticalRadarMap from './TacticalRadarMap.jsx';
import Chatbot from './Chatbot.jsx';
import { LOCATION_DATA } from './data/locations.js';
import SimClockBar, { useSimClockDriver } from './SimClockBar.jsx';
import { RISK_LABELS, VEHICLE_LEVEL_COLORS, VEHICLE_LEVELS, getDetections, imageUrl, listImages, vehicleColor, vehicleLevel } from './lib/agentApi.js';
import { initialNavigation, navigationReducer } from './lib/navigation.js';
import { isVisibleAt } from './lib/simTime.js';
import { useVehicles, vehicleStore } from './store/vehicleStore.js';
import { CLASS_LABELS, STALE_MIN } from './three/VehicleIcon.jsx';

const PHASE_LABEL = {
  overview: 'KUŞ BAKIŞI', framing: 'ARAÇ İZİ AÇILIYOR', preview: 'ARAÇ İZİ · KUŞ BAKIŞI', diving: 'ARACA YAKLAŞILIYOR', focused: 'ARAÇ TAKİBİ',
  closing: 'PANEL KAPANIYOR', backing: 'ARAÇ İZİNE DÖNÜLÜYOR', leaving: 'KART KAPANIYOR', returning: 'MERKEZE DÖNÜLÜYOR',
};
// Bu fazlarda geri dönüş zaten sürüyor; kuş bakışı düğmesi beklemeye alınır.
const RESET_LOCKED = ['closing', 'backing', 'leaving', 'returning'];
const SPLASH_DURATION = 3000;
const APPROVAL_DURATION = 1000;
const SCREEN_VARIANTS = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

function SplashScreen({ reducedMotion }) {
  const [logoMissing, setLogoMissing] = useState(false);
  return (
    <section className="flex min-h-dvh flex-col items-center justify-center bg-[radial-gradient(ellipse_at_50%_38%,#3f4b2e_0%,#232d1c_42%,#10150e_100%)] px-8 text-center" aria-label="Sistem başlatılıyor">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reducedMotion ? 0 : 0.7 }}>
        {logoMissing ? (
          <div className="splash-logo-fallback" aria-label="Roketsan logosu yer tutucusu">ROKETSAN<span>LOGO / YER TUTUCU</span></div>
        ) : (
          <img src={`${import.meta.env.BASE_URL}roketsan.png`} alt="Roketsan" width="300" height="120"
            className="h-30 w-75 object-contain brightness-0 invert" onError={() => setLogoMissing(true)} />
        )}
      </motion.div>
      <p className="mt-12 font-mono text-xs tracking-[0.22em] text-ares-100" role="status"><span className="font-semibold text-leaf-400">ROKETSAN</span> SİSTEMİ BAŞLATILIYOR...</p>
      <div className="mt-6 h-px w-80 max-w-full overflow-hidden bg-ares-700" aria-hidden="true">
        <motion.div className="h-full w-full origin-left bg-gradient-to-r from-leaf-500 to-gold-400"
          initial={{ scaleX: reducedMotion ? 1 : 0 }} animate={{ scaleX: 1 }}
          transition={{ duration: reducedMotion ? 0 : SPLASH_DURATION / 1000, ease: 'linear' }} />
      </div>
    </section>
  );
}

function AuthPanel({ approved, onConnect, reducedMotion }) {
  const operatorInput = useRef(null);
  useEffect(() => { operatorInput.current?.focus({ preventScroll: true }); }, []);
  const inputClass = 'mt-3 w-full rounded-sm border border-ares-700 bg-ares-950/60 px-4 py-3.5 font-mono text-sm text-white outline-none transition duration-200 placeholder:text-ares-500 focus:border-leaf-600 focus:ring-2 focus:ring-leaf-600/35 focus:shadow-[0_0_24px_rgba(132,169,75,0.16)] disabled:opacity-50';
  return (
    <section className="auth-screen flex min-h-dvh items-center justify-center px-8 py-12" aria-labelledby="auth-title">
      <motion.div className="auth-card relative w-full max-w-md rounded-lg border border-ares-700 bg-ares-900/70 p-10 shadow-[0_25px_100px_rgba(0,0,0,0.65)] backdrop-blur-lg"
        initial={{ y: reducedMotion ? 0 : 18 }} animate={{ y: 0 }} transition={{ duration: reducedMotion ? 0 : 0.55 }}>
        <div className="mb-9 flex items-center justify-between font-mono text-[9px] tracking-[0.2em] text-ares-400">
          <span>ERİŞİM TERMİNALİ</span><span className="rounded-sm border border-leaf-900/60 px-2 py-1 text-gold-300">DEMO</span>
        </div>
        <div className="mb-6 flex h-11 w-11 items-center justify-center rounded border border-leaf-800/50 bg-leaf-950/30 text-leaf-500" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M12 3 20 6v5c0 5-5 9-8 10-3-1-8-5-8-10V6Z" /><path d="m8 12 3 3 5-6" /></svg>
        </div>
        <h1 id="auth-title" className="font-mono text-lg leading-8 tracking-[0.05em] text-white"><span className="block text-xs tracking-[0.12em] text-gold-300">ROKETSAN TAKTİK KOMUTA <span className="text-ares-500">|</span></span>YETKİLİ PERSONEL GİRİŞİ</h1>
        <p className="mt-3 text-xs leading-6 text-ares-400">Komuta kontrol arayüzüne erişmek için devam edin.</p>
        {/* Deliberately no required, pattern, minLength or credential checks. */}
        <form noValidate autoComplete="off" className="mt-8" onSubmit={(event) => { event.preventDefault(); onConnect(); }}>
          <label className="block font-mono text-[10px] tracking-[0.18em] text-ares-400" htmlFor="operator-id">OPERATÖR ID</label>
          <input ref={operatorInput} id="operator-id" name="demo-operator" type="text" autoComplete="off" spellCheck={false}
            placeholder="Operatör kimliğiniz" disabled={approved} className={inputClass} />
          <label className="mt-6 block font-mono text-[10px] tracking-[0.18em] text-ares-400" htmlFor="access-code">ERİŞİM KODU</label>
          <input id="access-code" name="demo-access-code" type="password" autoComplete="off"
            placeholder="Erişim kodunuz" disabled={approved} className={inputClass} />
          <button type="submit" disabled={approved}
            className="mt-8 flex w-full items-center justify-center gap-3 rounded-sm border border-leaf-700 bg-leaf-800 px-5 py-4 font-mono text-xs tracking-[0.18em] text-white hover:bg-leaf-700 focus-visible:ring-2 focus-visible:ring-leaf-600 disabled:cursor-default">
            SİSTEME BAĞLAN <span aria-hidden="true">→</span>
          </button>
          <div className="flex h-12 items-center justify-center" role="status" aria-live="polite" aria-atomic="true">
            {approved && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reducedMotion ? 0 : 0.15 }}
              className="font-mono text-xs tracking-[0.16em] text-white"><span className="text-gold-400">✓</span> ERİŞİM ONAYLANDI</motion.p>}
          </div>
        </form>
        <p className="border-t border-ares-700 pt-5 text-center font-mono text-[9px] leading-5 tracking-wide text-ares-400">DEMO GİRİŞİ · KİMLİK DOĞRULAMA YAPILMAZ</p>
      </motion.div>
    </section>
  );
}

export default function App() {
  const [appState, setAppState] = useState('splash');
  const [approved, setApproved] = useState(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (appState !== 'splash') return;
    const timer = setTimeout(() => setAppState('auth'), SPLASH_DURATION);
    return () => clearTimeout(timer);
  }, [appState]);

  useEffect(() => {
    if (appState !== 'auth' || !approved) return;
    const timer = setTimeout(() => setAppState('dashboard'), APPROVAL_DURATION);
    return () => clearTimeout(timer);
  }, [appState, approved]);

  return (
    <div className="min-h-dvh bg-ares-950">
      {/* Wait for the previous screen's exit before mounting the next one. */}
      <AnimatePresence mode="wait">
        <motion.div key={appState} variants={SCREEN_VARIANTS} initial="hidden" animate="visible" exit="exit"
          transition={{ duration: reducedMotion ? 0 : 0.45, ease: 'easeInOut' }}>
          {appState === 'splash' && <SplashScreen reducedMotion={reducedMotion} />}
          {appState === 'auth' && <AuthPanel approved={approved} onConnect={() => setApproved(true)} reducedMotion={reducedMotion} />}
          {appState === 'dashboard' && <Dashboard />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);
  return <time className="header-clock" dateTime={now.toISOString()}>{now.toLocaleTimeString('tr-TR', { timeZone: 'UTC' })}<span>UTC</span></time>;
}

function useDetections(imageId) {
  const [state, setState] = useState({ imageId: null, data: null, error: null });
  useEffect(() => {
    if (!imageId) return undefined;
    const controller = new AbortController();
    getDetections(imageId, controller.signal)
      .then((data) => setState({ imageId, data, error: null }))
      .catch((error) => { if (error.name !== 'AbortError') setState({ imageId, data: null, error: error.message }); });
    return () => controller.abort();
  }, [imageId]);
  return state.imageId === imageId ? state : { imageId, data: null, error: null };
}

/** Tüm tespitler soluk; seçili aracın kutusu kategori renginde, kalın ve etiketli. */
function DetectionOverlay({ detections, highlight, color }) {
  const { width_px: width, height_px: height } = detections;
  const minRadius = width * 0.022;
  return (
    <svg className="detection-overlay" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {detections.detections.map((item) => {
        const [x, y] = item.center_px;
        const [, , boxWidth, boxHeight] = item.bbox_xywh;
        const active = item.det_id === highlight;
        return (
          <g key={item.det_id} className={active ? 'det-active' : 'det-dim'} style={{ color: active ? color : '#a9b394' }}>
            {boxWidth > 0 && boxHeight > 0
              ? <rect x={x - boxWidth / 2} y={y - boxHeight / 2} width={boxWidth} height={boxHeight} />
              : <circle cx={x} cy={y} r={minRadius} />}
            {active && (
              <text x={boxWidth > 0 ? x - boxWidth / 2 : x + minRadius + 4} y={(boxHeight > 0 ? y - boxHeight / 2 : y - minRadius) - 6}>
                {item.det_id}{item.cls !== 'unknown' ? ` ${item.cls}${item.alt_cls ? `/${item.alt_cls}` : ''}` : ''}{item.track_id ? ` · ${item.track_id}` : ''}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

const REPORT_VERDICT_LABELS = { uyumlu: 'rapor uyumlu', celiskili: 'rapor çelişkili', ilgisiz: 'rapor ilgisiz', dogrulanamaz: 'rapor doğrulanamadı' };
const REPORT_VERDICT_COLORS = { uyumlu: '#39ff88', celiskili: '#ff3355', ilgisiz: '#a9b394', dogrulanamaz: '#a9b394' };

function vehicleTitle(vehicle) {
  return vehicle.kind === 'track' ? vehicle.id : `${vehicle.observations[0]?.det_id} · izsiz`;
}

/** Tıklamadan sonra kuş bakışı iz görünümünün üstünde sabit duran özet kartı. */
function VehicleSummary({ vehicle, onDetails, onReset, reducedMotion }) {
  const details = useRef(null);
  useEffect(() => { details.current?.focus({ preventScroll: true }); }, []);
  const level = vehicleLevel(vehicle);
  const color = vehicleColor(vehicle);
  const stale = vehicle.stale_min >= STALE_MIN;
  return (
    <motion.section className="vehicle-summary" role="region" aria-label={`${vehicleTitle(vehicle)} özet kartı`} style={{ '--neon': color }}
      initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
      transition={{ duration: reducedMotion ? 0 : 0.3 }}>
      <div className="summary-heading">
        <div><span className="eyebrow">ARAÇ İZİ / KUŞ BAKIŞI</span>
          <strong>{vehicleTitle(vehicle)} · {CLASS_LABELS[vehicle.cls] ?? vehicle.cls}</strong></div>
        <button className="icon-button" onClick={onReset} aria-label="Özet kartını kapat">×</button>
      </div>
      <div className="summary-body">
        <span>RİSK · {RISK_LABELS[level]} · {vehicle.score ?? 0} puan{vehicle.kind === 'static' ? ' · takipsiz' : ''}</span>
        <span>
          {vehicle.kind === 'track' ? `${vehicle.points[0][0]} → ${vehicle.last_time}` : `park · ${vehicle.last_time}`}
          {vehicle.speed_ms != null ? ` · ${vehicle.speed_ms.toFixed(1)} m/s` : ''} · üsse {(vehicle.dist_to_base_m / 1000).toFixed(2)} km
        </span>
        {stale && <em>sinyal yok · son konum {vehicle.stale_min} dk önce</em>}
        {vehicle.overridden && <em>konum/özellik üzerine yazıldı</em>}
        {vehicle.reasons.map((reason) => <em key={reason}>{reason}</em>)}
        <em>{vehicle.observations.length ? `${vehicle.observations.length} görüntüde tespit` : 'henüz görüntüde tespit yok'}</em>
      </div>
      <div className="summary-actions">
        <button ref={details} onClick={onDetails}>DETAYLAR <span aria-hidden="true">→</span></button>
      </div>
    </motion.section>
  );
}

function VehiclePanel({ vehicle, observation, image, onSelectImage, onAsk, onReset, reducedMotion }) {
  const close = useRef(null);
  useEffect(() => { close.current?.focus({ preventScroll: true }); }, []);
  const imageId = observation?.image_id ?? null;
  const detections = useDetections(imageId);
  const proxy = detections.data?.source === 'track_proxy';
  const level = vehicleLevel(vehicle);
  const color = vehicleColor(vehicle);
  const title = vehicleTitle(vehicle);
  const question = observation
    ? `${observation.image_id} görüntüsündeki ${observation.det_id}${vehicle.kind === 'track' ? ` (${vehicle.id})` : ''} aracını değerlendir: hareketi, üsse göre durumu ve ilgili saha raporları. Dikkat gerektiriyor mu?`
    : `${vehicle.id} hareket kaydını analiz et: hız, yön, üsse yaklaşma. Dikkat gerektiriyor mu?`;
  return (
    <motion.section className="image-panel" role="region" aria-label={`${title} araç paneli`}
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
      transition={{ duration: reducedMotion ? 0 : 0.3 }}>
      <div className="image-heading">
        <div><span className="eyebrow">ARAÇ TAKİBİ / {vehicle.kind === 'track' ? 'HAREKET KAYDI' : 'TESPİT'}</span>
          <h3>{title} <span className="vehicle-class" style={{ color }}>{CLASS_LABELS[vehicle.cls] ?? vehicle.cls}</span></h3></div>
        <button ref={close} className="icon-button" onClick={onReset} aria-label="Araç panelini kapat">×</button>
      </div>
      {vehicle.observations.length > 0 && (
        <div className="image-tabs" role="tablist" aria-label="Aracın tespit edildiği görüntüler">
          {vehicle.observations.map((item) => (
            <button key={item.image_id} role="tab" aria-selected={item.image_id === imageId} className={item.image_id === imageId ? 'active' : ''} onClick={() => onSelectImage(item.image_id)} title={`${item.image_id} · ${item.det_id}`}>
              {item.capture_time} · {item.det_id}
            </button>
          ))}
        </div>
      )}
      {observation && image ? (
        <div className="drone-frame" style={{ aspectRatio: `${image.width_px} / ${image.height_px}` }}>
          <img src={imageUrl(image.image_id)} alt={`${image.image_id} drone görüntüsü`} />
          {detections.data && <DetectionOverlay detections={detections.data} highlight={observation.det_id} color={color} />}
          <div className="feed-top"><span>EO / {image.image_id} · {observation.zone}</span><span className="risk-badge" style={{ '--risk': color }}>RİSK · {RISK_LABELS[level]}</span></div>
        </div>
      ) : (
        <div className="drone-placeholder"><div className="feed-empty"><span>⌁</span><strong>GÖRÜNTÜ YOK</strong>
          <p>{vehicle.kind === 'track' ? 'Bu araç sanal saate kadar hiçbir drone görüntüsünde tespit edilmedi; yalnızca hareket kaydı var.' : 'Görüntü bilgisi alınamadı.'}</p></div></div>
      )}
      <div className="feed-stats">
        <div><span>RİSK PUANI</span><strong style={{ color }}>{vehicle.score ?? 0} <small>{RISK_LABELS[level]}{vehicle.kind === 'static' ? ' · takipsiz' : ''}</small></strong></div>
        <div><span>MEDYAN HIZ</span><strong>{vehicle.speed_ms != null ? vehicle.speed_ms.toFixed(1) : '—'} <small>m/s</small></strong></div>
        <div><span>ÜSSE</span><strong>{(vehicle.dist_to_base_m / 1000).toFixed(2)} <small>km</small></strong></div>
        <div><span>İZ</span><strong className="small-value">{vehicle.points[0][0]}→{vehicle.last_time}</strong></div>
        <div><span>DURUM</span><strong className="small-value">{vehicle.stale_min >= STALE_MIN ? 'sinyal yok' : (vehicle.state ?? 'park')}</strong></div>
        <div><span>TESPİT</span><strong>{vehicle.observations.length} <small>görüntü</small></strong></div>
      </div>
      <ul className="vehicle-reasons">{vehicle.reasons.map((reason) => <li key={reason} style={{ '--neon': color }}>{reason}</li>)}
        {vehicle.overridden && <li style={{ '--neon': '#e1cb8c' }}>konum/özellik üzerine yazıldı</li>}
        {(vehicle.reports ?? []).map((report) => (
          <li key={report.report_id} style={{ '--neon': REPORT_VERDICT_COLORS[report.verdict] }}>
            {report.report_id} {report.time} · {REPORT_VERDICT_LABELS[report.verdict] ?? report.verdict} · {report.text}
          </li>
        ))}</ul>
      <div className="panel-actions">
        <button onClick={() => onAsk(question, imageId)}>AGENT İLE ANALİZ ET <span aria-hidden="true">→</span></button>
      </div>
      <div className="image-footer"><span className={`status-dot ${proxy || detections.error ? 'neutral' : ''}`} />
        {!observation ? 'Tespit yok · konum tracks.csv' : detections.error ? `Tespit alınamadı: ${detections.error}` : proxy ? 'Tespitler: track uç noktaları (model ağırlığı yok)' : detections.data ? 'Tespitler: Aşama 1 ensemble (2× YOLO11m, WBF)' : 'Tespitler yükleniyor…'}
      </div>
    </motion.section>
  );
}

function Dashboard() {
  const [navigation, dispatch] = useReducer(navigationReducer, initialNavigation);
  const [terrainStatus, setTerrainStatus] = useState('loading');
  const reducedMotion = useReducedMotion();
  const dashboardTitle = useRef(null);
  const { phase, target } = navigation;
  const [images, setImages] = useState([]);
  const [selectedImageId, setSelectedImageId] = useState(null);
  const [briefs, setBriefs] = useState({});
  const [chatRequest, setChatRequest] = useState(null);
  const simTime = useSimClockDriver();
  const vehicleCount = useVehicles((state) => state.ids.length);
  const entity = useVehicles((state) => (target ? state.vehicles[target.id] : null));
  const override = useVehicles((state) => (target ? state.overrides[target.id] : null));
  const vehicle = useMemo(() => (entity ? { ...entity, ...override, overridden: Boolean(override) } : null), [entity, override]);
  const captureTimes = useMemo(() => images.map((item) => item.capture_time), [images]);
  useEffect(() => {
    const controller = new AbortController();
    listImages(controller.signal).then(setImages).catch(() => setImages([]));
    return () => controller.abort();
  }, []);
  // Seçim tek kaynaktan: navigasyon → vehicleStore.selectedId (harita vurgusu bunu okur).
  useEffect(() => { vehicleStore.getState().select(phase === 'overview' ? null : target?.id ?? null); }, [phase, target]);
  // Araç seçilince en güncel tespiti açılır; saat geri alınıp tespit geleceğe düşerse
  // yine en güncele geçilir. Backend yalnızca sanal saate kadarki tespitleri gönderir.
  const observations = useMemo(() => vehicle?.observations ?? [], [vehicle]);
  useEffect(() => {
    if (phase === 'overview') setSelectedImageId(null);
    else if (!observations.some((item) => item.image_id === selectedImageId)) setSelectedImageId(observations.at(-1)?.image_id ?? null);
  }, [phase, observations, selectedImageId]);
  const observation = observations.find((item) => item.image_id === selectedImageId) ?? null;
  const selectedImage = useMemo(() => {
    const meta = images.find((item) => item.image_id === selectedImageId);
    return meta && isVisibleAt(meta.capture_time, simTime) ? { ...meta, brief: briefs[meta.image_id] } : null;
  }, [images, selectedImageId, simTime, briefs]);
  const onBrief = useCallback((imageId, brief) => setBriefs((previous) => ({ ...previous, [imageId]: brief })), []);
  const onAsk = useCallback((text, imageId) => setChatRequest({ id: crypto.randomUUID(), text, imageId }), []);
  const onSelect = useCallback((selected) => dispatch({ type: 'SELECT', target: selected }), []);
  const onArrived = useCallback(() => dispatch({ type: 'ARRIVED' }), []);
  const onDetails = useCallback(() => dispatch({ type: 'DETAILS' }), []);
  const onReset = useCallback(() => dispatch({ type: 'RESET' }), []);
  useEffect(() => { dashboardTitle.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onReset(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onReset]);
  const chatVehicle = vehicle && { id: vehicleTitle(vehicle), name: `${CLASS_LABELS[vehicle.cls] ?? vehicle.cls} · risk ${RISK_LABELS[vehicleLevel(vehicle)]}` };

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 ref={dashboardTitle} tabIndex={-1} className="sr-only">Komuta kontrol merkezi</h1>
        <div className="header-right"><span className="environment-tag"><i className="status-dot neutral" />SİMÜLASYON ORTAMI</span><Clock /><div className="operator-badge" title="Demo operatör">OP</div></div>
      </header>
      <main className="workspace">
        <section className="map-panel" aria-label="3D topolojik harita">
          <div className="map-toolbar"><div className="flex items-center gap-3"><span className="section-index">01</span><h2>Operasyon Sahası</h2><span className="toolbar-separator" /><span className="toolbar-subtitle">3D TOPOLOJİK GÖRÜNÜM · 20 × 20 KM</span></div><span className="map-mode">PERSPEKTİF / 3D</span></div>
          <SimClockBar captureTimes={captureTimes} />
          <div className="map-stage">
            <TacticalRadarMap onTerrainStatus={setTerrainStatus} phase={phase} target={target} onSelect={onSelect} onArrived={onArrived} reducedMotion={reducedMotion} />
            <div className="map-vignette" />
            <div className="map-top-left">
              {phase === 'overview' ? <div className="sector-label"><span className="eyebrow">SEKTÖR 001</span><strong>Merkez Üs Çevresi</strong><span>39°55′18.6″ N / 32°51′11.0″ E</span></div> : <button className="reset-button" onClick={onReset} disabled={RESET_LOCKED.includes(phase)}>↖ KUŞ BAKIŞI <kbd>ESC</kbd></button>}
            </div>
            <div className="compass" aria-label="Kuzey yönü"><span>K</span><div>↑</div><small>000°</small></div>
            <div className="map-bottom-left"><div className="legend">{VEHICLE_LEVELS.map((item) => <span key={item} title={item === 'ORTA' ? 'Hareket kaydı olmayan (takipsiz) araçlar da en az sarı gösterilir' : undefined}><i className="status-dot" style={{ background: VEHICLE_LEVEL_COLORS[item], boxShadow: `0 0 6px ${VEHICLE_LEVEL_COLORS[item]}` }} />{RISK_LABELS[item]}</span>)}<span><i className="status-dot stale" />Sinyal yok · son konum</span><span><i className="status-dot neutral" />Merkez üs</span></div><p>{terrainStatus === 'ready' ? `${vehicleCount} araç · konumlar tracks.csv, ${simTime} itibarıyla · Araca tıklayın` : 'Araçlar arazi yüklenince açılır'}</p></div>
            <div className="map-phase" role="status"><span className="status-dot" />{PHASE_LABEL[phase]}</div>
            <AnimatePresence onExitComplete={() => dispatch({ type: 'CARD_CLOSED' })}>
              {phase === 'preview' && vehicle && <VehicleSummary key={vehicle.id} vehicle={vehicle}
                onDetails={onDetails} onReset={onReset} reducedMotion={reducedMotion} />}
            </AnimatePresence>
            <AnimatePresence onExitComplete={() => dispatch({ type: 'PANEL_CLOSED' })}>
              {phase === 'focused' && vehicle && <VehiclePanel key={vehicle.id} vehicle={vehicle} observation={observation} image={selectedImage}
                onSelectImage={setSelectedImageId} onAsk={onAsk} onReset={onReset} reducedMotion={reducedMotion} />}
            </AnimatePresence>
          </div>
        </section>
        <Chatbot selectedVehicle={chatVehicle} selectedImage={selectedImage} request={chatRequest} onBrief={onBrief} simTime={simTime} />
      </main>
      <footer className="app-footer"><span><i className="status-dot" /><b>v0.2</b><em> / </em>HACKATHON PROTOTİPİ</span><span>WGS84 <em> / </em>REFERANS {LOCATION_DATA.base.lat} N, {LOCATION_DATA.base.lon} E</span><span>TELEMETRİ SİMÜLASYONU</span></footer>
    </div>
  );
}
