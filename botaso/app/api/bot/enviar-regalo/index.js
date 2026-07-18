import { NextResponse } from 'next/server';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

// ========== CONFIGURACIÓN GLOBAL ==========
let accessToken = null;
let tokenExpiry = null;
let deviceAuth = null;
let accountId = null;

// En Next.js, es más seguro usar process.cwd() para encontrar archivos
try {
  const authPath = path.join(process.cwd(), 'deviceAuth.json');
  deviceAuth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
  accountId = deviceAuth.accountId;
  console.log('✅ DeviceAuth cargado correctamente en Next.js');
} catch (error) {
  console.error('❌ Error cargando deviceAuth:', error.message);
}

// ========== FUNCIONES DE AUTENTICACIÓN ==========
async function getToken() {
  try {
    console.log('🔄 Obteniendo token...');
    const params = new URLSearchParams({
      grant_type: 'device_auth',
      account_id: deviceAuth.accountId,
      device_id: deviceAuth.deviceId,
      secret: deviceAuth.secret
    });

    const response = await axios({
      method: 'POST',
      url: 'https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic M2Y2OWU1NmM3NjQ5NDkyYzhjYzI5ZjFhZjA4YThhMTI6YjUxZWU5Y2IxMjIzNGY1MGE2OWVmYTY3ZWY1MzgxMmU='
      },
      data: params.toString(),
      timeout: 15000
    });

    const data = response.data;
    accessToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in * 1000);
    console.log('✅ Token obtenido correctamente');
    return accessToken;
  } catch (error) {
    console.error('❌ Error obteniendo token:', error.response?.data || error.message);
    return null;
  }
}

async function ensureToken() {
  if (!accessToken || Date.now() >= tokenExpiry) {
    return await getToken();
  }
  return accessToken;
}

// ========== FUNCIONES AUXILIARES ==========
async function getAccountIdByName(displayName) {
  const token = await ensureToken();
  if (!token) return null;

  try {
    const response = await axios({
      method: 'GET',
      url: `https://account-public-service-prod.ol.epicgames.com/account/api/public/account/displayName/${encodeURIComponent(displayName)}`,
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000
    });
    return response.data?.id || null;
  } catch (error) {
    if (error.response?.status === 404) {
      console.log(`❌ Usuario "${displayName}" no encontrado`);
    } else {
      console.error(`❌ Error buscando ${displayName}:`, error.response?.data?.errorMessage || error.message);
    }
    return null;
  }
}

// ========== ENDPOINT PRINCIPAL (Equivalente a app.post) ==========
export async function POST(request) {
  try {
    // En Next.js los datos se reciben así
    const body = await request.json();
    console.log('📥 /enviar-regalo body RECIBIDO:', body);

    const { epicName, offerId, mensaje } = body;
    
    if (!epicName || !offerId) {
      console.log('❌ Faltan campos: epicName o offerId');
      return NextResponse.json({ success: false, error: 'epicName y offerId son requeridos' }, { status: 400 });
    }

    const token = await ensureToken();
    if (!token) {
      console.log('❌ Token no disponible');
      return NextResponse.json({ success: false, error: 'No se pudo obtener token' }, { status: 401 });
    }

    console.log(`🔍 Buscando ID de ${epicName}...`);
    const friendId = await getAccountIdByName(epicName);
    if (!friendId) {
      console.log(`❌ Usuario ${epicName} no encontrado`);
      return NextResponse.json({ success: false, error: `Usuario "${epicName}" no encontrado` }, { status: 404 });
    }
    console.log(`✅ ID de ${epicName}: ${friendId}`);

    // Verificar amistad
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
      console.log(`❌ No son amigos de ${epicName}`);
      return NextResponse.json({
        success: false,
        error: `No eres amigo de ${epicName}. Debe aceptar la solicitud primero.`
      }, { status: 400 });
    }
    console.log('✅ Son amigos');

    // Obtener precio del catálogo
    let itemPrice = 0;
    try {
      const catalogResponse = await axios({
        method: 'GET',
        url: 'https://fortnite-public-service-prod11.ol.epicgames.com/fortnite/api/storefront/v2/catalog',
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 10000
      });

      let objetoEncontrado = false;

      for (const store of catalogResponse.data.storefronts) {
        if (store.catalogEntries) {
          const entry = store.catalogEntries.find(e => e.offerId === offerId);
          if (entry) {
            objetoEncontrado = true;
            console.log(`✅ Objeto encontrado en la tienda de Epic: ${store.name}`);
            
            if (entry.prices && entry.prices.length > 0) {
              itemPrice = entry.prices[0].finalPrice || entry.prices[0].regularPrice || 0;
            } else {
              itemPrice = entry.regularPrice || entry.devPrice || 0;
            }
            break;
          }
        }
      }
      
      if (!objetoEncontrado) {
        console.warn(`⚠️ El Epic ID ${offerId} no se encontró en el catálogo actual.`);
      } else {
        console.log(`💰 Precio en paVos obtenido para ${offerId}: ${itemPrice}`);
      }
    } catch (error) {
      console.warn('⚠️ Error obteniendo catálogo:', error.message);
    }

    const payload = {
      offerId,
      purchaseQuantity: 1,
      currency: 'MtxCurrency',
      currencySubType: '',
      expectedTotalPrice: itemPrice,
      gameContext: '',
      receiverAccountIds: [friendId],
      giftWrapTemplateId: 'GiftBox:gb_default',
      personalMessage: mensaje || '¡Gracias por tu compra!'
    };

    console.log('📦 Enviando payload:', payload);

    const response = await axios({
      method: 'POST',
      url: `https://fortnite-public-service-prod11.ol.epicgames.com/fortnite/api/game/v2/profile/${accountId}/client/GiftCatalogEntry?profileId=common_core&rvn=-1`,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: payload,
      timeout: 30000
    });

    console.log(`✅ Regalo enviado exitosamente a ${epicName}`);
    return NextResponse.json({ success: true, message: `Regalo enviado a ${epicName}` });

  } catch (error) {
    console.error('❌ Error en /enviar-regalo:');
    console.error(error.response?.data || error.message);
    return NextResponse.json({
      success: false,
      error: error.response?.data?.errorMessage || error.message,
      details: error.response?.data || null
    }, { status: 500 });
  }
}