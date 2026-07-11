export async function sendShoppingAiMessage(text, config, chatHistory, library) {
  if (!text || !text.trim()) return chatHistory;

  const url = config.url ? config.url.trim() : "";
  const model = config.model ? config.model.trim() : "llama3";

  if (!url) {
    throw new Error("Por favor configura la URL de Ollama o la API Key de Gemini arriba.");
  }

  // Detect if it's Gemini or Ollama based on the URL or Key format
  // If it's a simple key without http, assume Gemini.
  const isGemini = !url.startsWith("http");

  // Format library for context
  const libStr = library.map(p => `- ${p.name} (Cat: ${p.cat}): ${p.price}`).join("\n");
  
  const systemPrompt = `Eres "Chef AI", un asistente de compras, finanzas y nutrición personal.
Conoces la biblioteca de productos del usuario y sus precios actuales:
--- BIBLIOTECA DE PRODUCTOS ---
${libStr}
-------------------------------

OBJETIVO:
1. El usuario te dirá lo que ha comido (ej. "Desayuné 2 huevos y un pan").
2. Debes calcular el costo aproximado de esa comida basándote en los precios de la biblioteca. Si no sabes el precio exacto, haz una estimación razonable o pregúntale al usuario el precio si falta en la biblioteca.
3. Responde siempre en español, de forma amigable, concisa y directa.
4. Sugiere comidas o ideas basándote en lo que ya compró o en opciones económicas.
5. Lleva un seguimiento si el usuario te dice qué come frecuentemente ("que sepa cuantas veces he comido lo mismo"). Como tienes acceso al historial de este chat, usa ese contexto.
`;

  let userMsg = { role: "user", content: text };
  let newChat = [...chatHistory, userMsg];

  if (isGemini) {
    // Gemini API format
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.0-flash'}:generateContent?key=${url}`;
    
    const contents = [];
    contents.push({ role: "user", parts: [{ text: systemPrompt }] });
    contents.push({ role: "model", parts: [{ text: "Entendido, soy el Chef AI. ¿En qué te ayudo hoy?" }] });
    
    newChat.forEach(msg => {
      contents.push({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }]
      });
    });

    try {
      const res = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Error al conectar con Gemini");
      }
      const data = await res.json();
      const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "Lo siento, no pude generar una respuesta.";
      
      newChat.push({ role: "assistant", content: aiText });
      return newChat;
    } catch (e) {
      throw e;
    }
  } else {
    // Ollama API format
    // Ensure the endpoint is correct (usually /api/chat)
    const ollamaUrl = url.endsWith("/api/chat") ? url : (url.endsWith("/") ? url + "api/chat" : url + "/api/chat");
    const messages = [
      { role: "system", content: systemPrompt },
      ...newChat.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
    ];

    try {
      const res = await fetch(ollamaUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model,
          messages: messages,
          stream: false
        })
      });
      if (!res.ok) throw new Error("Error al conectar con Ollama");
      const data = await res.json();
      const aiText = data.message?.content || "No hay respuesta.";
      
      newChat.push({ role: "assistant", content: aiText });
      return newChat;
    } catch (e) {
      throw e;
    }
  }
}
