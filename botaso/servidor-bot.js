const { Client } = require('fnbr');

// 1. Inicializamos el bot apuntando al archivo que acabas de crear
const bot = new Client({
  auth: { deviceAuth: require('./deviceAuth.json') }
});

// 2. Evento para confirmar que la conexión funcionó
bot.on('ready', () => {
  console.log(`🤖 ¡Bot conectado con éxito como: ${bot.user.displayName}!`);
});

// 3. Encender el bot
bot.login()
  .catch((error) => {
    console.error('❌ Error al iniciar sesión:', error.message);
  });