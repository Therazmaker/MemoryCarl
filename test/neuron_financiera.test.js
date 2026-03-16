import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NeuronaFinanciera,
  calcularSimilitud,
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
