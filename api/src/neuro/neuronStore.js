const { supabase } = require('../services/supabaseClient.js');

async function getAllNeurons() {
  const { data, error } = await supabase.from('neurons').select('*');
  if (error) {
    console.error('[neuronStore] Error fetching neurons:', error.message);
    return [];
  }
  return data;
}

async function saveNeuron(neuron) {
  const { data, error } = await supabase
    .from('neurons')
    .upsert({
      id: neuron.id,
      concept: neuron.core?.concept || 'Unknown',
      domain: neuron.core?.domain,
      summary: neuron.core?.summary,
      triggers: neuron.triggers || [],
      emotion: neuron.emotion || 'neutral',
      weight: neuron.weight || 1.0,
      temporal: neuron.temporal || {},
      // embedding: neuron.embedding // Si pgvector está configurado
    })
    .select()
    .single();

  if (error) {
    console.error('[neuronStore] Error saving neuron:', error.message);
    return null;
  }
  return data;
}

async function saveManyNeurons(neurons) {
  const payload = neurons.map(n => ({
    id: n.id,
    concept: n.core?.concept || 'Unknown',
    domain: n.core?.domain,
    summary: n.core?.summary,
    triggers: n.triggers || [],
    emotion: n.emotion || 'neutral',
    weight: n.weight || 1.0,
    temporal: n.temporal || {},
  }));

  const { data, error } = await supabase.from('neurons').upsert(payload).select();
  if (error) {
    console.error('[neuronStore] Error saving multiple neurons:', error.message);
    return [];
  }
  return data;
}

async function deleteNeuron(id) {
  const { error } = await supabase.from('neurons').delete().eq('id', id);
  if (error) {
    console.error('[neuronStore] Error deleting neuron:', error.message);
    return false;
  }
  return true;
}

module.exports = {
  getAllNeurons,
  saveNeuron,
  saveManyNeurons,
  deleteNeuron
};
