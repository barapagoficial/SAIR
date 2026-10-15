# Auditoría de SAIR3 — 3.1.1 Oficial A

**Fecha:** 15 de octubre de 2026
**Alcance:** todo el repositorio `barapagoficial/SAIR` (`index.html`, `supabase.js`, `sw.js`, `manifest.json`, los 5 `.sql`, `Changelog.txt`, assets).
**Sitio publicado:** `https://barapagoficial.github.io/SAIR/` (GitHub Pages, rama `main`, raíz `/`).

---

## 0. Resumen ejecutivo

**Lo que está muy bien y no hay que tocar**

- La arquitectura "sin backend propio" (Supabase + API Key del usuario + Gemini) es la decisión correcta: cero coste de tokens para ti y privacidad de facto.
- La ingeniería alrededor de los **filtros de Gemini** (escalera de reintentos, texto discretizado, lectura por tramos, diagnóstico con `sairDiagnostico()`) es de nivel muy alto. Es la parte más difícil del problema y está resuelta con criterio.
- **Seguridad XSS de base bien hecha:** `escapeHtml()` en todo el contenido de usuario, `sanitizeImageUrl()` con lista blanca de protocolos, markdown propio que sólo permite `*acciones*` (sin dependencias tipo `marked`), y RLS aplicado con `security definer`/`security invoker` bien separados. No encontré ninguna inyección explotable.
- Rendimiento y accesibilidad ya tienen cuidados que casi nadie hace: `prefers-reduced-motion` global, modo de rendimiento conmutables (auto/ligero/completo), `content-visibility`/skeletons, paginación de historial por `orden`, y un normalizador de español neutral.
- La PWA está bien resuelta: service worker con estrategia por tipo de recurso, banner de instalación por plataforma (iOS/Android/desktop), `updatefound` + banner de recarga, y `estado_app` en Supabase para avisar de actualizaciones en caliente.

**Los 8 problemas que resolvería primero**

| # | Problema | Impacto | Esfuerzo |
|---|----------|---------|----------|
| 1 | **No se puede detener una respuesta en curso** y, peor, el timeout de 30 s sólo cubre las cabeceras HTTP → un stream que se queda colgado bloquea la UI para siempre | 🔴 Crítico | S |
| 2 | **Avatares y fondos guardados como base64 dentro de Postgres**: `buscar_usuarios` puede devolver decenas de MB | 🔴 Crítico | M |
| 3 | `listarChats()` usa `select('*')`: descarga el `historial` JSONB **completo de cada chat** sólo para pintar la lista lateral | 🔴 Crítico | S |
| 4 | `cargarHistorialChat()` trae `historial` en **cada** carga, incluso paginando | 🟠 Alto | S |
| 5 | **Fuga de listeners** en el reintento por rate limit → reintentos duplicados (dos peticiones a Gemini por un clic) | 🟠 Alto | S |
| 6 | El chat se llama **"Chat a1b2c3"**: sin título, sin renombrar, sin búsqueda, sin vista previa | 🟠 Alto | M |
| 7 | `renderMarkdown()` se ejecuta sobre **todo** el texto en cada chunk (O(n²) por respuesta larga) | 🟠 Alto | S |
| 8 | **`regenerarRespuesta` y `guardarEdicionMensaje` están definidas dos veces**: la primera es código muerto que nunca se ejecuta | 🟠 Alto | S |
| 9 | Falta `README.md`, `.gitignore`, el **DDL base de Supabase** y cualquier validación automática | 🟡 Medio | S |

A continuación el detalle, con línea, causa y arreglo concreto.

---

## 0.1 Estado de la implementación (15/10/2026)

Aplicado y verificado en la rama `arena/8a1338a8-sair` sobre `ac5e6ff`, publicado como **3.1.2 Oficial A**:

| Cambio | Estado | Verificación |
|---|---|---|
| Timeout real del stream + cancelación | ✅ | 10 aserciones funcionales sobre `enviarAGeminiStream` con `fetch` simulado |
| Botón rojo de detener + guardado de lo generado | ✅ | Carga completa de la app en jsdom sin excepciones |
| Fuga de listeners del reintento por rate limit | ✅ | Revisión del ciclo de vida del handler |
| `listarChats()` sin `select('*')` | ✅ | — |
| Historial legacy a demanda | ✅ | — |
| Pintado del stream a ~16 fps | ✅ | 100 llamadas consecutivas sin error, markdown intacto |
| Eliminación de las 2 funciones duplicadas | ✅ | AST con `acorn`: 0 duplicadas (antes 2) |

`node --check` sobre el script completo y `html-validate` (69 avisos, **los mismos que antes**: la nueva UI no añade ninguno). El diff es de +135/−24 líneas: se conservaron los finales de línea originales para que el cambio sea revisable.

Los arreglos 2 (imágenes en base64 → Supabase Storage) y 3 (§1.3) quedan pendientes: el primero necesita tocar el bucket y las políticas de Storage.

---

## 1. Bugs y riesgos reales

### 1.1 🔴 Una respuesta colgada bloquea el chat para siempre

`index.html:2535` (`enviarAGeminiStream`):

```js
controller=new AbortController(),timeoutId=setTimeout(()=>controller.abort(),30e4);
let response;
try{ response=await fetch(url,{...signal:controller.signal}) }
catch(err){ if(err.name==='AbortError') throw new Error('Tiempo de espera agotado…'); throw err }
finally{ clearTimeout(timeoutId) }   // ← se cancela AQUÍ
```

El `clearTimeout` se ejecuta en cuanto llegan las cabeceras, es decir **antes** de leer el cuerpo. Si el stream se estanca a mitad (red móvil, cambio de antena, cuelgue del servidor), el bucle `for(;;){ await reader.read() }` nunca termina, `isStreaming` se queda en `true` y el botón de enviar queda deshabilitado hasta recargar la página.

Agravante: **no hay ningún botón de detener**. El único `AbortController` vive dentro del generador y nunca se expone a la interfaz.

**Arreglo** (los dos problemas de una vez): ver el snippet completo en el [Anexo A](#anexo-a-detener-la-generación).

---

### 1.2 🔴 Imágenes en base64 dentro de la base de datos

`index.html:3186-3187` comprime el avatar a 256 px JPEG 0.82 y el fondo a **1200 px JPEG 0.78**, y ambos se guardan con `canvas.toDataURL(...)` en columnas `text` (`perfiles.avatar_url`, `perfiles.fondo_url`, `personajes.avatar_url`).

Consecuencias medidas:

- Un fondo de 1200 px ronda los 200–600 KB. En base64 (+33 %) son **270–800 KB por usuario**.
- `supabase_user_search.sql` → `buscar_usuarios()` devuelve `avatar_url` **y** `fondo_url` de hasta **30 usuarios**: una sola búsqueda puede transferir entre 8 y 25 MB. En un móvil eso son varios segundos de espera y consumo de datos real.
- `obtener_mi_perfil()` y la fila de `perfiles` engordan en cada `select`.
- Postgres no está hecho para servir imágenes: los backups y el `diskUsage` (2,7 MB ahora) crecen rápido.

**Arreglo recomendado:** Supabase Storage + URL firmada o pública.

```js
// subir el blob en vez de guardar base64
async function subirImagen(blob, ruta){
  const { error } = await sbClient.storage.from('perfiles').upload(ruta, blob, {
    upsert: true, contentType: 'image/jpeg', cacheControl: '31536000'
  });
  if (error) throw error;
  return sbClient.storage.from('perfiles').getPublicUrl(ruta).data.publicUrl;
}
```

- Bucket `perfiles` público para leer, políticas de escritura `storage.objects` = `auth.uid()::text = (storage.foldername(name))[1]`.
- Guardar en la columna sólo la URL (`https://…/storage/v1/object/public/perfiles/<uid>/fondo.jpg`). `sanitizeImageUrl()` ya acepta `https:`, así que **el resto de la app no cambia**.
- Además `buscar_usuarios` puede devolver el avatar y dejar de devolver el fondo (la tarjeta de búsqueda no lo usa: sólo la portada del perfil).

**Arreglo mínimo si no quieres tocar Storage todavía:** bajar el fondo a 900 px / calidad 0.68 y **quitar `fondo_url` del `returns table` de `buscar_usuarios`**.

---

### 1.3 🔴 `listarChats()` descarga el historial completo de todos los chats

`index.html:2488`:

```js
sbClient.from('chats').select('*').eq('user_id',…).eq('personaje_id',…).order('actualizado_en',…)
```

`chats` todavía conserva la columna legacy `historial jsonb` (`supabase_chat_storage_v2.sql` dice explícitamente que "se conserva como respaldo/compatibilidad"). Ese `select('*')` trae **todas las conversaciones completas del personaje** cada vez que abres la lista lateral o cambias de personaje.

**Arreglo:**

```js
.select('id,creado_en,actualizado_en,resumen,formato_version,titulo')  // titulo: ver §6.2
```

---

### 1.4 🟠 `cargarHistorialChat()` también trae `historial` en cada carga

`index.html:2490`:

```js
.select('historial,resumen,resumen_version,formato_version')…
```

Ese `historial` sólo se usa en el caso legacy (`rows.length === 0 && formato_version < 2`). Para todos los chats migrados se descarga para nada, **en cada envío de mensaje** (porque `enviarMensaje`, `regenerarRespuesta` y `guardarEdicionMensaje` llaman a `cargarHistorialCompleto`).

**Arreglo:** pedir primero lo ligero y sólo caer al JSONB si hace falta.

```js
const { data: chat, error } = await sbClient.from('chats')
  .select('resumen,resumen_version,formato_version').eq('id', chatId).eq('user_id', currentUser.id).single();
// …y SOLO si (rows.length === 0 && formato_version < 2):
const { data: legacy } = await sbClient.from('chats').select('historial').eq('id', chatId).single();
```

---

### 1.5 🟠 Fuga de listeners en el reintento por rate limit

`index.html:2876` (`mostrarErrorRateLimit`), al final:

```js
document.removeEventListener('click',retryHandler);
document.addEventListener('click',retryHandler);
```

`retryHandler` se crea **de nuevo** en cada llamada, así que el `removeEventListener` intenta quitar el handler nuevo (que nunca se añadió) y **el handler viejo sigue registrado**. `pendingAction` y `pendingData` son globales, así que un handler viejo puede dispararse con los datos nuevos: **dos reintentos, dos peticiones facturadas al usuario**, una burbuja borrada dos veces.

**Arreglo:** el handler fuera de la función (una sola vez en el arranque) o guardarlo en una variable de módulo.

```js
let rateLimitRetryHandler=null;
// dentro de mostrarErrorRateLimit:
if(rateLimitRetryHandler)document.removeEventListener('click',rateLimitRetryHandler);
rateLimitRetryHandler=e=>{…};
document.addEventListener('click',rateLimitRetryHandler);
```

---

### 1.6 🟠 El aura de un personaje de la Comunidad siempre sale rosa

`index.html:2538` calcula el color con `parsearSystemPrompt(p.system_prompt)`, pero `listarPersonajesComunidad()` (`index.html:2481`) **no selecciona `system_prompt`** (correcto, no hay que exponerlo). Resultado: todas las tarjetas de la Comunidad usan `#ff4d8f`.

**Arreglo:** guardar el color como columna propia al crear/editar el personaje y seleccionarla en la consulta pública.

```sql
alter table public.personajes add column if not exists color_aura text default '#ff4d8f';
```

```js
// al insertar/actualizar: color_aura: sanitizeThemeColor(datos.themeColor)
// en listarPersonajesComunidad: select('...,color_aura')
// en renderCharactersGrid: const themeColor = sanitizeThemeColor(p.color_aura || parsed.themeColor || '#ff4d8f');
```

Nota aparte: `parsearSystemPrompt()` devuelve `themeColor` sin sanitizar y se inyecta en `style="--char-color:${themeColor}"`. Hoy no es explotable (sólo tu propio prompt acaba ahí), pero pasa siempre por `sanitizeThemeColor()` y duerme tranquilo.

---

### 1.7 🟠 `renderMarkdown()` se reejecuta sobre todo el texto en cada chunk

En los cuatro bucles de streaming:

```js
for await(const chunk of generator){
  textoCompleto+=chunk;
  bubbleIA.innerHTML=renderMarkdown(textoCompleto) + '<span class="streaming-cursor"></span>';
}
```

Con `maxOutputTokens: 4096` y chunks de ~30 caracteres, son ~300 regeneraciones completas del markdown, cada una con su regex sobre el texto entero y su reflow. En un gama media se nota como tirones y batería.

**Arreglo** (mismo resultado visual, ~60 renders/s máx.):

```js
let framePendiente=null;
const pintar=()=>{ bubbleIA.innerHTML=renderMarkdown(textoCompleto)+'<span class="streaming-cursor"></span>';
                     scrollChatToBottom(); framePendiente=null; };
for await(const chunk of generator){
  textoCompleto+=chunk;
  const typing=bubbleIA.querySelector('.typing-indicator'); if(typing)typing.remove();
  if(!framePendiente)framePendiente=requestAnimationFrame(pintar);
}
if(framePendiente){ cancelAnimationFrame(framePendiente); framePendiente=null; }
bubbleIA.innerHTML=renderMarkdown(textoCompleto); // render final limpio
```

Como esto está duplicado en 4 sitios (§2.6), lo natural es extraer un `async function transmitirRespuesta(bubble, generator)`.

---

### 1.8 🟡 Cuatro copias del mismo flujo (fuente de bugs futuros)

`enviarMensaje` (2879), `reintentarRespuestaAsistente` (2878), `regenerarRespuesta` (2880) y `guardarEdicionMensaje` (2883) contienen **el mismo bloque de ~40 líneas** copiado y pegado: cargar historial → `procesarHistorialSiEsNecesario` → generar → streaming → guardar → `agregarBotones` → `renderizarChatPaginado`.

Ya se ven las divergencias que eso provoca:

- `reintentarRespuestaAsistente` guarda el mensaje y llama a `marcarRespuestaIncompleta()`, pero **no** actualiza `chatOffset`; `enviarMensaje` sí.
- El `finally` de `enviarMensaje`/`reintentar` pone `disabled=!chatInput.value.trim()||!currentChatId`, mientras el listener de `input` (2838) añade `||isStreaming`.
- El texto de error de rate limit se duplica literal en dos sitios.

**Arreglo:** un único `async function transmitirRespuesta({bubble, generador, alTerminar})`. Es la refactorización con mejor relación valor/riesgo de todo el proyecto: quita ~150 líneas y hace que los arreglos de §1.1 y §1.7 se apliquen **una sola vez**.

---

### 1.9 🟡 Detalles menores pero reales

| Qué | Dónde | Detalle |
|-----|-------|---------|
| `document.write()` en la vista previa del fondo | `index.html:2455` | Deprecado y bloqueado por algunos navegadores. Usa un `Blob` + `URL.createObjectURL()` o `img.src` en el mismo documento. |
| `window._rateLimitBubble` global | 2876 | Dos generaciones simultáneas se pisan. Debería vivir en el módulo. |
| `roles` vs `roles_usuario` | 2308 vs 2332 | Dos tablas distintas para dos cosas distintas (rol de permiso vs nombre de rol del usuario). Funciona, pero el nombre confunde; renómbralas a `perfiles_permisos` / `perfiles_nombre_rol` o documéntalo en el DDL. |
| `api-key-status` duplicado | 1157 (dentro de un comentario) y 1256 (real) | No colisiona porque uno está comentado, pero es una trampa para el próximo cambio. |
| `.single()` sin `maybeSingle()` | 15 usos | Supabase no lanza excepción, devuelve `{data:null,error}` y aquí está bien tratado (`rolResult.data?.rol\|\|'user'`). Sólo tenlo en cuenta si añades tablas nuevas. |
| `contarTokensHistorial` / `estimarTokens` | 1663-1664 | La estimación (`length/3.5`) sólo se usa internamente para decidir cuándo resumir. Perfecto como *feature* visible → §6.6. |

---

### 1.10 🟠 Dos funciones están definidas dos veces (la primera es código muerto)

Verificado con un análisis de AST (`acorn`) sobre el script completo: hay **230 declaraciones de función de nivel superior y 2 nombres repetidos**.

```
⚠️  DUPLICADAS (gana la ÚLTIMA):
    regenerarRespuesta     → líneas 1318, 1337
    guardarEdicionMensaje  → líneas 1321, 1390
```

En JavaScript, dos `function` con el mismo nombre en el mismo ámbito no dan error: **la última declaración sobrescribe a la primera**. Es decir, las versiones minificadas de `regenerarRespuesta` (`index.html:2880`) y `guardarEdicionMensaje` (`index.html:2883`) **nunca se ejecutaban**; las que corrían son las versiones formateadas "atómicas" que empiezan en `index.html:2899` y `2952`.

Por qué importa aunque "funcione":

- Cualquier arreglo aplicado en la copia equivocada no surte efecto y parece que la app ignora los cambios. Es exactamente el tipo de trampa que hace perder una tarde.
- Las versiones muertas usan **el modelo antiguo de burbujas** (`bubbleElement.innerHTML`), así que si alguien "revive" una quitando la otra copia, reaparecen bugs ya corregidos (duplicados al regenerar, desincronización con Supabase) descritos en el Changelog 2.1.0.

**Arreglo (ya aplicado en 3.1.2):** eliminar las copias muertas y dejar una única definición.

```bash
# comprobación reutilizable, sin dependencias del navegador
node -e "…"   # parsea el script con acorn y lista FunctionDeclaration duplicadas (ver Anexo B)
```

---

## 2. Qué limpiar

### 2.1 Código muerto (verificado: aparece 1 sola vez en todo el archivo)

| Función | Línea | Comentario |
|---------|-------|------------|
| `cambiarUsername()` | ~2330 | Queda de la función de "cambiar nombre de usuario" retirada. |
| `obtenerUsername()` | ~2480 | Sustituida por `obtenerUsernamesBatch()`. |
| `eliminarMensajeDeChat()` | 2533 | **Tiene funcionalidad real pero ningún botón la llama** → ver §6.3. |
| `getProfileBackground()` | ~2370 | Sin uso. |

### 2.2 CSS muerto: ~10 selectores de la función retirada

Verificado uno por uno (aparecen **sólo** dentro del bloque `<style>` y ninguna línea de JS los aplica):

`.username-form` (4 reglas), `.username-current`, `.username-current-avatar`, `.username-current-email`, `.username-current-info`, `.username-current-name`, `.profile-avatar-editor` (2 reglas), `.profile-background-editor`, `.profile-background-preview`, `.profile-cover-avatar` (2 reglas), `.diario-hint` (el modal usa `.notas-rol-hint`), `.user-badge.has-profile-background` (2 reglas).

**Ojo, estas NO las borres** aunque un buscador de CSS sin usar las marque: `.intensity-suave/.intensity-mediana/.intensity-maxima`, `.role-tag.admin` y `.role-tag.owner` se construyen dinámicamente (`intensity-${intensidad}`, `role-tag ${userRole}`).

### 2.3 ~4 KB de HTML comentado

`index.html:1146-1160`: el bloque del `settings-modal` con `gemini-api-key`, `gemini-model`, `save-api-key`, `clear-api-key`… Todo eso ya vive en "Ajustes de Rol" (1250+). Además duplica IDs y contiene una lista de modelos desactualizada. Bórralo: `html-validate` ya lo señalaba como fuente de ambigüedad.

### 2.4 Finales de línea mezclados

`index.html` tiene **2459 líneas CRLF y 2321 LF**. Es la causa de que cada diff salga raro en GitHub y de conflictos falsos. Un `.gitattributes` lo arregla de raíz:

```gitattributes
* text=auto eol=lf
*.png binary
*.mp4 binary
```

Y una sola vez: `npx prettier --write index.html` o `dos2unix index.html`, en un PR exclusivo de formato.

### 2.5 Assets

- `icon.jpg` (159 KB) **no se referencia en ningún sitio** → borrar.
- `ERROR.mp4` es un archivo de audio (11,6 KB) con extensión de vídeo, cargado con `preload="auto"`. Renómbralo a `error.m4a` y usa `preload="none"` + `play()` bajo demanda (ya se usa sólo en `playErrorSound()`).
- `icon-512.png` (277 KB) e `icon-maskable-512.png` (196 KB) se pueden reducir un 50–70 % con `pngquant`/`oxipng` sin pérdida visible. Son obligatorios en PNG para la PWA, pero no tan pesados.
- `apple-touch-icon.png` (180×180, 39 KB) correcto.

### 2.6 Versionado duplicado en 4 sitios

`index.html:1087`, `index.html:1090`, `sw.js:1` (`sair-v3.1.1-oficial-a`) y `Changelog.txt`. Un olvido en cualquiera de los cuatro y los usuarios no reciben la actualización (o se les queda el HTML viejo en caché).

**Arreglo:** una constante en un archivo compartido y que `sw.js` la derive.

```js
// version.js  (cárgalo con <script src="version.js"></script> antes del bloque principal)
window.SAIR_VERSION = { app: '3.1.2', sw: 'sair-v3.1.2' };
```

```js
// sw.js
importScripts('./version.js');
const CACHE_NAME = self.SAIR_VERSION.sw;   // el nombre del caché se actualiza solo
```

`Changelog.txt` también merece ser `CHANGELOG.md` con enlaces a los PRs (y así se renderiza en GitHub).

### 2.7 El monkey-patch del español neutral

`index.html:3906-3911`:

```js
const construirSystemPromptBase=construirSystemPrompt;
construirSystemPrompt=function(datos){return construirSystemPromptBase(datos)+REGLA_ESPANOL_NEUTRAL};
```

Y un `MutationObserver` global sobre `document.body` que reescribe texto en caliente (`Describí→Describe`, `Tocá→Toca`…).

Funciona y el filtro que excluye `#chat-messages, .message-bubble, textarea, input, code` está bien pensado (no toca el rol). Pero:

1. El `MutationObserver` recorre **cada** mutación del DOM de la app para arreglar 13 cadenas. Basta con hacer un *find & replace* en el código fuente y el observer desaparece: menos CPU, menos riesgo.
2. `REGLA_ESPANOL_NEUTRAL` se añade al `system_prompt` de **todos** los personajes. Un personaje que debería hablar en rioplatense o en mexicano queda aplanado, y como se aplica también al guardar, el texto de la app cambia el comportamiento de personajes ya existentes. Sugerencia: conviértelo en un interruptor por personaje ("🌎 Español neutral: sí/no") y no lo apliques a los `ejemplos de diálogo` ni al `saludo`.

### 2.8 Lo que falta en el repo para que sea mantenible

```
README.md          ← no existe (instalación, variables, deploy, arquitectura)
.gitignore         ← no existe  (node_modules, .DS_Store, *.zip…)
.gitattributes     ← no existe  (§2.4)
schema.sql         ← falta el DDL BASE: perfiles, roles, roles_usuario,
                     personajes, chats, mensajes, anuncios, estado_app + RLS
404.html           ← GitHub Pages no tiene SPA fallback
robots.txt / sitemap.xml
.github/workflows/ ← cero validación automática
```

Hoy el repo tiene las **migraciones** (notas de rol, diario, avatares, búsqueda, almacenamiento v2) pero no el esquema inicial: es imposible reconstruir el proyecto desde cero o abrir un entorno de pruebas. Añadir `schema.sql` con el DDL + policies + triggers de alta de usuario es la mejora de mantenibilidad más rentable después de §1.8.

### 2.9 Coherencia con la Política de Privacidad

`index.html:1540` afirma: *"Este Sitio utiliza servicios de publicidad de terceros (Google AdSense)… Google utiliza cookies"*. **No hay ni una línea de AdSense en el proyecto.** Hoy la política describe algo que no pasa (riesgo legal y de confianza). O se añade la publicidad, o se elimina el punto 2. Además:

- No hay **Términos de Servicio** (sólo Privacidad).
- No hay forma de **borrar la cuenta ni los datos** desde la app (derecho de supresión). Mínimo: un botón "Eliminar mi cuenta y mis datos" en Ajustes que llame a una función `security definer` que borre `perfiles`, `personajes` (cascade a `chats`/`mensajes`), `roles`, `roles_usuario`, `anuncios` y `auth.users`.
- El foco del producto es rol + "🔥 Máxima (mínimo permitido)" y no hay ninguna declaración de edad mínima ni aviso de contenido ficticio. Un aviso de 18+ al registrarse te cubre y no rompe la experiencia.

---

## 3. Rendimiento

### 3.1 Peso real

| Recurso | Tamaño | En tránsito (gzip, como sirve Pages) |
|---|---|---|
| `index.html` | 412 KB | **96 KB** |
| `supabase.js` | 206 KB | ~55 KB |
| `icon-512.png` | 277 KB | 277 KB (PNG no comprime) |
| `icon-maskable-512.png` | 196 KB | 196 KB |
| **Primera carga** | **~1,2 MB** | **~650 KB** |

Las 4.780 líneas en un único archivo tienen una ventaja (despliegue atómico) y una desventaja (nada se cachea por separado). Mi recomendación es **no** trocear el JS por módulos (el SW ya lo cachea todo y el ahorro real es pequeño), pero sí:

1. Comprimir los iconos (§2.5): –350 KB en la primera visita.
2. Añadir `<link rel="preload" as="image" href="icon-192.png">` no aporta; mejor `<meta name="theme-color">` ya está.
3. Reducir las fuentes: se piden Inter (300–700, 5 pesos), Space Grotesk (400–700, 4) y JetBrains Mono (400,500) = **11 archivos woff2**. Baja a Inter 400/600, Space Grotesk 500/700 y JetBrains Mono 400 → 5 archivos. Ahorro ~150 KB y una conexión TLS menos al primer render.
4. `supabase.js` (206 KB) es la librería completa. Si algún día quieres, `@supabase/supabase-js` con tree-shaking + esbuild baja a ~60 KB, pero **no** es una prioridad.

### 3.2 Lo que más pesa de verdad: las imágenes en base64

Ya descrito en §1.2. Es, con diferencia, el mayor consumo de ancho de banda del producto.

### 3.3 La Comunidad no escala

`listarPersonajesComunidad()` trae los **50 más recientes**, sin búsqueda, sin filtros, sin orden, sin paginación, con 50 avatares base64. En cuanto haya 200 personajes públicos la pestaña se vuelve inservible.

**Mínimo viable:** `.ilike('nombre', \`%${q}%\`)` + `.range(offset, offset+23)` con botón "Cargar más" + `select` sin `system_prompt`. Si añades `tags text[]`, con `.contains('tags', [tag])` tienes filtros.

### 3.4 Service worker

Bien construido (network-first para navegación y manifest, stale-while-revalidate para estáticos). Dos detalles:

- El `CACHE_NAME` manual (§2.6).
- En `install` cacheas `./ERROR.mp4` en un `Promise.allSettled` aparte: correcto, porque si falla no rompe la instalación. Bien visto.

---

## 4. Accesibilidad

`npx html-validate index.html` → **69 errores**. Los relevantes:

### 4.1 Zoom bloqueado (WCAG 1.4.4)

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=yes" />
```

`maximum-scale=1.0` desactiva el zoom por pellizco en iOS aunque pongas `user-scalable=yes`. Quita `maximum-scale` (o pon `5.0`).

### 4.2 Botones sin nombre accesible

9 botones sólo-icono no tienen texto ni `aria-label` (`title` no cuenta como nombre accesible fiable). Los peores por importancia: el botón de envío del chat, el hamburguesa, el de modo inmersivo, el de ajustes y el de scroll-to-bottom. Ejemplo:

```html
<button class="chat-send-btn" id="chat-send-btn" aria-label="Enviar mensaje">
```

### 4.3 Modales incompletos

`openModal()` (2384) sólo añade la clase. Falta: `role="dialog"`, `aria-modal="true"`, foco al primer campo al abrir, **trampa de foco**, y devolver el foco al botón que lo abrió al cerrar. Escape ya funciona (2402) y el click en el overlay también: bien.

```js
function openModal(id){
  const el=document.getElementById(id);
  el._focoPrevio=document.activeElement;
  el.classList.add('visible');
  el.setAttribute('aria-hidden','false');
  const foco=el.querySelector('input,textarea,select,button:not(.modal-close)');
  foco?.focus();
}
function closeModal(id){
  const el=document.getElementById(id);
  el.classList.remove('visible');
  el._focoPrevio?.focus?.();
}
```

### 4.4 Nada se anuncia a los lectores de pantalla

- El `toast` (avisos de éxito y de error) no tiene `aria-live`. Con `role="status" aria-live="polite"` cualquier error de Gemini se anunciaría solo.
- Los mensajes que se van escribiendo en streaming tampoco tienen región viva. Basta un `<div id="chat-live" class="sr-only" aria-live="polite">` con el texto final.

### 4.5 Contrastes (calculados)

| Variable | Sobre | Ratio | Veredicto |
|---|---|---|---|
| `--text-4` `#606078` | `#050507` (tema oscuro) | **3.34:1** | ❌ falla AA |
| `--text-4` `#606078` | `#12121a` (tarjeta) | **3.05:1** | ❌ falla AA |
| `--text-4` `#8a8aa0` | `#fafafa` (tema claro) | **3.23:1** | ❌ falla AA |
| `--text-3` `#9090a8` | `#050507` | 6.54:1 | ✅ AA |
| `--text-2` `#d0d0e0` | `#050507` | 13.36:1 | ✅ AA |
| `--pink` `#ff4d8f` | `#050507` | 6.51:1 | ✅ AA |

`--text-4` se usa en textos de `.72rem`–`.75rem` (ayudas, contadores, "0/8000", notas al pie). Sube a `#7a7a92` en oscuro y `#6e6e85` en claro: llegas a ~4.6:1 sin cambiar la estética.

### 4.6 El popover "Más opciones"

`#chat-extra-popover` tiene `role="menu"` con `role="menuitem"` y `aria-hidden="true"`, pero **no implementa navegación con flechas** (que es obligatorio si usas `role="menu"`). Lo más simple y correcto: quita `role="menu"`/`role="menuitem"` y déjalo como una lista de botones normales con `aria-expanded` en el disparador (que ya está).

### 4.7 Bien hecho, para que no lo rompas

- `prefers-reduced-motion` global (línea 1032) cubre todas las animaciones.
- `lang="es"`, `aria-label` en las secciones principales, `title` en casi todo.
- Los `sr-only`… no existen, pero tampoco hacen falta salvo en §4.4.
- `tabindex="0"` + `role="button"` + Enter/Espacio en `#user-badge` (3189).

---

## 5. Seguridad y privacidad

### 5.1 La CSP es casi decorativa

```html
<meta http-equiv="Content-Security-Policy" content="object-src 'none'; base-uri 'self'; form-action 'self';">
```

Falta lo importante. Y ojo: **GitHub Pages no permite cabeceras HTTP personalizadas**, así que la `<meta>` es tu única vía (y el `frame-ancestors`/`X-Frame-Options` no se puede poner en una meta: para eso necesitarías Cloudflare en medio).

Propuesta compatible con el código actual (usa estilos e handlers inline, así que `unsafe-inline` es inevitable sin reescribir los `onclick`):

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com data:;
  img-src 'self' data: blob: https:;
  connect-src 'self' https://tcnzimhqjyivlrvqzwpb.supabase.co wss://tcnzimhqjyivlrvqzwpb.supabase.co https://generativelanguage.googleapis.com;
  object-src 'none'; base-uri 'self'; form-action 'self';
">
```

Ganancia real: aunque un atacante lograra inyectar HTML, `connect-src` le impide exfiltrar tu API Key a un dominio suyo. **Eso** es lo que protege la clave, no `script-src`.

Nota: hay 3 `onclick=` inline (`renderCharacters()`, y dos en plantillas generadas). Con migrarlos a `addEventListener` podrías quitar `'unsafe-inline'` de `script-src`; el resto (Data URLs, handlers) queda cubierto por `img-src data:`.

### 5.2 La anon key pública es correcta… si el RLS está bien

Publicar `SUPABASE_ANON_KEY` en un repo público es el uso previsto de Supabase. **Todo** depende de que el RLS y las funciones `security definer` estén bien. Vi `buscar_usuarios` y `obtener_usernames` con `security definer` y `revoke … from public, anon`: correcto. Pero:

- `obtener_usernames(p_user_ids uuid[])` permite a cualquier usuario autenticado pasar **cualquier UUID** y obtener el nombre. Es enumeración de usuarios. Si te importa, filtra por `exists (select 1 from personajes p where p.user_id = perfil.user_id and p.publico)` o limítalo a usuarios con los que compartes algo.
- No hay DDL versionado (§2.8), así que no puedo verificar las policies de `perfiles`, `personajes`, `chats`, `anuncios` ni `estado_app`. **Esto es lo primero que revisaría en el dashboard de Supabase**: que `personajes` tenga `using (publico = true or user_id = auth.uid())` y que `chats`/`mensajes` no sean legibles por terceros.

### 5.3 La API Key del usuario

`localStorage` + ofuscación por `_obf_k` (que no es cifrado, es codificación). Es la decisión pragmática y el aviso al usuario es honesto. Dos mejoras:

1. La política dice "se procesa localmente". Es cierto (el navegador llama directo a Google), pero convendría decir también "y se guarda en el almacenamiento local de tu navegador, no en nuestros servidores" — tal como está redactado puede leerse como "no se guarda". Sé explícito: **mejor transparencia, cero fricción.**
2. `getGeminiKey()` hace hasta 5 iteraciones de deobfuscación en cada llamada y reescribe en cada lectura. Cachea el valor descifrado en memoria tras la primera lectura.

### 5.4 Exportar/importar chat

`chat-export-btn` genera un JSON con toda la conversación. Bien. Sugerencias: incluir `version`, `personaje.nombre` y `personaje.system_prompt` (hoy se pierde el personaje al importar en otra cuenta), y pedir confirmación antes de sobrescribir un chat existente.

---

## 6. Qué agregar

Ordenado por **valor para el usuario ÷ esfuerzo**. Los tres primeros son los que yo haría esta semana.

### 6.1 🔴 Botón de detener + guardar lo generado

Ver §1.1 y Anexo A. No hay nada que un usuario de rol pida más veces que "para, para, así está bien".

### 6.2 🟠 Títulos de chat, búsqueda y vista previa

Hoy la lista lateral dice `Chat a1b2c3` (2775) con una fecha. Con 30 chats es inmanejable.

- **Título automático:** añade `titulo text` a `chats` y en la RPC `guardar_mensaje_chat` que ya existe:

```sql
-- dentro de guardar_mensaje_chat, antes del update de chats
update public.chats c
set actualizado_en = v_creado_en,
    formato_version = 2,
    titulo = coalesce(c.titulo, case when p_rol = 'user' then left(regexp_replace(btrim(p_contenido), '\s+', ' ', 'g'), 60) end)
where c.id = p_chat_id and c.user_id = (select auth.uid());
```

- **Renombrar:** doble clic sobre el título → `update chats set titulo = …`.
- **Vista previa:** mostrar el último mensaje (`order by orden desc limit 1`) o el `resumen` ya guardado.
- **Buscar:** un `input` que filtre en cliente por título + contenido del `resumen` (sin coste de red).

### 6.3 🟠 Usar la función que ya existe: borrar mensaje

`eliminarMensajeDeChat()` está escrita y nunca se llama. Añade un botón "🗑️" en `agregarBotones()` para los mensajes del usuario (y opcionalmente para los del asistente, pidiendo confirmación y avisando de que la numeración se recalcula). Coste: ~15 líneas. Valor percibido: alto.

### 6.4 🟠 Continuar y "volver a tirar los dados"

- **Continuar** ya existe (`✂️ Continuar respuesta` en 4086). Bien.
- **Swipe/variantes:** hoy "Regenerar" **borra** la respuesta anterior. Guarda las alternativas (`<< 1/3 >>`) y deja que el usuario elija. Es la mecánica más valorada en apps de rol (SillyTavern, AI Dungeon) y ya tienes toda la infraestructura: sólo hay que no borrar y guardar el índice activo.
- **Regenerar con instrucción:** "hazlo más corto", "más dramático". Se añade como mensaje de sistema efímero al prompt.

### 6.5 🟠 Exportar/importar personajes (interoperabilidad)

Falta por completo. Con dos formatos:

```js
// Exportar — compatible con el estándar de tarjetas v2 (SillyTavern, Agnai, Risu)
function exportarPersonaje(p){
  const s = parsearSystemPrompt(p.system_prompt);
  const card = {
    spec: 'chara_card_v2', spec_version: '2.0',
    data: {
      name: p.nombre, description: s.personalidad, personality: s.personalidad,
      scenario: s.escenario, first_mes: p.saludo || '', mes_example: s.ejemplos,
      creator_notes: p.descripcion_corta || '', tags: [],
      extensions: { sair: { version: '3.1.1', color_aura: s.themeColor, intensidad: p.intensidad, max_tokens: p.max_tokens } }
    }
  };
  descargarJSON(card, `${p.nombre.replace(/[^\w\-]+/g,'_')}.card.json`);
}
// Importar: acepta .json (tarjeta v2) y rellena el formulario existente
```

Ganancia doble: tus usuarios se llevan y traen personajes de otras apps, y tú recibes personajes de fuera para tu Comunidad. Es la mejor palanca de crecimiento que tienes disponible y son ~60 líneas.

### 6.6 🟡 Lectura en voz alta (TTS) y dictado (STT)

El rol se consume mucho tumbado o con auriculares. La Web Speech API es gratis, nativa y no necesita backend:

```js
function leerEnVoz(bubble){
  const t=(bubble.dataset.originalText||'').replace(/\*[^*]*\*/g,'');   // fuera las acciones
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(t);
  const v=speechSynthesis.getVoices().find(v=>/^es(-|$)/.test(v.lang));
  if(v)u.voice=v; u.rate=1.02; speechSynthesis.speak(u);
}
```

Botón 🔊 en `agregarBotones()` + autolectura opcional por personaje (y su `saludo`). Emparejado con un 🎙️ de dictado en el `textarea`, esto es una actualización de versión entera.

### 6.7 🟡 Comunidad que se pueda explorar

Buscar por nombre, paginar, ordenar (recientes / más chateados), etiquetas, "❤️ Favoritos", "🚩 Reportar" (necesario en cuanto haya contenido de terceros: hoy no tienes ninguna herramienta de moderación más allá de borrar tu propio personaje). Un contador de chats iniciados por personaje público es además tu mejor métrica de producto.

### 6.8 🟡 Amigos de verdad (o cambiarle el nombre)

`🔎 Buscar Amigos` sólo busca usuarios por nombre y muestra su perfil: **no hay solicitudes, ni lista, ni amigos**. O se hace (tabla `amistades (solicitante, destinatario, estado)`, + RLS, + UI de solicitudes) o se renombra a "🔎 Explorar usuarios" y se deja para más adelante. Un botón que promete algo que no cumple desgasta más que su ausencia.

### 6.9 🟡 Bóveda de memoria (lorebook)

Ya tienes tres capas de memoria (Notas de Rol, Recapitulación, Diario de Personajes) y son buenas. Falta lo que hace la competencia: **entradas de memoria con palabra clave** que se inyectan sólo cuando aparecen en el contexto (ej. entrada "Reino de Valdora" → se añade al prompt si el usuario escribe "Valdora"). Es un `jsonb` con `{clave, texto}` por personaje y ~30 líneas de lógica de inyección. Escala mucho mejor que un prompt gigante.

### 6.10 🟡 Borradores, contador de gasto y atajos

- **Borrador por chat** en `localStorage` (hoy recargas y pierdes el mensaje a medio escribir).
- **Contador de tokens y coste estimado** del chat (`estimarTokens()` ya existe). Transparencia total con la clave del usuario: es un diferenciador frente a apps con suscripción.
- **Atajos**: `Ctrl/⌘+↑/↓` navegar chats, `Ctrl+Enter` regenerar, `Esc` cancelar edición.

### 6.11 🟢 Compartir y crecer

- `<meta property="og:title|description|image|url">` + `twitter:card`. **Hoy no tienes ni uno**: cuando alguien pega el enlace en Discord o WhatsApp no aparece ni título ni imagen. Es la mejora de marketing más barata que existe.
- `navigator.share()` en los personajes y capítulos del Historiador ("Compartir capítulo").
- Landing mínima con 3 capturas, para explicar qué es antes del registro.
- `manifest.json`: añade los `screenshots` (Chrome los pide para el diálogo de instalación enriquecido) y haz que el `shortcut` lleve a un destino real: `./index.html?view=community` en vez de `./index.html` (y que la app lea ese query param).
- Ojo con `"id": "sair2"` en el manifest mientras la app es 3.1.1: el `id` **no se debe cambiar** una vez publicado (crearía una instalación duplicada), pero documenta por qué es "sair2".

### 6.12 🟢 Infra

- `schema.sql` + `seed.sql` + `.github/workflows/validate.yml` (`html-validate`, `node --check`, un smoke test con Playwright de: cargar → login aparece → modal de políticas).
- Renombrar `Changelog.txt` → `CHANGELOG.md` y enlazar los PRs.
- Sentry (o un `window.onerror` → tabla `errores`) te daría visibilidad real de lo que falla en producción. Hoy sólo está `sairDiagnostico()` en consola, que exige que el usuario abra la consola.
- Los 72 `console.*` del archivo deberían silenciarse cuando no hay `?debug`: se filtran credenciales por accidente en capturas de pantalla y ensucian el perfil de rendimiento.

---

## 7. Plan de acción propuesto

### Sprint 1 — Estabilidad ✅ **aplicado en 3.1.2 Oficial A**
1. ✅ `listarChats()` → `select` explícito (§1.3).
2. ✅ `cargarHistorialChat()` → `historial` sólo cuando haga falta (§1.4).
3. ✅ Arreglar la fuga de listeners del rate limit (§1.5).
4. ✅ Timeout del stream + **botón de detener** (§1.1, Anexo A).
5. ✅ Renders del streaming a ~16 fps (§1.7).
6. ✅ Eliminar las dos funciones duplicadas (§1.10).
7. ⏳ Bump de versión en un único sitio (§2.6) — de momento se subió a mano en los 3 sitios.

### Sprint 2 — Limpieza (1 sesión)
7. Extraer `transmitirRespuesta()` y borrar las 3 copias (§1.8).
8. Borrar código muerto y CSS muerto (§2.1, §2.2) y el bloque comentado (§2.3).
9. `.gitattributes` + normalización de finales de línea en un PR aparte (§2.4).
10. Optimizar iconos y borrar `icon.jpg` (§2.5).
11. README, .gitignore, schema.sql, CI mínima (§2.8).
12. Corregir la política (AdSense) y añadir borrado de cuenta (§2.9).

### Sprint 3 — Accesibilidad (1 sesión)
13. Viewport sin `maximum-scale`, `aria-label` en los 9 botones, `role="dialog"` + foco en modales, `aria-live` en toast y chat, contraste de `--text-4`, `role="menu"` fuera (§4).

### Sprint 4 — Producto (2–3 sesiones)
14. Títulos + búsqueda de chats (§6.2) y borrar mensaje (§6.3).
15. Variantes de respuesta (§6.4) y export/import de personajes (§6.5).
16. Comunidad: buscar, paginar, reportar (§6.7).
17. `og:`/`twitter:` + `screenshots` del manifest (§6.11).
18. TTS/STT (§6.6) — la actualización que más se nota al usarla.

---

## Anexo A. Detener la generación (implementado en 3.1.2)

Así quedó implementado, por si quieres revisarlo o reutilizarlo:

**1) `enviarAGeminiStream` (index.html:2535).** El controller se publica en una variable de módulo y los timeouts distinguen el motivo:

```js
controller=new AbortController();
abortarGeneracion=controller;
let timeoutId=setTimeout(()=>controller.abort('timeout'),30e4);   // sólo cabeceras
// …tras recibir la respuesta:
clearTimeout(timeoutId);
timeoutId=setTimeout(()=>controller.abort('stall'),90000);        // 90 s sin datos = colgado
```

**2) Traducir el motivo del aborto a un error entendible.** Dos caminos distintos:

- Si el aborto ocurre **conectando**, `fetch` rechaza → se captura en el `catch` del `fetch`.
- Si ocurre **a mitad del stream**, quien rechaza es `reader.read()` (con un `AbortError` o con el propio motivo del aborto) → se captura en el `catch` del bucle de lectura.

```js
const abortado=!!controller.signal.aborted||(err&&err.name==='AbortError')||err==='usuario'||(err&&err.message==='usuario');
if(abortado){
  if(controller.signal.reason==='usuario'){generacionCancelada=true;throw new Error('Generación detenida.')}
  throw new Error('Tiempo de espera agotado. Gemini no respondió a tiempo.')
}
```

Ese segundo `catch` es imprescindible y es fácil de pasar por alto: abortar un `fetch` en curso **no** hace que el `fetch` lance, hace que **el cuerpo** falle.

**3) Botón y estado.** `#chat-stop-btn` se muestra con `empezarGeneracion()` y se oculta con `terminarGeneracion()`, llamadas en los cinco puntos que generan texto (enviar, reintentar, regenerar, editar y continuar). Detener es:

```js
function detenerGeneracion(){ if(abortarGeneracion&&!abortarGeneracion.signal.aborted)abortarGeneracion.abort('usuario'); }
```

**4) Guardar lo ya generado.** `pintarStreaming()` mantiene `streamTextoActual` siempre al día (aunque no repinte), así que al cancelar se puede persistir el parcial:

```js
async function guardarRespuestaParcial(bubble){
  const parcial=String(streamTextoActual||'').trim();
  if(!parcial){ if(bubble)bubble.remove(); showToast('⏹️ Generación detenida'); return; }
  const mensaje=await guardarMensaje(currentChatId,'assistant',parcial);
  // …repinta la burbuja, la añade al historial y la marca como DETENIDA
  motivoIncompletaUltimaGeneracion='DETENIDA';   // aparece «✂️ Continuar respuesta»
  marcarRespuestaIncompleta(mensaje.id);
}
```

**5) El wrapper de continuación automática no debe seguir tras una cancelación.** `enviarAGeminiStream` está envuelto por un bucle que reintenta si el corte fue por `MAX_TOKENS`; se le añadió una guarda al principio de cada vuelta:

```js
for(let vuelta=0;vuelta<=MAX_CONTINUACIONES_AUTO;vuelta++){
  if(generacionCancelada)return;   // el usuario detuvo la generación
```

**6) Motivo nuevo para el aviso.** En `MOTIVOS_RESPUESTA_INCOMPLETA`:

```js
DETENIDA:'⏹️ Respuesta detenida por ti. Puedes continuarla cuando quieras.'
```

**Comportamiento por flujo al detener:** enviar y reintentar **guardan** el parcial ("⏹️ Generación detenida. Se guardó lo que se alcanzó a escribir."); regenerar, editar y continuar **restauran** la conversación como estaba ("⏹️ Generación detenida. La conversación quedó como estaba"), que es lo mismo que hacían ante un error, pero sin pintar un error rojo.

---

## Anexo B. Cómo repetir estas comprobaciones

```bash
# 1. Validación HTML/a11y (69 errores hoy)
npx html-validate index.html

# 2. Sintaxis del script completo (extraído del <script> inline)
node --check app.js

# 3. Funciones duplicadas de nivel superior (el §1.10)
cat > check.js <<'EOF'
const fs=require('fs'), acorn=require('acorn');
const src=fs.readFileSync('app.js','utf8');
const ast=acorn.parse(src,{ecmaVersion:2022,sourceType:'script',locations:true});
const top=[];
for(const n of ast.body){
  if(n.type==='FunctionDeclaration') top.push([n.id.name,n.loc.start.line]);
  if(n.type==='VariableDeclaration') for(const d of n.declarations)
    if(d.id.type==='Identifier' && d.init && ['ArrowFunctionExpression','FunctionExpression'].includes(d.init.type))
      top.push([d.id.name,n.loc.start.line]);
}
const c={}; for(const [n,l] of top)(c[n]=c[n]||[]).push(l);
console.log('declaraciones:',top.length);
for(const [n,ls] of Object.entries(c)) if(ls.length>1) console.log('DUPLICADA:',n,ls.join(', '));
EOF
node check.js

# 4. Finales de línea (deben seguir siendo los de siempre)
grep -c $'\r$' index.html          # → ~2525 CRLF de ~4891 líneas

# 5. Peso real en tránsito
gzip -9 -c index.html | wc -c      # → ~96 KB

# 6. Diagnóstico que ya tiene la app en producción
#    Abre la consola y ejecuta:  sairDiagnostico()
```

Además, durante el Sprint 1 se usaron dos pruebas que conviene conservar:

- **Test funcional del aborto:** extrae `enviarAGeminiStream` con `acorn` y la ejecuta contra un `fetch` simulado (stream que se estanca) comprobando que detener lanza `Generación detenida.`, deja `generacionCancelada=true`, **conserva el texto ya recibido** y libera el controller. 10/10 aserciones.
- **Smoke test de arranque:** carga `index.html` completo en `jsdom` con Supabase simulado y verifica que el script se ejecuta sin excepciones y que el botón de detener se muestra/oculta con el estado de generación.

---

*Auditoría realizada sobre el commit `ac5e6ff` de `main`, con `html-validate`, análisis estático propio (código/CSS sin uso, interpolaciones en atributos HTML, cálculo de contraste WCAG) y lectura de los 5 scripts SQL y del service worker.*

---

## 8. Sprints 2, 3 y 4 aplicados (15/10/2026) — versión 4.0.0 Oficial A

### Variantes de respuesta (estilo Character.AI)

`Regenerar` ya no borra la respuesta: la añade como **versión** y aparece un control `‹ 2/3 ›` en la burbuja. Al **enviar un mensaje nuevo** se fija la versión elegida en todas las respuestas anteriores y se descartan las demás, así que la lista nunca se llena de ramas.

Decisiones de diseño que conviene conocer antes de tocar esto:

| Decisión | Motivo |
|---|---|
| Solo la **última** respuesta acumula versiones | En una respuesta del medio no hay forma de saber cuál queda fijada al seguir la conversación: al continuar, todo lo posterior se descarta y la elección se perdería. En su lugar, regenerar una respuesta antigua recorta la rama como antes. |
| `contenido` se mantiene sincronizado con la versión activa | Resúmenes, Diario de Personajes, exportación y el prompt de Gemini siguen leyendo `contenido` sin saber que existen variantes. |
| `variantesEnNube` con repliegue en `42703` | Sin ejecutar `supabase_variantes_respuesta.sql`, la app detecta que las columnas no existen y sigue funcionando con las variantes en memoria, en lugar de romper la carga del chat. |
| `reemplazar_historial_chat` reescrita | Esa función borra y reinserta todos los mensajes del chat: si no arrastrara `variantes`, cualquier regeneración borraría las versiones guardadas del resto de la conversación. |
| Deshacer con copia profunda (`copiarHistorial`) | Una copia superficial comparte el array de `variantes`; al deshacer un error se habrían perdido las versiones anteriores. Hay una prueba explícita para esto. |
| Tope de 20 versiones | El texto de todas las versiones viaja en `cargarHistorialChat()`. Es un equilibrio entre lo útil y lo que pesa la carga. |

### Lo demás aplicado

- **Sprint 2 (limpieza):** 3 funciones muertas, 23 reglas CSS muertas, 19 líneas de HTML comentado del `settings-modal` (que además duplicaba IDs), `preload="none"` en el audio de error, `.gitattributes`, `.gitignore`, `README.md`, `schema.sql` (el DDL base que faltaba), `robots.txt`, `sitemap.xml` y un workflow de validación.
- **Sprint 3 (accesibilidad):** `maximum-scale` fuera del viewport (bloqueaba el zoom en iOS), 17 botones con nombre accesible, 14 modales como `role="dialog" aria-modal="true"` con `tabindex="-1"`, **gestión de foco al abrir y cerrar** y **trampa de Tab**, región `aria-live` para los anuncios y `--text-4` subido de 3.05:1 a 4.6:1 (AA).
- **Sprint 4 (producto):** títulos de chat automáticos desde el primer mensaje + renombrado con doble clic, buscador en la lista lateral, vista previa del último contenido, y **borrar mensaje**, que usa la función `eliminarMensajeDeChat()` que llevaba escrita desde el principio sin ningún botón que la llamara.

### Verificación

Tres suites ejecutadas sobre el `index.html` real, **76/76 aserciones**:

| Suite | Qué cubre | Aserciones |
|---|---|---|
| `aborbtest` | Extrae `enviarAGeminiStream` con acorn y la ejecuta contra un `fetch` simulado: cancelar a mitad del stream conserva lo recibido, libera el controller y distingue cancelación de error real | 10/10 |
| `variantes.test` | Variantes: navegación con límites, botones desactivados en los extremos, persistencia, fijado de la elegida, copia profunda y `transmitirStream` | 34/34 |
| `integral.test` | Arranque completo en jsdom: funciones expuestas, accesibilidad aplicada, foco de los modales, títulos/búsqueda de chats y botones de eliminar mensaje | 32/32 |

Además: `node --check` ✅, **0 funciones duplicadas** (AST con acorn) y `html-validate` **limpio** con la configuración del repositorio (se pasó de 69 errores a 7, y los 7 restantes están justificados en el README y desactivados con su motivo).

Dos de esos 7 merecen mención porque un validador no puede distinguirlos: el popover de «más opciones» se oculta con `display:none` (sus botones no son alcanzables con Tab, aunque conserven el `aria-hidden`), y `#user-badge` es un `<div role="button">` con soporte de teclado explícito cuya conversión a `<button>` cambiaría el layout del encabezado.
