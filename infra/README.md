# Base de datos de Trazo

Trazo no tiene instancia propia: usa **bd-juegos**, la instancia compartida de Postgres + PostgREST
que vive en el servidor de Oracle, en `~/proyectos/bd-juegos`, publicada en
`https://bd-juegos.deiviperdomo.dev`. Allí están las instrucciones para arrancarla, hacer copias y
añadir juegos (`README.md` y `GUIA-NUEVO-JUEGO.md`).

El juego funciona sin base de datos (la partida vive en Cloudflare). Solo guarda:

- `trazo_rooms`: salas vivas, para la lista de "salas abiertas" de la portada.
- `trazo_rounds`: historial, una fila por ronda terminada con su dibujo.

`schema.sql` es la copia de referencia de esas tablas. Para cambiarlas, edita
`~/proyectos/bd-juegos/sql/trazo.sql` en el servidor, ejecuta `./aplicar.sh` y copia el cambio aquí.

## Conexión

- `DB_URL`: en `wrangler.jsonc` (producción) y `.dev.vars` (local).
- `DB_KEY`: JWT del rol `trazo_api`. Se genera en el servidor con `./clave.sh trazo_api`. Va en
  `.dev.vars` (local) y como secreto del Worker: `npx wrangler secret put DB_KEY`.

## Mirar los datos

En el servidor, dentro de `~/proyectos/bd-juegos`:

```sh
docker compose exec db psql -U postgres juegos -c "select room_code, round_number, category, word, fake_name, caught from trazo_rounds order by id desc limit 20"
```
