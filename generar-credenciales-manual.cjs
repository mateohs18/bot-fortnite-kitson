// generar-credenciales-manual.cjs
const fs = require('fs');
const readline = require('readline');
const axios = require('axios');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Credenciales del cliente de Android de Fortnite
const ANDROID_TOKEN = 'M2Y2OWU1NmM3NjQ5NDkyYzhjYzI5ZjFhZjA4YThhMTI6YjUxZWU5Y2IxMjIzNGY1MGE2OWVmYTY3ZWY1MzgxMmU=';
const ANDROID_CLIENT_ID = '3f69e56c7649492c8cc29f1af08a8a12';

console.log('\n🔐 GENERADOR DE DEVICE AUTH MANUAL');
console.log('=================================\n');

console.log('📱 PASO 1: Abre este enlace en tu navegador:');
console.log(`\n👉 https://www.epicgames.com/id/api/redirect?clientId=${ANDROID_CLIENT_ID}&responseType=code\n`);
console.log('🔑 Inicia sesión con tu cuenta de Epic Games');
console.log('📋 Después de iniciar sesión, copia el código de 32 caracteres de la URL\n');

rl.question('📝 Código de 32 caracteres: ', async (code) => {
  code = code.trim();
  
  if (code.length !== 32) {
    console.log('\n❌ El código debe tener 32 caracteres');
    rl.close();
    return;
  }
  
  console.log('\n🔄 Obteniendo token de acceso...');
  
  try {
    // Paso 1: Obtener token
    const tokenResponse = await axios({
      method: 'POST',
      url: 'https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token',
      headers: {
        'Authorization': `Basic ${ANDROID_TOKEN}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: `grant_type=authorization_code&code=${code}`,
      timeout: 10000
    });

    const tokenData = tokenResponse.data;
    console.log('✅ Token obtenido');
    console.log(`   Account ID: ${tokenData.account_id}`);

    // Paso 2: Crear device auth
    console.log('🔄 Creando device auth...');
    
    const deviceAuthResponse = await axios({
      method: 'POST',
      url: `https://account-public-service-prod.ol.epicgames.com/account/api/public/account/${tokenData.account_id}/deviceAuth`,
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      },
      data: JSON.stringify({}),
      timeout: 10000
    });

    const deviceAuthData = deviceAuthResponse.data;
    
    // Verificar que los datos sean correctos
    if (!deviceAuthData.accountId || !deviceAuthData.deviceId || !deviceAuthData.secret) {
      throw new Error('Datos de device auth incompletos');
    }

    // Guardar el archivo
    fs.writeFileSync('./deviceAuth.json', JSON.stringify(deviceAuthData, null, 2));
    
    console.log('\n✅ ========================================');
    console.log('✅ DEVICE AUTH GENERADO EXITOSAMENTE');
    console.log('✅ ========================================');
    console.log(`📁 Archivo guardado: deviceAuth.json`);
    console.log(`👤 Account ID: ${deviceAuthData.accountId}`);
    console.log(`🔑 Device ID: ${deviceAuthData.deviceId}`);
    console.log(`🔐 Secret: ${deviceAuthData.secret}`);
    console.log('\n📋 AHORA prueba el servidor con:');
    console.log('   node index-simple.js\n');
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    if (error.response) {
      console.error('   Respuesta:', JSON.stringify(error.response.data, null, 2));
    }
  } finally {
    rl.close();
  }
});