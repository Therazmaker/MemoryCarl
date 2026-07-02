const { createClient } = require('@supabase/supabase-js');

async function handleTelegramWebhook(req, res) {
  // Solo procesar peticiones que traigan message
  if (!req.body || !req.body.message || !req.body.message.text) {
    return res.status(200).send('OK');
  }

  const text = req.body.message.text;
  const chatId = req.body.message.chat.id;

  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const ollamaUrl = process.env.OLLAMA_TELEGRAM_URL || "https://api.corpi.com"; // Proxy URL u Ollama Cloud base url
  const ollamaKey = process.env.OLLAMA_TELEGRAM_API_KEY;
  const ollamaModel = process.env.OLLAMA_TELEGRAM_MODEL || "llama3";
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!telegramToken || !ollamaKey || !supabaseUrl || !supabaseKey) {
    console.error("Faltan variables de entorno para Telegram Bot");
    return res.status(500).send("Server config error");
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Función para enviar mensaje a Telegram
  const replyToTelegram = async (msg) => {
    try {
      await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg })
      });
    } catch(e) { console.error("Error replying to Telegram", e); }
  };

  try {
    // 1. Llamar a Ollama para extraer el JSON
    const systemPrompt = `Eres un asistente financiero estricto. Tu único objetivo es extraer los detalles de la transacción del mensaje del usuario y responder ÚNICAMENTE con un objeto JSON válido, sin Markdown ni texto adicional.
Campos esperados en el JSON:
- "type": "expense" o "income"
- "amount": número (el valor monetario extraído, siempre positivo)
- "category": Categoría lógica (ej. "Alimentación", "Transporte", "Ingresos", "Vivienda", "Ocio", "Otros")
- "note": Breve descripción o nota (ej. "Café en Starbucks")
- "accountId": Intenta deducirlo. Si dice "efectivo", usa "cash". Si dice "tarjeta", "banco", usa "bank". Si no dice nada, usa "default".

Asegúrate de que la respuesta sea 100% JSON parseable. Ejemplo: {"type": "expense", "amount": 15, "category": "Alimentación", "note": "Café", "accountId": "default"}`;

    const url = `${ollamaUrl.replace(/\/+$/, '')}/api/chat`;
    const ollamaRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ollamaKey}`
      },
      body: JSON.stringify({
        model: ollamaModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text }
        ],
        stream: false,
        options: { temperature: 0.1 } // Baja temperatura para JSON estricto
      })
    });

    if (!ollamaRes.ok) throw new Error("Ollama API failed");
    const data = await ollamaRes.json();
    let replyText = data.message?.content || data.choices?.[0]?.message?.content || "";

    // Limpiar posible markdown (ej. \`\`\`json ... \`\`\`)
    replyText = replyText.replace(/```json/g, '').replace(/```/g, '').trim();

    const parsed = JSON.parse(replyText);

    // 2. Insertar en Supabase telegram_inbox
    const { error } = await supabase
      .from('telegram_inbox')
      .insert([
        {
          type: parsed.type,
          amount: Math.abs(Number(parsed.amount) || 0),
          category: parsed.category || "Otros",
          note: parsed.note || "",
          account_id: parsed.accountId || "default",
          processed: false
        }
      ]);

    if (error) {
      throw error;
    }

    // 3. Responder Éxito
    const icon = parsed.type === 'expense' ? '💸' : '💰';
    await replyToTelegram(`${icon} Registrado: $${parsed.amount} en ${parsed.category} (${parsed.note})`);
    res.status(200).send('OK');

  } catch (error) {
    console.error("Error procesando webhook Telegram:", error);
    await replyToTelegram(`❌ Hubo un error procesando tu gasto: ${error.message}. Por favor intenta de nuevo.`);
    res.status(500).send('Error');
  }
}

module.exports = { handleTelegramWebhook };
