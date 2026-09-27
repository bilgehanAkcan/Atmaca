import test from 'node:test';
import assert from 'node:assert/strict';
import { createVehicleStore, resolveVehicle } from '../src/store/vehicleStore.js';

const entity = (id, points, extra = {}) => ({ id, kind: 'track', cls: 'car', category: 1, heading_deg: 90, points, observations: [], ...extra });

test('Konumlar izin son noktasından güncellenir, değişmeyen konum kimliği korunur', () => {
  const store = createVehicleStore();
  store.getState().ingest({ until: '10:00', vehicles: [entity('T1', [['09:55', 39.9, 32.8], ['10:00', 39.91, 32.81]]), entity('T2', [['10:00', 39.8, 32.7]])] });
  const first = store.getState().positions;
  assert.deepEqual(first.T1, { lat: 39.91, lon: 32.81, heading_deg: 90, time: '10:00', source: 'track' });

  store.getState().ingest({ until: '10:05', vehicles: [entity('T1', [['10:00', 39.91, 32.81], ['10:05', 39.92, 32.82]]), entity('T2', [['10:00', 39.8, 32.7]])] });
  const second = store.getState().positions;
  assert.equal(second.T1.lat, 39.92);
  assert.equal(second.T2, first.T2);
});

test('Üzerine yazma yeni CSV verisinden sonra da korunur ve temizlenebilir', () => {
  const store = createVehicleStore();
  const scene = (lat) => ({ until: '10:00', vehicles: [entity('T1', [['10:00', lat, 32.8]])] });
  store.getState().ingest(scene(39.9));
  store.getState().setOverride('T1', { lat: 39.95, category: 2 });
  store.getState().ingest(scene(39.91));
  const view = resolveVehicle(store.getState(), 'T1');
  assert.equal(view.lat, 39.95);
  assert.equal(view.category, 2);
  assert.equal(view.source, 'override');

  store.getState().clearOverride('T1');
  assert.equal(resolveVehicle(store.getState(), 'T1').lat, 39.91);
});

test('Sahnede olmayan araç listeden düşer; vehicles alanı yoksa durum değişmez', () => {
  const store = createVehicleStore();
  store.getState().ingest({ until: '10:00', vehicles: [entity('T1', [['10:00', 39.9, 32.8]])] });
  store.getState().ingest({ until: '10:01', gates: [] });
  assert.deepEqual(store.getState().ids, ['T1']);
  store.getState().ingest({ until: '10:40', vehicles: [] });
  assert.deepEqual(store.getState().ids, []);
  assert.equal(resolveVehicle(store.getState(), 'T1'), null);
});

test('Ayrıştırma: çakışan araçlar yarıçap toplamı kadar açılır, uzaktakiler kıpırdamaz', async () => {
  const { separate } = await import('../src/lib/declutter.js');
  const items = [{ x: 0, z: 0, r: 0.5 }, { x: 0, z: 0, r: 0.5 }, { x: 0.3, z: 0, r: 0.5 }, { x: 50, z: 50, r: 0.5 }];
  const out = separate(items, undefined, 30);
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      assert.ok(Math.hypot(out[i].x - out[j].x, out[i].z - out[j].z) >= 0.99 - 1e-6);
    }
  }
  assert.deepEqual(out[3], { x: 50, z: 50 });
  assert.deepEqual(separate(items, undefined, 30), out);
});


test('Agent seçim isteği her seferinde yeni bir istek olarak yayınlanır', () => {
  const store = createVehicleStore();
  const seen = [];
  store.subscribe((state, previous) => { if (state.pickRequest !== previous.pickRequest) seen.push(state.pickRequest.id); });
  store.getState().requestPick('T1');
  store.getState().requestPick('T1');
  store.getState().requestPick(null);
  assert.deepEqual(seen, ['T1', 'T1']);
});