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

const MN_FAMILY_COLOR = {
  flow:        { bg: '#7c5cff', border: '#9d82ff', font: '#fff' },
  habit:       { bg: '#2dd4bf', border: '#5eead4', font: '#0f2524' },
  risk:        { bg: '#f87171', border: '#fca5a5', font: '#3b0000' },
  opportunity: { bg: '#f59e0b', border: '#fcd34d', font: '#2c1a00' },
  ingreso:     { bg: '#34d399', border: '#6ee7b7', font: '#052e16' },
  consumo:     { bg: '#fb923c', border: '#fdba74', font: '#1c0500' },
  pasivo:      { bg: '#e879f9', border: '#f0abfc', font: '#1e001e' },
};

function _mnColorFor(n) {
  if (n.family && MN_FAMILY_COLOR[n.family]) return MN_FAMILY_COLOR[n.family];
  if (n.tipo && MN_FAMILY_COLOR[n.tipo]) return MN_FAMILY_COLOR[n.tipo];
  return { bg: '#6b7280', border: '#9ca3af', font: '#fff' };
}

function _mnPriorityBadge(p) {
  if (!p) return '';
  const map = { critical: 'high', high: 'high', medium: 'med', low: 'low' };
  const cls = map[p] || 'low';
  const label = { critical: 'Crítico', high: 'Alto', medium: 'Medio', low: 'Bajo' }[p] || p;
  return `<span class="neuroBadge ${cls}">${label}</span>`;
}

function _mnFamilyLabel(f) {
  return { flow: 'Flujo', habit: 'Hábito', risk: 'Riesgo', opportunity: 'Oportunidad' }[f] || f || '';
}

function _mnTypeLabel(t) {
  const map = {
    income_fixed: 'Ingreso Fijo', income_variable: 'Ingreso Variable',
    expense_essential: 'Gasto Esencial', expense_discretionary: 'Gasto Discrecional',
    debt_outflow: 'Salida Deuda', recurring_monthly: 'Recurrente Mensual',
    silent_leak: 'Filtración Silenciosa', impulse_spend: 'Gasto Impulsivo',
    easy_cut_candidate: 'Candidato a Cortar', savings_window: 'Ventana de Ahorro',
    deteriorating_margin: 'Margen Deteriorado', overdraft_risk: 'Riesgo Sobregiro',
  };
  return map[t] || (t || '').replace(/_/g, ' ');
}

function readGlobalFinanceAccounts() {
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  if (Array.isArray(g.state?.financeAccounts)) return g.state.financeAccounts;
  if (Array.isArray(g.window?.FINANCE?.state?.accounts)) return g.window.FINANCE.state.accounts;
  return [];
}

function buildMovementNeurons(movements = [], accounts = []) {
  const accountMap = new Map((accounts || []).map((a) => [a.id, a]));
  const active = (movements || []).filter((m) => m && !m.archived);
  return active.map((m, index) => {
    const rawAmount = Number(m.amount || 0);
    const amount = Math.abs(rawAmount);
    const isIncome = String(m.type || '').toLowerCase() === 'income';
    const acc = accountMap.get(m.accountId);
    const role = String(m.neuronRole || 'auto');
    const movementId = String(m.id || `idx_${index}`);
    const neuronId = String(m.neuronId || `mov_${movementId}`);
    return {
      id: neuronId,
      movementId,
      label: String(m.category || m.reason || (isIncome ? 'Ingreso' : 'Gasto') || 'Movimiento'),
      amount,
      role,
      family: isIncome ? 'flow' : (role === 'risk' ? 'risk' : role === 'opportunity' ? 'opportunity' : 'habit'),
      type: isIncome ? 'movement_income' : 'movement_expense',
      accountId: m.accountId || null,
      accountName: acc?.name || 'Cuenta',
      date: String(m.date || '').slice(0, 10),
      note: m.note || ''
    };
  });
}

export function renderMapaNeuronal() {
  const movements = readGlobalFinanceMovements();
  const accounts = readGlobalFinanceAccounts();
  const movementNeurons = buildMovementNeurons(movements, accounts);
  const brainState = loadFinanceBrainState();
  const neurons = brainState.neuronRegistry || [];
  const legacy = brainState.legacyNeuronas || [];
  const insights = brainState.insights || [];
  const lastScan = brainState.lastScanAt;
  const summary = brainState.latestScanSummary || {};

  const activeCount = neurons.length + movementNeurons.length;
  const insightCount = insights.length;

  const monthKey = new Date().toISOString().slice(0, 7);
  const monthData = (brainState.hippocampus?.monthly || {})[monthKey] || {};
  const pressureRaw = Math.round((monthData.pressureScore || 0) * 100);
  const leakRaw     = Math.round((monthData.leakScore || 0) * 100);
  const pressureColor = pressureRaw > 70 ? '#f87171' : pressureRaw > 40 ? '#fbbf24' : '#34d399';
  const leakColor     = leakRaw > 30 ? '#f87171' : leakRaw > 10 ? '#fbbf24' : '#34d399';

  const scanLabel = lastScan
    ? `Último escaneo: ${new Date(lastScan).toLocaleString('es-PE', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}`
    : 'Sin escaneo previo';

  const metricsHtml = `
    <div class="mnMetricsGrid">
      <div class="mnMetric">
        <div class="mnMetricVal">${activeCount}</div>
        <div class="mnMetricLabel">Neuronas activas</div>
      </div>
      <div class="mnMetric">
        <div class="mnMetricVal">${movementNeurons.length}</div>
        <div class="mnMetricLabel">Desde movimientos</div>
      </div>
      <div class="mnMetric">
        <div class="mnMetricVal">${insightCount}</div>
        <div class="mnMetricLabel">Insights</div>
      </div>
      <div class="mnMetric">
        <div class="mnMetricVal" style="color:${pressureColor}">${pressureRaw}%</div>
        <div class="mnMetricLabel">Presión</div>
      </div>
      <div class="mnMetric">
        <div class="mnMetricVal" style="color:${leakColor}">${leakRaw}%</div>
        <div class="mnMetricLabel">Filtración</div>
      </div>
    </div>`;

  const insightsHtml = insights.length ? `
    <div class="mnSubTitle">💡 Insights</div>
    <div class="neuroList">
      ${insights.map(i => `
        <div class="neuroItem">
          <div class="neuroRow">
            <div class="neuroMsg"><b>${i.title || ''}</b><br><span style="font-size:11px;opacity:.7">${i.message || ''}</span></div>
            ${_mnPriorityBadge(i.priority)}
          </div>
        </div>`).join('')}
    </div>` : `<div class="mnEmpty">Sin insights aún. Pulsa <b>Escanear</b> para analizar.</div>`;

  const neuronsListHtml = neurons.length ? `
    <div class="mnSubTitle" style="margin-top:14px">🔮 Neuronas detectadas</div>
    <div class="mnNeuronsList">
      ${neurons.map(n => {
        const c = _mnColorFor(n);
        const pct = Math.round((n.score || 0) * 100);
        return `<div class="mnNeuronChip" style="border-color:${c.border};background:${c.bg}22">
          <span class="mnNeuronDot" style="background:${c.bg}"></span>
          <span class="mnNeuronName">${_mnTypeLabel(n.type)}</span>
          <span class="mnNeuronScore">${pct}%</span>
          <span class="mnNeuronFamily">${_mnFamilyLabel(n.family)}</span>
        </div>`;
      }).join('')}
    </div>` : '';

  const movementNeuronListHtml = movementNeurons.length ? `
    <div class="mnSubTitle" style="margin-top:14px">🧾 Neuronas por movimiento</div>
    <div class="mnNeuronsList">
      ${movementNeurons.map((n) => {
        const c = _mnColorFor(n);
        return `<div class="mnNeuronChip" style="border-color:${c.border};background:${c.bg}22">
          <span class="mnNeuronDot" style="background:${c.bg}"></span>
          <span class="mnNeuronName">${n.label}</span>
          <span class="mnNeuronScore">S/ ${Math.round((n.amount || 0) * 100) / 100}</span>
          <span class="mnNeuronFamily">${n.date || n.accountName}</span>
        </div>`;
      }).join('')}
    </div>` : '<div class="mnEmpty">Sin movimientos para convertir en neuronas.</div>';

  const legendHtml = `
    <div class="mnLegend">
      ${Object.entries({ Flujo: '#7c5cff', Hábito: '#2dd4bf', Riesgo: '#f87171', Oportunidad: '#f59e0b' }).map(
        ([l, c]) => `<div class="mnLegendItem"><span class="mnLegendDot" style="background:${c}"></span>${l}</div>`
      ).join('')}
    </div>`;

  const isEmpty = activeCount === 0 && insightCount === 0;

  return `
    <section class="finSection">
      <div class="finSectionHead">
        <div class="finSectionTitle">🧠 Sistema Neuronal Financiero</div>
        <div style="display:flex;gap:6px">
          <button class="finIconBtn" onclick="neuronasRunScan()" title="Escanear">⚡ Escanear</button>
          <button class="finIconBtn" onclick="neuronasReset();neuronasRunScan()" title="Reiniciar">🔄</button>
        </div>
      </div>
      <div class="mnScanLabel">${scanLabel}</div>
      ${metricsHtml}
      <div class="mnGrafoWrap">
        <div id="mnGrafo" class="mnGrafo">${isEmpty ? '<div class="mnEmpty" style="padding:40px 0">Pulsa ⚡ Escanear para activar el mapa neuronal</div>' : ''}</div>
        ${legendHtml}
      </div>
      ${insightsHtml}
      ${neuronsListHtml}
      ${movementNeuronListHtml}
    </section>`;
}

export function neuronasInitGrafo() {
  const container = typeof document !== 'undefined' ? document.getElementById('mnGrafo') : null;
  if (!container) return null;

  const brainState = loadFinanceBrainState();
  const patternNeurons = brainState.neuronRegistry || [];
  const legacyNeurons = brainState.legacyNeuronas || [];
  const movementNeurons = buildMovementNeurons(readGlobalFinanceMovements(), readGlobalFinanceAccounts());

  if (!patternNeurons.length && !legacyNeurons.length && !movementNeurons.length) return null;

  const vis = (typeof window !== 'undefined' && window.vis) ? window.vis : null;
  if (!vis) return null;

  const nodes = [];
  const edges = [];

  patternNeurons.forEach(n => {
    const c = _mnColorFor(n);
    const pct = Math.round((n.score || 0) * 100);
    nodes.push({
      id: n.id,
      label: `${_mnTypeLabel(n.type)}\n${pct}%`,
      color: { background: c.bg, border: c.border, highlight: { background: c.bg, border: '#fff' } },
      font: { color: c.font, size: 11, face: 'system-ui, sans-serif' },
      size: 18 + Math.round((n.score || 0) * 18),
      shape: n.family === 'risk' ? 'diamond' : n.family === 'opportunity' ? 'star' : 'ellipse',
      title: `${_mnTypeLabel(n.type)} (${_mnFamilyLabel(n.family)})\nScore: ${pct}%\nConfianza: ${Math.round((n.confidence || 0) * 100)}%`,
    });
  });

  legacyNeurons.forEach(n => {
    if (nodes.find(x => x.id === n.id)) return;
    const c = _mnColorFor(n);
    nodes.push({
      id: n.id,
      label: (n.nombre || n.id).slice(0, 18),
      color: { background: c.bg, border: c.border, highlight: { background: c.bg, border: '#fff' } },
      font: { color: c.font, size: 11, face: 'system-ui, sans-serif' },
      size: 14 + Math.round((n.peso || 0.5) * 12),
      shape: 'box',
      title: `${n.nombre || n.id} (${n.tipo || ''})\nMonto: ${n.monto || 0}`,
    });
    (n.conexiones || []).forEach(targetId => {
      if (nodes.find(x => x.id === targetId) || legacyNeurons.find(x => x.id === targetId)) {
        edges.push({ from: n.id, to: targetId, color: { color: c.bg + '88' }, width: 2 });
      }
    });
  });

  const accountNodeIds = new Set();
  movementNeurons.forEach((n) => {
    const c = _mnColorFor(n);
    const size = Math.max(12, Math.min(34, 12 + Math.round(Math.log10((n.amount || 1) + 1) * 10)));
    nodes.push({
      id: n.id,
      label: `${n.label}\nS/ ${Math.round((n.amount || 0) * 100) / 100}`,
      color: { background: c.bg, border: c.border, highlight: { background: c.bg, border: '#fff' } },
      font: { color: c.font, size: 10, face: 'system-ui, sans-serif' },
      size,
      shape: 'dot',
      title: `${n.label}\nFecha: ${n.date || '-'}\nCuenta: ${n.accountName}\nRol: ${n.role}`,
    });
    if (n.accountId) {
      const accNodeId = `acc_${n.accountId}`;
      if (!accountNodeIds.has(accNodeId)) {
        accountNodeIds.add(accNodeId);
        nodes.push({
          id: accNodeId,
          label: n.accountName,
          color: { background: '#111827', border: '#6b7280', highlight: { background: '#1f2937', border: '#9ca3af' } },
          font: { color: '#f3f4f6', size: 11, face: 'system-ui, sans-serif' },
          size: 20,
          shape: 'box',
          title: `Cuenta financiera: ${n.accountName}`,
        });
      }
      edges.push({ from: n.id, to: accNodeId, color: { color: '#6b728088' }, width: 1.5 });
    }
  });

  container.innerHTML = '';
  container.style.height = '260px';

  try {
    new vis.Network(container, { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) }, {
      physics: { enabled: true, stabilization: { iterations: 80 }, barnesHut: { gravitationalConstant: -4000, springLength: 95 } },
      interaction: { dragNodes: true, zoomView: true, tooltipDelay: 100 },
      edges: { smooth: { type: 'continuous' }, arrows: { to: { enabled: true, scaleFactor: 0.5 } } },
      layout: { improvedLayout: true },
    });
  } catch (_e) {
    container.innerHTML = '<div class="mnEmpty">No se pudo renderizar el grafo. Actualiza la página e intenta de nuevo.</div>';
  }

  return null;
}

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
export function neuronasReset() {
  const state = loadFinanceBrainState();
  state.legacyNeuronas = JSON.parse(JSON.stringify(DEFAULT_NEURONAS));
  state.neuronRegistry = [];
  state.insights = [];
  state.hippocampus = { daily: {}, weekly: {}, monthly: {}, patternHistory: [], neuronHistory: [] };
  state.lastScanAt = null;
  state.latestScanSummary = null;
  saveFinanceBrainState(state);
  try { localStorage.setItem(NEURONAS_LS_KEY, JSON.stringify(state.legacyNeuronas)); } catch (_e) {}
}
export function getFinanceBrainSummary() { return runFinanceBrainScan({}).summary; }

export function neuronasRunScan() {
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  const movements = Array.isArray(g.state?.financeLedger) ? g.state.financeLedger
    : Array.isArray(g.state?.financeMovements) ? g.state.financeMovements : [];
  const accounts = Array.isArray(g.state?.financeAccounts) ? g.state.financeAccounts : [];
  runFinanceBrainScan({ financeState: { movements, accounts } });
  if (typeof g.view === 'function') {
    g.view();
    // Wait one tick for view() to flush the DOM before re-initializing the graph
    setTimeout(() => { try { neuronasInitGrafo(); } catch (_e) {} }, 50);
  }
}

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
  window.neuronasRunScan = neuronasRunScan;
  window.getAllNeuronas = getAllNeuronas;
}
