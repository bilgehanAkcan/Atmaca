import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCATION_DATA, ZONES, projectLatLon } from '../src/data/locations.js';
import { initialNavigation, navigationReducer as reduce } from '../src/lib/navigation.js';

test('Merkez üs tam orijindedir; kuzey -Z, doğu +X yönündedir', () => {
  assert.deepEqual(projectLatLon(LOCATION_DATA.base.lat, LOCATION_DATA.base.lon), [0, 0, 0]);
  assert.equal(ZONES.length, 8);
  assert.equal(ZONES[0].position[0], 0);
  assert.ok(ZONES[0].position[2] < 0);
  assert.ok(ZONES[2].position[0] > 0);
  assert.equal(ZONES[2].position[2], 0);
  assert.ok(ZONES[4].position[2] > 0);
  assert.ok(ZONES[6].position[0] < 0);
  for (const zone of ZONES) {
    assert.equal(zone.position[1], 0);
    assert.ok(Math.abs(zone.distanceKm - 3.2) < 0.02);
  }
  assert.ok(Math.abs(ZONES[0].position[2] + ZONES[4].position[2]) < 1e-8);
  assert.ok(Math.abs(ZONES[2].position[0] + ZONES[6].position[0]) < 1e-8);
});

test('Geçersiz koordinatlar reddedilir', () => {
  for (const pair of [[NaN, 0], [0, Infinity], [91, 0], [0, -181]]) {
    assert.throws(() => projectLatLon(...pair), RangeError);
  }
});

test('Kuş bakışı iz → özet kartı → detaylar → dalış → panel sıralaması korunur', () => {
  let state = reduce(initialNavigation, { type: 'SELECT', target: ZONES[0] });
  assert.equal(state.phase, 'framing');
  assert.equal(reduce(state, { type: 'DETAILS' }), state);
  state = reduce(state, { type: 'ARRIVED' });
  assert.equal(state.phase, 'preview');
  state = reduce(state, { type: 'DETAILS' });
  assert.equal(state.phase, 'diving');
  state = reduce(state, { type: 'ARRIVED' });
  assert.equal(state.phase, 'focused');
  assert.equal(state.target.id, ZONES[0].id);
});

test('Geri dönüş aynı adımları ters sırayla izler', () => {
  let state = { phase: 'focused', target: ZONES[0] };
  state = reduce(state, { type: 'RESET' });
  assert.equal(state.phase, 'closing');
  assert.equal(reduce(state, { type: 'ARRIVED' }).phase, 'closing');
  state = reduce(state, { type: 'PANEL_CLOSED' });
  assert.equal(state.phase, 'backing');
  state = reduce(state, { type: 'ARRIVED' });
  assert.equal(state.phase, 'preview');
  state = reduce(state, { type: 'RESET' });
  assert.equal(state.phase, 'leaving');
  assert.equal(reduce(state, { type: 'PANEL_CLOSED' }), state);
  state = reduce(state, { type: 'CARD_CLOSED' });
  assert.equal(state.phase, 'returning');
  assert.equal(state.target.id, ZONES[0].id);
  assert.deepEqual(reduce(state, { type: 'ARRIVED' }), initialNavigation);
});

test('Uçuş iptalleri ve eski panel/kart olayları', () => {
  let state = reduce(initialNavigation, { type: 'SELECT', target: ZONES[0] });
  assert.equal(reduce(state, { type: 'SELECT', target: ZONES[1] }), state);
  assert.equal(reduce(state, { type: 'RESET' }).phase, 'returning');
  state = { phase: 'diving', target: ZONES[0] };
  state = reduce(state, { type: 'RESET' });
  assert.equal(state.phase, 'backing');
  assert.equal(reduce(state, { type: 'RESET' }), state);
  assert.equal(reduce(state, { type: 'CARD_CLOSED' }), state);
  state = { phase: 'returning', target: ZONES[0] };
  assert.equal(reduce(state, { type: 'PANEL_CLOSED' }), state);
  assert.equal(reduce(state, { type: 'RESET' }), state);
});

test('Özet kartında başka araca tıklamak onun izine geçer; odaktayken doğrudan ona dalar', () => {
  let state = { phase: 'preview', target: { id: 'T1' } };
  assert.equal(reduce(state, { type: 'SELECT', target: { id: 'T1' } }), state);
  assert.deepEqual(reduce(state, { type: 'SELECT', target: { id: 'T2' } }), { phase: 'framing', target: { id: 'T2' } });
  state = reduce({ phase: 'focused', target: { id: 'T1' } }, { type: 'SELECT', target: { id: 'T2' } });
  assert.deepEqual(state, { phase: 'diving', target: { id: 'T2' } });
  assert.equal(reduce({ ...state, phase: 'closing' }, { type: 'SELECT', target: { id: 'T3' } }).phase, 'closing');
});
