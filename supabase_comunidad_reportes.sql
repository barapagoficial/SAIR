-- ════════════════════════════════════════════════════════════════
--  SAIR — Comunidad: reportes de personajes y búsqueda rápida
--  Ejecutar una vez en Supabase → SQL Editor. Se puede repetir sin
--  romper nada (todo usa "if not exists" / "or replace").
--
--  Sin este script la Comunidad funciona igual (búsqueda, orden y
--  "Cargar más"), pero el botón 🚩 Reportar avisa de que los reportes
--  todavía no están activados.
-- ════════════════════════════════════════════════════════════════

-- 1. Tabla de reportes ────────────────────────────────────────────
create table if not exists public.reportes_personajes (
  id            uuid primary key default gen_random_uuid(),
  personaje_id  uuid not null references public.personajes (id) on delete cascade,
  reportado_por uuid not null references auth.users (id) on delete cascade,
  motivo        text not null check (motivo in ('contenido_sexual_menores', 'odio_acoso', 'violencia_extrema', 'spam', 'suplantacion', 'otro')),
  detalle       text check (char_length(detalle) <= 500),
  creado_en     timestamptz not null default now(),
  -- Un usuario solo puede reportar una vez el mismo personaje.
  unique (personaje_id, reportado_por)
);

create index if not exists idx_reportes_personaje on public.reportes_personajes (personaje_id);
create index if not exists idx_reportes_fecha on public.reportes_personajes (creado_en desc);

alter table public.reportes_personajes enable row level security;

-- Cualquiera con sesión puede reportar, siempre a su nombre y solo
-- personajes públicos que no sean suyos.
drop policy if exists "Usuarios reportan personajes publicos" on public.reportes_personajes;
create policy "Usuarios reportan personajes publicos"
  on public.reportes_personajes for insert to authenticated
  with check (
    reportado_por = (select auth.uid())
    and exists (
      select 1 from public.personajes p
      where p.id = personaje_id and p.publico and p.user_id <> (select auth.uid())
    )
  );

-- Solo el owner ve y descarta reportes.
drop policy if exists "Solo el owner ve reportes" on public.reportes_personajes;
create policy "Solo el owner ve reportes"
  on public.reportes_personajes for select to authenticated
  using (exists (select 1 from public.roles r where r.user_id = (select auth.uid()) and r.rol = 'owner'));

drop policy if exists "Solo el owner descarta reportes" on public.reportes_personajes;
create policy "Solo el owner descarta reportes"
  on public.reportes_personajes for delete to authenticated
  using (exists (select 1 from public.roles r where r.user_id = (select auth.uid()) and r.rol = 'owner'));

-- 2. Moderación: el owner retira un personaje de la Comunidad ─────
--    No lo borra: lo pasa a privado (su autor lo sigue teniendo) y
--    elimina los reportes asociados.
create or replace function public.retirar_personaje_reportado(p_personaje_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.roles r where r.user_id = auth.uid() and r.rol = 'owner') then
    raise exception 'Solo el owner puede moderar la Comunidad';
  end if;
  update public.personajes set publico = false where id = p_personaje_id;
  delete from public.reportes_personajes where personaje_id = p_personaje_id;
end;
$$;

revoke all on function public.retirar_personaje_reportado(uuid) from public, anon;
grant execute on function public.retirar_personaje_reportado(uuid) to authenticated;

-- 3. Búsqueda rápida por nombre y descripción ─────────────────────
--    La app busca con ILIKE '%texto%'. Con este índice trigram la
--    búsqueda sigue siendo rápida aunque haya miles de personajes.
create extension if not exists pg_trgm;
create index if not exists idx_personajes_publicos_nombre_trgm
  on public.personajes using gin (nombre gin_trgm_ops) where publico;
create index if not exists idx_personajes_publicos_desc_trgm
  on public.personajes using gin (descripcion_corta gin_trgm_ops) where publico;
