import { supabase } from '../services/supabaseClient.js';
import { getAllNeurons, saveManyNeurons } from '../neuro/neuronStore.js';

// Prompt del sistema para la API backend
const SYSTEM_PROMPT = `Eres Carl, una inteligencia personal con memoria contextual. Tienes acceso al grafo mental del usuario: neuronas (conceptos, patrones y creencias aprendidas) y memorias.

REGLAS DE COMPORTAMIENTO Y CONVERSACIÓN:
- Eres un compañero de conversación. Actúa con curiosidad y empatía.
- Basa tu respuesta en el contexto neuronal provisto. No inventes recuerdos.
- Si el usuario dice algo vago, haz UNA sola pregunta clara para explorar.
- Sé conciso y directo.

GESTIÓN DE NEURONAS E INTENCIÓN (al final de tu respuesta, separado por ---NEURON_ACTIONS---):
Después de responder, indica tu intención conversacional y qué acciones tomar sobre el grafo. Usa este formato JSON estricto:
{
  "intent": "clarify|explore|respond|consolidate",
  "actions": [
    {
      "type": "create",
      "neuron": {
        "id": "neuron_12345",
        "core": { "concept": "...", "domain": "...", "summary": "..." },
        "triggers": ["trigger1"],
        "emotion": "neutral"
      }
    }
  ]
}

Si no hay acciones necesarias, devuelve: { "intent": "respond", "actions": [] }`;

export async function processChat(userInput, ollamaUrl = 'https://ollama.com', ollamaKey = '') {
  // 1. Cargar contexto de Supabase
  const { data: historyData } = await supabase
    .from('chat_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
  
  const history = (historyData || []).reverse().map(h => ({
    role: h.role,
    content: h.content
  }));

  const allNeurons = await getAllNeurons();
  
  let systemContent = SYSTEM_PROMPT;
  if (allNeurons.length > 0) {
    systemContent += "\n\n## CONTEXTO NEURONAL\n";
    allNeurons.slice(0, 10).forEach(n => {
      systemContent += `- [${n.domain || 'general'}] **${n.concept}**: ${n.summary || ''}\n`;
    });
  }

  const messages = [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user', content: userInput }
  ];

  // 2. Llamar a Ollama (usando fetch nativo de Node 18+)
  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ollamaKey}`
    },
    body: JSON.stringify({
      model: 'gpt-oss:120b',
      messages,
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama API Error: ${response.statusText}`);
  }

  const data = await response.json();
  const fullReply = data.message.content;

  // 3. Parsear Respuesta y Acciones
  let replyText = fullReply;
  let actionsJson = { intent: 'respond', actions: [] };
  
  const splitIdx = fullReply.indexOf('---NEURON_ACTIONS---');
  if (splitIdx !== -1) {
    replyText = fullReply.slice(0, splitIdx).trim();
    const rawActions = fullReply.slice(splitIdx + '---NEURON_ACTIONS---'.length).trim();
    try {
      const match = rawActions.match(/\{[\s\S]*\}/);
      if (match) actionsJson = JSON.parse(match[0]);
    } catch (e) {
      console.warn('[Backend] Error parsing neuron actions', e);
    }
  }

  // 4. Guardar nuevas neuronas si las hay
  if (actionsJson.actions && actionsJson.actions.length > 0) {
    const toSave = actionsJson.actions
      .filter(a => a.type === 'create' && a.neuron)
      .map(a => {
        const n = a.neuron;
        n.id = n.id || `neur_${Date.now()}`;
        return n;
      });
    
    if (toSave.length > 0) {
      await saveManyNeurons(toSave);
    }
  }

  // 5. Guardar historial en Supabase
  const msgIdBase = Date.now().toString(36);
  await supabase.from('chat_history').insert([
    { message_id: `user_${msgIdBase}`, role: 'user', content: userInput },
    { message_id: `asst_${msgIdBase}`, role: 'assistant', content: replyText, meta: { intent: actionsJson.intent } }
  ]);

  return {
    reply: replyText,
    intent: actionsJson.intent,
    neuronsCreated: actionsJson.actions?.length || 0
  };
}
