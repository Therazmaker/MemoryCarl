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
  const neuronas = getAllNeuronas();
  const top = neuronas
    .slice()
    .sort((a, b) => Number(b.peso || 0) - Number(a.peso || 0))
    .slice(0, 5)
    .map((n) => `<li><b>${_escapeHtml(n.nombre)}</b> · ${_escapeHtml(n.tipo)} · peso ${Number(n.peso || 0).toFixed(2)}</li>`)
    .join('');

  return `
    <section class="finCard" style="padding:0;overflow:hidden;">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #1a1a1a;">
        <h3 style="margin:0;">Mapa Neuronal Financiero</h3>
        <div style="display:flex;gap:8px;">
          <button class="finIconBtn" onclick="neuronasEscanearTodo()" title="Escanear historial">🔄</button>
          <button class="finIconBtn" onclick="neuronasOpenAddModal()" title="Agregar neurona manual">＋</button>
        </div>
      </div>

      <div id="mnQuickSummary" style="padding:10px 16px;border-bottom:1px solid #1a1a1a;font-size:12px;color:#9ca3af;">
        ${neuronas.length > 0
          ? `Neuronas activas: <b>${neuronas.length}</b><ul style="margin:6px 0 0 14px;padding:0;">${top}</ul>`
          : 'Sin neuronas activas todavía. Presiona 🔄 para aprender del historial.'}
      </div>

      <div id="mnGrafo" style="width:100%;height:420px;background:#0b1220;position:relative;">
        <div id="mnGrafoPlaceholder" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#6b7280;font-size:13px;">
          Cargando mapa neuronal…
        </div>
      </div>
      <div id="mnDetallePanel" style="padding:10px 16px;border-top:1px solid #1a1a1a;font-size:12px;color:#9ca3af;">
        Selecciona un nodo para ver detalle.
      </div>
    </section>
  `;
}

function _escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _buildGraphFromLegacy(neuronas) {
  const maxMonto = Math.max(1, ...neuronas.map((n) => Number(n.monto || 0)));
  const colors = {
    ingreso: { background: '#16a34a', border: '#15803d', font: '#fff' },
    consumo: { background: '#f59e0b', border: '#d97706', font: '#111' },
    pasivo: { background: '#ef4444', border: '#b91c1c', font: '#fff' },
    prevision: { background: '#a78bfa', border: '#7c3aed', font: '#fff' }
  };

  const nodes = neuronas.map((n) => ({
    id: n.id,
    label: n.nombre,
    value: 10 + (Number(n.monto || 0) / maxMonto) * 25,
    color: colors[n.tipo] || { background: '#64748b', border: '#334155', font: '#fff' },
    title: `${n.nombre}\nTipo: ${n.tipo}\nMonto: ${Number(n.monto || 0).toFixed(2)}\nPeso: ${Number(n.peso || 0).toFixed(2)}`
  }));

  const nodeIds = new Set(neuronas.map((n) => n.id));
  const edges = [];
  for (const n of neuronas) {
    for (const c of (Array.isArray(n.conexiones) ? n.conexiones : [])) {
      if (nodeIds.has(c)) edges.push({ from: n.id, to: c });
    }
  }

  return { nodes, edges };
}

function _renderFallbackList(container, neuronas) {
  const rows = neuronas
    .slice()
    .sort((a, b) => Number(b.peso || 0) - Number(a.peso || 0))
    .slice(0, 18)
    .map((n) => `<div style="padding:8px 10px;border-bottom:1px solid #172036;display:flex;justify-content:space-between;gap:12px;">
      <span style="color:#e5e7eb;">${_escapeHtml(n.nombre)}</span>
      <span style="color:#93c5fd;">${_escapeHtml(n.tipo)} · ${Number(n.peso || 0).toFixed(2)}</span>
    </div>`)
    .join('');
  container.innerHTML = `<div style="height:100%;overflow:auto;">${rows || '<div style="padding:12px;color:#6b7280;">Sin neuronas disponibles.</div>'}</div>`;
}

export function neuronasInitGrafo() {
  const container = typeof document !== 'undefined' ? document.getElementById('mnGrafo') : null;
  if (!container) return;

  const neuronas = getAllNeuronas();
  if (!neuronas.length) {
    container.innerHTML = '<div style="padding:16px;color:#6b7280;">No hay neuronas activas. Ejecuta un escaneo.</div>';
    return;
  }

  const placeholder = document.getElementById('mnGrafoPlaceholder');
  if (placeholder) placeholder.style.display = 'none';

  if (typeof window === 'undefined' || !window.vis || !window.vis.Network) {
    _renderFallbackList(container, neuronas);
    return;
  }

  const { nodes, edges } = _buildGraphFromLegacy(neuronas);
  // eslint-disable-next-line no-undef
  const network = new window.vis.Network(container, {
    nodes: new window.vis.DataSet(nodes),
    edges: new window.vis.DataSet(edges)
  }, {
    physics: { stabilization: true },
    nodes: { shape: 'dot', scaling: { min: 12, max: 35 }, font: { color: '#e5e7eb' } },
    edges: { color: { color: '#334155' } },
    interaction: { hover: true }
  });

  network.on('click', (params) => {
    const detail = document.getElementById('mnDetallePanel');
    if (!detail) return;
    const id = params.nodes?.[0];
    const n = neuronas.find((x) => x.id === id);
    if (!n) return;
    detail.innerHTML = `
      <b>${_escapeHtml(n.nombre)}</b> · ${_escapeHtml(n.tipo)}
      <div style="margin-top:6px;color:#9ca3af;">Monto: ${Number(n.monto || 0).toFixed(2)} · Peso: ${Number(n.peso || 0).toFixed(2)}</div>
      <div style="margin-top:4px;color:#6b7280;">Contexto: ${_escapeHtml(n.metadata?.contexto_tipo || 'sin contexto')}</div>
    `;
  });
}

export function neuronasOpenAddModal() {
  if (typeof window === 'undefined') return;
  const nombre = window.prompt('Nombre de la neurona financiera:');
  if (!nombre) return;
  const montoTxt = window.prompt('Monto de referencia:', '0');
  const tipo = window.prompt('Tipo (ingreso | consumo | pasivo):', 'consumo') || 'consumo';
  const n = new NeuronaFinanciera({ nombre, monto: Number(montoTxt || 0), tipo });
  saveNeurona(n);
  neuronasInitGrafo();
}

export function neuronasConfirmAdd() { return neuronasOpenAddModal(); }

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
  const result = actualizarSistemaFinanciero({ transacciones, estres: 5 });
  try { neuronasInitGrafo(); } catch (_e) {}
  return result;
}

export function neuronasEscanearTodo() {
  const transacciones = readGlobalFinanceMovements().filter((m) => m.type === 'expense').map((m) => ({ nombre: m.category || m.reason || 'Gasto', monto: Math.abs(Number(m.amount) || 0), tipo: 'consumo', notas: m.note || m.notes || m.notas || '' }));
  if (!transacciones.length) return;
  const result = actualizarSistemaFinanciero({ transacciones, estres: 5 });
  try { neuronasInitGrafo(); } catch (_e) {}
  return result;
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
  setTimeout(() => { try { neuronasInitGrafo(); } catch (_e) {} }, 60);
}
