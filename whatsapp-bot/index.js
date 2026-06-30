require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');

const API_URL = process.env.CARL_API_URL || 'https://memory-carl.vercel.app';
const API_KEY = process.env.CARL_API_KEY || '';
const MY_PHONE = process.env.MY_PHONE || ''; // Tu número con código de país, sin +

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./baileys_auth');
    const { version } = await fetchLatestBaileysVersion();

    console.log(`[Carl Bot] Iniciando con WhatsApp v${version.join('.')}`);

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Carl Bot', 'Chrome', '120.0'],
    });

    // --- VINCULAR POR CÓDIGO EN VEZ DE QR ---
    // Hay que esperar a que el WebSocket esté listo antes de pedir el código
    if (!sock.authState.creds.registered) {
        if (!MY_PHONE) {
            console.error('❌ ERROR: Configura MY_PHONE en .env');
            process.exit(1);
        }
        // Pequeña espera para que el handshake WebSocket se complete
        await new Promise(resolve => setTimeout(resolve, 3000));
        try {
            const code = await sock.requestPairingCode(MY_PHONE);
            const formatted = code.match(/.{1,4}/g)?.join('-');
            console.log('\n===========================================');
            console.log('📱 CÓDIGO DE VINCULACIÓN DE WHATSAPP:');
            console.log(`\n   >>>  ${formatted}  <<<\n`);
            console.log('Pasos:');
            console.log('1. Abre WhatsApp en tu celular');
            console.log('2. Ve a Configuración → Dispositivos vinculados');
            console.log('3. Toca "Vincular con número de teléfono"');
            console.log('4. Escribe el código de arriba');
            console.log('===========================================\n');
        } catch (e) {
            console.error('[Carl Bot] Error al pedir código de vinculación:', e.message);
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log('[Carl Bot] Reconectando en 5 segundos...');
                setTimeout(connectToWhatsApp, 5000);
            } else {
                console.log('[Carl Bot] Sesión cerrada. Borra la carpeta baileys_auth y reinicia.');
            }
        } else if (connection === 'open') {
            console.log('\n✅ ¡Carl está conectado a WhatsApp!');
            console.log(`📱 Número: ${sock.user?.id}`);
            console.log('💬 Ve al chat "Tú" en WhatsApp y escríbete algo. Carl te responderá con 🤖\n');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message) continue;

            const text = msg.message?.conversation
                || msg.message?.extendedTextMessage?.text
                || '';

            if (!text.trim()) continue;

            const myJid = sock.user?.id;
            const myNumber = myJid?.split(':')[0] + '@s.whatsapp.net';
            const sender = msg.key.remoteJid;

            if (sender !== myNumber) continue;
            if (text.startsWith('🤖')) continue;

            console.log(`[Tú → Carl] ${text}`);

            try {
                const response = await fetch(`${API_URL}/api/chat`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${API_KEY}`
                    },
                    body: JSON.stringify({ message: text })
                });

                if (!response.ok) {
                    const errText = await response.text();
                    console.error('[Carl Bot] Error API:', response.status, errText);
                    await sock.sendMessage(myNumber, { text: `🤖 (Error del servidor: ${response.status})` });
                    return;
                }

                const data = await response.json();
                const carlReply = data.data?.reply || 'Lo siento, no pude procesar eso.';

                await sock.sendMessage(myNumber, { text: `🤖 ${carlReply}` });
                console.log(`[Carl → Tú] ${carlReply}`);

            } catch (error) {
                console.error('[Carl Bot] Error:', error.message);
                await sock.sendMessage(myNumber, { text: `🤖 (Error de conexión: ${error.message})` });
            }
        }
    });
}

connectToWhatsApp();
