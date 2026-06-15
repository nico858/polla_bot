const fs = require('fs');
const path = require('path');
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
require('dayjs/locale/es');
const dotenv = require('dotenv');
const puppeteerConfig = require('./puppeteer');

function assertSupportedNodeVersion() {
    const major = Number(process.versions.node.split('.')[0] || 0);
    // whatsapp-web.js + puppeteer are notably unstable on Node 24 in this project.
    if (major >= 24) {
        console.error(
            `Node ${process.versions.node} no es compatible con este bot. Usa Node 20 LTS o 22 LTS.`
        );
        process.exit(1);
    }
}

function loadEnvFile() {
    const regularEnvPath = path.join(__dirname, '.env');
    const altEnvPath = path.join(__dirname, '-env');

    if (fs.existsSync(regularEnvPath)) {
        dotenv.config({ path: regularEnvPath });
        console.log('Cargadas variables desde .env');
        return;
    }

    if (fs.existsSync(altEnvPath)) {
        dotenv.config({ path: altEnvPath });
        console.log('Cargadas variables desde -env (renombralo a .env recomendado)');
        return;
    }

    console.log('No se encontro .env ni -env. Se usaran valores por defecto/env del sistema.');
}

assertSupportedNodeVersion();
loadEnvFile();

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('es');

const PORT = Number(process.env.PORT || 3000);
const TIMEZONE = process.env.TIMEZONE || 'America/Bogota';
const GROUP_NAME = process.env.WHATSAPP_GROUP_NAME || 'Grupo prueba polla';
const GROUP_ID = process.env.WHATSAPP_GROUP_ID || '';
const DAILY_REMINDER_CRON = process.env.DAILY_REMINDER_CRON || '0 8 * * *';
const DAILY_REMINDER_MESSAGE =
    process.env.DAILY_REMINDER_MESSAGE ||
    'Recuerden llenar los resultados del dia en la polla antes de que arranquen los partidos.';
const MATCH_REMINDER_MINUTES_BEFORE = Number(
    process.env.MATCH_REMINDER_MINUTES_BEFORE || 30
);
const DEBUG_LIST_GROUPS = process.env.DEBUG_LIST_GROUPS === 'true';
const MATCH_SOURCE = (process.env.MATCH_SOURCE || 'local').toLowerCase();
const ESPN_LEAGUE_SLUG = process.env.ESPN_LEAGUE_SLUG || 'fifa.world';
const MATCHES_DAYS_AHEAD = Number(process.env.MATCHES_DAYS_AHEAD || 7);
const MATCHES_REFRESH_MINUTES = Number(process.env.MATCHES_REFRESH_MINUTES || 60);
const MATCHES_FILE = path.join(__dirname, 'matches.json');
const QR_VIEW_TOKEN = process.env.QR_VIEW_TOKEN || '';
const defaultSendRetries = process.platform === 'win32' ? 1 : 0;
const SEND_MESSAGE_RETRIES = Number(process.env.SEND_MESSAGE_RETRIES || defaultSendRetries);
const SEND_MESSAGE_RETRY_DELAY_MS = Number(process.env.SEND_MESSAGE_RETRY_DELAY_MS || 1500);
const GROUP_ID_RESOLVE_TIMEOUT_MS = Number(
    process.env.GROUP_ID_RESOLVE_TIMEOUT_MS || 10000
);
const SEND_MESSAGE_TIMEOUT_MS = Number(
    process.env.SEND_MESSAGE_TIMEOUT_MS || (process.platform === 'win32' ? 8000 : 25000)
);
const MATCH_REMINDER_GRACE_MINUTES = Number(process.env.MATCH_REMINDER_GRACE_MINUTES || 2);
const MAX_CONSECUTIVE_SEND_FAILURES = Number(
    process.env.MAX_CONSECUTIVE_SEND_FAILURES || 3
);
const REINIT_COOLDOWN_MS = Number(process.env.REINIT_COOLDOWN_MS || 30000);
const GROUP_RESOLVE_TIMEOUT_MS = Number(process.env.GROUP_RESOLVE_TIMEOUT_MS || 25000);
const GROUP_RESOLVE_RETRIES = Number(process.env.GROUP_RESOLVE_RETRIES || 2);
const GROUP_RESOLVE_BACKGROUND_MINUTES = Number(
    process.env.GROUP_RESOLVE_BACKGROUND_MINUTES || 3
);
const GROUP_LIST_TIMEOUT_MS = Number(process.env.GROUP_LIST_TIMEOUT_MS || 20000);
const GROUP_LIST_RETRIES = Number(process.env.GROUP_LIST_RETRIES || 2);
const CLIENT_READY_WAIT_MS = Number(process.env.CLIENT_READY_WAIT_MS || 30000);
const AUTO_LOG_GROUPS_ON_READY = (process.env.AUTO_LOG_GROUPS_ON_READY || 'false') === 'true';
const ALLOW_GROUP_NAME_RESOLUTION =
    (process.env.ALLOW_GROUP_NAME_RESOLUTION ||
        (process.platform === 'win32' ? 'true' : 'false')) === 'true';

const alreadySentMatchReminderKeys = new Set();
let cachedGroupId = GROUP_ID;
let latestQrText = '';
let latestQrGeneratedAt = null;
let schedulesInitialized = false;
let isReinitializingClient = false;
let isClientReady = false;
let lastReinitAtMs = 0;
let consecutiveSendFailures = 0;
let groupResolvePromise = null;
let internetMatchesCache = {
    fetchedAt: null,
    matches: []
};

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'polla-bot' }),
    puppeteer: puppeteerConfig
});

function waitForClientReady(timeoutMs = CLIENT_READY_WAIT_MS) {
    if (isClientReady) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error('Cliente de WhatsApp no esta listo todavia.'));
        }, timeoutMs);

        const onReady = () => {
            cleanup();
            resolve();
        };

        const onDisconnected = () => {
            // Keep waiting; disconnected can happen before reconnect.
        };

        const cleanup = () => {
            clearTimeout(timeoutId);
            client.off('ready', onReady);
            client.off('disconnected', onDisconnected);
        };

        client.on('ready', onReady);
        client.on('disconnected', onDisconnected);
    });
}

function startHealthServer() {
    const app = express();

    function ensureQrAccess(req, res) {
        if (!QR_VIEW_TOKEN) {
            return true;
        }
        if (req.query.token === QR_VIEW_TOKEN) {
            return true;
        }
        res.status(401).send('No autorizado para ver QR.');
        return false;
    }

    app.get('/health', (req, res) => {
        res.status(200).json({
            status: 'ok',
            service: 'polla-bot',
            now: dayjs().tz(TIMEZONE).format()
        });
    });

    app.get('/qr', (req, res) => {
        if (!ensureQrAccess(req, res)) {
            return;
        }
        if (!latestQrText) {
            res.status(404).send('No hay QR activo en este momento.');
            return;
        }

        const encoded = encodeURIComponent(latestQrText);
        const imageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=420x420&data=${encoded}`;
        const generatedAt = latestQrGeneratedAt
            ? dayjs(latestQrGeneratedAt).tz(TIMEZONE).format('DD/MM HH:mm:ss')
            : 'desconocido';
        res.status(200).send(
            `<!doctype html>
<html>
<head><meta charset="utf-8"><title>QR WhatsApp Bot</title></head>
<body style="font-family:Arial,sans-serif;padding:24px">
  <h2>QR de WhatsApp Bot</h2>
  <p>Generado: ${generatedAt} (${TIMEZONE})</p>
  <p>Escanea este QR desde WhatsApp -> Dispositivos vinculados.</p>
  <img src="${imageUrl}" alt="QR WhatsApp" />
  <p style="font-size:12px;color:#666">El QR expira rapido. Si no funciona, refresca la pagina.</p>
</body>
</html>`
        );
    });

    app.get('/groups', async (req, res) => {
        if (!ensureQrAccess(req, res)) {
            return;
        }
        try {
            const groups = await listAvailableGroups();
            res.status(200).json({
                total: groups.length,
                groups
            });
        } catch (error) {
            res.status(500).json({
                error: `No se pudieron listar grupos: ${error.message}`
            });
        }
    });

    app.listen(PORT, () => {
        console.log(`Health server escuchando en puerto ${PORT}`);
    });
}

function loadMatches() {
    if (!fs.existsSync(MATCHES_FILE)) {
        console.warn('No existe matches.json. Se inicia sin recordatorios de partidos.');
        return [];
    }

    const raw = fs.readFileSync(MATCHES_FILE, 'utf8');
    if (!raw.trim()) {
        return [];
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new Error(`matches.json no tiene un JSON valido: ${error.message}`);
    }

    if (!Array.isArray(parsed)) {
        throw new Error('matches.json debe ser un arreglo de partidos.');
    }

    return parsed.filter((match) => {
        if (!match || !match.id || !match.kickoff || !match.home || !match.away) {
            console.warn('Partido ignorado por datos incompletos:', match);
            return false;
        }
        const kickoff = parseKickoff(match.kickoff);
        if (!kickoff.isValid()) {
            console.warn(`Partido ${match.id} ignorado: kickoff invalido (${match.kickoff})`);
            return false;
        }
        return true;
    });
}

function parseKickoff(rawKickoff) {
    if (!rawKickoff) {
        return dayjs('');
    }

    const hasTimeZoneInfo = /z$|[+-]\d{2}:\d{2}$/i.test(rawKickoff);
    if (hasTimeZoneInfo) {
        return dayjs(rawKickoff).tz(TIMEZONE);
    }
    return dayjs.tz(rawKickoff, TIMEZONE);
}

function getFlagFromCountryCode(countryCode) {
    if (!countryCode || typeof countryCode !== 'string') {
        return '';
    }
    const normalized = countryCode.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(normalized)) {
        return '';
    }
    const codePoints = [...normalized].map((char) => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
}

function formatTeamWithFlag(teamName, countryCode) {
    const flag = getFlagFromCountryCode(countryCode);
    return `${flag ? `${flag} ` : ''}${teamName}`;
}

async function fetchEspnMatches() {
    const now = dayjs().tz(TIMEZONE).startOf('day');
    const allMatches = [];

    for (let dayOffset = 0; dayOffset <= MATCHES_DAYS_AHEAD; dayOffset += 1) {
        const date = now.add(dayOffset, 'day').format('YYYYMMDD');
        const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_LEAGUE_SLUG}/scoreboard?dates=${date}`;

        let response;
        try {
            response = await fetch(url);
        } catch (error) {
            console.error('Error consultando ESPN:', error.message);
            continue;
        }

        if (!response.ok) {
            console.error(`ESPN respondio ${response.status} para ${date}`);
            continue;
        }

        const data = await response.json();
        const events = Array.isArray(data.events) ? data.events : [];
        for (const event of events) {
            const competition = event.competitions?.[0];
            const competitors = Array.isArray(competition?.competitors)
                ? competition.competitors
                : [];
            const home = competitors.find((c) => c.homeAway === 'home');
            const away = competitors.find((c) => c.homeAway === 'away');

            if (!home?.team?.displayName || !away?.team?.displayName || !event?.date) {
                continue;
            }

            allMatches.push({
                id: String(event.id || `${date}-${home.team.displayName}-${away.team.displayName}`),
                home: home.team.displayName,
                away: away.team.displayName,
                homeCode: home.team.isoCode || '',
                awayCode: away.team.isoCode || '',
                kickoff: event.date
            });
        }
    }

    return allMatches;
}

async function getMatches() {
    if (MATCH_SOURCE !== 'espn') {
        return loadMatches();
    }

    const now = dayjs();
    const shouldRefresh =
        !internetMatchesCache.fetchedAt ||
        now.diff(internetMatchesCache.fetchedAt, 'minute') >= MATCHES_REFRESH_MINUTES;

    if (!shouldRefresh) {
        return internetMatchesCache.matches;
    }

    const fetchedMatches = await fetchEspnMatches();
    internetMatchesCache = {
        fetchedAt: now,
        matches: fetchedMatches
    };

    console.log(
        `Partidos actualizados desde internet (${fetchedMatches.length}) a las ${now
            .tz(TIMEZONE)
            .format('DD/MM HH:mm')}`
    );
    return fetchedMatches;
}

async function getGroupChat() {
    if (cachedGroupId) {
        try {
            return await client.getChatById(cachedGroupId);
        } catch (error) {
            console.warn(
                `No se pudo recuperar el grupo por ID (${cachedGroupId}). Se buscara por nombre.`
            );
            cachedGroupId = '';
        }
    }

    if (!ALLOW_GROUP_NAME_RESOLUTION) {
        throw new Error(
            'Resolucion por nombre deshabilitada. Configura WHATSAPP_GROUP_ID para este entorno.'
        );
    }

    const chats = await client.getChats();
    const normalizedTarget = GROUP_NAME.trim().toLowerCase();
    const group = chats.find(
        (chat) => chat.isGroup && String(chat.name || '').trim().toLowerCase() === normalizedTarget
    );

    if (!group) {
        throw new Error(
            `No se encontro el grupo "${GROUP_NAME}". Verifica el nombre o usa WHATSAPP_GROUP_ID.`
        );
    }

    cachedGroupId = group.id._serialized;
    return group;
}

async function listAvailableGroups() {
    await waitForClientReady();

    if (!client || typeof client.getChats !== 'function') {
        throw new Error('Cliente de WhatsApp aun no inicializado correctamente.');
    }

    let lastError = null;
    for (let attempt = 1; attempt <= GROUP_LIST_RETRIES + 1; attempt += 1) {
        try {
            const chats = await Promise.race([
                client.getChats(),
                new Promise((_, reject) =>
                    setTimeout(
                        () => reject(new Error('Timeout listando chats/grupos.')),
                        GROUP_LIST_TIMEOUT_MS
                    )
                )
            ]);

            return chats
                .filter((chat) => chat.isGroup)
                .map((group) => ({
                    name: String(group.name || '').trim(),
                    id: group.id?._serialized || ''
                }));
        } catch (error) {
            lastError = error;
            const hasMoreAttempts = attempt <= GROUP_LIST_RETRIES;
            if (!hasMoreAttempts) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }

    throw lastError || new Error('No se pudieron listar grupos.');
}

async function resolveAndCacheGroupId() {
    if (cachedGroupId) {
        return cachedGroupId;
    }

    if (groupResolvePromise) {
        return groupResolvePromise;
    }

    groupResolvePromise = (async () => {
        let lastError = null;
        for (let attempt = 1; attempt <= GROUP_RESOLVE_RETRIES + 1; attempt += 1) {
            try {
                const group = await Promise.race([
                    getGroupChat(),
                    new Promise((_, reject) =>
                        setTimeout(
                            () => reject(new Error('Timeout resolviendo grupo por nombre.')),
                            GROUP_RESOLVE_TIMEOUT_MS
                        )
                    )
                ]);

                cachedGroupId = group.id._serialized;
                console.log(`Grupo objetivo resuelto: ${cachedGroupId}`);
                return cachedGroupId;
            } catch (error) {
                lastError = error;
                const hasMoreAttempts = attempt <= GROUP_RESOLVE_RETRIES;
                if (!hasMoreAttempts) {
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 1200));
            }
        }
        throw lastError || new Error('No se pudo resolver groupId.');
    })();

    try {
        return await groupResolvePromise;
    } finally {
        groupResolvePromise = null;
    }
}

function isLikelyStaleGroupError(messageText) {
    return (
        messageText.includes('wid error') ||
        messageText.includes('not a whatsapp user') ||
        messageText.includes('invalid wid')
    );
}

async function maybeReinitializeClient(reason) {
    const now = Date.now();
    const inCooldown = now - lastReinitAtMs < REINIT_COOLDOWN_MS;
    if (isReinitializingClient || inCooldown) {
        return;
    }

    isReinitializingClient = true;
    isClientReady = false;
    lastReinitAtMs = now;
    console.warn(`Reinicializando cliente por: ${reason}`);

    try {
        await client.destroy();
    } catch (error) {
        console.warn('No se pudo destruir cliente antes de reiniciar:', error.message);
    }

    try {
        client.initialize();
    } catch (error) {
        console.error('Error al reinicializar cliente:', error.message);
    } finally {
        isReinitializingClient = false;
    }
}

async function sendGroupMessage(message) {
    let lastError = null;

    for (let attempt = 1; attempt <= SEND_MESSAGE_RETRIES + 1; attempt += 1) {
        try {
            const groupId = await Promise.race([
                resolveAndCacheGroupId(),
                new Promise((_, reject) =>
                    setTimeout(
                        () => reject(new Error('Timeout resolviendo groupId.')),
                        GROUP_ID_RESOLVE_TIMEOUT_MS
                    )
                )
            ]);

            await Promise.race([
                client.sendMessage(groupId, message),
                new Promise((_, reject) =>
                    setTimeout(
                        () => reject(new Error('Timeout enviando mensaje al grupo.')),
                        SEND_MESSAGE_TIMEOUT_MS
                    )
                )
            ]);

            consecutiveSendFailures = 0;
            console.log(`Mensaje enviado al grupo (intento ${attempt}).`);
            return;
        } catch (error) {
            lastError = error;
            const messageText = String(error?.message || '');
            consecutiveSendFailures += 1;
            const isTimeout =
                messageText.includes('Runtime.callFunctionOn timed out') ||
                messageText.includes('Timeout resolviendo groupId.') ||
                messageText.includes('Timeout enviando mensaje al grupo.') ||
                messageText.includes('Timeout resolviendo grupo por nombre.');
            const isStaleGroup = isLikelyStaleGroupError(messageText);
            const hasMoreAttempts = attempt <= SEND_MESSAGE_RETRIES;
            const isResolveIssue =
                messageText.includes('No se encontro el grupo') ||
                messageText.includes('Timeout resolviendo groupId.') ||
                messageText.includes('Timeout resolviendo grupo por nombre.') ||
                messageText.includes('Timeout listando chats/grupos.');
            const isSendPipelineIssue =
                messageText.includes('Runtime.callFunctionOn timed out') ||
                messageText.includes('Target closed') ||
                messageText.includes('detached Frame');

            if (isStaleGroup) {
                cachedGroupId = '';
                console.warn('Se detecto groupId invalido; se reintentara resolviendo de nuevo.');
            }

            if (
                consecutiveSendFailures >= MAX_CONSECUTIVE_SEND_FAILURES &&
                !isResolveIssue &&
                isSendPipelineIssue
            ) {
                maybeReinitializeClient(
                    `${consecutiveSendFailures} fallos consecutivos al enviar mensajes`
                ).catch(() => {});
            }

            if (!isTimeout || !hasMoreAttempts) {
                throw error;
            }

            console.warn(
                `Timeout enviando mensaje (intento ${attempt}). Reintentando en ${SEND_MESSAGE_RETRY_DELAY_MS}ms...`
            );
            await new Promise((resolve) => setTimeout(resolve, SEND_MESSAGE_RETRY_DELAY_MS));
        }
    }

    throw lastError;
}

async function printAvailableGroups() {
    const groups = await listAvailableGroups();

    if (!groups.length) {
        console.log('No se encontraron grupos en esta sesion.');
        return;
    }

    console.log('Grupos detectados (nombre -> id):');
    for (const group of groups) {
        console.log(`- ${group.name} -> ${group.id}`);
    }
}

function buildMatchReminderMessage(match, kickoff) {
    const kickoffFormatted = kickoff.format('dddd D [de] MMMM, h:mm A');
    const home = formatTeamWithFlag(match.home, match.homeCode);
    const away = formatTeamWithFlag(match.away, match.awayCode);

    return (
        `⚽ *Recordatorio de partido*\n` +
        `${home} vs ${away}\n` +
        `🕒 Empieza ${kickoffFormatted} (${TIMEZONE})\n` +
        `📝 Todavia estas a tiempo de registrar tu resultado en la polla.`
    );
}

function scheduleDailyReminder() {
    cron.schedule(
        DAILY_REMINDER_CRON,
        async () => {
            try {
                const today = dayjs().tz(TIMEZONE).format('dddd D [de] MMMM');
                await sendGroupMessage(
                    `☀️ *Buenos dias a todos!*\n` +
                        `Hoy es ${today}.\n` +
                        `${DAILY_REMINDER_MESSAGE}`
                );
            } catch (error) {
                console.error('Error enviando recordatorio diario:', error.message);
            }
        },
        { timezone: TIMEZONE }
    );
    console.log(`Recordatorio diario programado con cron "${DAILY_REMINDER_CRON}" (${TIMEZONE})`);
}

function scheduleMatchReminders() {
    cron.schedule(
        '* * * * *',
        async () => {
            const matches = await getMatches();
            const now = dayjs().tz(TIMEZONE).startOf('minute');

            for (const match of matches) {
                const kickoff = parseKickoff(match.kickoff).startOf('minute');
                const reminderKey = `${match.id}-${kickoff.format()}`;
                if (alreadySentMatchReminderKeys.has(reminderKey)) {
                    continue;
                }

                const minutesUntilKickoff = kickoff.diff(now, 'minute');
                const lowerBound = MATCH_REMINDER_MINUTES_BEFORE - MATCH_REMINDER_GRACE_MINUTES;
                const withinReminderWindow =
                    minutesUntilKickoff <= MATCH_REMINDER_MINUTES_BEFORE &&
                    minutesUntilKickoff >= lowerBound;

                if (!withinReminderWindow) {
                    continue;
                }

                try {
                    await sendGroupMessage(buildMatchReminderMessage(match, kickoff));
                    alreadySentMatchReminderKeys.add(reminderKey);
                } catch (error) {
                    console.error(
                        `Error enviando recordatorio de partido ${match.id}:`,
                        error.message
                    );
                }
            }
        },
        { timezone: TIMEZONE }
    );

    console.log(
        `Chequeo de partidos activo. Se avisa ${MATCH_REMINDER_MINUTES_BEFORE} minutos antes.`
    );
}

function scheduleBackgroundGroupResolver() {
    if (!ALLOW_GROUP_NAME_RESOLUTION) {
        console.log(
            'Resolver en segundo plano desactivado: se requiere WHATSAPP_GROUP_ID en este entorno.'
        );
        return;
    }

    cron.schedule(
        `*/${GROUP_RESOLVE_BACKGROUND_MINUTES} * * * *`,
        async () => {
            if (cachedGroupId || isReinitializingClient || groupResolvePromise) {
                return;
            }
            try {
                await resolveAndCacheGroupId();
            } catch (error) {
                console.warn('Resolucion en segundo plano de groupId fallo:', error.message);
            }
        },
        { timezone: TIMEZONE }
    );
    console.log(
        `Resolver de groupId en segundo plano activo (cada ${GROUP_RESOLVE_BACKGROUND_MINUTES} min).`
    );
}

client.on('qr', (qr) => {
    latestQrText = qr;
    latestQrGeneratedAt = new Date();
    qrcode.generate(qr, { small: true });
    console.log('Escanea el QR para iniciar sesion en WhatsApp Web.');
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=420x420&data=${encodeURIComponent(
        qr
    )}`;
    console.log(`Si en logs no se ve bien, abre esta URL del QR: ${qrImageUrl}`);
    if (QR_VIEW_TOKEN) {
        console.log(`Tambien puedes usar /qr?token=*** en la URL publica del servicio.`);
    } else {
        console.log(`Tambien puedes usar /qr en la URL publica del servicio.`);
    }
});

client.on('ready', () => {
    isClientReady = true;
    console.log('Bot conectado y listo.');
    if (!cachedGroupId && ALLOW_GROUP_NAME_RESOLUTION) {
        setTimeout(() => {
            resolveAndCacheGroupId().catch((error) => {
                console.warn('No se pudo resolver groupId al iniciar:', error.message);
            });
        }, 4000);
    } else if (!cachedGroupId) {
        console.warn(
            'No hay WHATSAPP_GROUP_ID configurado y resolucion por nombre esta deshabilitada.'
        );
    }

    if (ALLOW_GROUP_NAME_RESOLUTION && (DEBUG_LIST_GROUPS || !cachedGroupId || AUTO_LOG_GROUPS_ON_READY)) {
        printAvailableGroups().catch((error) => {
            console.error('No se pudieron listar los grupos:', error.message);
        });
    }
    if (!schedulesInitialized) {
        scheduleDailyReminder();
        scheduleMatchReminders();
        scheduleBackgroundGroupResolver();
        schedulesInitialized = true;
    } else {
        console.log('Cliente reconectado; cron jobs existentes se mantienen activos.');
    }
});

client.on('authenticated', () => {
    console.log('Sesion autenticada correctamente.');
});

client.on('auth_failure', (message) => {
    isClientReady = false;
    console.error('Fallo de autenticacion:', message);
});

client.on('disconnected', (reason) => {
    isClientReady = false;
    console.warn('Cliente desconectado:', reason);
});

startHealthServer();
client.initialize();