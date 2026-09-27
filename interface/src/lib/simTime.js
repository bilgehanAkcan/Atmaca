// Simülasyon saati yardımcıları. Backend `baseguard.sim.clock` ile aynı formül:
// dakika = çapa + (geçen gerçek saniye × hız / 60), gün sonunda durur.
export const DAY_START = 8 * 60;
export const DAY_END = 16 * 60;
export const DEFAULT_RATES = [1, 10, 60, 300];

export function toMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? '');
  if (!match) throw new RangeError(`Geçersiz saat: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function toHHMM(minute) {
  const whole = Math.floor(minute);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

/** anchor: { minute, running, rate, at (ms, performance.now) } */
export function extrapolate(anchor, nowMs, end = DAY_END) {
  if (!anchor.running) return anchor.minute;
  return Math.min(anchor.minute + ((nowMs - anchor.at) / 1000) * anchor.rate / 60, end);
}

/** Yalnızca `until` saatine eşit veya daha eski kayıtlar işlenir. */
export const isVisibleAt = (hhmm, until) => toMinutes(hhmm) <= toMinutes(until);

export function formatAge(minutes) {
  if (minutes == null) return '—';
  if (minutes < 60) return `${minutes} dk önce`;
  return `${Math.floor(minutes / 60)} sa ${minutes % 60} dk önce`;
}
