# Bot de WhatsApp para Polla Mundialista

Este proyecto envia:

- recordatorio diario a las `8:00 AM`,
- recordatorios `30 minutos antes` de cada partido definido en `matches.json` o consultado desde internet.

Usa `whatsapp-web.js` (sin API de Meta de pago), con sesion via QR de WhatsApp Web.

## 1) Requisitos

- Node.js 20+
- Una cuenta de WhatsApp dedicada para el bot (recomendado)

## 2) Instalacion local

1. Instala dependencias:

   ```bash
   npm install
   ```

2. Crea variables de entorno:

   - Copia `.env.example` a `.env`
   - Ajusta `TIMEZONE`, `WHATSAPP_GROUP_NAME` o `WHATSAPP_GROUP_ID`

3. Define tus partidos en `matches.json`:

   ```json
   [
     {
       "id": "match-001",
       "home": "Argentina",
       "away": "Brasil",
       "homeCode": "AR",
       "awayCode": "BR",
       "kickoff": "2026-06-20T19:00:00"
     }
   ]
   ```

   `kickoff` debe estar en formato ISO local (sin zona), y el bot lo interpreta con `TIMEZONE`.
   `homeCode` y `awayCode` (ISO-2) son opcionales, pero permiten mostrar banderas en el mensaje.

4. Ejecuta el bot:

   ```bash
   npm start
   ```

5. Escanea el QR en consola desde WhatsApp.

## 3) Como funciona la programacion

- Diario: `DAILY_REMINDER_CRON` (por defecto `0 8 * * *`)
- Partidos: cada minuto revisa la fuente configurada y envia aviso cuando faltan `MATCH_REMINDER_MINUTES_BEFORE` minutos.

### Fuente de partidos desde internet (opcional)

En `.env` puedes activar:

```env
MATCH_SOURCE=espn
ESPN_LEAGUE_SLUG=fifa.world
MATCHES_DAYS_AHEAD=7
MATCHES_REFRESH_MINUTES=60
```

- `MATCH_SOURCE=local` (default): usa `matches.json`.
- `MATCH_SOURCE=espn`: consulta ESPN y actualiza horarios periodicamente.

## 4) QR legible en Railway

En Railway, el QR en logs puede verse dañado. Este bot tambien expone:

- `GET /qr`: muestra el QR en formato imagen para escanear desde navegador.
- `GET /groups`: lista los grupos detectados con su `id` para copiar en `WHATSAPP_GROUP_ID`.

Si quieres proteger esa ruta, define:

```env
QR_VIEW_TOKEN=un_token_largo
```

y accede con:

`https://tu-servicio.up.railway.app/qr?token=un_token_largo`

Para listar grupos con token:

`https://tu-servicio.up.railway.app/groups?token=un_token_largo`

Si `/groups` falla justo al arrancar, espera 20-40 segundos y vuelve a intentar.
