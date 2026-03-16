import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NeuronaFinanciera,
  calcularSimilitud,
  analizarContextoNota,
  actualizarSistemaFinanciero,
  getAllNeuronas,
  saveNeurona,
  getNeurona
} from '../src/finance/neuron_financiera.js';

/* ── NeuronaFinanciera ────────────────────────────────────── */

test('NeuronaFinanciera: usa el id proporcionado', () => {
  const n = new NeuronaFinanciera({ id: 'mi_id', tipo: 'consumo', nombre: 'Test', monto: 100 });
  assert.equal(n.id, 'mi_id');
});

test('NeuronaFinanciera: genera id único cuando no se proporciona', () => {
  const n1 = new NeuronaFinanciera({ tipo: 'consumo', nombre: 'Alpha', monto: 50 });
  const n2 = new NeuronaFinanciera({ tipo: 'consumo', nombre: 'Alpha', monto: 50 });
  assert.ok(n1.id.startsWith('alpha_'), `id debería comenzar con alpha_, fue: ${n1.id}`);
  assert.ok(n2.id.startsWith('alpha_'), `id debería comenzar con alpha_, fue: ${n2.id}`);
  assert.notEqual(n1.id, n2.id, 'Dos neuronas con el mismo nombre deben tener ids distintos');
});

test('NeuronaFinanciera: clampea peso entre 0 y 1', () => {
  const high = new NeuronaFinanciera({ tipo: 'ingreso', nombre: 'X', monto: 0, peso: 5 });
  assert.equal(high.peso, 1);
  const low = new NeuronaFinanciera({ tipo: 'ingreso', nombre: 'X', monto: 0, peso: -1 });
  assert.equal(low.peso, 0);
  const mid = new NeuronaFinanciera({ tipo: 'ingreso', nombre: 'X', monto: 0, peso: 0.7 });
  assert.equal(mid.peso, 0.7);
});

test('NeuronaFinanciera: monto se convierte a número', () => {
  const n = new NeuronaFinanciera({ tipo: 'consumo', nombre: 'X', monto: '250' });
  assert.equal(n.monto, 250);
});

test('NeuronaFinanciera: metadata tiene valores por defecto', () => {
  const n = new NeuronaFinanciera({ tipo: 'consumo', nombre: 'X', monto: 0 });
  assert.equal(n.metadata.prioridad, 'mid');
  assert.equal(n.metadata.fecha_limite, null);
  assert.ok(typeof n.metadata.elasticidad === 'number');
  assert.equal(n.metadata.contexto_tipo, null);
  assert.equal(n.metadata.elastica, false);
});

test('NeuronaFinanciera: nuevos campos en constructor y toJSON', () => {
  const n = new NeuronaFinanciera({
    tipo: 'consumo',
    nombre: 'Test',
    monto: 100,
    ultimo_contexto: 'se rompió el celular',
    contador_emocional: { necesario: 2, evitable: 1 },
    prediccion_basada_en_nota: 'cada mes sube'
  });
  assert.equal(n.ultimo_contexto, 'se rompió el celular');
  assert.deepEqual(n.contador_emocional, { necesario: 2, evitable: 1 });
  assert.equal(n.prediccion_basada_en_nota, 'cada mes sube');

  const json = n.toJSON();
  assert.equal(json.ultimo_contexto, 'se rompió el celular');
  assert.deepEqual(json.contador_emocional, { necesario: 2, evitable: 1 });
  assert.equal(json.prediccion_basada_en_nota, 'cada mes sube');
});

test('NeuronaFinanciera: toJSON devuelve objeto plano', () => {
  const n = new NeuronaFinanciera({
    id: 'abc',
    tipo: 'pasivo',
    nombre: 'Préstamo',
    monto: 500,
    peso: 0.9,
    metadata: { fecha_limite: '2025-12-31', prioridad: 'high', elasticidad: 0.2 },
    conexiones: ['consumo_madre']
  });
  const json = n.toJSON();
  assert.equal(json.id, 'abc');
  assert.equal(json.tipo, 'pasivo');
  assert.equal(json.nombre, 'Préstamo');
  assert.equal(json.monto, 500);
  assert.equal(json.peso, 0.9);
  assert.deepEqual(json.conexiones, ['consumo_madre']);
  assert.equal(json.metadata.fecha_limite, '2025-12-31');
});

test('NeuronaFinanciera: conexiones es copia independiente', () => {
  const original = ['a', 'b'];
  const n = new NeuronaFinanciera({ tipo: 'consumo', nombre: 'X', monto: 0, conexiones: original });
  n.conexiones.push('c');
  assert.equal(original.length, 2);
});

/* ── calcularSimilitud ────────────────────────────────────── */

test('calcularSimilitud: coincidencia exacta de nombre y tipo → alta similitud', () => {
  const gasto = { nombre: 'Mercado', monto: 600, tipo: 'consumo' };
  const neurona = { nombre: 'Mercado', monto: 600, tipo: 'consumo' };
  const sim = calcularSimilitud(gasto, neurona);
  assert.ok(sim >= 0.9, `Se esperaba ≥0.9, fue ${sim}`);
});

test('calcularSimilitud: nombres completamente distintos → baja similitud', () => {
  const gasto = { nombre: 'Spotify', monto: 15, tipo: 'consumo' };
  const neurona = { nombre: 'Alquiler', monto: 600, tipo: 'consumo' };
  const sim = calcularSimilitud(gasto, neurona);
  assert.ok(sim < 0.4, `Se esperaba <0.4, fue ${sim}`);
});

test('calcularSimilitud: rango entre 0 y 1', () => {
  const gasto = { nombre: 'Test', monto: 100, tipo: 'consumo' };
  const neurona = { nombre: 'Otro', monto: 200, tipo: 'ingreso' };
  const sim = calcularSimilitud(gasto, neurona);
  assert.ok(sim >= 0 && sim <= 1, `Valor fuera de rango: ${sim}`);
});

test('calcularSimilitud: maneja valores faltantes sin error', () => {
  const sim = calcularSimilitud({}, { nombre: '', monto: 0, tipo: 'consumo' });
  assert.ok(typeof sim === 'number');
  assert.ok(!Number.isNaN(sim));
});

/* ── actualizarSistemaFinanciero ─────────────────────────── */
// Nota: requiere localStorage — se usa globalThis para entorno Node

const _lsStore = {};
if (typeof localStorage === 'undefined') {
  globalThis.localStorage = {
    getItem: (k) => _lsStore[k] ?? null,
    setItem: (k, v) => { _lsStore[k] = v; },
    removeItem: (k) => { delete _lsStore[k]; }
  };
}

test('actualizarSistemaFinanciero: retorna objeto con neuronas y nuevas', () => {
  delete _lsStore['memorycarl_neuronas_financieras'];
  const result = actualizarSistemaFinanciero({ transacciones: [], estres: 0 });
  assert.ok(Array.isArray(result.neuronas));
  assert.ok(Array.isArray(result.nuevas));
});

test('actualizarSistemaFinanciero: crea neurona nueva (mitosis) cuando similitud < 80%', () => {
  delete _lsStore['memorycarl_neuronas_financieras'];
  const result = actualizarSistemaFinanciero({
    transacciones: [{ nombre: 'Suscripción Gaming XYZ', monto: 29.99, tipo: 'consumo' }],
    estres: 3
  });
  assert.ok(result.nuevas.length >= 1, 'Debe haber creado al menos 1 neurona nueva');
  const nueva = result.nuevas[0];
  assert.equal(nueva.nombre, 'Suscripción Gaming XYZ');
  assert.equal(nueva.tipo, 'consumo');
  assert.ok(nueva.conexiones.includes('consumo_madre'));
});

test('actualizarSistemaFinanciero: no crea neurona nueva cuando similitud >= 80%', () => {
  delete _lsStore['memorycarl_neuronas_financieras'];
  // Primer pase: insertar neurona "Mercado" con monto 600
  actualizarSistemaFinanciero({
    transacciones: [{ nombre: 'Mercado Nuevo', monto: 600, tipo: 'consumo' }],
    estres: 0
  });
  // Segundo pase con gasto muy similar
  const result = actualizarSistemaFinanciero({
    transacciones: [{ nombre: 'Mercado', monto: 600, tipo: 'consumo' }],
    estres: 0
  });
  assert.equal(result.nuevas.length, 0, 'No debe crear neurona si ya existe una coincidente');
});

test('actualizarSistemaFinanciero: ajusta peso de pasivos próximos a vencer', () => {
  delete _lsStore['memorycarl_neuronas_financieras'];
  // Crear neurona pasivo que vence en 3 días
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 3);
  const fechaLimite = tomorrow.toISOString().slice(0, 10);

  const pasivo = new NeuronaFinanciera({
    id: 'prestamo_test',
    tipo: 'pasivo',
    nombre: 'Préstamo Test',
    monto: 1000,
    peso: 0.5,
    metadata: { fecha_limite: fechaLimite, prioridad: 'high', elasticidad: 0.1 },
    conexiones: []
  });
  saveNeurona(pasivo);

  const result = actualizarSistemaFinanciero({ transacciones: [], estres: 5 });
  const actualizado = result.neuronas.find(n => n.id === 'prestamo_test');
  assert.ok(actualizado, 'La neurona pasivo debe seguir existiendo');
  assert.ok(actualizado.peso > 0.5, `El peso debe haber aumentado; fue ${actualizado.peso}`);
});

test('actualizarSistemaFinanciero: maneja datosDia vacío sin error', () => {
  delete _lsStore['memorycarl_neuronas_financieras'];
  assert.doesNotThrow(() => actualizarSistemaFinanciero({}));
  assert.doesNotThrow(() => actualizarSistemaFinanciero(null));
  assert.doesNotThrow(() => actualizarSistemaFinanciero(undefined));
});

/* ── CRUD básico ─────────────────────────────────────────── */

test('saveNeurona y getNeurona: persiste y recupera correctamente', () => {
  delete _lsStore['memorycarl_neuronas_financieras'];
  const n = new NeuronaFinanciera({
    id: 'test_save_001',
    tipo: 'ingreso',
    nombre: 'Freelance',
    monto: 300,
    peso: 0.6
  });
  saveNeurona(n);
  const found = getNeurona('test_save_001');
  assert.ok(found, 'getNeurona debe encontrar la neurona guardada');
  assert.equal(found.nombre, 'Freelance');
  assert.equal(found.monto, 300);
});

test('saveNeurona: actualiza neurona existente', () => {
  delete _lsStore['memorycarl_neuronas_financieras'];
  saveNeurona({ id: 'upd_001', tipo: 'consumo', nombre: 'Original', monto: 100, peso: 0.5, metadata: {}, conexiones: [] });
  saveNeurona({ id: 'upd_001', tipo: 'consumo', nombre: 'Actualizado', monto: 200, peso: 0.7, metadata: {}, conexiones: [] });
  const all = getAllNeuronas();
  const found = all.filter(n => n.id === 'upd_001');
  assert.equal(found.length, 1, 'No debe duplicar la neurona');
  assert.equal(found[0].nombre, 'Actualizado');
  assert.equal(found[0].monto, 200);
});

test('getAllNeuronas: devuelve array no vacío', () => {
  delete _lsStore['memorycarl_neuronas_financieras'];
  const all = getAllNeuronas();
  assert.ok(Array.isArray(all));
  assert.ok(all.length > 0, 'El seed por defecto debe tener neuronas');
});

/* ── analizarContextoNota ────────────────────────────────── */

test('analizarContextoNota: detecta emergencia por palabras clave', () => {
  const r = analizarContextoNota('Se rompió el celular y fue urgente repararlo');
  assert.equal(r.tipo, 'emergencia');
  assert.ok(r.palabrasClave.length > 0);
});

test('analizarContextoNota: detecta inversión/trabajo', () => {
  const r = analizarContextoNota('Compré un curso de programación para mejorar');
  assert.equal(r.tipo, 'inversion');
  assert.ok(r.palabrasClave.includes('curso'));
});

test('analizarContextoNota: detecta previsión/futuro', () => {
  const r = analizarContextoNota('Pago inicial para el departamento del próximo mes');
  assert.equal(r.tipo, 'prevision');
  assert.ok(r.palabrasClave.length > 0);
});

test('analizarContextoNota: detecta ocio/variable', () => {
  const r = analizarContextoNota('Compré esto por capricho, fue un gusto');
  assert.equal(r.tipo, 'ocio');
  assert.ok(r.palabrasClave.includes('capricho'));
});

test('analizarContextoNota: retorna null cuando no hay coincidencias', () => {
  const r = analizarContextoNota('Compra normal del día');
  assert.equal(r.tipo, null);
  assert.equal(r.palabrasClave.length, 0);
});

test('analizarContextoNota: maneja nota vacía o nula sin error', () => {
  assert.doesNotThrow(() => analizarContextoNota(''));
  assert.doesNotThrow(() => analizarContextoNota(null));
  assert.doesNotThrow(() => analizarContextoNota(undefined));
  const r = analizarContextoNota(null);
  assert.equal(r.tipo, null);
});

test('analizarContextoNota: emergencia tiene prioridad sobre ocio', () => {
  const r = analizarContextoNota('urgente capricho del momento');
  assert.equal(r.tipo, 'emergencia', 'Emergencia debe tener mayor prioridad que ocio');
});

/* ── actualizarSistemaFinanciero con contexto ────────────── */

test('actualizarSistemaFinanciero: nueva neurona hereda contexto de nota (emergencia)', () => {
  delete _lsStore['memorycarl_neuronas_financieras'];
  const result = actualizarSistemaFinanciero({
    transacciones: [{ nombre: 'Médico Urgente XYZ', monto: 300, tipo: 'consumo', notas: 'Se rompió urgente' }],
    estres: 3
  });
  const nueva = result.nuevas.find(n => n.nombre === 'Médico Urgente XYZ');
  assert.ok(nueva, 'Debe haber creado neurona nueva');
  assert.equal(nueva.metadata.contexto_tipo, 'emergencia');
  assert.equal(nueva.ultimo_contexto, 'Se rompió urgente');
  assert.equal(nueva.contador_emocional.necesario, 1);
  assert.equal(nueva.contador_emocional.evitable, 0);
});

test('actualizarSistemaFinanciero: nueva neurona marcada como elástica por nota de ocio', () => {
  delete _lsStore['memorycarl_neuronas_financieras'];
  const result = actualizarSistemaFinanciero({
    transacciones: [{ nombre: 'Capricho GamingXYZ', monto: 50, tipo: 'consumo', notas: 'capricho del momento' }],
    estres: 1
  });
  const nueva = result.nuevas.find(n => n.nombre === 'Capricho GamingXYZ');
  assert.ok(nueva, 'Debe haber creado neurona nueva');
  assert.equal(nueva.metadata.elastica, true, 'Neurona de ocio debe ser elástica');
  assert.equal(nueva.contador_emocional.evitable, 1);
});

test('actualizarSistemaFinanciero: neurona de previsión creada cuando nota menciona evento futuro', () => {
  delete _lsStore['memorycarl_neuronas_financieras'];
  const result = actualizarSistemaFinanciero({
    transacciones: [{ nombre: 'Departamento', monto: 1000, tipo: 'consumo', notas: 'pago inicial para el depa' }],
    estres: 2
  });
  const prevision = result.nuevas.find(n => n.tipo === 'prevision');
  assert.ok(prevision, 'Debe haber creado neurona de previsión');
  assert.ok(prevision.prediccion_basada_en_nota, 'Debe tener predicción guardada');
});

test('actualizarSistemaFinanciero: nota con "cada mes sube" almacena predicción en neurona existente', () => {
  delete _lsStore['memorycarl_neuronas_financieras'];
  /* Primera pasada: crear neurona para Mercado */
  actualizarSistemaFinanciero({
    transacciones: [{ nombre: 'Mercado', monto: 600, tipo: 'consumo' }],
    estres: 0
  });
  /* Segunda pasada con nota de predicción */
  const result = actualizarSistemaFinanciero({
    transacciones: [{ nombre: 'Mercado', monto: 650, tipo: 'consumo', notas: 'Cada mes sube el precio' }],
    estres: 0
  });
  const mercado = result.neuronas.find(n => n.nombre === 'Mercado');
  assert.ok(mercado, 'Neurona Mercado debe seguir existiendo');
  assert.ok(mercado.prediccion_basada_en_nota, 'Debe almacenar predicción por nota "cada mes sube"');
});

test('actualizarSistemaFinanciero: nota en campo note también es procesada', () => {
  delete _lsStore['memorycarl_neuronas_financieras'];
  const result = actualizarSistemaFinanciero({
    transacciones: [{ nombre: 'Herramienta ABC', monto: 200, tipo: 'consumo', note: 'compré herramienta para el trabajo' }],
    estres: 2
  });
  const nueva = result.nuevas.find(n => n.nombre === 'Herramienta ABC');
  assert.ok(nueva, 'Debe crear neurona nueva');
  assert.equal(nueva.metadata.contexto_tipo, 'inversion');
});
