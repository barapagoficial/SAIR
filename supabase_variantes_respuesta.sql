-- SAIR: variantes de respuesta (3.2.0 Oficial A).
-- "Regenerar" ya no borra la respuesta anterior: se guarda como una versión
-- más y la app permite recorrerlas con ‹ › (estilo Character.AI). Al enviar un
-- mensaje nuevo se conserva solo la versión elegida y se descartan las demás.
--
-- Ejecuta este script una sola vez en el SQL Editor de Supabase.
-- La app funciona sin ejecutarlo (las variantes se mantienen en memoria
-- durante la sesión), pero solo con este script sobreviven al recargar.

alter table public.mensajes
  add column if not exists variantes jsonb,
  add column if not exists variante_activa integer not null default 0;

comment on column public.mensajes.variantes is
  'Todas las versiones generadas para esta respuesta. contenido es siempre igual a variantes[variante_activa].';
comment on column public.mensajes.variante_activa is
  'Índice (base 0) de la versión elegida dentro de variantes.';

alter table public.mensajes
  drop constraint if exists mensajes_variante_activa_check;
alter table public.mensajes
  add constraint mensajes_variante_activa_check check (variante_activa >= 0);

-- Guarda las variantes de un mensaje validando la propiedad del chat.
-- Mantiene contenido sincronizado con la variante activa para que el resto de
-- la app (resúmenes, diario, exportación, prompt de Gemini) no cambie.
create or replace function public.guardar_variantes_mensaje(
  p_mensaje_id uuid,
  p_variantes jsonb,
  p_variante_activa integer
)
returns table(contenido text, variantes jsonb, variante_activa integer)
language plpgsql
security invoker
set search_path = pg_catalog, public, auth
as $$
declare
  v_total integer;
  v_activa integer;
begin
  if jsonb_typeof(p_variantes) <> 'array' or jsonb_array_length(p_variantes) = 0 then
    raise exception 'Variantes inválidas';
  end if;

  v_total := jsonb_array_length(p_variantes);

  if v_total > 20 then
    raise exception 'Demasiadas variantes (máximo 20)';
  end if;

  if octet_length(p_variantes::text) > 400000 then
    raise exception 'Las variantes son demasiado largas';
  end if;

  v_activa := least(greatest(coalesce(p_variante_activa, 0), 0), v_total - 1);

  update public.mensajes m
  set variantes = p_variantes,
      variante_activa = v_activa,
      contenido = p_variantes ->> v_activa
  where m.id = p_mensaje_id
    and exists (
      select 1 from public.chats c
      where c.id = m.chat_id and c.user_id = (select auth.uid())
    );

  if not found then
    raise exception 'Mensaje no autorizado';
  end if;

  return query
    select m.contenido, m.variantes, m.variante_activa
    from public.mensajes m
    where m.id = p_mensaje_id;
end;
$$;

revoke all on function public.guardar_variantes_mensaje(uuid, jsonb, integer) from public, anon;
grant execute on function public.guardar_variantes_mensaje(uuid, jsonb, integer) to authenticated;

-- reemplazar_historial_chat borra y reinserta los mensajes del chat, así que
-- debe arrastrar también las variantes: si no, cualquier regeneración borraría
-- las versiones guardadas del resto de la conversación.
create or replace function public.reemplazar_historial_chat(
  p_chat_id uuid,
  p_resumen text,
  p_resumen_version integer,
  p_mensajes jsonb
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public, auth
as $$
begin
  if not exists (
    select 1 from public.chats c
    where c.id = p_chat_id and c.user_id = (select auth.uid())
  ) then
    raise exception 'Chat no autorizado';
  end if;

  delete from public.mensajes where chat_id = p_chat_id;

  insert into public.mensajes (id, chat_id, rol, contenido, creado_en, orden, variantes, variante_activa)
  select
    case
      when (item->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (item->>'id')::uuid
      else gen_random_uuid()
    end,
    p_chat_id,
    item->>'rol',
    item->>'contenido',
    coalesce((item->>'creado_en')::timestamptz, timezone('utc', now())),
    elements.ordinality,
    case
      when jsonb_typeof(item->'variantes') = 'array' and jsonb_array_length(item->'variantes') > 0
        then item->'variantes'
      else null
    end,
    case
      when jsonb_typeof(item->'variantes') = 'array'
       and jsonb_array_length(item->'variantes') > 0
       and (item->>'variante_activa') ~ '^[0-9]+$'
        then least((item->>'variante_activa')::integer, jsonb_array_length(item->'variantes') - 1)
      else 0
    end
  from jsonb_array_elements(coalesce(p_mensajes, '[]'::jsonb)) with ordinality as elements(item, ordinality)
  where item->>'rol' in ('user', 'assistant')
    and item->>'contenido' is not null;

  update public.chats
  set resumen = nullif(p_resumen, ''),
      resumen_version = greatest(coalesce(p_resumen_version, 0), 0),
      formato_version = 2,
      actualizado_en = now()
  where id = p_chat_id;
end;
$$;

revoke all on function public.reemplazar_historial_chat(uuid, text, integer, jsonb) from public, anon;
grant execute on function public.reemplazar_historial_chat(uuid, text, integer, jsonb) to authenticated;
