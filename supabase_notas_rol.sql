-- SAIR: Notas para Rol por chat (3.0.0 Preview H).
-- Cada chat guarda sus propias notas (relaciones, gustos, secretos, contexto…)
-- y la app las envía como contexto adicional en cada respuesta de ese chat.
--
-- Ejecuta este script una sola vez en el SQL Editor de Supabase.
-- La app funciona igual sin ejecutarlo (las notas se guardan en el navegador),
-- pero solo con este script se sincronizan entre dispositivos.

alter table public.chats
  add column if not exists notas_rol text;

comment on column public.chats.notas_rol is
  'Notas para Rol del usuario: contexto extra que se envía a la IA solo en este chat.';

-- Evita que las notas viajen en las respuestas que no las necesitan.
create index if not exists idx_chats_notas_rol
  on public.chats (user_id, personaje_id)
  where notas_rol is not null;

-- Guarda (o borra, con cadena vacía o null) las notas de un chat con validación
-- de propiedad y longitud. Devuelve el texto almacenado.
create or replace function public.guardar_notas_rol_chat(
  p_chat_id uuid,
  p_notas text
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, public, auth
as $$
declare
  v_notas text := nullif(btrim(left(coalesce(p_notas, ''), 8000)), '');
begin
  update public.chats c
  set notas_rol = v_notas,
      actualizado_en = now()
  where c.id = p_chat_id
    and c.user_id = (select auth.uid());

  if not found then
    raise exception 'Chat no autorizado';
  end if;

  return v_notas;
end;
$$;

revoke all on function public.guardar_notas_rol_chat(uuid, text) from public, anon;
grant execute on function public.guardar_notas_rol_chat(uuid, text) to authenticated;
