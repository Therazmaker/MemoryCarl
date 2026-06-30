require('dotenv').config();
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const API_URL = process.env.CARL_API_URL || 'https://memory-carl.vercel.app';
const API_KEY = process.env.CARL_API_KEY || '';

// Inicializar el cliente de WhatsApp
// LocalAuth guarda la sesión localmente para no tener que escanear el QR cada vez.
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    // Si la sesión no está guardada, genera un código QR en la terminal.
    console.log('¡Escanea este código QR con tu aplicación de WhatsApp!');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ ¡Cliente de WhatsApp conectado y listo!');
    console.log(`Conectado como: ${client.info.wid.user}`);
});

client.on('message_create', async (msg) => {
    // Opción B: Carl solo te responde a ti mismo (en tu propio chat).
    // client.info.wid.user es tu número (ej: "584123456789")
    // msg.to es el destinatario, msg.from es el remitente.
    // En un mensaje a ti mismo, `msg.to` es tu propio número (terminado en @c.us).
    
    const myNumber = `${client.info.wid.user}@c.us`;
    
    // Solo responder a mensajes enviados EN EL CHAT DE "TÚ"
    // Un mensaje en tu propio chat cumple: msg.from === myNumber && msg.to === myNumber
    if (msg.from === myNumber && msg.to === myNumber) {
        
        // Evitar que el bot se responda a sí mismo en un bucle
        // Solo respondemos si el mensaje no fue generado por el propio bot (podemos marcar los nuestros o revisar si somos nosotros tecleando)
        // Por defecto en whatsapp-web.js, msg.fromMe es true si lo enviaste tú.
        // Si el texto empieza con "🤖", asumimos que es una respuesta anterior de Carl y la ignoramos.
        if (msg.body.startsWith('🤖')) return;
        
        console.log(`[Tú] ${msg.body}`);
        
        try {
            // Llamar a tu API en Vercel
            const response = await fetch(`${API_URL}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${API_KEY}`
                },
                body: JSON.stringify({ message: msg.body })
            });

            if (!response.ok) {
                console.error('Error de la API de Carl:', response.status);
                return;
            }

            const data = await response.json();
            const carlReply = data.data?.reply || 'Lo siento, no pude procesar eso.';

            // Enviar respuesta al mismo chat
            // Añadimos el prefijo 🤖 para saber que fue Carl y no tú quien lo escribió.
            await client.sendMessage(myNumber, `🤖 ${carlReply}`);
            console.log(`[Carl] ${carlReply}`);
            
        } catch (error) {
            console.error('Error contactando a MemoryCarl:', error.message);
            await client.sendMessage(myNumber, '🤖 (Error conectando con la API de Carl)');
        }
    }
});

client.initialize();
