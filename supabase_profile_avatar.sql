-- SAIR: datos visuales del perfil.
-- Todo se guarda en Supabase; no depende de localStorage.
alter table public.perfiles
add column if not exists avatar_url text,
add column if not exists descripcion text,
add column if not exists fondo_url text,
add column if not exists avatar_pos_x integer not null default 50,
add column if not exists avatar_pos_y integer not null default 50,
add column if not exists fondo_pos_x integer not null default 50,
add column if not exists fondo_pos_y integer not null default 50;

alter table public.perfiles
drop constraint if exists perfiles_avatar_pos_x_check,
drop constraint if exists perfiles_avatar_pos_y_check,
drop constraint if exists perfiles_fondo_pos_x_check,
drop constraint if exists perfiles_fondo_pos_y_check;

alter table public.perfiles
add constraint perfiles_avatar_pos_x_check check (avatar_pos_x between 0 and 100),
add constraint perfiles_avatar_pos_y_check check (avatar_pos_y between 0 and 100),
add constraint perfiles_fondo_pos_x_check check (fondo_pos_x between 0 and 100),
add constraint perfiles_fondo_pos_y_check check (fondo_pos_y between 0 and 100);
