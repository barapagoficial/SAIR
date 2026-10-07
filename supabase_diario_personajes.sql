-- SAIR: Diario de Personajes por chat (3.1.0 Oficial A).
-- Cada chat guarda el diario que la IA escribe para los personajes que han
-- interactuado con el usuario: qué opinan de él/ella, qué les gustaría saber,
-- qué sienten y cómo se sienten a su lado.
--
-- Ejecuta este script una sola vez en el SQL Editor de Supabase.
-- La app funciona igual sin ejecutarlo (el diario se guarda en el navegador),
-- pero solo con este script se sincroniza entre dispositivos.

alter table public.chats
  add column if not exists diario_personajes jsonb;

comment on column public.chats.diario_personajes is
  'Diario de Personajes del chat: entradas escritas por la IA para cada personaje que interactuó con el usuario.';

-- El diario solo se consulta por chat, así que basta un índice parcial.
create index if not exists idx_chats_diario_personajes
  on public.chats (user_id, personaje_id)
  where diario_personajes is not null;

-- Guarda (o borra, con null) el diario de un chat validando:
--   · que el chat pertenece al usuario autenticado
--   · que el diario es un objeto con una lista "personajes" de 1 a 12 entradas
--   · que el contenido no supera los 280 KB
-- Devuelve el diario almacenado.
create or replace function public.guardar_diario_chat(
  p_chat_id uuid,
  p_diario jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, auth
as $$
declare
  v_diario jsonb := p_diario;
begin
  if v_diario is not null then
    if jsonb_typeof(v_diario) <> 'object'
       or jsonb_typeof(v_diario -> 'personajes') <> 'array'
       or jsonb_array_length(v_diario -> 'personajes') = 0
       or jsonb_array_length(v_diario -> 'personajes') > 12 then
      raise exception 'Diario con formato inválido';
    end if;

    if octet_length(v_diario::text) > 280000 then
      raise exception 'El diario es demasiado largo';
    end if;
  end if;

  update public.chats c
  set diario_personajes = v_diario,
      actualizado_en = now()
  where c.id = p_chat_id
    and c.user_id = (select auth.uid());

  if not found then
    raise exception 'Chat no autorizado';
  end if;

  return v_diario;
end;
$$;

revoke all on function public.guardar_diario_chat(uuid, jsonb) from public, anon;
grant execute on function public.guardar_diario_chat(uuid, jsonb) to authenticated;
