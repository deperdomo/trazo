# Base de datos de Trazo (Oracle)

Instancia mínima: **Postgres + PostgREST**, los dos únicos servicios de Supabase que el juego usa.
Unos 150 MB de RAM en reposo frente a los 2–4 GB del stack completo de Supabase.

El juego funciona sin esto (la partida vive en Cloudflare). La base de datos solo guarda:

- `trazo_rooms`: salas vivas, para la lista de "salas abiertas" de la portada.
- `trazo_rounds`: historial, una fila por ronda terminada con su dibujo.

## Puesta en marcha

En el servidor, dentro de esta carpeta:

```sh
cp .env.example .env
# Rellena POSTGRES_PASSWORD y JWT_SECRET con: openssl rand -hex 32
docker compose up -d
```

`schema.sql` se aplica solo la primera vez que arranca. PostgREST queda escuchando en `127.0.0.1:3010`.

## Clave para el Worker

El Worker se identifica con un JWT firmado con `JWT_SECRET`. Para generarlo (no caduca; si se filtra,
cambia `JWT_SECRET`, reinicia `rest` y genera otro):

```sh
set -a; . ./.env; set +a
b64() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
H=$(printf '{"alg":"HS256","typ":"JWT"}' | b64)
P=$(printf '{"role":"trazo_api"}' | b64)
echo "$H.$P.$(printf '%s.%s' "$H" "$P" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64)"
```

Comprobación (con clave responde `[]`, sin clave responde un error de permisos):

```sh
curl -H "Authorization: Bearer <clave>" http://127.0.0.1:3010/trazo_rooms
curl http://127.0.0.1:3010/trazo_rooms
```

## Publicarlo y conectarlo

1. Publica `127.0.0.1:3010` en un subdominio con HTTPS (por ejemplo `bd-trazo.deiviperdomo.dev`) con el
   mismo proxy inverso o túnel que usas para `bd-mr-white`.
2. En `wrangler.jsonc`, pon esa URL en `DB_URL`.
3. Guarda la clave como secreto del Worker: `npx wrangler secret put DB_KEY`.

Para desarrollo local, las dos variables van en `.dev.vars` (ver `.dev.vars.example`).

## Mirar los datos

No hay Studio. Con cualquier cliente Postgres por túnel SSH, o directamente:

```sh
docker compose exec db psql -U postgres trazo -c "select room_code, round_number, category, word, fake_name, caught from trazo_rounds order by id desc limit 20"
```

## Copia de seguridad

```sh
docker compose exec db pg_dump -U postgres trazo | gzip > trazo-$(date +%F).sql.gz
```
