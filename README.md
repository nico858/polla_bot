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

## 4) Obtener el ID del grupo (recomendado)

Puedes iniciar por nombre con `WHATSAPP_GROUP_NAME`.  
Cuando ya funcione, deja fijo `WHATSAPP_GROUP_ID` para evitar fallos si cambian el nombre del grupo.

Si necesitas descubrir el ID, pon temporalmente:

```env
DEBUG_LIST_GROUPS=true
```

y al iniciar veras en logs el listado `nombre -> id` de todos tus grupos.

## 5) Despliegue en Railway

1. Sube este repo a GitHub.
2. En Railway: New Project -> Deploy from GitHub Repo.
3. Configura variables de entorno (las de `.env`).
4. Start command: `npm start`.
5. Abre logs, escanea QR.

Importante: si el contenedor reinicia, puede requerir reautenticacion si no hay disco persistente.

## 6) Despliegue en Render

1. Crea un `Web Service` con este repo.
2. Build Command: `npm install`
3. Start Command: `npm start`
4. Agrega variables de entorno.
5. Escanea QR desde logs.

### Mantener despierto en Render

- El endpoint de salud es `GET /health`.
- El archivo `awake_script.js` puede hacer ping periodico a esa URL **desde fuera de Render**.
- Ejemplo:

  ```bash
  TARGET_URL=https://tu-app.onrender.com/health PING_EVERY_MINUTES=10 npm run awake
  ```

Puedes ejecutar ese script en otra plataforma (o una GitHub Action programada).

## 7) Advertencias importantes

- `whatsapp-web.js` no es oficial de Meta y puede romperse si WhatsApp Web cambia. 
- No uses tu numero personal principal para bots.
- Si quieres confiabilidad total en produccion, evalua WhatsApp Cloud API oficial.
