-- Tablas de Trazo en la instancia compartida "bd-juegos" (Postgres + PostgREST en Oracle).
-- Copia de referencia: el fichero que se aplica es ~/proyectos/bd-juegos/sql/trazo.sql en el servidor.
-- Idempotente. Los cambios de columnas se añaden al final con: alter table ... add column if not exists ...

-- Rol de las peticiones con la clave del Worker (JWT con "role": "trazo_api").
select 'create role trazo_api nologin' where not exists (select from pg_roles where rolname = 'trazo_api') \gexec
grant trazo_api to authenticator;

-- Salas vivas: alimenta la lista de "salas abiertas". La fila se borra al cerrarse la sala.
create table if not exists trazo_rooms (
  code         text primary key check (code ~ '^[A-Z0-9]{6}$'),
  status       text not null default 'waiting' check (status in ('waiting', 'playing')),
  host_name    text not null,
  player_count int  not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Historial: una fila por ronda terminada, con el dibujo.
create table if not exists trazo_rounds (
  id           bigint generated always as identity primary key,
  room_code    text not null,
  round_number int  not null,
  category     text not null,             -- ya no se usa: siempre ''
  word         text not null,
  qm_name      text not null,
  fake_name    text not null,
  caught       boolean not null,          -- ¿pillaron al falso artista?
  guess        text,                      -- lo que dijo al intentar adivinar
  guessed      boolean,                   -- ¿se dio por bueno?
  players      jsonb not null,            -- [{ name, score }]
  votes        jsonb not null,            -- [{ from, to }]
  strokes      jsonb not null,            -- [{ player, color, pts: [x, y, presión, ...] }] sobre una pizarra de 1000x1000
  created_at   timestamptz not null default now()
);

grant select, insert, update, delete on trazo_rooms to trazo_api;
grant select, insert on trazo_rounds to trazo_api;
