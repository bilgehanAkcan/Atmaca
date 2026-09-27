// BaseGuard backend istemcisi. API anahtarları backend'de kalır; renderer yalnızca
// yerel HTTP uçlarını çağırır.
export const API_BASE = (import.meta.env?.VITE_API_BASE ?? 'http://127.0.0.1:8000').replace(/\/$/, '');

export const RISK_COLORS = {
  DUSUK: '#9bbb69',
  ORTA: '#d3b55a',
  YUKSEK: '#e0523c',
  BELIRSIZ: '#a9b394',
};

export const RISK_LABELS = {
  DUSUK: 'DÜŞÜK', ORTA: 'ORTA', YUKSEK: 'YÜKSEK', BELIRSIZ: 'BELİRSİZ',
};

export const TOOL_LABELS = {
  get_image_context: 'Görüntü bağlamı',
  detect_vehicles: 'Araç tespiti',
  pixel_to_geo: 'Konum dönüşümü',
  match_tracks: 'Hareket kaydı eşleme',
  analyze_track: 'Hareket analizi',
  search_reports: 'Saha raporları',
  compute_risk: 'Risk hesabı',
  inspect_crop: 'Görsel inceleme',
  find_vehicles: 'Haritada araç arama',
  show_vehicle: 'Aracı haritada gösterme',
};

async function getJson(path, signal) {
  const response = await fetch(`${API_BASE}${path}`, { signal });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

// Haritadaki araç rengi, kural puanından gelen risk seviyesidir (0-1 / 2-3 / 4+).
export const VEHICLE_LEVELS = ['DUSUK', 'ORTA', 'YUKSEK'];
export const VEHICLE_LEVEL_COLORS = { DUSUK: '#39ff88', ORTA: '#ffe14d', YUKSEK: '#ff3355' };

/** Hareket kaydı olmayan (takipsiz) araç puanı 0 olsa da en az ORTA gösterilir. */
export function vehicleLevel(vehicle) {
  const level = VEHICLE_LEVEL_COLORS[vehicle?.risk_level] ? vehicle.risk_level : 'DUSUK';
  return vehicle?.kind === 'static' && level === 'DUSUK' ? 'ORTA' : level;
}

export const vehicleColor = (vehicle) => VEHICLE_LEVEL_COLORS[vehicleLevel(vehicle)];

async function postJson(path, body, signal) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

export const getClock = (signal) => getJson('/api/clock', signal);
export const postClock = (change, signal) => postJson('/api/clock', change, signal);
export const getScene = (until, signal) => getJson(`/api/scene?until=${encodeURIComponent(until)}`, signal);
export const listImages = (signal) => getJson('/api/images', signal);
export const getDetections = (imageId, signal) => getJson(`/api/images/${encodeURIComponent(imageId)}/detections`, signal);
export const imageUrl = (imageId) => `${API_BASE}/api/images/${encodeURIComponent(imageId)}/file`;

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Ham görüntü baytlarını yükler; backend JPEG olarak saklayıp `upl_…` kimliği döndürür. */
export async function uploadImage(file, signal) {
  const response = await fetch(`${API_BASE}/api/uploads?name=${encodeURIComponent(file.name ?? '')}`, {
    method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file, signal,
  });
  if (!response.ok) {
    let detail = `${response.status}`;
    try { detail = (await response.json()).detail ?? detail; } catch { /* body is not JSON */ }
    throw new Error(detail);
  }
  return response.json();
}

/** Splits buffered SSE text into complete events; returns the unfinished tail. */
export function parseSse(buffer) {
  const events = [];
  const blocks = buffer.split('\n\n');
  const rest = blocks.pop();
  for (const block of blocks) {
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) data.push(line.slice(6));
    }
    if (data.length) events.push({ event, data: JSON.parse(data.join('\n')) });
  }
  return { events, rest };
}

/** Streams one agent turn; onEvent receives { event, data } for every step. */
export async function streamChat({ message, sessionId, imageId, simTime, onEvent, signal }) {
  const response = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: sessionId ?? null, image_id: imageId ?? null, sim_time: simTime ?? null }),
    signal,
  });
  if (!response.ok || !response.body) {
    let detail = `${response.status}`;
    try { detail = (await response.json()).detail ?? detail; } catch { /* body is not JSON */ }
    throw new Error(detail);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const parsed = parseSse(buffer + value);
    buffer = parsed.rest;
    parsed.events.forEach(onEvent);
  }
}
