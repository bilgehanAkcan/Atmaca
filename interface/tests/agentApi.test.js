import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSse, VEHICLE_LEVEL_COLORS, vehicleColor, vehicleLevel } from '../src/lib/agentApi.js';

test('SSE ayrıştırıcı tamamlanan olayları döndürür, yarım kalanı saklar', () => {
  const first = parseSse('event: session\ndata: {"session_id":"s1"}\n\nevent: tool_call\ndata: {"to');
  assert.deepEqual(first.events, [{ event: 'session', data: { session_id: 's1' } }]);

  const second = parseSse(`${first.rest}ol":"detect_vehicles"}\n\n`);
  assert.deepEqual(second.events, [{ event: 'tool_call', data: { tool: 'detect_vehicles' } }]);
  assert.equal(second.rest, '');
});

test('Türkçe karakterli veri bozulmadan ayrıştırılır', () => {
  const { events } = parseSse('event: brief\ndata: {"summary":"Üsse yaklaşan araç"}\n\n');
  assert.equal(events[0].data.summary, 'Üsse yaklaşan araç');
});

test('araç rengi risk seviyesinden gelir; takipsiz araç en az ORTA gösterilir', () => {
  assert.equal(vehicleLevel({ kind: 'track', risk_level: 'DUSUK' }), 'DUSUK');
  assert.equal(vehicleLevel({ kind: 'track', risk_level: 'YUKSEK' }), 'YUKSEK');
  assert.equal(vehicleColor({ kind: 'track', risk_level: 'YUKSEK' }), VEHICLE_LEVEL_COLORS.YUKSEK);
  assert.equal(vehicleLevel({ kind: 'static', risk_level: 'DUSUK' }), 'ORTA');
  assert.equal(vehicleLevel({ kind: 'static', risk_level: 'YUKSEK' }), 'YUKSEK');
  // Eski ya da eksik yanıt: seviye yoksa yeşil.
  assert.equal(vehicleLevel({ kind: 'track' }), 'DUSUK');
});
