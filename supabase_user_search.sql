-- SAIR: búsqueda segura de usuarios autenticados.
-- Devuelve únicamente datos de perfil necesarios para la tarjeta de búsqueda.
create or replace function public.buscar_usuarios(p_busqueda text)
returns table(
  user_id uuid,
  username text,
  descripcion text,
  avatar_url text,
  fondo_url text,
  avatar_pos_x integer,
  avatar_pos_y integer,
  fondo_pos_x integer,
  fondo_pos_y integer,
  rol text
)
language sql
security definer
set search_path = pg_catalog, public, auth
as $$
  select p.user_id, p.username, p.descripcion, p.avatar_url, p.fondo_url,
         p.avatar_pos_x, p.avatar_pos_y, p.fondo_pos_x, p.fondo_pos_y,
         coalesce(r.rol, 'user')
  from public.perfiles p
  left join public.roles r on r.user_id = p.user_id
  where auth.uid() is not null
    and p.user_id <> auth.uid()
    and nullif(trim(p_busqueda), '') is not null
    and p.username ilike '%' || left(trim(p_busqueda), 50) || '%'
  order by p.username asc
  limit 30;
$$;

revoke execute on function public.buscar_usuarios(text) from public, anon;
grant execute on function public.buscar_usuarios(text) to authenticated;

-- Las lecturas directas quedan limitadas al propio perfil. Las pantallas
-- públicas usan las funciones anteriores y no pueden enumerar la tabla.
drop policy if exists "Cualquiera puede ver perfiles" on public.perfiles;
create policy "Usuarios pueden ver su propio perfil"
  on public.perfiles for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.obtener_mi_perfil()
returns table(
  user_id uuid,
  username text,
  descripcion text,
  avatar_url text,
  fondo_url text,
  avatar_pos_x integer,
  avatar_pos_y integer,
  fondo_pos_x integer,
  fondo_pos_y integer
)
language sql
security invoker
set search_path = pg_catalog, public, auth
as $$
  select p.user_id, p.username, p.descripcion, p.avatar_url, p.fondo_url,
         p.avatar_pos_x, p.avatar_pos_y, p.fondo_pos_x, p.fondo_pos_y
  from public.perfiles p
  where p.user_id = (select auth.uid());
$$;

revoke all on function public.obtener_mi_perfil() from public, anon;
grant execute on function public.obtener_mi_perfil() to authenticated;

create or replace function public.obtener_usernames(p_user_ids uuid[])
returns table(user_id uuid, username text)
language sql
security definer
set search_path = pg_catalog, public, auth
as $$
  select p.user_id, p.username
  from public.perfiles p
  where p.user_id = any(coalesce(p_user_ids, array[]::uuid[]))
  limit 100;
$$;

revoke all on function public.obtener_usernames(uuid[]) from public, anon;
grant execute on function public.obtener_usernames(uuid[]) to authenticated;
