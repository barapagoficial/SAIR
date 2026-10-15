-- SAIR: esquema base de Supabase.
-- Faltaba en el repositorio: solo estaban las migraciones posteriores, así que
-- no era posible reconstruir el proyecto desde cero ni montar un entorno de
-- pruebas. Es idempotente: se puede ejecutar sobre el proyecto en producción.
--
-- Orden completo de ejecución:
--   1. schema.sql                              (este archivo)
--   2. supabase_chat_storage_v2.sql
--   3. supabase_notas_rol.sql
--   4. supabase_diario_personajes.sql
--   5. supabase_profile_avatar.sql
--   6. supabase_user_search.sql
--   7. supabase_variantes_respuesta.sql
--   8. supabase_chat_titulos_y_aura.sql

-- ═══════════════════════════════════════════════════════════════════════
-- PERFILES
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.perfiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  username   text not null check (char_length(username) between 3 and 30),
  descripcion text,
  creado_en  timestamptz not null default now()
);

create unique index if not exists idx_perfiles_username_lower
  on public.perfiles (lower(username));

alter table public.perfiles enable row level security;

-- El perfil es privado: las pantallas públicas usan las funciones
-- security definer de supabase_user_search.sql.
drop policy if exists "Usuarios pueden ver su propio perfil" on public.perfiles;
create policy "Usuarios pueden ver su propio perfil"
  on public.perfiles for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Usuarios pueden crear su propio perfil" on public.perfiles;
create policy "Usuarios pueden crear su propio perfil"
  on public.perfiles for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Usuarios pueden actualizar su propio perfil" on public.perfiles;
create policy "Usuarios pueden actualizar su propio perfil"
  on public.perfiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ═══════════════════════════════════════════════════════════════════════
-- ROLES
-- ═══════════════════════════════════════════════════════════════════════
-- `roles` es el permiso (user/owner); `roles_usuario` es el nombre de rol
-- que el usuario elige para sus personajes.
create table if not exists public.roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  rol     text not null default 'user' check (rol in ('user', 'owner'))
);

create table if not exists public.roles_usuario (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  nombre_rol text not null check (nombre_rol ~ '^[A-Za-z0-9_]{3,30}$')
);

alter table public.roles enable row level security;
alter table public.roles_usuario enable row level security;

drop policy if exists "Usuarios pueden ver su rol" on public.roles;
create policy "Usuarios pueden ver su rol"
  on public.roles for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Usuarios pueden gestionar su nombre de rol" on public.roles_usuario;
create policy "Usuarios pueden gestionar su nombre de rol"
  on public.roles_usuario for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Alta automática: al registrarse se crea el perfil y el rol.
create or replace function public.crear_perfil_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.perfiles (user_id, username)
  values (
    new.id,
    coalesce(
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'usuario_' || left(replace(new.id::text, '-', ''), 8)
    )
  )
  on conflict (user_id) do nothing;

  insert into public.roles (user_id, rol) values (new.id, 'user')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.crear_perfil_nuevo_usuario();

-- ═══════════════════════════════════════════════════════════════════════
-- PERSONAJES
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.personajes (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  nombre            text not null,
  descripcion_corta text,
  system_prompt     text not null,
  avatar_url        text,
  saludo            text,
  max_tokens        integer not null default 4096 check (max_tokens between 256 and 16384),
  intensidad        text not null default 'suave' check (intensidad in ('suave', 'mediana', 'maxima')),
  publico           boolean not null default false,
  color_aura        text default '#ff4d8f',
  creado_en         timestamptz not null default now()
);

create index if not exists idx_personajes_user_id on public.personajes (user_id);
create index if not exists idx_personajes_publicos
  on public.personajes (creado_en desc) where publico;

alter table public.personajes enable row level security;

-- El system_prompt es del autor, pero la app pide * para poder clonar
-- personajes públicos, así que la lectura pública incluye la fila completa.
drop policy if exists "Personajes públicos y propios son visibles" on public.personajes;
create policy "Personajes públicos y propios son visibles"
  on public.personajes for select to authenticated
  using (publico or (select auth.uid()) = user_id);

drop policy if exists "Usuarios pueden crear personajes" on public.personajes;
create policy "Usuarios pueden crear personajes"
  on public.personajes for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Usuarios pueden editar sus personajes" on public.personajes;
create policy "Usuarios pueden editar sus personajes"
  on public.personajes for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Usuarios pueden eliminar sus personajes" on public.personajes;
create policy "Usuarios pueden eliminar sus personajes"
  on public.personajes for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ═══════════════════════════════════════════════════════════════════════
-- CHATS Y MENSAJES
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.chats (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  personaje_id   uuid not null references public.personajes (id) on delete cascade,
  historial      jsonb not null default '[]'::jsonb,   -- legado: solo respaldo
  resumen        text,
  resumen_version integer not null default 0,
  formato_version integer not null default 2,
  notas_rol      text,
  diario_personajes jsonb,
  titulo         text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.mensajes (
  id              uuid primary key default gen_random_uuid(),
  chat_id         uuid not null references public.chats (id) on delete cascade,
  rol             text not null check (rol in ('user', 'assistant')),
  contenido       text not null,
  orden           bigint,
  variantes       jsonb,
  variante_activa integer not null default 0,
  creado_en       timestamptz not null default now()
);

create index if not exists idx_chats_user_personaje
  on public.chats (user_id, personaje_id, actualizado_en desc);
create index if not exists idx_mensajes_chat_orden
  on public.mensajes (chat_id, orden, creado_en, id);

alter table public.chats enable row level security;
alter table public.mensajes enable row level security;

drop policy if exists "Usuarios gestionan sus chats" on public.chats;
create policy "Usuarios gestionan sus chats"
  on public.chats for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Los mensajes se consultan siempre a través de la pertenencia del chat.
drop policy if exists "Usuarios pueden ver mensajes de sus chats" on public.mensajes;
create policy "Usuarios pueden ver mensajes de sus chats"
  on public.mensajes for select to authenticated
  using (exists (select 1 from public.chats c where c.id = mensajes.chat_id and c.user_id = (select auth.uid())));

drop policy if exists "Usuarios pueden crear mensajes en sus chats" on public.mensajes;
create policy "Usuarios pueden crear mensajes en sus chats"
  on public.mensajes for insert to authenticated
  with check (exists (select 1 from public.chats c where c.id = mensajes.chat_id and c.user_id = (select auth.uid())));

drop policy if exists "Usuarios pueden actualizar mensajes de sus chats" on public.mensajes;
create policy "Usuarios pueden actualizar mensajes de sus chats"
  on public.mensajes for update to authenticated
  using (exists (select 1 from public.chats c where c.id = mensajes.chat_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from public.chats c where c.id = mensajes.chat_id and c.user_id = (select auth.uid())));

drop policy if exists "Usuarios pueden eliminar mensajes de sus chats" on public.mensajes;
create policy "Usuarios pueden eliminar mensajes de sus chats"
  on public.mensajes for delete to authenticated
  using (exists (select 1 from public.chats c where c.id = mensajes.chat_id and c.user_id = (select auth.uid())));

-- ═══════════════════════════════════════════════════════════════════════
-- ANUNCIOS Y ESTADO DE LA APP
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.anuncios (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users (id) on delete cascade,
  titulo    text not null check (char_length(titulo) <= 100),
  contenido text not null check (char_length(contenido) <= 2000),
  creado_en timestamptz not null default now()
);

create index if not exists idx_anuncios_user_id on public.anuncios (user_id);

alter table public.anuncios enable row level security;

drop policy if exists "Todos pueden leer anuncios" on public.anuncios;
create policy "Todos pueden leer anuncios"
  on public.anuncios for select to authenticated using (true);

drop policy if exists "Solo el owner publica anuncios" on public.anuncios;
create policy "Solo el owner publica anuncios"
  on public.anuncios for insert to authenticated
  with check (exists (select 1 from public.roles r where r.user_id = (select auth.uid()) and r.rol = 'owner'));

drop policy if exists "Solo el owner elimina anuncios" on public.anuncios;
create policy "Solo el owner elimina anuncios"
  on public.anuncios for delete to authenticated
  using (exists (select 1 from public.roles r where r.user_id = (select auth.uid()) and r.rol = 'owner'));

-- Tabla de una sola fila que la app escucha en tiempo real para avisar de
-- actualizaciones pendientes.
create table if not exists public.estado_app (
  id                      integer primary key default 1 check (id = 1),
  actualizacion_pendiente boolean not null default false
);

insert into public.estado_app (id, actualizacion_pendiente) values (1, false)
on conflict (id) do nothing;

alter table public.estado_app enable row level security;

drop policy if exists "Cualquiera puede leer el estado" on public.estado_app;
create policy "Cualquiera puede leer el estado"
  on public.estado_app for select to authenticated using (true);

drop policy if exists "Solo el owner cambia el estado" on public.estado_app;
create policy "Solo el owner cambia el estado"
  on public.estado_app for update to authenticated
  using (exists (select 1 from public.roles r where r.user_id = (select auth.uid()) and r.rol = 'owner'));

-- Realtime para el aviso de actualización.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'estado_app'
     ) then
    alter publication supabase_realtime add table public.estado_app;
  end if;
end;
$$;
