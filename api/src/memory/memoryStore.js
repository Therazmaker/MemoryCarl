const { supabase } = require('../services/supabaseClient.js');

async function getAllMemories() {
  const { data, error } = await supabase.from('memories').select('*').order('created_at', { ascending: false });
  if (error) {
    console.error('[memoryStore] Error fetching memories:', error.message);
    return [];
  }
  return data;
}

async function saveMemory(memory) {
  const payload = {
    id: memory.id || `mem_${Date.now()}`,
    title: memory.title || 'Untitled Memory',
    snippet: memory.snippet || '',
    text_content: memory.text || '',
    date: memory.date || new Date().toISOString().split('T')[0],
    emotion: memory.emotion || 'neutral',
    tags: memory.tags || [],
    linked_neurons: memory.linkedNeurons || [],
    importance: memory.importance || 'medium',
    temporal: memory.temporal || {},
  };

  const { data, error } = await supabase.from('memories').upsert(payload).select().single();
  if (error) {
    console.error('[memoryStore] Error saving memory:', error.message);
    return null;
  }
  return data;
}

module.exports = {
  getAllMemories,
  saveMemory
};
