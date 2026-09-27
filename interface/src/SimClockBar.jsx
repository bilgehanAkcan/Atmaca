import { useEffect, useMemo } from 'react';
import { selectSimTime, simStore, useSim } from './store/simStore.js';
import { DAY_END, DAY_START, toHHMM, toMinutes } from './lib/simTime.js';

const TICK_MS = 200;
const RESYNC_MS = 5000;
const RATE_LABELS = { 1: 'GERÇEK', 10: '×10', 60: '×60', 300: '×300' };

/** Saati yerelde ilerletir, backend ile senkronlar ve dakika değişince sahneyi ister. */
export function useSimClockDriver() {
  const simTime = useSim(selectSimTime);
  useEffect(() => {
    const { sync, tick } = simStore.getState();
    sync();
    const ticker = setInterval(tick, TICK_MS);
    const resync = setInterval(sync, RESYNC_MS);
    return () => { clearInterval(ticker); clearInterval(resync); };
  }, []);
  useEffect(() => { simStore.getState().loadScene(simTime); }, [simTime]);
  return simTime;
}

export default function SimClockBar({ captureTimes = [] }) {
  const simTime = useSim(selectSimTime);
  const minute = useSim((state) => state.minute);
  const running = useSim((state) => state.anchor.running);
  const rate = useSim((state) => state.anchor.rate);
  const rates = useSim((state) => state.rates);
  const offline = useSim((state) => state.offline);
  const scene = useSim((state) => state.scene);
  const { play, pause, seek, setRate } = simStore.getState();
  const ticks = useMemo(() => [...new Set(captureTimes)].map((time) => ({
    time, left: (toMinutes(time) - DAY_START) / (DAY_END - DAY_START) * 100,
  })), [captureTimes]);

  return (
    <div className="sim-clock" role="group" aria-label="Simülasyon saati">
      <button className="sim-play" onClick={running ? pause : play} aria-label={running ? 'Saati durdur' : 'Saati başlat'}>
        {running ? '❚❚' : '▶'}
      </button>
      <div className="sim-readout"><span className="eyebrow">SANAL SAAT</span><strong>{simTime}</strong></div>
      <div className="sim-track">
        <input type="range" min={DAY_START} max={DAY_END} step={1} value={minute}
          aria-label="Simülasyon saatini ayarla" aria-valuetext={simTime}
          onChange={(event) => seek(toHHMM(Number(event.target.value)))} />
        <div className="sim-ticks" aria-hidden="true">
          {ticks.map((tick) => <i key={tick.time} style={{ left: `${tick.left}%` }} className={toMinutes(tick.time) <= minute ? 'seen' : ''} title={tick.time} />)}
        </div>
        <div className="sim-scale" aria-hidden="true"><span>{toHHMM(DAY_START)}</span><span>12:00</span><span>{toHHMM(DAY_END)}</span></div>
      </div>
      <div className="sim-rates" role="radiogroup" aria-label="Saat hızı">
        {rates.map((value) => (
          <button key={value} role="radio" aria-checked={rate === value} className={rate === value ? 'active' : ''} onClick={() => setRate(value)}>
            {RATE_LABELS[value] ?? `×${value}`}
          </button>
        ))}
      </div>
      <div className="sim-counters">
        <span>ARAÇ <b>{scene?.vehicles ? scene.vehicles.length : '—'}</b></span>
        <span>GÖRÜNTÜ <b>{scene ? `${scene.images_visible}/${scene.images_total}` : '—'}</b></span>
        <span>RAPOR <b>{scene ? `${scene.reports_visible}/${scene.reports_total}` : '—'}</b></span>
        <span className="sim-sync"><i className={`status-dot ${offline ? 'neutral' : ''}`} />{offline ? 'YEREL SAAT' : 'SENKRON'}</span>
      </div>
    </div>
  );
}