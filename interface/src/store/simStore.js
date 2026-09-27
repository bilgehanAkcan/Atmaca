import { createStore, useStore } from 'zustand';
import { getClock, getScene, postClock } from '../lib/agentApi.js';
import { DAY_END, DAY_START, DEFAULT_RATES, extrapolate, toHHMM, toMinutes } from '../lib/simTime.js';
import { vehicleStore } from './vehicleStore.js';

const DEFAULT_API = { getClock, postClock, getScene };
const wallClock = () => globalThis.performance?.now() ?? Date.now();

/**
 * Simülasyon saati + zaman filtreli sahne.
 * Backend saati otoritedir (tüm istemciler aynı saati görür); istemci çapadan yerel
 * olarak ilerletir, değişiklikleri önce yerelde uygular (optimistic) sonra POST eder.
 * Backend yoksa saat yalnızca yerelde çalışır (`offline`).
 */
export function createSimStore({ api = DEFAULT_API, now = wallClock, onScene = () => {} } = {}) {
  let pendingWrites = 0;
  let sceneInFlight = false;
  let sceneQueued = null;

  return createStore((set, get) => {
    const commit = (anchor, extra = {}) => set({ anchor, minute: Math.floor(extrapolate(anchor, anchor.at)), ...extra });

    const change = async (patch) => {
      const at = now();
      const current = get().anchor;
      const anchor = { ...current, minute: extrapolate(current, at), at };
      if (patch.time !== undefined) anchor.minute = toMinutes(patch.time);
      if (patch.rate !== undefined) anchor.rate = patch.rate;
      if (patch.running !== undefined) {
        if (patch.running && anchor.minute >= DAY_END) anchor.minute = DAY_START;
        anchor.running = patch.running;
      }
      commit(anchor);
      if (get().offline) return;
      pendingWrites += 1;
      try {
        const snapshot = await api.postClock(patch);
        pendingWrites -= 1;
        get().applySnapshot(snapshot);
      } catch {
        pendingWrites -= 1;
        set({ offline: true });
      }
    };

    return {
      anchor: { minute: DAY_START, running: false, rate: 60, at: now() },
      minute: DAY_START,
      rates: DEFAULT_RATES,
      version: -1,
      synced: false,
      offline: false,
      scene: null,
      sceneStatus: 'idle',
      sceneError: null,

      applySnapshot(snapshot) {
        if (snapshot.version < get().version) return; // eski yanıt
        commit(
          { minute: snapshot.minute, running: snapshot.running, rate: snapshot.rate, at: now() },
          { version: snapshot.version, rates: snapshot.rates ?? DEFAULT_RATES, synced: true, offline: false },
        );
      },
      async sync() {
        try {
          const snapshot = await api.getClock();
          // Yolda bir değişiklik varken gelen okuma onu geri alamaz.
          if (pendingWrites === 0) get().applySnapshot(snapshot);
        } catch {
          set({ offline: true, synced: false });
        }
      },
      tick() {
        const { anchor, minute } = get();
        const value = extrapolate(anchor, now());
        if (anchor.running && value >= DAY_END) {
          commit({ minute: DAY_END, running: false, rate: anchor.rate, at: now() });
          return;
        }
        if (Math.floor(value) !== minute) set({ minute: Math.floor(value) });
      },
      play: () => change({ running: true }),
      pause: () => change({ running: false }),
      seek: (hhmm) => change({ time: hhmm }),
      setRate: (rate) => change({ rate }),

      /** Tek istek uçuşta; arada biriken saatlerden yalnızca sonuncusu istenir. */
      async loadScene(until) {
        if (sceneInFlight) { sceneQueued = until; return; }
        if (get().scene?.until === until) return;
        sceneInFlight = true;
        if (!get().scene) set({ sceneStatus: 'loading' });
        try {
          const scene = await api.getScene(until);
          set({ scene, sceneStatus: 'ready', sceneError: null });
          onScene(scene);
        } catch (error) {
          set({ sceneStatus: 'error', sceneError: error.message });
        } finally {
          sceneInFlight = false;
          const next = sceneQueued;
          sceneQueued = null;
          if (next && next !== until) get().loadScene(next);
        }
      },
    };
  });
}

// Her yeni sahne araç durumuna aktarılır; konumlar vehicleStore'da tutulur.
export const simStore = createSimStore({ onScene: (scene) => vehicleStore.getState().ingest(scene) });
export const useSim = (selector) => useStore(simStore, selector);
export const selectSimTime = (state) => toHHMM(state.minute);