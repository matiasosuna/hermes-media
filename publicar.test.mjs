import test from 'node:test';
import assert from 'node:assert/strict';
import { pideHistoria, siguiente, pideMetricas, horaNY, buscarDuplicadoIG, desdeRepost, parametrosContenedor } from './publicar.mjs';

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

// Republicar un reel como trial (Matías, 24/11/2026): misma primera línea que el original
const original = { id: 'o1', caption: 'Most people think X. It isn\'t.\nviejo', timestamp: '2026-11-03T17:00:00+0000' };
const repost = { id: 'trial-x', cuando: '2026-11-25T21:00:00-05:00', instagram: { caption: 'Most people think X. It isn\'t.\nnuevo', trial: 'MANUAL', repost_de: 'x' } };
test('repost: el original no cuenta como ya publicado', () => assert.equal(buscarDuplicadoIG([original], repost.instagram.caption, desdeRepost(repost)), null));
test('repost: el trial ya salido sí cuenta', () => {
  const salido = { id: 't1', caption: repost.instagram.caption, timestamp: '2026-11-26T02:05:00+0000' };
  assert.equal(buscarDuplicadoIG([salido, original], repost.instagram.caption, desdeRepost(repost))?.id, 't1');
});
test('sin repost: igual que antes', () => assert.equal(buscarDuplicadoIG([original], original.caption, desdeRepost({ instagram: {} }))?.id, 'o1'));
test('repost: contenedor de trial, sin share_to_feed', () => {
  const p = parametrosContenedor({ archivo: 'x.mp4', ...repost }, 'a/b');
  assert.equal(p.trial_params, '{"graduation_strategy":"MANUAL"}');
  assert.equal(p.share_to_feed, undefined);
});

test('trial: no corre la espera del reel principal', () => {
  const cal = { separacion_minima_horas: 9, requiere_v2: true, items: [
    { id: 't', cuando: '2026-11-25T14:00:00Z', v2: {}, instagram: { trial: 'MANUAL', publicado: { fecha: '2026-11-25T14:10:00Z' } } },
    { id: 'r', cuando: '2026-11-25T17:00:00Z', v2: {}, instagram: {} } ] };
  assert.equal(siguiente(cal, 'instagram', Date.parse('2026-11-25T17:05:00Z')).item?.id, 'r');
});
