const TARGET_URL = process.env.TARGET_URL;
const INTERVAL_MINUTES = Number(process.env.PING_EVERY_MINUTES || 10);

if (!TARGET_URL) {
    console.error('Falta TARGET_URL. Ejemplo: https://tu-app.onrender.com/health');
    process.exit(1);
}

if (!Number.isFinite(INTERVAL_MINUTES) || INTERVAL_MINUTES <= 0) {
    console.error('PING_EVERY_MINUTES debe ser un numero mayor que 0.');
    process.exit(1);
}

async function pingTarget() {
    try {
        const response = await fetch(TARGET_URL, {
            method: 'GET',
            headers: { 'User-Agent': 'polla-bot-awake-script' }
        });
        console.log(`[${new Date().toISOString()}] Ping ${response.status} -> ${TARGET_URL}`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error haciendo ping:`, error.message);
    }
}

console.log(
    `Awake script activo. Ping cada ${INTERVAL_MINUTES} minutos a ${TARGET_URL}`
);

pingTarget();
setInterval(pingTarget, INTERVAL_MINUTES * 60 * 1000);