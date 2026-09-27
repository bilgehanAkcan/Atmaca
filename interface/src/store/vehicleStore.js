import { createStore, useStore } from 'zustand';

/**
 * Araç durumu: /api/scene'den gelen varlıklar, anlık konumlar ve üzerine yazmalar.
 *
 * - `vehicles`: id → backend varlığı (iz noktaları ≤ sanal saat, tespitler, kategori).
 * - `positions`: id → { lat, lon, heading_deg, time, source }. Her sahne yüklemesinde
 *   izin son noktasından güncellenir; harita yalnızca buradan okur.
 * - `overrides`: id → kısmi alanlar (lat, lon, heading_deg, category, cls, hidden).
 *   İleride agent'ın araçları manipüle etmesi için; yeni CSV verisi bunları ezmez.
 */
function positionOf(entity, override) {
  const [time, lat, lon] = entity.points.at(-1);
  if (override && (override.lat != null || override.lon != null)) {
    return { lat: override.lat ?? lat, lon: override.lon ?? lon, heading_deg: override.heading_deg ?? entity.heading_deg, time, source: 'override' };
  }
  return { lat, lon, heading_deg: override?.heading_deg ?? entity.heading_deg, time, source: 'track' };
}

const samePosition = (a, b) => a && b && a.lat === b.lat && a.lon === b.lon && a.heading_deg === b.heading_deg && a.source === b.source;

// Değişmeyen konumların nesne kimliği korunur; aboneler gereksiz yere yeniden çizmez.
function recompute(vehicles, overrides, previous) {
  const positions = {};
  for (const [id, entity] of Object.entries(vehicles)) {
    const next = positionOf(entity, overrides[id]);
    positions[id] = samePosition(previous[id], next) ? previous[id] : next;
  }
  return positions;
}

export function createVehicleStore() {
  return createStore((set, get) => ({
    vehicles: {},
    ids: [],
    positions: {},
    overrides: {},
    selectedId: null,
    until: null,

    ingest(scene) {
      if (!Array.isArray(scene?.vehicles)) return;
      const vehicles = Object.fromEntries(scene.vehicles.map((entity) => [entity.id, entity]));
      const ids = scene.vehicles.map((entity) => entity.id);
      const previousIds = get().ids;
      const sameIds = ids.length === previousIds.length && ids.every((id, index) => id === previousIds[index]);
      set({
        vehicles,
        ids: sameIds ? previousIds : ids,
        positions: recompute(vehicles, get().overrides, get().positions),
        until: scene.until,
      });
    },
    setOverride(id, patch) {
      const overrides = { ...get().overrides, [id]: { ...get().overrides[id], ...patch } };
      set({ overrides, positions: recompute(get().vehicles, overrides, get().positions) });
    },
    clearOverride(id) {
      const { [id]: _removed, ...overrides } = get().overrides;
      set({ overrides, positions: recompute(get().vehicles, overrides, get().positions) });
    },
    clearOverrides() {
      set({ overrides: {}, positions: recompute(get().vehicles, {}, get().positions) });
    },
    select(id) { set({ selectedId: id }); },
    // Agent'ın show_vehicle aracı: harita bunu fareyle tıklama gibi işler. Her istek
    // yeni bir nesnedir; aynı araç art arda istense de tekrar seçilir.
    pickRequest: null,
    requestPick(id) { if (id) set({ pickRequest: { id } }); },
  }));
}

/** Backend varlığı + üzerine yazma; seçili araç paneli ve tooltip bunu kullanır. */
export function resolveVehicle(state, id) {
  const entity = state.vehicles[id];
  if (!entity) return null;
  const override = state.overrides[id];
  return { ...entity, ...override, ...state.positions[id], overridden: Boolean(override) };
}

export const vehicleStore = createVehicleStore();
export const useVehicles = (selector) => useStore(vehicleStore, selector);