app.post('/api/bot/enviar-regalo', async (req, res) => {
  // Ahora recibimos el nombre de Epic y el ID de la oferta
  const { epicName, offerId, mensaje } = req.body;

  try {
    // 1. Buscamos al cliente en la lista de amigos del bot
    const amigo = bot.friends.find(f => f.displayName.toLowerCase() === epicName.toLowerCase());

    if (!amigo) {
      return res.status(400).json({ error: 'El usuario no está en la lista de amigos del bot.' });
    }

    // 2. Preparamos el regalo con el ID interno que fnbr descubrió (amigo.id)
    const giftPayload = {
      offerId: offerId, 
      purchaseQuantity: 1,
      currency: "MtxCurrency",
      currencySubType: "",
      expectedTotalPrice: 0, 
      gameContext: "",
      receiverAccountIds: [amigo.id], // ID interno de 32 caracteres
      giftWrapTemplateId: "GiftBox:gb_makeitrain", // Caja de regalo estándar
      personalMessage: mensaje || "¡Regalo enviado desde Kitson Kit!"
    };

    // 3. Enviamos la orden de compra a Epic Games
    const response = await bot.http.sendEcpRequest(
      'POST',
      `/fortnite/api/game/v2/profile/${bot.user.id}/client/GiftCatalogEntry?profileId=common_core`,
      giftPayload
    );

    res.json({ success: true, message: 'Regalo entregado con éxito en Fortnite.' });

  } catch (error) {
    console.error('Error enviando regalo:', error.message);
    res.status(500).json({ error: error.message });
  }
});