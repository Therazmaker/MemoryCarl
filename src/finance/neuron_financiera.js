/*************************************************************
 * SISTEMA DE NEURONAS FINANCIERAS — MemoryCarl
 * Carlos Herraz · MemoryCarl
 *
 * Exports:
 *   NeuronaFinanciera          — clase de nodo neuronal
 *   calcularSimilitud          — función pura de similitud (testeable)
 *   actualizarSistemaFinanciero — lógica de aprendizaje diario
 *   renderMapaNeuronal         — HTML de la pestaña Mapa Neuronal
 *   neuronasInitGrafo          — inicializa vis-Network en el DOM
 *
 * Deps (browser globals set by main.js or inline onclick):
 *   toast(), escapeHtml() — usados si disponibles; hay fallbacks
 *************************************************************/

const NEURONAS_LS_KEY = 'memorycarl_neuronas_financieras';

/* ── Seed data (mirrors finanzas_neuronas.json) ──────────── */
const DEFAULT_NEURONAS = [
  {
    id: 'ingreso_principal',
    tipo: 'ingreso',
    nombre: 'Sueldo Principal',
    monto: 0,
    peso: 1.0,
    metadata: { fecha_limite: null, prioridad: 'high', elasticidad: 0.1 },
    conexiones: ['consumo_madre']
  },
  {
    id: 'ingreso_secundario',
    tipo: 'ingreso',
    nombre: 'Ingresos Extra',
    monto: 0,
    peso: 0.6,
    metadata: { fecha_limite: null, prioridad: 'low', elasticidad: 0.8 },
    conexiones: ['consumo_madre']
  },
  {
    id: 'consumo_madre',
    tipo: 'consumo',
    nombre: 'Consumo',
    monto: 0,
    peso: 0.8,
    metadata: { fecha_limite: null, prioridad: 'mid', elasticidad: 0.5 },
    conexiones: ['consumo_mercado', 'consumo_servicios', 'consumo_transporte']
  },
  {
    id: 'consumo_mercado',
    tipo: 'consumo',
    nombre: 'Mercado',
    monto: 600,
    peso: 0.7,
    metadata: { fecha_limite: null, prioridad: 'high', elasticidad: 0.3 },
    conexiones: []
  },
  {
    id: 'consumo_servicios',
    tipo: 'consumo',
    nombre: 'Servicios',
    monto: 200,
    peso: 0.6,
    metadata: { fecha_limite: null, prioridad: 'mid', elasticidad: 0.2 },
    conexiones: []
  },
  {
    id: 'consumo_transporte',
    tipo: 'consumo',
    nombre: 'Transporte',
    monto: 150,
    peso: 0.5,
    metadata: { fecha_limite: null, prioridad: 'mid', elasticidad: 0.4 },
    conexiones: []
  }
];

/* ── NeuronaFinanciera Class ─────────────────────────────── */
export class NeuronaFinanciera {
  /**
   * @param {object} opts
   * @param {string}  [opts.id]         — id único; se genera si se omite
   * @param {string}   opts.tipo        — 'ingreso' | 'pasivo' | 'consumo'
   * @param {string}   opts.nombre
   * @param {number}   opts.monto
   * @param {number}  [opts.peso=0.5]   — 0–1
   * @param {object}  [opts.metadata]
   * @param {string[]}[opts.conexiones]
   */
  constructor({ id, tipo, nombre, monto, peso = 0.5, metadata = {}, conexiones = [] }) {
    this.id = id || NeuronaFinanciera.generateId(nombre);
    this.tipo = tipo;
    this.nombre = nombre;
    this.monto = Number(monto) || 0;
    this.peso = Math.max(0, Math.min(1, Number(peso) || 0.5));
    this.metadata = {
      fecha_limite: metadata.fecha_limite || null,
      prioridad: metadata.prioridad || 'mid',
      elasticidad: Number(metadata.elasticidad) || 0.3
    };
    this.conexiones = Array.isArray(conexiones) ? [...conexiones] : [];
  }

  /** Genera un id único basado en el nombre y timestamp. */
  static generateId(nombre = '') {
    const base = String(nombre)
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 20);
    const rand = Math.random().toString(36).slice(2, 7);
    return `${base || 'neurona'}_${Date.now().toString(36)}_${rand}`;
  }

  toJSON() {
    return {
      id: this.id,
      tipo: this.tipo,
      nombre: this.nombre,
      monto: this.monto,
      peso: this.peso,
      metadata: { ...this.metadata },
      conexiones: [...this.conexiones]
    };
  }
}

/* ── localStorage helpers ────────────────────────────────── */
function _neuronasLoad() {
  try {
    const raw = localStorage.getItem(NEURONAS_LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_e) { /* ignore */ }
  return JSON.parse(JSON.stringify(DEFAULT_NEURONAS));
}

function _neuronasSave(neuronas) {
  try {
    localStorage.setItem(NEURONAS_LS_KEY, JSON.stringify(neuronas));
  } catch (_e) { /* ignore */ }
}

/* ── Public read/write ───────────────────────────────────── */
export function getAllNeuronas() {
  return _neuronasLoad();
}

export function getNeurona(id) {
  return _neuronasLoad().find(n => n.id === id) || null;
}

export function saveNeurona(neurona) {
  const neuronas = _neuronasLoad();
  const data = neurona instanceof NeuronaFinanciera ? neurona.toJSON() : neurona;
  const idx = neuronas.findIndex(n => n.id === data.id);
  if (idx >= 0) {
    neuronas[idx] = data;
  } else {
    neuronas.push(data);
  }
  _neuronasSave(neuronas);
}

/* ── Similarity (pure — exported for testing) ───────────── */
/**
 * Calcula la similitud (0–1) entre un gasto y una neurona.
 * Combina: solapamiento textual (50%), proximidad de monto (30%), tipo (20%).
 *
 * @param {{ nombre?: string, monto?: number, tipo?: string }} gasto
 * @param {{ nombre: string, monto: number, tipo: string }}    neurona
 * @returns {number}
 */
export function calcularSimilitud(gasto, neurona) {
  const nombreGasto = String(gasto.nombre || gasto.categoria || '').toLowerCase();
  const nombreNeurona = String(neurona.nombre || '').toLowerCase();

  const wordsGasto = new Set(nombreGasto.split(/\s+/).filter(Boolean));
  const wordsNeurona = new Set(nombreNeurona.split(/\s+/).filter(Boolean));
  const intersection = [...wordsGasto].filter(w => wordsNeurona.has(w)).length;
  const union = new Set([...wordsGasto, ...wordsNeurona]).size;
  const textSim = union > 0 ? intersection / union : 0;

  const montoGasto = Number(gasto.monto || gasto.amount || 0);
  const montoNeurona = Number(neurona.monto || 0);
  const amountSim = montoNeurona > 0
    ? Math.max(0, 1 - Math.abs(montoGasto - montoNeurona) / montoNeurona)
    : (montoGasto === 0 ? 1 : 0);

  const tipoGasto = gasto.tipo || 'consumo';
  const tipoSim = tipoGasto === neurona.tipo ? 1 : 0;

  return (textSim * 0.5) + (amountSim * 0.3) + (tipoSim * 0.2);
}

/* ── actualizarSistemaFinanciero ─────────────────────────── */
/**
 * Lógica de aprendizaje diario:
 *  1. Ajusta los pesos de neuronas "pasivo" próximas a su fecha límite.
 *  2. Crea nuevas neuronas (mitosis) cuando un gasto no coincide >80%
 *     con ninguna neurona de consumo existente.
 *
 * @param {{ transacciones?: object[], estres?: number }} datosDia
 * @returns {{ neuronas: object[], nuevas: object[] }}
 */
export function actualizarSistemaFinanciero(datosDia) {
  const { transacciones = [], estres = 0 } = datosDia || {};
  const neuronas = _neuronasLoad();
  const hoy = new Date();
  const UMBRAL_SIMILITUD = 0.80;
  const nuevas = [];

  /* 1 — Ajustar pesos de pasivos según fecha límite y estrés */
  for (const n of neuronas) {
    if (n.tipo === 'pasivo' && n.metadata && n.metadata.fecha_limite) {
      const limite = new Date(n.metadata.fecha_limite);
      const diasRestantes = Math.max(0, (limite - hoy) / (1000 * 60 * 60 * 24));
      const factorEstres = 1 + (Math.min(10, Number(estres) || 0) / 10) * 0.2;
      if (diasRestantes <= 7) {
        n.peso = Math.min(1, n.peso * 1.3 * factorEstres);
      } else if (diasRestantes <= 30) {
        const urgency = 1 + (1 - diasRestantes / 30) * 0.15;
        n.peso = Math.min(1, n.peso * urgency * factorEstres);
      }
    }
  }

  /* 2 — Procesar transacciones → mitosis si similitud < umbral */
  const consumoNeuronas = () => neuronas.filter(n => n.tipo === 'consumo');

  for (const gasto of transacciones) {
    const current = consumoNeuronas();
    if (current.length === 0) continue;

    let bestSim = 0;
    let bestMatch = null;
    for (const n of current) {
      const sim = calcularSimilitud(gasto, n);
      if (sim > bestSim) { bestSim = sim; bestMatch = n; }
    }

    if (bestSim < UMBRAL_SIMILITUD) {
      /* Mitosis: crear neurona nueva */
      const estr = Math.min(10, Number(estres) || 0);
      const nueva = new NeuronaFinanciera({
        tipo: gasto.tipo || 'consumo',
        nombre: gasto.nombre || gasto.categoria || 'Gasto Nuevo',
        monto: Number(gasto.monto || gasto.amount || 0),
        peso: Math.min(1, 0.4 + (estr / 10) * 0.3),
        metadata: {
          fecha_limite: null,
          prioridad: estr > 7 ? 'high' : estr > 4 ? 'mid' : 'low',
          elasticidad: 0.5
        },
        conexiones: ['consumo_madre']
      });

      /* Conectar madre → nueva */
      const madreIdx = neuronas.findIndex(n => n.id === 'consumo_madre');
      if (madreIdx >= 0 && !neuronas[madreIdx].conexiones.includes(nueva.id)) {
        neuronas[madreIdx].conexiones.push(nueva.id);
      }

      neuronas.push(nueva.toJSON());
      nuevas.push(nueva.toJSON());
    } else if (bestMatch) {
      /* Actualizar monto de la neurona mejor coincidente (EMA α=0.3) */
      const idx = neuronas.findIndex(n => n.id === bestMatch.id);
      if (idx >= 0) {
        const alpha = 0.3;
        neuronas[idx].monto =
          (1 - alpha) * Number(neuronas[idx].monto || 0) +
          alpha * Number(gasto.monto || gasto.amount || 0);
      }
    }
  }

  _neuronasSave(neuronas);
  return { neuronas, nuevas };
}

/* ── renderMapaNeuronal ──────────────────────────────────── */
/**
 * Devuelve el HTML de la pestaña "Mapa Neuronal".
 * El grafo se inicializa después con neuronasInitGrafo().
 */
export function renderMapaNeuronal() {
  return `
    <section class="card homeCard homeWide" style="padding:0;overflow:hidden;">
      <div style="padding:16px 16px 8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <h2 class="cardTitle" style="margin:0;">🧠 Mapa Neuronal</h2>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="finIconBtn" onclick="neuronasOpenAddModal()" title="Agregar neurona">＋</button>
          <button class="finIconBtn" onclick="neuronasRunDayUpdate()" title="Actualizar con transacciones del día">⚡</button>
          <button class="finIconBtn" onclick="neuronasReset()" title="Restablecer datos de ejemplo">↺</button>
        </div>
      </div>
      <div id="mnLeyenda" style="display:flex;gap:12px;padding:0 16px 8px;flex-wrap:wrap;">
        <span style="display:flex;align-items:center;gap:4px;font-size:12px;color:#aaa;">
          <span style="width:12px;height:12px;border-radius:50%;background:#22c55e;display:inline-block;"></span>Ingreso
        </span>
        <span style="display:flex;align-items:center;gap:4px;font-size:12px;color:#aaa;">
          <span style="width:12px;height:12px;border-radius:50%;background:#ef4444;display:inline-block;"></span>Pasivo
        </span>
        <span style="display:flex;align-items:center;gap:4px;font-size:12px;color:#aaa;">
          <span style="width:12px;height:12px;border-radius:50%;background:#f59e0b;display:inline-block;"></span>Consumo
        </span>
        <span style="display:flex;align-items:center;gap:4px;font-size:12px;color:#aaa;">
          <span style="width:12px;height:12px;border-radius:50%;background:#6b7280;display:inline-block;"></span>Tamaño = Monto
        </span>
      </div>
      <div id="mnGrafo" style="width:100%;height:420px;background:#0d0d0d;border-radius:0;position:relative;">
        <div id="mnGrafoPlaceholder" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#555;font-size:13px;">
          Cargando Mapa Neuronal…
        </div>
      </div>
      <div id="mnDetallePanel" style="padding:12px 16px;min-height:64px;border-top:1px solid #1e1e1e;">
        <div class="muted" style="font-size:13px;">Haz clic en un nodo para ver sus detalles.</div>
      </div>
    </section>
  `;
}

/* ── neuronasInitGrafo ───────────────────────────────────── */
/**
 * Inicializa el grafo vis-Network en el contenedor #mnGrafo.
 * Requiere que vis-Network esté cargado globalmente (window.vis).
 */
export function neuronasInitGrafo() {
  const container = document.getElementById('mnGrafo');
  if (!container) return;

  /* Limpiar instancia anterior */
  if (container.__visNetwork) {
    try { container.__visNetwork.destroy(); } catch (_e) { /* ignore */ }
    container.__visNetwork = null;
  }

  if (typeof window === 'undefined' || typeof window.vis === 'undefined' || !window.vis.Network) {
    container.innerHTML = `
      <div style="color:#aaa;text-align:center;padding:40px;font-size:13px;">
        La librería vis-Network no está disponible.<br>
        <span style="color:#666;font-size:11px;">Verifica la conexión a internet e intenta recargando.</span>
      </div>`;
    return;
  }

  const placeholder = document.getElementById('mnGrafoPlaceholder');
  if (placeholder) placeholder.style.display = 'none';

  const neuronas = _neuronasLoad();

  const COLORS = {
    ingreso: { background: '#22c55e', border: '#16a34a', font: '#fff' },
    pasivo:  { background: '#ef4444', border: '#b91c1c', font: '#fff' },
    consumo: { background: '#f59e0b', border: '#d97706', font: '#111' }
  };

  const maxMonto = Math.max(...neuronas.map(n => Number(n.monto) || 0), 1);

  const nodesArr = neuronas.map(n => {
    const color = COLORS[n.tipo] || { background: '#6b7280', border: '#4b5563', font: '#fff' };
    const size = 10 + (Number(n.monto || 0) / maxMonto) * 40;
    return {
      id: n.id,
      label: n.nombre,
      title: `${n.nombre}\nMonto: S/ ${Number(n.monto || 0).toFixed(2)}\nPeso: ${Number(n.peso || 0).toFixed(2)}\nTipo: ${n.tipo}`,
      color: {
        background: color.background,
        border: color.border,
        highlight: { background: color.border, border: color.background }
      },
      font: { color: color.font, size: 12 },
      size,
      opacity: Math.max(0.3, Number(n.peso) || 0.5),
      _data: n
    };
  });

  const edgesArr = [];
  const edgeSet = new Set();
  for (const n of neuronas) {
    for (const targetId of (n.conexiones || [])) {
      const key = [n.id, targetId].sort().join('--');
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edgesArr.push({
          from: n.id,
          to: targetId,
          width: 1 + Number(n.peso || 0.5) * 3,
          color: { color: '#444', highlight: '#7c5cff', opacity: 0.8 },
          smooth: { type: 'dynamic' }
        });
      }
    }
  }

  const data = {
    nodes: new window.vis.DataSet(nodesArr),
    edges: new window.vis.DataSet(edgesArr)
  };

  const options = {
    physics: {
      enabled: true,
      solver: 'forceAtlas2Based',
      forceAtlas2Based: {
        gravitationalConstant: -50,
        centralGravity: 0.01,
        springLength: 120,
        springConstant: 0.08,
        damping: 0.4
      },
      stabilization: { iterations: 200 }
    },
    interaction: { hover: true, zoomView: true, dragNodes: true, tooltipDelay: 200 },
    nodes: { shape: 'dot', borderWidth: 2, chosen: true },
    edges: { smooth: { type: 'dynamic' } }
  };

  const network = new window.vis.Network(container, data, options);
  container.__visNetwork = network;

  network.on('click', params => {
    const panel = document.getElementById('mnDetallePanel');
    if (!panel) return;
    if (params.nodes.length > 0) {
      const nodeId = params.nodes[0];
      const node = nodesArr.find(nd => nd.id === nodeId);
      if (node && node._data) {
        const nd = node._data;
        const esc = typeof escapeHtml === 'function' ? escapeHtml : _escapeHtml;
        panel.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:4px;">
            <div style="font-weight:700;font-size:15px;">${esc(nd.nombre)}</div>
            <div style="font-size:13px;color:#aaa;">
              <b>Tipo:</b> ${esc(nd.tipo)} &nbsp;|&nbsp;
              <b>Monto:</b> S/ ${Number(nd.monto || 0).toFixed(2)} &nbsp;|&nbsp;
              <b>Peso:</b> ${Number(nd.peso || 0).toFixed(2)}
            </div>
            <div style="font-size:12px;color:#666;">
              <b>Prioridad:</b> ${esc(nd.metadata?.prioridad || '—')} &nbsp;|&nbsp;
              <b>Elasticidad:</b> ${nd.metadata?.elasticidad ?? '—'} &nbsp;|&nbsp;
              <b>Fecha límite:</b> ${esc(nd.metadata?.fecha_limite || '—')}
            </div>
            <div style="font-size:12px;color:#555;">
              <b>Conexiones:</b> ${(nd.conexiones || []).map(c => esc(c)).join(', ') || 'ninguna'}
            </div>
          </div>`;
      }
    } else {
      panel.innerHTML = `<div class="muted" style="font-size:13px;">Haz clic en un nodo para ver sus detalles.</div>`;
    }
  });
}

/* ── Modal: agregar neurona ──────────────────────────────── */
export function neuronasOpenAddModal() {
  const existing = document.getElementById('mnAddModal');
  if (existing) existing.remove();

  const div = document.createElement('div');
  div.id = 'mnAddModal';
  div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  div.innerHTML = `
    <div style="background:#1a1a2e;border-radius:16px;padding:20px;width:100%;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.5);max-height:90vh;overflow-y:auto;">
      <div style="font-weight:700;font-size:16px;margin-bottom:14px;">➕ Nueva Neurona</div>
      <label style="font-size:13px;color:#aaa;">Nombre</label>
      <input id="mnNombre" type="text" placeholder="Ej: Alquiler, Spotify…"
        style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #333;background:#111;color:#fff;margin:4px 0 10px;" />
      <label style="font-size:13px;color:#aaa;">Tipo</label>
      <select id="mnTipo"
        style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #333;background:#111;color:#fff;margin:4px 0 10px;">
        <option value="ingreso">Ingreso</option>
        <option value="pasivo">Pasivo</option>
        <option value="consumo" selected>Consumo</option>
      </select>
      <label style="font-size:13px;color:#aaa;">Monto (S/)</label>
      <input id="mnMonto" type="number" min="0" placeholder="0"
        style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #333;background:#111;color:#fff;margin:4px 0 10px;" />
      <label style="font-size:13px;color:#aaa;">Peso (0–1)</label>
      <input id="mnPeso" type="number" min="0" max="1" step="0.01" placeholder="0.5"
        style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #333;background:#111;color:#fff;margin:4px 0 10px;" />
      <label style="font-size:13px;color:#aaa;">Prioridad</label>
      <select id="mnPrioridad"
        style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #333;background:#111;color:#fff;margin:4px 0 10px;">
        <option value="low">Baja</option>
        <option value="mid" selected>Media</option>
        <option value="high">Alta</option>
      </select>
      <label style="font-size:13px;color:#aaa;">Fecha límite (opcional)</label>
      <input id="mnFecha" type="date"
        style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #333;background:#111;color:#fff;margin:4px 0 16px;" />
      <div style="display:flex;gap:8px;">
        <button onclick="neuronasConfirmAdd()"
          style="flex:1;padding:10px;border-radius:8px;background:#7c5cff;color:#fff;border:none;cursor:pointer;font-weight:600;">
          Guardar
        </button>
        <button onclick="document.getElementById('mnAddModal').remove()"
          style="flex:1;padding:10px;border-radius:8px;background:#333;color:#fff;border:none;cursor:pointer;">
          Cancelar
        </button>
      </div>
    </div>`;
  document.body.appendChild(div);
}

export function neuronasConfirmAdd() {
  const nombre = (document.getElementById('mnNombre')?.value || '').trim();
  if (!nombre) { alert('El nombre es requerido'); return; }
  const tipo = document.getElementById('mnTipo')?.value || 'consumo';
  const monto = parseFloat(document.getElementById('mnMonto')?.value) || 0;
  const peso = Math.max(0, Math.min(1, parseFloat(document.getElementById('mnPeso')?.value) || 0.5));
  const prioridad = document.getElementById('mnPrioridad')?.value || 'mid';
  const fecha = document.getElementById('mnFecha')?.value || null;

  const nueva = new NeuronaFinanciera({
    tipo,
    nombre,
    monto,
    peso,
    metadata: { fecha_limite: fecha, prioridad, elasticidad: 0.3 },
    conexiones: tipo === 'consumo' ? ['consumo_madre'] : []
  });
  saveNeurona(nueva);
  document.getElementById('mnAddModal')?.remove();
  setTimeout(() => { try { neuronasInitGrafo(); } catch (_e) { /* ignore */ } }, 100);
}

export function neuronasRunDayUpdate() {
  const movs = (typeof state !== 'undefined' && Array.isArray(state.financeMovements))
    ? state.financeMovements
    : [];
  const today = new Date().toISOString().slice(0, 10);
  const transacciones = movs
    .filter(m => m.date === today && m.type === 'expense')
    .map(m => ({
      nombre: m.category || m.reason || 'Gasto',
      monto: Math.abs(Number(m.amount) || 0),
      tipo: 'consumo'
    }));

  const result = actualizarSistemaFinanciero({ transacciones, estres: 5 });
  const msg = result.nuevas.length > 0
    ? `⚡ ${result.nuevas.length} nueva(s) neurona(s) creada(s)`
    : '✅ Sistema actualizado, sin nuevas neuronas';

  if (typeof toast === 'function') toast(msg);
  else console.info('[NeuronaFinanciera]', msg);

  setTimeout(() => { try { neuronasInitGrafo(); } catch (_e) { /* ignore */ } }, 100);
}

export function neuronasReset() {
  if (!confirm('¿Restablecer las neuronas a los datos de ejemplo? Se perderán los cambios.')) return;
  try { localStorage.removeItem(NEURONAS_LS_KEY); } catch (_e) { /* ignore */ }
  setTimeout(() => { try { neuronasInitGrafo(); } catch (_e) { /* ignore */ } }, 100);
}

/* ── Internal escape helper (fallback) ──────────────────── */
function _escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Expose to window for onclick handlers ───────────────── */
if (typeof window !== 'undefined') {
  window.NeuronaFinanciera = NeuronaFinanciera;
  window.actualizarSistemaFinanciero = actualizarSistemaFinanciero;
  window.calcularSimilitud = calcularSimilitud;
  window.renderMapaNeuronal = renderMapaNeuronal;
  window.neuronasInitGrafo = neuronasInitGrafo;
  window.neuronasOpenAddModal = neuronasOpenAddModal;
  window.neuronasConfirmAdd = neuronasConfirmAdd;
  window.neuronasRunDayUpdate = neuronasRunDayUpdate;
  window.neuronasReset = neuronasReset;
  window.getAllNeuronas = getAllNeuronas;
  window.getNeurona = getNeurona;
  window.saveNeurona = saveNeurona;
}
