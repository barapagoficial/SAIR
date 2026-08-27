-- SAIR: migración aditiva para almacenar chats de forma normalizada.
-- La columna chats.historial se conserva como respaldo/compatibilidad.

alter table public.chats
  add column if not exists resumen text,
  add column if not exists resumen_version integer not null default 0,
  add column if not exists formato_version integer not null default 2;

alter table public.mensajes
  add column if not exists orden bigint;

-- Copia el resumen legado a su columna dedicada.
update public.chats c
set resumen = (
      select elements.value->>'contenido'
      from jsonb_array_elements(coalesce(c.historial, '[]'::jsonb)) with ordinality as elements(value, ordinality)
      where elements.value->>'rol' = 'summary'
      order by elements.ordinality desc
      limit 1
    ),
    resumen_version = greatest(c.resumen_version, 1),
    formato_version = greatest(c.formato_version, 2)
where c.resumen is null
  and exists (
    select 1
    from jsonb_array_elements(coalesce(c.historial, '[]'::jsonb)) elements(value)
    where elements.value->>'rol' = 'summary'
  );

-- Migra mensajes del JSONB únicamente cuando todavía no existen filas
-- normalizadas para ese chat.
insert into public.mensajes (id, chat_id, rol, contenido, creado_en, orden)
select
  case
    when (item->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (item->>'id')::uuid
    else gen_random_uuid()
  end,
  c.id,
  item->>'rol',
  item->>'contenido',
  coalesce((item->>'creado_en')::timestamptz, c.creado_en),
  elements.ordinality
from public.chats c
cross join lateral jsonb_array_elements(coalesce(c.historial, '[]'::jsonb)) with ordinality as elements(item, ordinality)
where item->>'rol' in ('user', 'assistant')
  and item->>'contenido' is not null
  and not exists (select 1 from public.mensajes m where m.chat_id = c.id);

create index if not exists idx_mensajes_chat_creado
  on public.mensajes (chat_id, creado_en, id);
create index if not exists idx_anuncios_user_id
  on public.anuncios (user_id);
create index if not exists idx_personajes_user_id
  on public.personajes (user_id);

-- Sustituye de forma atómica el conjunto normalizado de un chat. El resumen
-- vive en chats.resumen y nunca se mezcla con los mensajes de Gemini.
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
    select 1 from public.chats
    where id = p_chat_id and user_id = (select auth.uid())
  ) then
    raise exception 'Chat no autorizado';
  end if;

  delete from public.mensajes where chat_id = p_chat_id;

  insert into public.mensajes (id, chat_id, rol, contenido, creado_en, orden)
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
    elements.ordinality
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

revoke all on function public.reemplazar_historial_chat(uuid, text, integer, jsonb) from public;
grant execute on function public.reemplazar_historial_chat(uuid, text, integer, jsonb) to authenticated;

-- Guarda un mensaje y actualiza el chat dentro de la misma transacción.
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
    select 1 from public.chats
    where id = p_chat_id and user_id = (select auth.uid())
    for update
  ) then
    raise exception 'Chat no autorizado';
  end if;
  select coalesce(max(m.orden), 0) + 1 into v_orden
  from public.mensajes m where m.chat_id = p_chat_id;
  insert into public.mensajes (id, chat_id, rol, contenido, creado_en, orden)
  values (v_id, p_chat_id, p_rol, p_contenido, v_creado_en, v_orden);
  update public.chats
  set actualizado_en = v_creado_en, formato_version = 2
  where id = p_chat_id and user_id = (select auth.uid());
  return query select v_id, p_chat_id, p_rol, p_contenido, v_creado_en, v_orden;
end;
$$;

revoke all on function public.guardar_mensaje_chat(uuid, text, text) from public, anon;
grant execute on function public.guardar_mensaje_chat(uuid, text, text) to authenticated;

-- Reemplaza la política demasiado amplia de mensajes por políticas explícitas.
drop policy if exists "Permitir todo a dueños del chat" on public.mensajes;
create policy "Usuarios pueden ver mensajes de sus chats"
  on public.mensajes for select to authenticated
  using (exists (select 1 from public.chats c where c.id = mensajes.chat_id and c.user_id = (select auth.uid())));
create policy "Usuarios pueden crear mensajes en sus chats"
  on public.mensajes for insert to authenticated
  with check (exists (select 1 from public.chats c where c.id = mensajes.chat_id and c.user_id = (select auth.uid())));
create policy "Usuarios pueden actualizar mensajes de sus chats"
  on public.mensajes for update to authenticated
  using (exists (select 1 from public.chats c where c.id = mensajes.chat_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from public.chats c where c.id = mensajes.chat_id and c.user_id = (select auth.uid())));
create policy "Usuarios pueden eliminar mensajes de sus chats"
  on public.mensajes for delete to authenticated
  using (exists (select 1 from public.chats c where c.id = mensajes.chat_id and c.user_id = (select auth.uid())));

-- Elimina duplicados de anuncios que solo agregaban trabajo al plan RLS.
drop policy if exists "Solo owner puede crear anuncios" on public.anuncios;
drop policy if exists "Solo owner puede eliminar anuncios" on public.anuncios;
