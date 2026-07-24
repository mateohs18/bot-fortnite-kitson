// index.js - Servidor Multi-Bot Híbrido (FNBR.js + Axios)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Client } = require('fnbr');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));

const bots = [];

// ==========================================================
// 0. SEGURIDAD: verificación del secreto compartido
// ==========================================================
const BOT_SECRET = process.env.BOT_SECRET || '';

function requiereSecreto(req, res, next) {
  if (!BOT_SECRET) {
    console.warn('⚠️  BOT_SECRET no está configurado — el endpoint queda SIN protección.');
    return next();
  }
  const recibido = req.headers['x-bot-secret'];
  if (recibido !== BOT_SECRET) {
    console.warn(`🚫 Petición rechazada: secreto inválido (IP: ${req.ip})`);
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

// ==========================================================
// 1. CREDENCIALES DEL CLIENTE ANDROID DE FORTNITE
// ==========================================================
const ANDROID_BASIC_AUTH = 'M2Y2OWU1NmM3NjQ5NDkyYzhjYzI5ZjFhZjA4YThhMTI6YjUxZWU5Y2IxMjIzNGY1MGE2OWVmYTY3ZWY1MzgxMmU=';

// ==========================================================
// 2. CARGA DE CREDENCIALES: carpetas locales O variables de entorno
// ==========================================================
// En tu compu (desarrollo): lee bots/<nombre>/deviceAuth.json de cada carpeta.
// En Railway (producción): los deviceAuth.json NUNCA pasan por Git (están en
// .gitignore a propósito, porque son equivalentes a la contraseña de la
// cuenta), así que ahí se cargan desde variables de entorno en su lugar:
//   DEVICE_AUTH_BOT1 = { "accountId": "...", "deviceId": "...", "secret": "..." }
//   DEVICE_AUTH_BOT2 = { ... }
//   DEVICE_AUTH_BOT3 = { ... }
//   DEVICE_AUTH_BOT4 = { ... }
// (el valor completo del JSON, pegado tal cual, en una sola línea o varias)
function cargarCredenciales() {
  const credenciales = [];

  // --- Fuente 1: carpetas locales (bots/<nombre>/deviceAuth.json) ---
  const botsDir = path.join(__dirname, 'bots');
  if (fs.existsSync(botsDir)) {
    const carpetas = fs.readdirSync(botsDir).filter((f) => fs.statSync(path.join(botsDir, f)).isDirectory());
    for (const carpeta of carpetas) {
      const authPath = path.join(botsDir, carpeta, 'deviceAuth.json');
      if (fs.existsSync(authPath)) {
        try {
          const deviceAuth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
          credenciales.push({ nombre: carpeta, deviceAuth });
        } catch (e) {
          console.error(`❌ deviceAuth.json inválido en bots/${carpeta}:`, e.message);
        }
      }
    }
  }

  // --- Fuente 2: variables de entorno DEVICE_AUTH_* (Railway) ---
  // Solo se usan si no encontramos nada en la carpeta local, para no
  // duplicar bots si algún día corrés con ambas fuentes presentes.
  if (credenciales.length === 0) {
    const variables = Object.keys(process.env).filter((k) => k.startsWith('DEVICE_AUTH_'));
    for (const variable of variables) {
      try {
        const deviceAuth = JSON.parse(process.env[variable]);
        const nombre = variable.replace('DEVICE_AUTH_', '').toLowerCase();
        credenciales.push({ nombre, deviceAuth });
      } catch (e) {
        console.error(`❌ ${variable} no es un JSON válido:`, e.message);
      }
    }
  }

  return credenciales;
}

// ==========================================================
// 3. CARGA DE BOTS Y FNBR.JS
// ==========================================================
async function loadBots() {
  const credenciales = cargarCredenciales();

  if (credenciales.length === 0) {
    console.error('❌ No se encontraron credenciales. Revisá la carpeta "bots" o las variables DEVICE_AUTH_*.');
    process.exit(1);
  }

  console.log(`\n🤖 Iniciando ${credenciales.length} bots con fnbr.js...`);

  for (const { nombre, deviceAuth } of credenciales) {
    const bot = new Client({
      auth: { deviceAuth },
      defaultStatus: 'Kitson Kit | Bot de Regalos',
      xmppKeepAliveInterval: 30
    });

    bot.botName = nombre;
    bot.deviceAuth = deviceAuth;
    bot.vbucks = 0;
    bot.giftsSentToday = 0;
    bot.giftLimit = 5; // límite real que impone Epic Games por cuenta y por día

    bot.accessToken = null;
    bot.tokenExpiry = null;
    bot.ensureManualToken = async function () {
      if (!this.accessToken || Date.now() >= this.tokenExpiry) {
        try {
          const params = new URLSearchParams({
            grant_type: 'device_auth',
            account_id: this.deviceAuth.accountId,
            device_id: this.deviceAuth.deviceId,
            secret: this.deviceAuth.secret
          });
          const response = await axios.post('https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token', params.toString(), {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': `Basic ${ANDROID_BASIC_AUTH}`
            }
          });
          this.accessToken = response.data.access_token;
          this.tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000;
        } catch (e) {
          console.error(`❌ [${this.botName}] Error OAuth token:`, e.message);
          return null;
        }
      }
      return this.accessToken;
    };

    bot.on('ready', async () => {
      await updateBotStats(bot);
      const displayName = bot.realDisplayName || bot.botName;
      console.log(`✅ [${bot.botName}] Conectado a Epic como: ${displayName}`);
    });

    bot.on('friend:request', (request) => {
      request.accept();
      console.log(`🤝 [${bot.botName}] Nueva amistad aceptada al instante: ${request.displayName || 'Desconocido'}`);
    });

    // Se dispara SIEMPRE que una amistad queda confirmada, sin importar
    // quién mandó la solicitud primero (nosotros o el cliente). Le avisamos
    // al sitio web para que notifique por Discord y reintente entregar
    // cualquier pedido que estuviera esperando esta amistad.
    bot.on('friend:added', async (friend) => {
      console.log(`✅ [${bot.botName}] Amistad confirmada con: ${friend.displayName || friend.id}`);

      const SITE_URL = process.env.SITE_URL || 'https://kitson-kit.store';
      const SITE_CALLBACK_SECRET = process.env.SITE_CALLBACK_SECRET || '';

      if (!SITE_CALLBACK_SECRET) {
        console.warn('⚠️  SITE_CALLBACK_SECRET no configurado — no se avisa al sitio de esta amistad.');
        return;
      }

      try {
        await axios.post(
          `${SITE_URL}/api/webhooks/amistad-aceptada`,
          { epicName: friend.displayName, botName: bot.botName },
          { headers: { 'x-callback-secret': SITE_CALLBACK_SECRET }, timeout: 15000 }
        );
      } catch (e) {
        console.warn(`⚠️ No se pudo avisar al sitio sobre la amistad con ${friend.displayName}:`, e.message);
      }
    });

    try {
      await bot.login();
      bots.push(bot);
    } catch (err) {
      console.error(`❌ [${bot.botName}] Error al iniciar sesión en fnbr:`, err.message);
    }
  }

  setInterval(() => {
    bots.forEach((bot) => updateBotStats(bot).catch(() => {}));
  }, 5 * 60 * 1000);
}

// ==========================================================
// 4. FUNCIÓN DE ESCÁNER DE DATOS
// ==========================================================
async function updateBotStats(bot) {
  try {
    const token = await bot.ensureManualToken();
    if (!token) return;

    const accountId = bot.deviceAuth.accountId;

    if (!bot.realDisplayName) {
      try {
        const accRes = await axios.get(`https://account-public-service-prod.ol.epicgames.com/account/api/public/account/${accountId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        bot.realDisplayName = accRes.data.displayName;
      } catch (e) {
        console.warn(`⚠️ No se pudo obtener el nombre real de la cuenta ${accountId}`);
      }
    }

    const response = await axios({
      method: 'POST',
      url: `https://fortnite-public-service-prod11.ol.epicgames.com/fortnite/api/game/v2/profile/${accountId}/client/QueryProfile?profileId=common_core`,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {}
    });

    const profile = response.data.profileChanges[0].profile;
    const items = profile.items || {};

    let totalPavos = 0;
    for (const key in items) {
      const item = items[key];
      if (item.templateId && item.templateId.startsWith('Currency:Mtx')) {
        totalPavos += (item.quantity || 0);
      }
    }
    bot.vbucks = totalPavos;

    let regalosEn24h = 0;
    const stats = profile.stats?.attributes || {};
    if (stats.gift_history && Array.isArray(stats.gift_history.gifts)) {
      const ahora = Date.now();
      const unDiaMs = 24 * 60 * 60 * 1000;
      regalosEn24h = stats.gift_history.gifts.filter(regalo => {
        const fechaRegalo = new Date(regalo.date).getTime();
        return (ahora - fechaRegalo) < unDiaMs;
      }).length;
    }
    bot.giftsSentToday = regalosEn24h;

  } catch (error) {
    console.warn(`⚠️ [${bot.botName}] Error actualizando datos:`, error.response?.data?.errorMessage || error.message);
  }
}

// ==========================================================
// 5. ENDPOINTS
// ==========================================================
app.get('/api/bots/status', requiereSecreto, async (req, res) => {
  for (const bot of bots) {
    await updateBotStats(bot);
  }

  const botStatus = bots.map(b => ({
    name: b.botName,
    accountId: b.deviceAuth.accountId,
    ready: !!b.accessToken,
    displayName: b.realDisplayName || b.botName,
    vbucks: b.vbucks,
    giftsSentToday: b.giftsSentToday,
    giftLimit: b.giftLimit,
    giftsRemaining: Math.max(0, b.giftLimit - b.giftsSentToday)
  }));

  res.json({ bots: botStatus });
});

app.post('/api/bot/enviar-regalo', requiereSecreto, async (req, res) => {
  const { epicName, offerId, precio, mensaje } = req.body;
  if (!epicName || !offerId) return res.status(400).json({ error: 'Faltan datos' });

  await Promise.all(bots.map((b) => updateBotStats(b).catch(() => {})));

  const botInfo = bots.find(b => (b.giftLimit - b.giftsSentToday) > 0 && b.vbucks >= (precio || 0));

  if (!botInfo) {
    return res.status(503).json({ error: 'No hay bots disponibles con suficientes Pavos o Regalos.' });
  }

  try {
    const token = await botInfo.ensureManualToken();
    const accountId = botInfo.deviceAuth.accountId;

    const friendRes = await axios.get(`https://account-public-service-prod.ol.epicgames.com/account/api/public/account/displayName/${encodeURIComponent(epicName)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const friendId = friendRes.data.id;

    const payload = {
      offerId,
      purchaseQuantity: 1,
      currency: 'MtxCurrency',
      currencySubType: '',
      expectedTotalPrice: precio || 0,
      gameContext: '',
      receiverAccountIds: [friendId],
      giftWrapTemplateId: 'GiftBox:gb_makeitrain',
      personalMessage: mensaje || '¡Disfruta tu compra en Kitson Kit!'
    };

    await axios.post(`https://fortnite-public-service-prod11.ol.epicgames.com/fortnite/api/game/v2/profile/${accountId}/client/GiftCatalogEntry?profileId=common_core&rvn=-1`, payload, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });

    console.log(`✅ [${botInfo.botName}] ¡Regalo enviado con éxito a ${epicName}!`);
    await updateBotStats(botInfo);
    res.json({ success: true, message: `Regalo enviado desde ${botInfo.botName}` });

  } catch (error) {
    console.error(`❌ Error enviando regalo:`, error.response?.data?.errorMessage || error.message);
    res.status(500).json({ error: 'Fallo al enviar el regalo. ¿Pasaron las 48 horas o el usuario no existe?' });
  }
});

app.post('/api/bot/agregar-amigo', requiereSecreto, async (req, res) => {
  const { epicName } = req.body;
  if (!epicName || typeof epicName !== 'string' || !epicName.trim()) {
    return res.status(400).json({ error: 'Falta el nombre de usuario de Epic.' });
  }

  const botDisponible = bots
    .filter((b) => !!b.accessToken)
    .sort((a, b) => (a.friend?.list?.size || 0) - (b.friend?.list?.size || 0))[0];

  if (!botDisponible) {
    return res.status(503).json({ error: 'No hay bots disponibles en este momento.' });
  }

  try {
    await botDisponible.friend.add(epicName.trim());
    console.log(`🤝 [${botDisponible.botName}] Solicitud de amistad enviada a ${epicName}`);
    return res.json({
      success: true,
      bot: botDisponible.botName,
      message: `Te enviamos la solicitud de amistad desde ${botDisponible.realDisplayName || botDisponible.botName}. Aceptala dentro de Fortnite para continuar.`,
    });
  } catch (error) {
    const tipo = error?.constructor?.name || '';
    let mensaje = 'No se pudo enviar la solicitud de amistad. Verificá el nombre de usuario e intentá de nuevo.';

    if (tipo.includes('UserNotFound')) {
      mensaje = 'No encontramos ese nombre de usuario de Epic Games. Revisá que esté bien escrito (sin espacios de más).';
    } else if (tipo.includes('DuplicateFriendship')) {
      mensaje = 'Ya son amigos — revisá tu lista de amigos dentro de Fortnite.';
    } else if (tipo.includes('FriendshipRequestAlreadySent')) {
      mensaje = 'Ya te habíamos enviado una solicitud antes — buscala en tus solicitudes pendientes dentro del juego.';
    } else if (tipo.includes('InviteeFriendshipSettings')) {
      mensaje = 'Esa cuenta tiene las solicitudes de amistad desactivadas en su configuración de privacidad de Epic Games.';
    } else if (tipo.includes('LimitExceeded')) {
      mensaje = 'Se alcanzó un límite de amistades. Probá de nuevo más tarde.';
    }

    console.warn(`⚠️ Error agregando a ${epicName}:`, error.message || error);
    return res.status(400).json({ error: mensaje });
  }
});

app.get('/health', (req, res) => res.json({ ok: true, bots: bots.length }));

// ==========================================================
// 6. INICIAR SERVIDOR
// ==========================================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Motor Híbrido (FNBR + Axios) escuchando en puerto ${PORT}`);
  if (!BOT_SECRET) {
    console.warn('⚠️  Configurá BOT_SECRET en el .env para proteger este servidor.');
  }
  loadBots();
});
