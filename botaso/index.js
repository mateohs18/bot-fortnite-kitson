// index.js - Servidor Multi-Bot 100% Axios (Anti-Baneos en la Nube)
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));

// ==========================================================
// 🛡️ TOKEN ORIGINAL Y SEGURO (El que funcionó perfecto al inicio)
// ==========================================================
const CURRENT_TOKEN = 'M2Y2OWU1NmM3NjQ5NDkyYzhjYzI5ZjFhZjA4YThhMTI6YjUxZWU5Y2IxMjIzNGY1MGE2OWVmYTY3ZWY1MzgxMmU=';

const bots = [];

// ==========================================================
// 1. CARGA DE BOTS (SIN FNBR.JS)
// ==========================================================
async function loadBots() {
  const botsDir = path.join(__dirname, 'bots');
  if (!fs.existsSync(botsDir)) {
    console.error('❌ No se encontró la carpeta "bots".');
    process.exit(1);
  }

  const botFolders = fs.readdirSync(botsDir).filter(f => fs.statSync(path.join(botsDir, f)).isDirectory());
  console.log(`\n🤖 Iniciando ${botFolders.length} bots (Modo Sigilo Axios)...`);

  for (const folder of botFolders) {
    const authPath = path.join(botsDir, folder, 'deviceAuth.json');
    if (!fs.existsSync(authPath)) continue;

    const deviceAuth = JSON.parse(fs.readFileSync(authPath, 'utf8'));

    const bot = {
      botName: folder,
      deviceAuth: deviceAuth,
      ready: false,
      vbucks: 0,
      giftsSentToday: 0,
      giftLimit: 5,
      accessToken: null,
      tokenExpiry: null,
      
      ensureManualToken: async function() {
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
                'Authorization': `Basic ${CURRENT_TOKEN}` 
              }
            });
            this.accessToken = response.data.access_token;
            // Guardamos el token y le restamos 1 minuto por seguridad
            this.tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000;
            this.ready = true;
          } catch (e) {
            console.error(`❌ [${this.botName}] Error conectando a Epic:`, e.response?.data?.errorMessage || e.message);
            this.ready = false;
            return null;
          }
        }
        return this.accessToken;
      }
    };

    // Primera sincronización
    await updateBotStats(bot);
    if (bot.ready) {
      console.log(`✅ [${bot.botName}] Conectado exitosamente como: ${bot.realDisplayName || bot.botName}`);
      bots.push(bot);
    }
  }

  // 🔄 LOOP EN SEGUNDO PLANO: Revisa amigos y actualiza pavos cada 45 segundos
  setInterval(async () => {
    for (const bot of bots) {
      if (bot.ready) await updateBotStats(bot);
    }
  }, 45000);
}

// ==========================================================
// 2. ESCÁNER TOTAL (Pavos, Regalos y Auto-Aceptar Amigos)
// ==========================================================
async function updateBotStats(bot) {
  try {
    const token = await bot.ensureManualToken();
    if (!token) return;

    const accountId = bot.deviceAuth.accountId; 
    
    // A. Obtener nombre real
    if (!bot.realDisplayName) {
      try {
        const accRes = await axios.get(`https://account-public-service-prod.ol.epicgames.com/account/api/public/account/${accountId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        bot.realDisplayName = accRes.data.displayName;
      } catch (e) {}
    }

    // B. AUTO-ACEPTAR SOLICITUDES DE AMISTAD (Sin fnbr)
    try {
      const summaryRes = await axios.get(`https://friends-public-service-prod.ol.epicgames.com/friends/api/v1/${accountId}/summary`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const incomingRequests = summaryRes.data.incoming || [];
      
      for (const request of incomingRequests) {
        const friendId = request.accountId;
        // Acepta a cada amigo pendiente de la lista
        await axios.post(`https://friends-public-service-prod.ol.epicgames.com/friends/api/v1/${accountId}/friends/${friendId}`, {}, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log(`🤝 [${bot.botName}] Nueva solicitud aceptada silenciosamente!`);
      }
    } catch (e) {
      // Ignoramos errores menores de la lista de amigos
    }
    
    // C. ACTUALIZAR PAVOS Y REGALOS EXACTOS
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
    console.warn(`⚠️ [${bot.botName}] Error de sincronización:`, error.response?.data?.errorMessage || error.message);
  }
}

// ==========================================================
// 3. ENDPOINTS PARA TU PÁGINA WEB
// ==========================================================
app.get('/api/bots/status', async (req, res) => {
  // Tu web pide el estado, se lo mandamos de la memoria de inmediato
  const botStatus = bots.map(b => ({
    name: b.botName,
    accountId: b.deviceAuth.accountId,
    ready: b.ready,
    displayName: b.realDisplayName || b.botName,
    vbucks: b.vbucks,
    giftsSentToday: b.giftsSentToday,
    giftLimit: b.giftLimit,
    giftsRemaining: Math.max(0, b.giftLimit - b.giftsSentToday)
  }));
  
  res.json({ bots: botStatus });
});

app.post('/api/bot/enviar-regalo', async (req, res) => {
  const { epicName, offerId, precio, mensaje } = req.body;
  if (!epicName || !offerId) return res.status(400).json({ error: 'Faltan datos' });

  const botInfo = bots.find(b => (b.giftLimit - b.giftsSentToday) > 0 && b.vbucks >= (precio || 0) && b.ready);
  
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

    console.log(`🎁✅ [${botInfo.botName}] ¡Regalo enviado con éxito a ${epicName}!`);
    await updateBotStats(botInfo);
    res.json({ success: true, message: `Regalo enviado desde ${botInfo.botName}` });

  } catch (error) {
    console.error(`❌ Error enviando regalo a ${epicName}:`, error.response?.data?.errorMessage || error.message);
    res.status(500).json({ error: 'Fallo al enviar el regalo. ¿Pasaron las 48 horas o el usuario no existe?' });
  }
});

// ==========================================================
// 4. INICIAR SERVIDOR
// ==========================================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor de Kitson Kit escuchando en puerto ${PORT}`);
  loadBots();
});