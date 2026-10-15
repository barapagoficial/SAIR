# SAIR3

Aplicación de roleplay conversacional con IA. Cada usuario conversa con personajes
impulsados por Gemini usando **su propia API Key** de Google AI Studio: el proyecto no
intermedia ni almacena claves, y no tiene backend propio más allá de Supabase
(autenticación, perfiles, personajes, chats y anuncios).

- **App en producción:** https://barapagoficial.github.io/SAIR/
- **Versión actual:** 4.0.0 Oficial A
- **Historial de cambios:** [`Changelog.txt`](Changelog.txt)
- **Auditoría técnica y hoja de ruta:** [`AUDITORIA.md`](AUDITORIA.md)

## Estructura

| Archivo | Qué es |
|---|---|
| `index.html` | **Toda la aplicación**: HTML, CSS y JavaScript en un único archivo. |
| `sw.js` | Service worker (PWA). El nombre del caché lleva la versión y se sube en cada release. |
| `manifest.json` | Manifiesto PWA (instalación, iconos, colores). |
| `supabase.js` | Cliente de Supabase vendorizado (versión UMD). No se toca. |
| `supabase_*.sql` | Migraciones del esquema. Ver abajo el orden. |
| `icon-*.png`, `apple-touch-icon.png` | Iconos. Requieren PNG para la instalación PWA. |
| `ERROR.mp4` | Sonido de error. El nombre es histórico; **no** renombrar sin cambiar `index.html`. |

## Puesta en marcha local

No hay build ni dependencias: es un sitio estático.

```bash
python3 -m http.server 8080 --bind 0.0.0.0
# → http://localhost:8080/index.html
```

Para usar el chat necesitas una API Key de Google AI Studio
(https://aistudio.google.com/app/apikey) y configurarla en **Ajustes de Rol 🎭** dentro
de un personaje. Se guarda en el `localStorage` de tu navegador.

## Base de datos

`CONFIG.SUPABASE_URL` y `CONFIG.SUPABASE_ANON_KEY` están en `index.html`. La clave
`anon` es pública por diseño: **toda la seguridad depende de las políticas RLS de
Supabase**, así que nunca se debe exponer la `service_role`.

Ejecuta los scripts en el SQL Editor de Supabase, en este orden:

1. `schema.sql` — esquema base (tablas, índices, RLS y alta de usuario). Solo para un
   proyecto nuevo; en el proyecto en producción ya está aplicado.
2. `supabase_chat_storage_v2.sql` — mensajes normalizados y RPCs de guardado.
3. `supabase_notas_rol.sql` — Notas para Rol por chat.
4. `supabase_diario_personajes.sql` — Diario de Personajes por chat.
5. `supabase_profile_avatar.sql` — avatar, fondo y encuadre del perfil.
6. `supabase_user_search.sql` — búsqueda de usuarios y perfiles.
7. `supabase_variantes_respuesta.sql` — variantes de respuesta (estilo Character.AI).
8. `supabase_chat_titulos_y_aura.sql` — títulos de chat y color de aura público.

Todas son **aditivas e idempotentes** (`add column if not exists`,
`create or replace function`). La app funciona sin las dos últimas: detecta el error
`42703` y se repliega (variantes en memoria, títulos calculados al vuelo).

## Despliegue

GitHub Pages sirve la rama `main` desde la raíz. Basta con hacer merge y actualizar la
versión en **dos** sitios (`index.html` y el `CACHE_NAME` de `sw.js`) para que el
service worker entregue la app nueva.

## Validación

```bash
npx html-validate index.html                 # estructura y accesibilidad del HTML
node --check app.js                          # sintaxis del script embebido
gzip -9 -c index.html | wc -c                # peso real en tránsito
```

El script embebido se extrae entre `<script src="supabase.js"></script>` y el
`</script>` siguiente. El workflow `.github/workflows/validate.yml` ejecuta estas
comprobaciones en cada push.

## Licencia

MIT — ver [`LICENSE.md`](LICENSE.md).

### Reglas desactivadas en `.htmlvalidate.json`

Cada excepción está justificada; el resto del conjunto recomendado se aplica.

| Regla | Por qué está desactivada |
|---|---|
| `no-inline-style` | La app usa estilos en línea a propósito (colores de aura por personaje, ajustes de encuadre). |
| `element-required-attributes` | `#chat-bg-img` y `#avatar-preview` reciben el `src` desde JavaScript; poner un `src` falso provocaría una petición de red innecesaria. |
| `prefer-native-element` | `#user-badge` es un `<div role="button">` con soporte de teclado explícito; convertirlo a `<button>` cambiaría el layout del encabezado. |
| `autocomplete-password` | El campo de la API Key usa `autocomplete="off"` **a propósito**: no es una contraseña y no debe guardarse en el gestor. Los campos reales de contraseña sí llevan `current-password` / `new-password`. |
| `hidden-focusable` | Falso positivo: el popover de «más opciones» se oculta con `display:none`, así que sus botones no son alcanzables con Tab aunque conserven `aria-hidden`. |
