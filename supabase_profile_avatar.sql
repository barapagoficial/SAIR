-- SAIR: campo para guardar la foto de perfil optimizada.
-- No elimina ni modifica los datos existentes.
alter table public.perfiles
add column if not exists avatar_url text;
