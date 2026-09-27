import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY_END, extrapolate, isVisibleAt, toHHMM, toMinutes } from '../src/lib/simTime.js';
import { createSimStore } from '../src/store/simStore.js';

function fakeApi(overrides = {}) {
  let version = 0;
  const calls = [];
  return {
    calls,
    getClock: async () => ({ minute: 600, running: false, rate: 60, version }),
    postClock: async (patch) => { calls.push(patch); version += 1; return { minute: patch.time ? toMinutes(patch.time) : 600, running: patch.running ?? false, rate: patch.rate ?? 60, version }; },
    getScene: async (until) => ({ until, gates: [] }),
    ...overrides,
  };
}

test('Saat dönüşümleri ve görünürlük filtresi', () => {
  assert.equal(toMinutes('08:05'), 485);
  assert.equal(toHHMM(485.9), '08:05');
  assert.throws(() => toMinutes('8:5'), RangeError);
  assert.ok(isVisibleAt('13:25', '13:25'));
  assert.ok(!isVisibleAt('13:26', '13:25'));
});

test('Çapadan ilerletme yalnızca çalışırken ve gün sonuna kadar', () => {
  const anchor = { minute: 600, running: true, rate: 60, at: 0 };
  assert.equal(extrapolate(anchor, 30_000), 630); // 30 s × 60 = 30 sim dakika
  assert.equal(extrapolate({ ...anchor, running: false }, 30_000), 600);
  assert.equal(extrapolate(anchor, 10_000_000), DAY_END);
});

test('Store: senkron, yerel tick ve optimistic seek', async () => {
  let now = 0;
  const api = fakeApi();
  const store = createSimStore({ api, now: () => now });
  await store.getState().sync();
  assert.equal(store.getState().minute, 600);

  await store.getState().play();
  now += 60_000; // 60 s × 60 = 60 sim dakika
  store.getState().tick();
  assert.equal(toHHMM(store.getState().minute), '11:00');

  await store.getState().seek('14:10');
  assert.equal(toHHMM(store.getState().minute), '14:10');
  assert.deepEqual(api.calls, [{ running: true }, { time: '14:10' }]);
});

test('Store: backend yoksa saat yerelde çalışmaya devam eder', async () => {
  let now = 0;
  const failing = async () => { throw new Error('offline'); };
  const store = createSimStore({ api: fakeApi({ getClock: failing, postClock: failing }), now: () => now });
  await store.getState().sync();
  assert.equal(store.getState().offline, true);
  await store.getState().play();
  now += 10_000;
  store.getState().tick();
  assert.equal(toHHMM(store.getState().minute), '08:10');
});

test('Store: sahne istekleri birleştirilir, en son saat yüklenir', async () => {
  const requested = [];
  let release;
  const api = fakeApi({ getScene: (until) => { requested.push(until); return new Promise((resolve) => { release = () => resolve({ until, gates: [] }); }); } });
  const store = createSimStore({ api, now: () => 0 });
  const first = store.getState().loadScene('10:00');
  store.getState().loadScene('10:01');
  store.getState().loadScene('10:02');
  release();
  await first;
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requested, ['10:00', '10:02']);
  assert.equal(store.getState().scene.until, '10:02');
});
