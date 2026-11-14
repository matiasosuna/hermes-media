// control.mjs: pedidos del panel de la web y la foto del calendario (node --test control.test.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fotoCalendario, historias, hacer, control } from './control.mjs';

const item = (id, cuando, pub, v2 = true) => ({ id, carta: id, cuando, v2: v2 ? { fecha: 'x' } : undefined,
  instagram: pub ? { publicado: { permalink: 'https://ig/' + id } } : {}, youtube: pub ? { publicado: { url: 'https://yt/' + id } } : {}, tiktok: pub ? { publicado: { url: 'https://tt/' + id } } : {} });
const cal0 = () => ({ requiere_v2: true, pausado: false, items: [
  item('a', '2026-11-10T09:00:00-05:00', true), item('b', '2026-11-15T09:00:00-05:00', false),
  item('c', '2026-11-16T09:00:00-05:00', false), item('d', '2026-11-17T09:00:00-05:00', false, false)] });

test('foto del calendario: próximo, listos, por hacer y publicados con links', () => {
  const f = fotoCalendario(cal0(), Date.parse('2026-11-14T12:00:00Z'));
  assert.equal(f.proximos[0].carta, 'b');
  assert.deepEqual([f.cola, f.por_hacer], [2, 1]);
  assert.equal(f.hasta, '2026-11-16T09:00:00-05:00');
  assert.deepEqual(f.proximos.map((x) => x.listo), [true, true, false]);
  assert.deepEqual(f.publicados, [{ carta: 'a', cuando: '2026-11-10T09:00:00-05:00', ig: 'https://ig/a', yt: 'https://yt/a', tt: 'https://tt/a' }]);
  assert.deepEqual(f.atrasados, []);
});

test('historias: las del repo, con su PNG', () => {
  const h = historias();
  assert.ok(h.some((x) => x.archivo === 'imagenes/club-historia-1.html' && x.png === 'imagenes/club-historia-1.png'));
  assert.ok(!h.some((x) => /web-compartir/.test(x.archivo)));
});

test('pedidos: pausar y seguir tocan el calendario; historia y status disparan el workflow', () => {
  const cal = cal0(); let g = 0; const corridas = [];
  const op = { repo: 'yo/hermes-media', correr: (a) => corridas.push(a.join(' ')) };
  assert.match(hacer({ tipo: 'pausar' }, cal, () => g++, op), /pausado/); assert.equal(cal.pausado, true);
  hacer({ tipo: 'seguir' }, cal, () => g++, op); assert.equal(cal.pausado, false); assert.equal(g, 2);
  hacer({ tipo: 'historia', datos: { archivo: 'imagenes/club-historia-1.html' } }, cal, () => {}, op);
  assert.equal(corridas[0], 'workflow run historia -R yo/hermes-media --ref main -f archivo=imagenes/club-historia-1.html -f publicar=si');
  assert.throws(() => hacer({ tipo: 'historia', datos: { archivo: 'imagenes/../calendario.json' } }, cal, () => {}, op));
  assert.throws(() => hacer({ tipo: 'historia', datos: { archivo: 'imagenes/no-existe.html' } }, cal, () => {}, op));
  hacer({ tipo: 'status' }, cal, () => {}, op); assert.equal(corridas[1], 'workflow run status -R yo/hermes-media --ref main');
});

test('control: hace los pedidos, los marca y manda la foto; si la web no responde, sigue', async () => {
  const llamadas = [], cal = cal0();
  const f = async (u, o = {}) => { llamadas.push([o.method || 'GET', u.replace(/^.*\/api\/control/, ''), o.body && JSON.parse(o.body)]);
    return u.endsWith('/pedidos') ? Response.json({ pedidos: [{ id: 7, tipo: 'pausar', datos: {} }, { id: 8, tipo: 'status', datos: {} }] }) : Response.json({ ok: true }); };
  const logs = [];
  await control({ cal, guardar: () => {}, env: { HT_STATS_TOKEN: 't' }, log: (s) => logs.push(s), repo: 'r', f, correr: () => {} });
  assert.equal(cal.pausado, true);
  assert.deepEqual(llamadas.map((l) => l.slice(0, 2)), [['GET', '/pedidos'], ['POST', '/pedidos/7'], ['POST', '/pedidos/8'], ['PUT', '/estado/calendario']]);
  assert.equal(llamadas[1][2].estado, 'hecho');
  assert.equal(llamadas[2][2].estado, 'error'); // status solo desde Actions
  assert.equal(llamadas[3][2].pausado, true);
  const l2 = [];
  await control({ cal, guardar: () => {}, env: { HT_STATS_TOKEN: 't' }, log: (s) => l2.push(s), repo: 'r', f: async () => { throw new Error('caída'); } });
  assert.match(l2[0], /caída/);
});
