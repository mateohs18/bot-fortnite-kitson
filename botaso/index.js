// index.js (Servidor del Bot)
const express = require('express');
const cors = require('cors');
const { Client } = require('fnbr');

const app = express();
app.use(express.json());
app.use(cors());

// Configura tu bot usando el deviceAuth.json que generaste previamente
const bot = new Client({
  auth: { deviceAuth: require('./deviceAuth.json') }
});

bot.on('ready', () => {
  console.log(`🤖 Bot conectado exitosamente como: ${bot.user.displayName}`);
});

// ENDPOINT 1: Enviar solicitud de amistad
app.post('/api/bot/agregar-amigo', async (req, res) => {
  const { epicId } = req.body;
  if (!epicId) return res.status(400).json({ error: 'Falta epicId' });

  try {
    console.log(`Enviando solicitud de amistad a: ${epicId}`);
    await bot.addFriend(epicId);
    res.json({ success: true, message: `Solicitud enviada a ${epicId}` });
  } catch (error) {
    console.error(`Error al agregar a ${epicId}:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ENDPOINT 2: Enviar el cosmético (Regalo)
app.post('/api/bot/enviar-regalo', async (req, res) => {
  const { accountIdReceptor, offerId, mensaje } = req.body;

  try {
    const giftPayload = {
      offerId: offerId, 
      purchaseQuantity: 1,
      currency: "MtxCurrency",
      currencySubType: "",
      expectedTotalPrice: 0, 
      gameContext: "",
      receiverAccountIds: [accountIdReceptor], 
      giftWrapTemplateId: "GiftBox:gb_makeitrain",
      personalMessage: mensaje || "¡Gracias por tu compra en Kitson Kit!"
    };

    // Petición interna de fnbr para regalar
    const response = await bot.http.sendEcpRequest(
      'POST',
      `/fortnite/api/game/v2/profile/${bot.user.id}/client/GiftCatalogEntry?profileId=common_core`,
      giftPayload
    );

    res.json({ success: true, message: 'Regalo enviado correctamente.' });
  } catch (error) {
    console.error('Error enviando regalo:', error.message);
    res.status(500).json({ success: false, error: 'Fallo al entregar el regalo.' });
  }
});

bot.login().then(() => {
  app.listen(3001, () => {
    console.log('🌐 Servidor del bot escuchando en el puerto 3001');
  });
});