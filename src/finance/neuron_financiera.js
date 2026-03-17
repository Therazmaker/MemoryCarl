import { runFinanceBrainScan } from './finance_brain_engine.js';
import { loadFinanceBrainState, saveFinanceBrainState, upsertLegacyNeurona } from './finance_neural_storage.js';

const NEURONAS_LS_KEY = 'memorycarl_neuronas_financieras';

const DEFAULT_NEURONAS = [
  { id: 'ingreso_principal', tipo: 'ingreso', nombre: 'Sueldo Principal', monto: 0, peso: 1, metadata: { prioridad: 'high', contexto_tipo: null, elastica: false }, conexiones: ['consumo_madre'], ultimo_contexto: null, contador_emocional: { necesario: 0, evitable: 0 }, prediccion_basada_en_nota: null },
  { id: 'consumo_madre', tipo: 'consumo', nombre: 'Consumo', monto: 0, peso: 0.8, metadata: { prioridad: 'mid', contexto_tipo: null, elastica: false }, conexiones: [], ultimo_contexto: null, contador_emocional: { necesario: 0, evitable: 0 }, prediccion_basada_en_nota: null }
];

export class NeuronaFinanciera {
  constructor({ id, tipo, nombre, monto, peso = 0.5, metadata = {}, conexiones = [], ultimo_contexto = null, contador_emocional = null, prediccion_basada_en_nota = null }) {
    this.id = id || NeuronaFinanciera.generateId(nombre);
    this.tipo = tipo;
    this.nombre = nombre;
    this.monto = Number(monto) || 0;
    this.peso = Math.max(0, Math.min(1, Number(peso) || 0.5));
    this.metadata = { fecha_limite: metadata.fecha_limite || null, prioridad: metadata.prioridad || 'mid', elasticidad: Number(metadata.elasticidad) || 0.3, contexto_tipo: metadata.contexto_tipo || null, elastica: !!metadata.elastica };
    this.conexiones = Array.isArray(conexiones) ? [...conexiones] : [];
    this.ultimo_contexto = ultimo_contexto;
    this.contador_emocional = { necesario: Number((contador_emocional || {}).necesario) || 0, evitable: Number((contador_emocional || {}).evitable) || 0 };
    this.prediccion_basada_en_nota = prediccion_basada_en_nota;
  }
  static generateId(nombre = '') { return `${String(nombre).toLowerCase().replace(/\W+/g, '_') || 'neurona'}_${Date.now().toString(36)}`; }
  toJSON() { return { ...this }; }
}

function mapNeuronToLegacy(neuron) {
  const tipo = neuron.type.includes('income') ? 'ingreso' : neuron.family === 'risk' ? 'pasivo' : 'consumo';
  return {
    id: neuron.id,
    tipo,
    nombre: neuron.type,
    monto: Math.round((neuron.supportingEvidence?.[0]?.amount || 0) * 100) / 100,
    peso: neuron.score,
    metadata: { prioridad: neuron.family === 'risk' ? 'high' : 'mid', contexto_tipo: neuron.type, elastica: neuron.type.includes('discretionary') },
    conexiones: [],
    ultimo_contexto: null,
    contador_emocional: { necesario: 0, evitable: 0 },
    prediccion_basada_en_nota: null
  };
}

function loadLegacy() {
  const state = loadFinanceBrainState();
  if (state.legacyNeuronas?.length) return state.legacyNeuronas;
  return JSON.parse(JSON.stringify(DEFAULT_NEURONAS));
}

function persistLegacy(neuronas) {
  const state = loadFinanceBrainState();
  state.legacyNeuronas = neuronas;
  try { localStorage.setItem(NEURONAS_LS_KEY, JSON.stringify(neuronas)); } catch (_e) {}
  saveFinanceBrainState(state);
}

export function getAllNeuronas() { return loadLegacy(); }
export function getNeurona(id) { return loadLegacy().find((n) => n.id === id) || null; }
export function saveNeurona(neurona) {
  const data = neurona instanceof NeuronaFinanciera ? neurona.toJSON() : neurona;
  upsertLegacyNeurona(data);
}

export function calcularSimilitud(gasto, neurona) {
  const a = String(gasto.nombre || gasto.categoria || '').toLowerCase().split(/\s+/).filter(Boolean);
  const b = String(neurona.nombre || '').toLowerCase().split(/\s+/).filter(Boolean);
  const union = new Set([...a, ...b]);
  const inter = a.filter((w) => b.includes(w)).length;
  const textSim = union.size ? inter / union.size : 0;
  const ga = Number(gasto.monto || gasto.amount || 0);
  const na = Number(neurona.monto || 0);
  const amountSim = na > 0 ? Math.max(0, 1 - Math.abs(ga - na) / na) : ga === 0 ? 1 : 0;
  const tipoSim = (gasto.tipo || 'consumo') === neurona.tipo ? 1 : 0;
  return (textSim * 0.5) + (amountSim * 0.3) + (tipoSim * 0.2);
}

export function analizarContextoNota(nota) {
  const t = String(nota || '').toLowerCase();
  const rules = [
    ['emergencia', ['urgente', 'salud', 'hospital', 'se rompió', 'se rompio']],
    ['inversion', ['curso', 'herramienta', 'software', 'trabajo']],
    ['prevision', ['próximo', 'proximo', 'pago inicial', 'planificado', 'anticipo']],
    ['ocio', ['capricho', 'gusto', 'salida', 'lujo']]
  ];
  for (const [tipo, words] of rules) {
    const matches = words.filter((w) => t.includes(w));
    if (matches.length) return { tipo, palabrasClave: matches };
  }
  return { tipo: null, palabrasClave: [] };
}

export function actualizarSistemaFinanciero(datosDia) {
  const tx = (datosDia?.transacciones || []).map((g, i) => ({
    id: g.id || `manual_${Date.now()}_${i}`,
    date: g.date || new Date().toISOString(),
    type: g.tipo === 'ingreso' ? 'income' : 'expense',
    amount: g.tipo === 'ingreso' ? Math.abs(Number(g.monto || g.amount || 0)) : -Math.abs(Number(g.monto || g.amount || 0)),
    category: g.nombre || g.categoria || 'Gasto',
    note: g.notas || g.note || g.notes || ''
  }));
  const result = runFinanceBrainScan({ financeState: { movements: tx, accounts: [] } });
  const legacyFromNeurons = result.neurons.map(mapNeuronToLegacy);
  persistLegacy(legacyFromNeurons.length ? legacyFromNeurons : loadLegacy());
  return { neuronas: getAllNeuronas(), nuevas: legacyFromNeurons };
}

export function renderMapaNeuronal() {
  return `<section class="finCard"><h3>Mapa Neuronal Financiero</h3><div id="mnGrafo">Neural finance active</div></section>`;
}

export function neuronasInitGrafo() { return null; }
export function neuronasOpenAddModal() { return null; }
export function neuronasConfirmAdd() { return null; }

function readGlobalFinanceMovements() {
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  if (Array.isArray(g.state?.financeMovements)) return g.state.financeMovements;
  if (Array.isArray(g.state?.financeLedger)) return g.state.financeLedger;
  if (Array.isArray(g.window?.FINANCE?.state?.movements)) return g.window.FINANCE.state.movements;
  return [];
}

export function neuronasRunDayUpdate() {
  const today = new Date().toISOString().slice(0, 10);
  const transacciones = readGlobalFinanceMovements().filter((m) => String(m.date || '').slice(0, 10) === today).filter((m) => m.type === 'expense').map((m) => ({ nombre: m.category || m.reason || 'Gasto', monto: Math.abs(Number(m.amount) || 0), tipo: 'consumo', notas: m.note || m.notes || m.notas || '' }));
  return actualizarSistemaFinanciero({ transacciones, estres: 5 });
}

export function neuronasEscanearTodo() {
  const transacciones = readGlobalFinanceMovements().filter((m) => m.type === 'expense').map((m) => ({ nombre: m.category || m.reason || 'Gasto', monto: Math.abs(Number(m.amount) || 0), tipo: 'consumo', notas: m.note || m.notes || m.notas || '' }));
  if (!transacciones.length) return;
  return actualizarSistemaFinanciero({ transacciones, estres: 5 });
}

export function neuronasToggleFiltroNotas() { return null; }
export function neuronasReset() { persistLegacy(JSON.parse(JSON.stringify(DEFAULT_NEURONAS))); }
export function getFinanceBrainSummary() { return runFinanceBrainScan({}).summary; }

if (typeof window !== 'undefined') {
  window.actualizarSistemaFinanciero = actualizarSistemaFinanciero;
  window.renderMapaNeuronal = renderMapaNeuronal;
  window.neuronasInitGrafo = neuronasInitGrafo;
  window.neuronasOpenAddModal = neuronasOpenAddModal;
  window.neuronasConfirmAdd = neuronasConfirmAdd;
  window.neuronasRunDayUpdate = neuronasRunDayUpdate;
  window.neuronasEscanearTodo = neuronasEscanearTodo;
  window.neuronasToggleFiltroNotas = neuronasToggleFiltroNotas;
  window.neuronasReset = neuronasReset;
  window.getAllNeuronas = getAllNeuronas;
}
