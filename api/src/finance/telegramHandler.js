const { createClient } = require('@supabase/supabase-js');

async function handleTelegramWebhook(req, res) {
  // Siempre responder algo para que Telegram no siga reintentando
  res.setHeader('Content-Type', 'application/json');

  try {
    // Solo procesar peticiones que traigan message
    if (!req.body || !req.body.message || !req.body.message.text) {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const text = req.body.message.text;
    const chatId = req.body.message.chat.id;

    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const ollamaUrl = process.env.OLLAMA_TELEGRAM_URL || "https://ollama.com";
    const ollamaKey = process.env.OLLAMA_TELEGRAM_API_KEY;
    const ollamaModel = process.env.OLLAMA_TELEGRAM_MODEL || "gpt-oss:120b";
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    // Diagnóstico: listar cuáles faltan
    const missing = [];
    if (!telegramToken) missing.push('TELEGRAM_BOT_TOKEN');
    if (!ollamaKey) missing.push('OLLAMA_TELEGRAM_API_KEY');
    if (!supabaseUrl) missing.push('SUPABASE_URL');
    if (!supabaseKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');

    if (missing.length > 0) {
      console.error("Faltan variables de entorno:", missing.join(', '));
      return res.status(500).json({ ok: false, error: "Missing env vars", missing });
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

    // 1. Llamar a Ollama para extraer el JSON
    const systemPrompt = `Eres un asistente financiero estricto del usuario peruano. La moneda es el Sol peruano (S/). Tu único objetivo es extraer los detalles de la transacción del mensaje del usuario y responder ÚNICAMENTE con un objeto JSON válido, sin Markdown ni texto adicional.
Campos esperados en el JSON:
- "type": "expense" o "income"
- "amount": número (el valor monetario extraído, siempre positivo)
- "category": Categoría lógica (ej. "Alimentación", "Transporte", "Ingresos", "Vivienda", "Ocio", "Otros")
- "note": Breve descripción o nota (ej. "Café en Starbucks")
- "accountId": Intenta deducirlo. Si dice "efectivo", usa "cash". Si dice "tarjeta", "banco", usa "bank". Si el gasto es para o de "Fergis", usa "fergis". Si no dice nada, usa "default".

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
        options: { temperature: 0.1 }
      })
    });

    if (!ollamaRes.ok) throw new Error(`Ollama API failed: HTTP ${ollamaRes.status}`);
    const data = await ollamaRes.json();
    let replyText = data.message?.content || data.choices?.[0]?.message?.content || "";

    // Limpiar posible markdown
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

    if (error) throw error;

    // 3. Responder Éxito
    const icon = parsed.type === 'expense' ? '💸' : '💰';
    await replyToTelegram(`${icon} Registrado: S/ ${parsed.amount} en ${parsed.category} (${parsed.note})`);
    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error("Error procesando webhook Telegram:", error);
    // Intentar notificar al usuario si tenemos el token y chatId
    try {
      const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = req.body?.message?.chat?.id;
      if (telegramToken && chatId) {
        await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: `❌ Error: ${error.message}` })
        });
      }
    } catch(_e) {}
    return res.status(500).json({ ok: false, error: error.message });
  }
}

async function getPendingTelegramTransactions(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ status: 'error', message: 'Supabase no configurado en servidor.' });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Buscar los no procesados
    const { data, error } = await supabase
      .from('telegram_inbox')
      .select('*')
      .eq('processed', false)
      .order('created_at', { ascending: true });

    if (error) throw error;

    if (data && data.length > 0) {
      // Marcarlos como procesados para que no se vuelvan a bajar
      const ids = data.map(d => d.id);
      await supabase
        .from('telegram_inbox')
        .update({ processed: true })
        .in('id', ids);
    }

    res.json({ status: 'ok', data: data || [] });
  } catch(e) {
    console.error("Error obteniendo telegram_inbox:", e);
    res.status(500).json({ status: 'error', message: e.message });
  }
}

module.exports = { handleTelegramWebhook, getPendingTelegramTransactions };
