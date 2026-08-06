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
function cargarCredenciales() {
  const credenciales = [];

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

  if (credenciales.length === 0) {
    const variables = Object.keys(process.env)
      .filter((k) => k.startsWith('DEVICE_AUTH_'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
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
// 3. CREAR Y CONECTAR UNA CUENTA — reutilizable tanto al arrancar el
//    servidor como para reconectar una cuenta puntual en caliente, sin
//    reiniciar nada, cuando Epic le revoca el dispositivo autorizado.
// ==========================================================
function crearBot(nombre, deviceAuth) {
  const bot = new Client({
    auth: { deviceAuth },
    defaultStatus: 'Kitson Kit | Bot de Regalos',
    xmppKeepAliveInterval: 30
  });

  bot.botName = nombre;
  bot.deviceAuth = deviceAuth;
  bot.vbucks = 0;
  bot.giftsSentToday = 0;
  bot.giftLimit = 5;

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

  return bot;
}

// ==========================================================
// 4. CARGA DE BOTS AL ARRANCAR
// ==========================================================
async function loadBots() {
  const credenciales = cargarCredenciales();

  if (credenciales.length === 0) {
    console.error('❌ No se encontraron credenciales. Revisá la carpeta "bots" o las variables DEVICE_AUTH_*.');
    process.exit(1);
  }

  console.log(`\n🤖 Iniciando ${credenciales.length} bots con fnbr.js...`);

  for (const { nombre, deviceAuth } of credenciales) {
    try {
      const bot = crearBot(nombre, deviceAuth);
      await bot.login();
      bots.push(bot);
    } catch (err) {
      console.error(`❌ [${nombre}] Error al iniciar sesión en fnbr:`, err.message);
    }
  }

  setInterval(() => {
    bots.forEach((bot) => updateBotStats(bot).catch(() => {}));
  }, 5 * 60 * 1000);
}

// ==========================================================
// 5. FUNCIÓN DE ESCÁNER DE DATOS
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
// 6. ENDPOINTS
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
  const { epicName, offerId, precio, mensaje, botName } = req.body;
  if (!epicName || !offerId) return res.status(400).json({ error: 'Faltan datos' });

  await Promise.all(bots.map((b) => updateBotStats(b).catch(() => {})));

  let botInfo;
  if (botName) {
    botInfo = bots.find((b) => b.botName === botName);
    if (!botInfo) {
      return res.status(404).json({ error: `No existe ninguna cuenta conectada llamada "${botName}".` });
    }
    if ((botInfo.giftLimit - botInfo.giftsSentToday) <= 0) {
      return res.status(400).json({ error: `La cuenta "${botName}" ya usó sus 5 regalos de hoy.` });
    }
    if (botInfo.vbucks < (precio || 0)) {
      return res.status(400).json({ error: `La cuenta "${botName}" no tiene suficientes pavos (tiene ${botInfo.vbucks}, hacen falta ${precio}).` });
    }
  } else {
    botInfo = bots.find(b => (b.giftLimit - b.giftsSentToday) > 0 && b.vbucks >= (precio || 0));
  }

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
      giftWrapTemplateId: 'GiftBox:gb_default',
      personalMessage: mensaje || '¡Disfruta tu compra en Kitson Kit!'
    };

    await axios.post(`https://fortnite-public-service-prod11.ol.epicgames.com/fortnite/api/game/v2/profile/${accountId}/client/GiftCatalogEntry?profileId=common_core&rvn=-1`, payload, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });

    console.log(`✅ [${botInfo.botName}] ¡Regalo enviado con éxito a ${epicName}!`);
    await updateBotStats(botInfo);
    res.json({ success: true, message: `Regalo enviado desde ${botInfo.botName}` });

  } catch (error) {
    const motivoReal = error.response?.data?.errorMessage || error.message || 'Error desconocido';
    console.error(`❌ Error enviando regalo:`, motivoReal);
    res.status(500).json({ error: `Fallo al enviar el regalo: ${motivoReal}` });
  }
});

app.post('/api/bot/agregar-amigo', requiereSecreto, async (req, res) => {
  const { epicName } = req.body;
  if (!epicName || typeof epicName !== 'string' || !epicName.trim()) {
    return res.status(400).json({ error: 'Falta el nombre de usuario de Epic.' });
  }
  const nombre = epicName.trim();

  const disponibles = bots.filter((b) => !!b.accessToken);
  if (disponibles.length === 0) {
    return res.status(503).json({ error: 'No hay bots disponibles en este momento.' });
  }

  const resultados = await Promise.all(
    disponibles.map(async (bot) => {
      try {
        await bot.friend.add(nombre);
        console.log(`🤝 [${bot.botName}] Solicitud de amistad enviada a ${nombre}`);
        return { bot: bot.botName, ok: true, yaEraAmigo: false };
      } catch (error) {
        const tipo = error?.constructor?.name || '';
        const yaEraAmigo = tipo.includes('DuplicateFriendship');
        const yaResuelto = yaEraAmigo || tipo.includes('FriendshipRequestAlreadySent');
        if (!yaResuelto) {
          console.warn(`⚠️ [${bot.botName}] Error agregando a ${nombre}:`, error.message || error);
        }
        return { bot: bot.botName, ok: yaResuelto, yaEraAmigo, error: yaResuelto ? null : (error.message || String(error)) };
      }
    })
  );

  const exitosos = resultados.filter((r) => r.ok);
  const algunaYaEraAmiga = resultados.some((r) => r.yaEraAmigo);

  if (exitosos.length === 0) {
    const primerError = resultados.find((r) => r.error)?.error || '';
    let mensaje = 'No se pudo enviar la solicitud de amistad. Verificá el nombre de usuario e intentá de nuevo.';
    if (primerError.includes('not found') || primerError.includes('UserNotFound')) {
      mensaje = 'No encontramos ese nombre de usuario de Epic Games. Revisá que esté bien escrito (sin espacios de más).';
    } else if (primerError.includes('FriendshipSettings')) {
      mensaje = 'Esa cuenta tiene las solicitudes de amistad desactivadas en su configuración de privacidad de Epic Games.';
    } else if (primerError.includes('LimitExceeded')) {
      mensaje = 'Se alcanzó un límite de amistades. Probá de nuevo más tarde.';
    }
    return res.status(400).json({ error: mensaje });
  }

  return res.json({
    success: true,
    cuentas: exitosos.map((r) => r.bot),
    algunaYaEraAmiga,
    message: `Te enviamos la solicitud de amistad desde ${exitosos.length} cuenta${exitosos.length === 1 ? '' : 's'} (${exitosos.map((r) => r.bot).join(', ')}). Aceptalas dentro de Fortnite para continuar.`,
  });
});

// ==========================================================
// 7. NUEVO — Actualizar credenciales de una cuenta en caliente, sin
//    reiniciar el servidor ni esperar un redeploy. Para cuando Epic le
//    revoca el dispositivo autorizado a una cuenta puntual.
// ==========================================================
app.post('/api/bot/actualizar-credenciales', requiereSecreto, async (req, res) => {
  const { botName, deviceAuth } = req.body;

  if (!botName || typeof botName !== 'string') {
    return res.status(400).json({ error: 'Falta "botName" (ej: "bot1").' });
  }
  if (!deviceAuth || !deviceAuth.accountId || !deviceAuth.deviceId || !deviceAuth.secret) {
    return res.status(400).json({ error: 'El deviceAuth no es válido — necesita accountId, deviceId y secret.' });
  }

  const nombre = botName.trim().toLowerCase();

  try {
    const nuevoBot = crearBot(nombre, deviceAuth);
    await nuevoBot.login();
    await updateBotStats(nuevoBot);

    // Si ya había una cuenta con ese nombre (funcionando o rota), la
    // sacamos y la reemplazamos — sin reiniciar nada.
    const idxExistente = bots.findIndex((b) => b.botName === nombre);
    if (idxExistente !== -1) {
      const botViejo = bots[idxExistente];
      bots.splice(idxExistente, 1);
      if (typeof botViejo.logout === 'function') {
        botViejo.logout().catch(() => {}); // mejor esfuerzo, no bloquea la respuesta
      }
    }

    bots.push(nuevoBot);

    const displayName = nuevoBot.realDisplayName || nombre;
    console.log(`✅ [${nombre}] Credenciales actualizadas en caliente — conectado como: ${displayName}`);
    res.json({
      success: true,
      message: `Credenciales de "${nombre}" actualizadas correctamente. Conectado como ${displayName}.`,
      displayName,
    });
  } catch (err) {
    console.error(`❌ [${nombre}] Error actualizando credenciales:`, err.message);
    res.status(400).json({ error: `No se pudo conectar con las credenciales nuevas: ${err.message}` });
  }
});

app.get('/health', (req, res) => res.json({ ok: true, bots: bots.length }));

// ==========================================================
// 8. INICIAR SERVIDOR
// ==========================================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Motor Híbrido (FNBR + Axios) escuchando en puerto ${PORT}`);
  if (!BOT_SECRET) {
    console.warn('⚠️  Configurá BOT_SECRET en el .env para proteger este servidor.');
  }
  loadBots();
});
