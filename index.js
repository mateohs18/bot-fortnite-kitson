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
// El sitio web (Kitson Kit) manda este mismo valor en el header
// "x-bot-secret" en cada pedido (ver BOT_DELIVERY_SECRET en su .env).
// Sin este chequeo, cualquiera que descubra la URL del bot podía pedirle
// regalos gratis sin pasar por el checkout ni pagar nada.
const BOT_SECRET = process.env.BOT_SECRET || '';

function requiereSecreto(req, res, next) {
  if (!BOT_SECRET) {
    // Si todavía no configuraste el secreto, dejamos pasar pero avisamos
    // fuerte en la consola — así no te quedás sin entregas por sorpresa,
    // pero tampoco te olvidás de configurarlo.
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
// Estas son las credenciales públicas del cliente oficial de Android que usa
// la comunidad de fnbr.js para autenticar bots — no son un secreto tuyo, son
// las mismas para cualquiera que use este método. Las centralizamos acá en
// una sola constante para no tenerlas duplicadas en varios archivos.
const ANDROID_BASIC_AUTH = 'M2Y2OWU1NmM3NjQ5NDkyYzhjYzI5ZjFhZjA4YThhMTI6YjUxZWU5Y2IxMjIzNGY1MGE2OWVmYTY3ZWY1MzgxMmU=';

// ==========================================================
// 2. CARGA DE BOTS Y FNBR.JS
// ==========================================================
async function loadBots() {
  const botsDir = path.join(__dirname, 'bots');
  if (!fs.existsSync(botsDir)) {
    console.error('❌ No se encontró la carpeta "bots".');
    process.exit(1);
  }

  const botFolders = fs.readdirSync(botsDir).filter(f => fs.statSync(path.join(botsDir, f)).isDirectory());
  console.log(`\n🤖 Iniciando ${botFolders.length} bots con fnbr.js...`);

  for (const folder of botFolders) {
    const authPath = path.join(botsDir, folder, 'deviceAuth.json');
    if (!fs.existsSync(authPath)) continue;

    const deviceAuth = JSON.parse(fs.readFileSync(authPath, 'utf8'));

    const bot = new Client({
      auth: { deviceAuth },
      defaultStatus: 'Kitson Kit | Bot de Regalos',
      xmppKeepAliveInterval: 30
    });

    bot.botName = folder;
    bot.deviceAuth = deviceAuth;
    bot.vbucks = 0;
    bot.giftsSentToday = 0;
    bot.giftLimit = 5; // límite real que impone Epic Games por cuenta y por día

    // CACHÉ DE TOKEN (Evita que Epic te banee por spam de peticiones)
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

    // MAGIA XMPP - Acepta amigos en 1 milisegundo
    bot.on('friend:request', (request) => {
      request.accept();
      console.log(`🤝 [${bot.botName}] Nueva amistad aceptada al instante: ${request.displayName || 'Desconocido'}`);
    });

    try {
      await bot.login();
      bots.push(bot);
    } catch (err) {
      console.error(`❌ [${bot.botName}] Error al iniciar sesión en fnbr:`, err.message);
    }
  }

  // ==========================================================
  // Refresco periódico de saldo y regalos enviados
  // ==========================================================
  // Antes, el saldo de pavos (vbucks) de cada bot solo se actualizaba
  // cuando llegaba una petición — así que al elegir qué bot usar para un
  // regalo, la info podía tener horas de desactualizada, y el bot podía
  // fallar un pedido real por creer que tenía saldo cuando ya no lo tenía.
  // Ahora se refresca solo cada 5 minutos en segundo plano.
  setInterval(() => {
    bots.forEach((bot) => updateBotStats(bot).catch(() => {}));
  }, 5 * 60 * 1000);
}

// ==========================================================
// 3. FUNCIÓN DE ESCÁNER DE DATOS
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

    // 💰 ESCÁNER DEFINITIVO DE PAVOS
    let totalPavos = 0;
    for (const key in items) {
      const item = items[key];
      if (item.templateId && item.templateId.startsWith('Currency:Mtx')) {
        totalPavos += (item.quantity || 0);
      }
    }
    bot.vbucks = totalPavos;

    // 🎁 ESCÁNER DE REGALOS EN 24 HORAS
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
// 4. ENDPOINTS
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

  // Refrescamos el saldo de TODOS los bots antes de elegir, para no fallar
  // un pedido real por estar usando datos de hace horas.
  await Promise.all(bots.map((b) => updateBotStats(b).catch(() => {})));

  const botInfo = bots.find(b => (b.giftLimit - b.giftsSentToday) > 0 && b.vbucks >= (precio || 0));

  if (!botInfo) {
    return res.status(503).json({ error: 'No hay bots disponibles con suficientes Pavos o Regalos.' });
  }

  try {
    const token = await botInfo.ensureManualToken();
    const accountId = botInfo.deviceAuth.accountId;

    // 1. Buscar ID del amigo
    const friendRes = await axios.get(`https://account-public-service-prod.ol.epicgames.com/account/api/public/account/displayName/${encodeURIComponent(epicName)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const friendId = friendRes.data.id;

    // 2. Enviar el regalo
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

// Chequeo simple de salud, útil para verificar que el servidor está vivo
// sin exponer datos de los bots (no requiere secreto).
app.get('/health', (req, res) => res.json({ ok: true, bots: bots.length }));

// ==========================================================
// 5. INICIAR SERVIDOR
// ==========================================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Motor Híbrido (FNBR + Axios) escuchando en puerto ${PORT}`);
  if (!BOT_SECRET) {
    console.warn('⚠️  Configurá BOT_SECRET en el .env para proteger este servidor.');
  }
  loadBots();
});
