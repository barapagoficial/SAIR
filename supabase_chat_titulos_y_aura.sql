-- SAIR: títulos de chat, búsqueda y color de aura público (4.0.0/3.2.0).
--   · chats.titulo      → la lista lateral deja de mostrar "Chat a1b2c3":
--                         el título se toma del primer mensaje del usuario y
--                         se puede renombrar a mano.
--   · chats.buscar      → índice de apoyo para el filtro de la lista.
--   · personajes.color_aura → el aura de un personaje público ya no se pierde
--                         (antes se leía del system_prompt, que nunca se
--                         envía al navegador de otros usuarios, así que todas
--                         las tarjetas de la Comunidad salían rosas).
--
-- Ejecuta este script una sola vez en el SQL Editor de Supabase.
-- La app funciona sin ejecutarlo (el título se calcula en memoria y el aura
-- cae a rosa), pero solo con este script se guardan entre dispositivos.

alter table public.chats
  add column if not exists titulo text;

comment on column public.chats.titulo is
  'Título del chat. Se rellena con el primer mensaje del usuario y se puede editar.';

alter table public.personajes
  add column if not exists color_aura text default '#ff4d8f';

comment on column public.personajes.color_aura is
  'Color de aura elegido por el autor. Se publica para que la Comunidad lo muestre.';

alter table public.personajes
  drop constraint if exists personajes_color_aura_check;
alter table public.personajes
  add constraint personajes_color_aura_check check (color_aura ~* '^#[0-9a-f]{6}$');

create index if not exists idx_chats_titulo
  on public.chats (user_id, personaje_id, titulo);

-- Renombra un chat validando la propiedad y la longitud.
create or replace function public.renombrar_chat(
  p_chat_id uuid,
  p_titulo text
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, public, auth
as $$
declare
  v_titulo text := nullif(btrim(left(coalesce(p_titulo, ''), 80)), '');
begin
  update public.chats c
  set titulo = v_titulo,
      actualizado_en = now()
  where c.id = p_chat_id
    and c.user_id = (select auth.uid());

  if not found then
    raise exception 'Chat no autorizado';
  end if;

  return v_titulo;
end;
$$;

revoke all on function public.renombrar_chat(uuid, text) from public, anon;
grant execute on function public.renombrar_chat(uuid, text) to authenticated;

-- Título automático: la primera vez que el usuario escribe en un chat sin
-- título se guarda un resumen de ese mensaje (máximo 60 caracteres).
create or replace function public.guardar_mensaje_chat(
  p_chat_id uuid,
  p_rol text,
  p_contenido text
)
returns table(id uuid, chat_id uuid, rol text, contenido text, creado_en timestamptz, orden bigint)
language plpgsql
security invoker
set search_path = pg_catalog, public, auth
as $$
declare
  v_id uuid := gen_random_uuid();
  v_creado_en timestamptz := timezone('utc', now());
  v_orden bigint;
begin
  if p_rol not in ('user', 'assistant') or nullif(trim(p_contenido), '') is null then
    raise exception 'Mensaje inválido';
  end if;

  if not exists (
    select 1 from public.chats c
    where c.id = p_chat_id and c.user_id = (select auth.uid())
    for update
  ) then
    raise exception 'Chat no autorizado';
  end if;

  select coalesce(max(m.orden), 0) + 1 into v_orden
  from public.mensajes m where m.chat_id = p_chat_id;

  insert into public.mensajes (id, chat_id, rol, contenido, creado_en, orden)
  values (v_id, p_chat_id, p_rol, p_contenido, v_creado_en, v_orden);

  update public.chats c
  set actualizado_en = v_creado_en,
      formato_version = 2,
      titulo = coalesce(
        c.titulo,
        case
          when p_rol = 'user'
            then nullif(left(regexp_replace(btrim(p_contenido), '\s+', ' ', 'g'), 60), '')
          else null
        end
      )
  where c.id = p_chat_id and c.user_id = (select auth.uid());

  return query select v_id, p_chat_id, p_rol, p_contenido, v_creado_en, v_orden;
end;
$$;

revoke all on function public.guardar_mensaje_chat(uuid, text, text) from public, anon;
grant execute on function public.guardar_mensaje_chat(uuid, text, text) to authenticated;
