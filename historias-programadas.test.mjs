import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { queToca, quedan } from './historias-programadas.mjs';

const it = (id, cuando, hasta, extra = {}) => ({ id, cuando, hasta, jpg: `${id}.jpg`, ...extra });
const prog = { release: 'videos', items: [
  it('a', '2026-11-27T07:00:00-05:00', '2026-11-27T19:00:00-05:00'),
  it('hoy', '2026-12-01T07:00:00-05:00', '2026-12-01T11:00:00-05:00'),
] };
const t = (s) => Date.parse(s);

test('antes de la hora no sale', () => assert.deepEqual(queToca(prog, t('2026-11-27T06:59:00-05:00')).publicar, []));
test('a la hora sale', () => assert.deepEqual(queToca(prog, t('2026-11-27T07:13:00-05:00')).publicar.map((x) => x.id), ['a']));
test('la de «Today» no sale después de que empezó el evento', () => {
  const r = queToca({ ...prog, items: [prog.items[1]] }, t('2026-12-01T11:00:00-05:00'));
  assert.deepEqual([r.publicar.length, r.vencer.map((x) => x.id)], [0, ['hoy']]);
});
test('publicada no se repite', () => assert.deepEqual(queToca({ ...prog, items: [{ ...prog.items[0], publicada: { id: '1' } }] }, t('2026-11-27T08:00:00-05:00')).publicar, []));
test('pausado no publica', () => assert.deepEqual(queToca({ ...prog, pausado: true }, t('2026-11-27T08:00:00-05:00')).publicar, []));
test('hasta antes que cuando: error', () => assert.throws(() => queToca({ items: [it('x', '2026-12-02T10:00:00Z', '2026-12-02T09:00:00Z')] }, 0)));
test('el calendario real es válido y cada «Today» vence a las 11 AM NY del evento', () => {
  const p = JSON.parse(readFileSync(new URL('./historias-programadas.json', import.meta.url), 'utf8'));
  queToca(p, 0);
  for (const h of p.items.filter((x) => /hoy/.test(x.id))) assert.match(h.hasta, /T11:00:00-05:00$/);
  assert.equal(new Set(p.items.map((x) => x.id)).size, p.items.length);
});

test('la cadena sigue mientras quede alguna por salir', () => {
  const it = (x = {}) => ({ id: 'a', cuando: '2026-12-05T12:00:00-05:00', hasta: '2026-12-05T19:00:00-05:00', jpg: 'a.jpg', ...x });
  assert.equal(quedan({ items: [it(), it({ publicada: { id: '1' } })] }), true);
  assert.equal(quedan({ items: [it({ publicada: { id: '1' } }), it({ vencida: 'x' })] }), false);
  assert.equal(quedan({ pausado: true, items: [it()] }), false);
});
