app.post('/api/bot/enviar-regalo', async (req, res) => {
  console.log('📥 /enviar-regalo llamado', req.body);
  const { epicName, offerId, mensaje } = req.body;

  if (!epicName || !offerId) {
    return res.status(400).json({ success: false, error: 'epicName y offerId requeridos' });
  }

  const token = await ensureToken();
  if (!token) {
    return res.status(401).json({ success: false, error: 'Sin token' });
  }

  try {
    const friendId = await getAccountIdByName(epicName);
    if (!friendId) {
      return res.status(404).json({ success: false, error: `Usuario ${epicName} no encontrado` });
    }

    // Obtener precio
    let itemPrice = 0;
    try {
      const catalog = await axios.get('https://fortnite-public-service-prod11.ol.epicgames.com/fortnite/api/storefront/v2/catalog', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      for (const store of catalog.data.storefronts) {
        if (store.catalogEntries) {
          const entry = store.catalogEntries.find(e => e.offerId === offerId);
          if (entry) {
            // ✅ LÓGICA DE PRECIO ACTUALIZADA
            if (entry.prices && entry.prices.length > 0) {
              itemPrice = entry.prices[0].finalPrice || entry.prices[0].regularPrice || 0;
            } else {
              itemPrice = entry.regularPrice || entry.devPrice || 0;
            }
            break;
          }
        }
      }
    } catch (err) {
      console.error('Error obteniendo catálogo:', err.message);
    }

    if (itemPrice === 0) {
      return res.status(400).json({ success: false, error: 'No se pudo obtener precio del artículo' });
    }

    const payload = {
      offerId,
      purchaseQuantity: 1,
      currency: 'MtxCurrency',
      currencySubType: '',
      expectedTotalPrice: itemPrice,
      gameContext: '',
      receiverAccountIds: [friendId],
      giftWrapTemplateId: 'GiftBox:gb_default', // ✅ PAPEL DE REGALO CORREGIDO
      personalMessage: mensaje || '¡Gracias por tu compra!'
    };

    console.log('Enviando payload:', payload);

    await axios.post(
      `https://fortnite-public-service-prod11.ol.epicgames.com/fortnite/api/game/v2/profile/${accountId}/client/GiftCatalogEntry?profileId=common_core&rvn=-1`,
      payload,
      { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );

    console.log(`✅ Regalo enviado a ${epicName}`);
    res.json({ success: true, message: `Regalo enviado a ${epicName}` });

  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data?.errorMessage || error.message });
  }
});