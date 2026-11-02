-- ════════════════════════════════════════════════════════════════
--  SAIR 4.2 — Aura pública, etiquetas, "me gusta" y Lorebook
--  Ejecutar una vez en Supabase → SQL Editor, DESPUÉS de
--  supabase_chat_titulos_y_aura.sql. Se puede repetir sin romper nada.
--
--  Sin este script la app sigue funcionando: oculta las etiquetas, los
--  "me gusta" y el orden "Más populares", y el Lorebook se guarda solo
--  en el navegador.
-- ════════════════════════════════════════════════════════════════

-- 1. Aura: rellenar color_aura de los personajes que ya existían ──
--    El color vivía solo dentro del prompt ([ConfiguracionTema]). La app
--    ahora lo guarda también en la columna; esto copia el de los viejos.
alter table public.personajes
  add column if not exists color_aura text default '#ff4d8f';

update public.personajes
set color_aura = lower(substring(system_prompt from '\[ConfiguracionTema\]\s*(#[0-9a-fA-F]{6})'))
where system_prompt ~ '\[ConfiguracionTema\]\s*#[0-9a-fA-F]{6}'
  and color_aura is distinct from lower(substring(system_prompt from '\[ConfiguracionTema\]\s*(#[0-9a-fA-F]{6})'));

-- 2. Etiquetas ───────────────────────────────────────────────────
alter table public.personajes
  add column if not exists tags text[] not null default '{}';

alter table public.personajes drop constraint if exists personajes_tags_check;
alter table public.personajes
  add constraint personajes_tags_check check (cardinality(tags) <= 5);

create index if not exists idx_personajes_tags
  on public.personajes using gin (tags) where publico;

-- 3. "Me gusta" (también sirven de favoritos) ────────────────────
alter table public.personajes
  add column if not exists likes_count integer not null default 0;

create table if not exists public.personajes_likes (
  personaje_id uuid not null references public.personajes (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  creado_en    timestamptz not null default now(),
  primary key (personaje_id, user_id)
);

create index if not exists idx_likes_usuario on public.personajes_likes (user_id, creado_en desc);
create index if not exists idx_personajes_populares
  on public.personajes (likes_count desc, creado_en desc) where publico;

alter table public.personajes_likes enable row level security;

-- Cada usuario ve y gestiona solo sus propios "me gusta"; el total
-- público está en personajes.likes_count.
drop policy if exists "Usuarios ven sus likes" on public.personajes_likes;
create policy "Usuarios ven sus likes"
  on public.personajes_likes for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Usuarios dan like a personajes visibles" on public.personajes_likes;
create policy "Usuarios dan like a personajes visibles"
  on public.personajes_likes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.personajes p where p.id = personaje_id and (p.publico or p.user_id = (select auth.uid())))
  );

drop policy if exists "Usuarios quitan sus likes" on public.personajes_likes;
create policy "Usuarios quitan sus likes"
  on public.personajes_likes for delete to authenticated
  using (user_id = (select auth.uid()));

-- El contador se mantiene con un trigger (security definer, porque el
-- usuario que da "me gusta" no puede editar personajes ajenos).
create or replace function public.actualizar_likes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.personajes set likes_count = likes_count + 1 where id = new.personaje_id;
  elsif tg_op = 'DELETE' then
    update public.personajes set likes_count = greatest(likes_count - 1, 0) where id = old.personaje_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_personajes_likes_count on public.personajes_likes;
create trigger trg_personajes_likes_count
  after insert or delete on public.personajes_likes
  for each row execute function public.actualizar_likes_count();

-- Recalcular por si ya había datos.
update public.personajes p
set likes_count = coalesce((select count(*) from public.personajes_likes l where l.personaje_id = p.id), 0);

-- 4. Lorebook (memoria del mundo) ─────────────────────────────────
--    Fichas privadas de cada usuario para un personaje: lugares,
--    personajes secundarios, reglas... Se añaden al prompt solo cuando
--    alguna de sus palabras clave aparece en la conversación.
create table if not exists public.lorebook_entradas (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  personaje_id uuid not null references public.personajes (id) on delete cascade,
  nombre       text not null check (char_length(nombre) between 1 and 80),
  claves       text[] not null default '{}' check (cardinality(claves) <= 20),
  contenido    text not null check (char_length(contenido) between 1 and 1500),
  siempre      boolean not null default false,
  activa       boolean not null default true,
  creado_en    timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists idx_lorebook_usuario_personaje
  on public.lorebook_entradas (user_id, personaje_id);

alter table public.lorebook_entradas enable row level security;

drop policy if exists "Lorebook propio" on public.lorebook_entradas;
create policy "Lorebook propio"
  on public.lorebook_entradas for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
