import { NextResponse } from 'next/server';
import axios from 'axios';

// IMPORTANTE: Asegúrate de tener aquí arriba tus funciones
// ensureToken, getAccountIdByName, y la variable accountId.

export async function POST(request) {
  try {
    // En Next.js, así es como se lee lo que envía la página web
    const body = await request.json();
    console.log('📦 Recibida petición de regalo:', body);
    
    const { epicName, offerId, mensaje } = body;
    
    if (!epicName || !offerId) {
      return NextResponse.json({ success: false, error: 'epicName y offerId son requeridos' }, { status: 400 });
    }

    const token = await ensureToken();
    if (!token) {
      return NextResponse.json({ success: false, error: 'No se pudo obtener token' }, { status: 401 });
    }

    // 1. Obtener Account ID del destinatario
    const friendId = await getAccountIdByName(epicName);
    if (!friendId) {
      return NextResponse.json({ success: false, error: `Usuario "${epicName}" no encontrado` }, { status: 404 });
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
      return NextResponse.json({
        success: false,
        error: `No eres amigo de ${epicName}. Debe aceptar la solicitud primero.`
      }, { status: 400 });
    }

    // 3. Obtener el precio REAL
    let itemPrice = 0;
    try {
      const catalogResponse = await axios({
        method: 'GET',
        url: 'https://fortnite-public-service-prod11.ol.epicgames.com/fortnite/api/storefront/v2/catalog',
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 10000
      });

      for (const store of catalogResponse.data.storefronts) {
        if (store.catalogEntries) {
          const entry = store.catalogEntries.find(e => e.offerId === offerId);
          if (entry) {
            if (entry.prices && entry.prices.length > 0) {
              itemPrice = entry.prices[0].finalPrice || entry.prices[0].regularPrice || 0;
            } else {
              itemPrice = entry.regularPrice || entry.devPrice || 0;
            }
            break;
          }
        }
      }
      console.log(`💰 Precio obtenido para ${offerId}: ${itemPrice} V-Bucks`);
    } catch (error) {
      console.warn('⚠️ Error en catálogo:', error.message);
    }

    // 4. Enviar el regalo
    const payload = {
      offerId: offerId,
      purchaseQuantity: 1,
      currency: 'MtxCurrency',
      currencySubType: '',
      expectedTotalPrice: itemPrice, 
      gameContext: '',
      receiverAccountIds: [friendId],
      giftWrapTemplateId: 'GiftBox:gb_default', 
      personalMessage: mensaje || '¡Gracias por tu compra!'
    };

    console.log(`🎁 Enviando regalo a ${epicName} (${friendId})`);

    await axios({
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
    return NextResponse.json({ success: true, message: `Regalo enviado a ${epicName}` });

  } catch (error) {
    const epicError = error.response?.data;
    console.error('❌ Error enviando regalo:', epicError || error.message);

    let userMessage = epicError?.errorMessage || error.message;
    if (epicError?.errorCode === 'errors.com.epicgames.modules.gifting.gift_offer_price_mismatch') {
      userMessage = 'El precio del artículo no coincide.';
    }

    return NextResponse.json({
      success: false,
      error: userMessage,
      details: epicError || null
    }, { status: 500 });
  }
}z