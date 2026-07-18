app.post('/api/bot/enviar-regalo', async (req, res) => {
  // ✅ 1. Movimos el console.log ADENTRO de la función para que no crashee
  console.log('📦 Recibida petición de regalo:', req.body);
  
  const { epicName, offerId, mensaje } = req.body;
  
  if (!epicName || !offerId) {
    return res.status(400).json({ success: false, error: 'epicName y offerId son requeridos' });
  }

  const token = await ensureToken();
  if (!token) {
    return res.status(401).json({ success: false, error: 'No se pudo obtener token' });
  }

  try {
    // 1. Obtener Account ID del destinatario
    const friendId = await getAccountIdByName(epicName)
    if (!friendId) {
      return res.status(404).json({ success: false, error: `Usuario "${epicName}" no encontrado` });
    }

    // 2. Verificar que son amigos
    let areFriends = false;
    try {
      const friendsResponse = await axios({
        method: 'GET',
        url: `https://friends-public-service-prod.ol.epicgames.com/friends/api/v1/${accountId}/friends`,
        headers: { 'Authorization': `Bearer ${token}` }
      });
      areFriends = friendsResponse.data.some(f => f.accountId === friendId);
    } catch (error) {
      console.warn('⚠️ No se pudo verificar amistad:', error.message);
    }

    if (!areFriends) {
      return res.status(400).json({
        success: false,
        error: `No eres amigo de ${epicName}. Debe aceptar la solicitud primero.`
      });
    }

    // 3. Obtener el precio REAL del artículo desde el catálogo
    let itemPrice = 0;
    try {
      const catalogResponse = await axios({
        method: 'GET',
        url: 'https://fortnite-public-service-prod11.ol.epicgames.com/fortnite/api/storefront/v2/catalog',
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 10000
      });

      // Buscar el offerId en todas las secciones de la tienda
      for (const store of catalogResponse.data.storefronts) {
        if (store.catalogEntries) {
          const entry = store.catalogEntries.find(e => e.offerId === offerId);
          if (entry) {
            // ✅ 2. LÓGICA DE PRECIO ACTUALIZADA A LA NUEVA API DE EPIC
            if (entry.prices && entry.prices.length > 0) {
              itemPrice = entry.prices[0].finalPrice || entry.prices[0].regularPrice || 0;
            } else {
              itemPrice = entry.regularPrice || entry.devPrice || 0;
            }
            break;
          }
        }
      }

      if (itemPrice === 0) {
        console.warn(`⚠️ No se encontró precio para ${offerId}, se usará 0 (puede fallar)`);
      } else {
        console.log(`💰 Precio obtenido para ${offerId}: ${itemPrice} V-Bucks`);
      }
    } catch (error) {
      console.warn('⚠️ No se pudo obtener catálogo, se usará precio 0:', error.message);
    }

    // 4. Enviar el regalo con el precio correcto
    const payload = {
      offerId: offerId,
      purchaseQuantity: 1,
      currency: 'MtxCurrency',
      currencySubType: '',
      expectedTotalPrice: itemPrice, // Usamos el precio real
      gameContext: '',
      receiverAccountIds: [friendId],
      giftWrapTemplateId: 'GiftBox:gb_default', // ✅ 3. CAJA DE REGALO VALIDA
      personalMessage: mensaje || '¡Gracias por tu compra!'
    };

    console.log(`🎁 Enviando regalo a ${epicName} (${friendId})`);
    console.log(`📦 Item: ${offerId}, Precio: ${itemPrice} V-Bucks`);

    const response = await axios({
      method: 'POST',
      url: `https://fortnite-public-service-prod11.ol.epicgames.com/fortnite/api/game/v2/profile/${accountId}/client/GiftCatalogEntry?profileId=common_core&rvn=-1`,
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      data: payload,
      timeout: 30000
    });

    console.log(`✅ Regalo enviado exitosamente a ${epicName}`);
    res.json({ success: true, message: `Regalo enviado a ${epicName}` });

  } catch (error) {
    // Mostrar error detallado de Epic
    const epicError = error.response?.data;
    console.error('❌ Error enviando regalo:');
    console.error(JSON.stringify(epicError || error.message, null, 2));

    // Si el error es por precio, dar un mensaje claro
    let userMessage = epicError?.errorMessage || error.message;
    if (epicError?.errorCode === 'errors.com.epicgames.modules.gifting.gift_offer_price_mismatch') {
      userMessage = 'El precio del artículo no coincide. Asegúrate de enviar el precio correcto desde la web.';
    }

    res.status(500).json({
      success: false,
      error: userMessage,
      details: epicError || null
    });
  }
});