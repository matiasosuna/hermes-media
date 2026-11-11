import test from 'node:test';
import assert from 'node:assert/strict';
import { pideHistoria, siguiente, pideMetricas, horaNY } from './publicar.mjs';

const h = (fecha, extra = {}) => ({ instagram: { publicado: fecha && { fecha }, ...extra } });
const ahora = Date.parse('2026-10-24T14:00:00Z');

test('historia: reel recién publicado la pide', () => assert.equal(pideHistoria(h('2026-10-24T13:01:00Z'), ahora), true));
test('historia: sin publicar no', () => assert.equal(pideHistoria(h(null), ahora), false));
test('historia: ya hecha no se repite', () => assert.equal(pideHistoria(h('2026-10-24T13:01:00Z', { historia: { id: 'x' } }), ahora), false));
test('historia: reels de antes del arranque no', () => assert.equal(pideHistoria(h('2026-10-23T23:03:00Z'), ahora), false));
test('historia: más de 12 h después no', () => assert.equal(pideHistoria(h('2026-10-24T13:01:00Z'), Date.parse('2026-10-25T02:00:00Z')), false));

test('siguiente: sin v2 no publica aunque esté vencido', () => {
  const cal = { requiere_v2: true, separacion_minima_horas: 9, items: [{ id: '25-x', cuando: '2026-10-24T00:00:00Z', instagram: {} }] };
  assert.equal(siguiente(cal, 'instagram', ahora).item, null);
});

const m = (fecha, extra = {}) => ({ instagram: { publicado: { id: '1', fecha }, ...extra } });
test('métricas 48 h: antes de las 48 h no', () => assert.equal(pideMetricas(m('2026-11-12T17:00:00Z'), Date.parse('2026-11-14T16:00:00Z')), false));
test('métricas 48 h: entre 48 y 72 h sí', () => assert.equal(pideMetricas(m('2026-11-12T17:00:00Z'), Date.parse('2026-11-14T17:10:00Z')), true));
test('métricas 48 h: una sola vez', () => assert.equal(pideMetricas(m('2026-11-12T17:00:00Z', { metricas_48h: {} }), Date.parse('2026-11-14T17:10:00Z')), false));
test('métricas 48 h: viejos (más de 72 h) no, no son comparables', () => assert.equal(pideMetricas(m('2026-11-01T17:00:00Z'), Date.parse('2026-11-14T17:10:00Z')), false));
test('hora NY del post', () => assert.equal(horaNY('2026-11-12T17:03:00Z'), 'Thu 12:03'));
