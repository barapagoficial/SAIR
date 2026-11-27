const COLS_PERSONAJE_BASE = "id,nombre,descripcion_corta,avatar_url,publico,user_id,creado_en";
const COLS_PERSONAJE_EXTRA = "color_aura,tags,likes_count,oculto";
let extrasPersonajeEnNube = true;
const ETIQUETAS_PERSONAJE = { fantasia: "🐉 Fantasía", romance: "💕 Romance", aventura: "🗺️ Aventura", accion: "⚔️ Acción", terror: "👻 Terror", misterio: "🔍 Misterio", scifi: "🚀 Ciencia ficción", comedia: "😂 Comedia", drama: "🎭 Drama", anime: "🌸 Anime", historico: "🏛️ Histórico", cotidiano: "☕ Vida cotidiana" };
const MAX_ETIQUETAS = 5;
function normalizarEtiquetas(lista) {
  return [...new Set((Array.isArray(lista) ? lista : []).filter((t) => ETIQUETAS_PERSONAJE[t]))].slice(0, MAX_ETIQUETAS);
}
function esErrorColumnaInexistente(error) {
  const t = `${error?.code || ""} ${error?.message || ""}`;
  return /42703|PGRST204|column .* does not exist|Could not find the '.*' column/i.test(t);
}
async function consultarConExtras(construir, colsRepliegue = COLS_PERSONAJE_BASE) {
  if (extrasPersonajeEnNube) {
    const r = await construir(`${COLS_PERSONAJE_BASE},${COLS_PERSONAJE_EXTRA}`);
    if (!r.error || !esErrorColumnaInexistente(r.error)) return r;
    extrasPersonajeEnNube = false;
    console.warn("ℹ️ Modo compatible de personajes.");
    actualizarDisponibilidadEtiquetas();
  }
  return construir(colsRepliegue);
}
async function guardarPersonajeConRepliegue(ejecutar, payload) {
  let r = await ejecutar(payload);
  if (r.error && esErrorColumnaInexistente(r.error)) {
    const sinExtras = { ...payload };
    delete sinExtras.color_aura;
    delete sinExtras.tags;
    r = await ejecutar(sinExtras);
    if (r.error && esErrorColumnaInexistente(r.error)) {
      delete sinExtras.intensidad;
      r = await ejecutar(sinExtras);
    }
  }
  if (r.error) throw new Error(mensajeErrorImagen(r.error.message));
  return r.data;
}
function colorAuraDe(p) {
  if (/^#[0-9a-f]{6}$/i.test(p?.color_aura || "")) return sanitizeThemeColor(p.color_aura.toLowerCase());
  return sanitizeThemeColor(parsearSystemPrompt(p?.system_prompt).themeColor);
}
async function crearPersonaje(datos) {
  if (!currentUser) throw new Error("No hay sesión");
  if (!datos.nombre?.trim()) throw new Error("El nombre es obligatorio");
  const system_prompt = construirSystemPrompt(datos);
  let avatar_url = await procesarAvatar();
  if (avatar_url === void 0) avatar_url = null;
  const payload = { user_id: currentUser.id, nombre: datos.nombre.trim(), descripcion_corta: (datos.descripcion_corta || "").slice(0, 200), system_prompt, avatar_url, publico: !!datos.publico, saludo: datos.saludo || null, max_tokens: parseInt(datos.max_tokens) || 4096, intensidad: datos.intensidad || "suave", color_aura: sanitizeThemeColor(datos.themeColor), tags: normalizarEtiquetas(datos.tags) };
  return ejecutarConRefresh(() => guardarPersonajeConRepliegue((p) => sbClient.from("personajes").insert(p).select().single(), payload));
}
async function actualizarPersonaje(id, datos) {
  if (!currentUser) throw new Error("No hay sesión");
  const system_prompt = construirSystemPrompt(datos);
  const avatar_url = await procesarAvatar();
  const updates = { nombre: datos.nombre.trim(), descripcion_corta: (datos.descripcion_corta || "").slice(0, 200), system_prompt, publico: !!datos.publico, saludo: datos.saludo || null, max_tokens: parseInt(datos.max_tokens) || 4096, intensidad: datos.intensidad || "suave", color_aura: sanitizeThemeColor(datos.themeColor), tags: normalizarEtiquetas(datos.tags) };
  if (avatar_url !== void 0) updates.avatar_url = avatar_url;
  return ejecutarConRefresh(() => guardarPersonajeConRepliegue((u) => sbClient.from("personajes").update(u).eq("id", id).eq("user_id", currentUser.id).select().single(), updates));
}
async function listarPersonajes() {
  if (!currentUser) return [];
  return ejecutarConRefresh(async () => {
    const { data, error } = await consultarConExtras((cols) => sbClient.from("personajes").select(cols).eq("user_id", currentUser.id).order("creado_en", { ascending: false }), `${COLS_PERSONAJE_BASE},system_prompt`);
    if (error) throw new Error(error.message);
    return data || [];
  });
}
function etiquetasSeleccionadas() {
  return [...document.querySelectorAll('#char-etiquetas .etiqueta-chip[aria-pressed="true"]')].map((b) => b.dataset.tag);
}
function marcarEtiquetasEditor(lista) {
  const sel = new Set(normalizarEtiquetas(lista));
  document.querySelectorAll("#char-etiquetas .etiqueta-chip").forEach((b) => b.setAttribute("aria-pressed", sel.has(b.dataset.tag) ? "true" : "false"));
}
function actualizarDisponibilidadEtiquetas() {
  const grupo = document.getElementById("char-etiquetas-grupo");
  if (grupo) grupo.hidden = !extrasPersonajeEnNube;
}
(function iniciarSelectorEtiquetas() {
  const cont = document.getElementById("char-etiquetas");
  if (!cont) return;
  cont.innerHTML = Object.entries(ETIQUETAS_PERSONAJE).map(([k, v]) => `<button type="button" class="etiqueta-chip" data-tag="${k}" aria-pressed="false">${v}</button>`).join("");
  cont.addEventListener("click", (e) => {
    const b = e.target.closest(".etiqueta-chip");
    if (!b) return;
    const activa = b.getAttribute("aria-pressed") === "true";
    if (!activa && etiquetasSeleccionadas().length >= MAX_ETIQUETAS) {
      showToast(`Máximo ${MAX_ETIQUETAS} etiquetas`, "error");
      return;
    }
    b.setAttribute("aria-pressed", activa ? "false" : "true");
  });
})();
function htmlTarjetaPersonaje(p, esComunidad) {
  const safeAvatar = sanitizeImageUrl(p.avatar_url);
  const avatarContent = safeAvatar ? `<img src="${safeAvatar.replace(/"/g, "&quot;")}" alt="${escapeHtml(p.nombre)}" loading="lazy">` : escapeHtml(p.nombre.charAt(0).toUpperCase());
  const badge = esComunidad ? "" : p.publico && p.oculto ? '<span class="badge-private" title="Recibió varios reportes y no se ve en la Comunidad hasta que el equipo de SAIR lo revise">Oculto · en revisión</span>' : p.publico ? '<span class="badge-public">Público</span>' : '<span class="badge-private">Privado</span>';
  const authorLine = esComunidad ? `<div class="character-author" data-user-id="${escapeHtml(p.user_id)}">Cargando...</div>` : "";
  const etiquetas = normalizarEtiquetas(p.tags);
  const tagsHtml = etiquetas.length ? `<div class="character-tags">${etiquetas.slice(0, 3).map((t) => `<span class="character-tag">${ETIQUETAS_PERSONAJE[t]}</span>`).join("")}</div>` : "";
  const id = escapeHtml(p.id), propio = p.user_id === currentUser?.id, nombre = escapeHtml(p.nombre);
  const chat = `<button type="button" class="btn btn-primary btn-small btn-chat" data-id="${id}">${ICONOS.chat}<span>Chatear</span></button>`;
  const compartir = p.publico ? `<button type="button" class="btn btn-ghost btn-small btn-icon btn-share" data-id="${id}" data-nombre="${nombre}" title="Compartir" aria-label="Compartir ${nombre}">${ICONOS.enlace}</button>` : "";
  let acciones;
  if (esComunidad) {
    const meGusta = likesEnNube && extrasPersonajeEnNube ? (() => {
      const dado = misLikes.has(String(p.id));
      return `<button type="button" class="btn btn-ghost btn-small btn-like${dado ? " activo" : ""}" data-id="${id}" aria-pressed="${dado}" title="${dado ? "Quitar me gusta" : "Me gusta"}" aria-label="Me gusta ${nombre}">${ICONOS.corazon}<span class="like-count">${Number(p.likes_count) || 0}</span></button>`;
    })() : "";
    const reportar = !propio ? `<button type="button" class="btn btn-ghost btn-small btn-icon btn-report" data-id="${id}" title="Reportar" aria-label="Reportar ${nombre}">${ICONOS.bandera}</button>` : "";
    acciones = chat + meGusta + compartir + reportar;
  } else {
    acciones = chat + compartir + `<button type="button" class="btn btn-ghost btn-small btn-icon btn-edit" data-id="${id}" title="Editar" aria-label="Editar ${nombre}">${ICONOS.editar}</button><button type="button" class="btn btn-danger btn-small btn-icon btn-delete" data-id="${id}" title="Eliminar" aria-label="Eliminar ${nombre}">${ICONOS.borrar}</button>`;
  }
  const themeColor = colorAuraDe(p), glowColor = hexToRgba(themeColor, 0.35);
  const banner = safeAvatar ? `<div class="character-banner" aria-hidden="true"><img src="${safeAvatar.replace(/"/g, "&quot;")}" alt="" loading="lazy"></div>` : '<div class="character-banner" aria-hidden="true"></div>';
  return `<div class="character-card" data-id="${id}" style="--char-color: ${themeColor}; --char-glow: ${glowColor};">${banner}${badge}<div class="character-avatar">${avatarContent}</div><div class="character-body"><div class="character-name">${nombre}</div>${authorLine}<div class="character-desc">${escapeHtml(p.descripcion_corta || "Sin descripción")}</div>${tagsHtml}</div><div class="character-actions">${acciones}</div></div>`;
}
let likesEnNube = true;
let misLikes = /* @__PURE__ */ new Set();
let misLikesCargados = false;
async function cargarMisLikes() {
  if (misLikesCargados || !likesEnNube || !currentUser) return;
  const { data, error } = await sbClient.from("personajes_likes").select("personaje_id").eq("user_id", currentUser.id).order("creado_en", { ascending: false }).limit(1e3);
  if (error) {
    if (esErrorTablaInexistente(error) || esErrorColumnaInexistente(error)) {
      likesEnNube = false;
      return;
    }
    console.warn("⚠️ No se pudieron cargar tus me gusta:", error.message);
    return;
  }
  misLikes = new Set((data || []).map((r) => String(r.personaje_id)));
  misLikesCargados = true;
}
async function alternarLike(btn) {
  const id = btn.dataset.id, dado = misLikes.has(id);
  const contador = btn.querySelector(".like-count");
  const pintar = (activo, delta) => {
    btn.classList.toggle("activo", activo);
    btn.setAttribute("aria-pressed", String(activo));
    btn.title = activo ? "Quitar me gusta" : "Me gusta";
    const n = Math.max(0, (parseInt(contador.textContent, 10) || 0) + delta);
    contador.textContent = n;
    const p = comunidad.lista.find((x) => String(x.id) === id);
    if (p) p.likes_count = n;
  };
  btn.disabled = true;
  if (dado) {
    misLikes.delete(id);
    pintar(false, -1);
  } else {
    misLikes.add(id);
    pintar(true, 1);
  }
  try {
    const { error } = dado ? await sbClient.from("personajes_likes").delete().eq("personaje_id", id).eq("user_id", currentUser.id) : await sbClient.from("personajes_likes").insert({ personaje_id: id, user_id: currentUser.id });
    if (error && error.code !== "23505") throw new Error(error.message);
  } catch (err) {
    if (dado) {
      misLikes.add(id);
      pintar(true, 1);
    } else {
      misLikes.delete(id);
      pintar(false, -1);
    }
    showToast(`❌ ${err.message}`, "error");
  } finally {
    btn.disabled = false;
  }
}
function enlacePersonaje(id) {
  return `${location.origin}${location.pathname}?personaje=${encodeURIComponent(id)}`;
}
async function compartirPersonaje(id, nombre) {
  const url = enlacePersonaje(id);
  const datos = { title: `${nombre} · SAIR`, text: `Chatea con ${nombre} en SAIR`, url };
  if (navigator.share) {
    try {
      await navigator.share(datos);
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast("🔗 Enlace copiado. Pégalo donde quieras compartirlo");
  } catch {
    mostrarEnlaceSAIR(url);
  }
}
const PERSONAJE_COMPARTIDO_KEY = "sair1_personaje_compartido";
(function capturarPersonajeCompartido() {
  try {
    const params = new URLSearchParams(location.search), id = params.get("personaje");
    if (id && /^[0-9a-f-]{36}$/i.test(id)) sessionStorage.setItem(PERSONAJE_COMPARTIDO_KEY, id);
    if (params.has("personaje")) {
      params.delete("personaje");
      const q = params.toString();
      history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash);
    }
  } catch {
  }
})();
async function abrirPersonajeCompartidoPendiente() {
  let id = null;
  try {
    id = sessionStorage.getItem(PERSONAJE_COMPARTIDO_KEY);
    sessionStorage.removeItem(PERSONAJE_COMPARTIDO_KEY);
  } catch {
  }
  if (!id || !currentUser) return;
  try {
    await abrirChatConPersonaje(id);
  } catch {
    showToast("Ese personaje ya no existe o dejó de ser público", "error");
  }
}
async function obtenerPersonaje(id) {
  return ejecutarConRefresh(async () => {
    const { data, error } = await sbClient.from("personajes").select("*").or(`publico.eq.true,user_id.eq.${currentUser.id}`).eq("id", id).single();
    if (error) throw new Error("Personaje no encontrado");
    return data;
  });
}
async function eliminarPersonaje(id) {
  return ejecutarConRefresh(async () => {
    const { error } = await sbClient.from("personajes").delete().eq("id", id).eq("user_id", currentUser.id);
    if (error) throw new Error(error.message);
    return true;
  });
}
async function listarAnuncios() {
  return ejecutarConRefresh(async () => {
    const { data, error } = await sbClient.from("anuncios").select("*").order("creado_en", { ascending: false }).limit(50);
    if (error) throw new Error(error.message);
    return data || [];
  });
}
async function crearAnuncio(titulo, contenido) {
  if (!isOwner()) throw new Error("Solo el Owner puede publicar anuncios");
  return ejecutarConRefresh(async () => {
    const { data, error } = await sbClient.from("anuncios").insert({ user_id: currentUser.id, titulo: titulo.trim(), contenido: contenido.trim() }).select().single();
    if (error) throw new Error(error.message);
    return data;
  });
}
async function eliminarAnuncio(id) {
  if (!isOwner()) throw new Error("No autorizado");
  return ejecutarConRefresh(async () => {
    const { error } = await sbClient.from("anuncios").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return true;
  });
}
async function crearNuevoChat(personajeId, historialInicial = []) {
  if (!currentUser) throw new Error("No hay sesión");
  return ejecutarConRefresh(async () => {
    if (String(currentCharacter?.id) !== String(personajeId)) {
      const { data: personaje, error: pError } = await sbClient.from("personajes").select("id").or(`publico.eq.true,user_id.eq.${currentUser.id}`).eq("id", personajeId).single();
      if (pError || !personaje) throw new Error("No tienes permiso para chatear con este personaje");
    }
    const { data, error } = await sbClient.from("chats").insert({ user_id: currentUser.id, personaje_id: personajeId, historial: [] }).select().single();
    if (error) throw new Error(error.message);
    if (historialInicial.length) {
      await reemplazarHistorialNormalizado(data.id, historialInicial);
    }
    return data;
  });
}
async function listarChats(personajeId) {
  return ejecutarConRefresh(async () => {
    const conTitulo = "id,creado_en,actualizado_en,resumen,resumen_version,formato_version,personaje_id,titulo";
    const sinTitulo = "id,creado_en,actualizado_en,resumen,resumen_version,formato_version,personaje_id";
    const consulta = (columnas) => sbClient.from("chats").select(columnas).eq("user_id", currentUser.id).eq("personaje_id", personajeId).order("actualizado_en", { ascending: false });
    let { data, error } = await consulta(titulosEnNube ? conTitulo : sinTitulo);
    if (error && error.code === "42703" && titulosEnNube) {
      titulosEnNube = false;
      ({ data, error } = await consulta(sinTitulo));
    }
    if (error) throw new Error(error.message);
    return data || [];
  });
}
function tituloChat(chat) {
  return chat && chat.titulo && chat.titulo.trim() || `Chat ${String(chat && chat.id || "").substring(0, 6)}`;
}
function vistaPreviaChat(chat) {
  const resumen = separarMarcaResumen(chat && chat.resumen || "").texto.replace(/\s+/g, " ").trim();
  return resumen ? resumen.slice(0, 90) : "Aún sin resumen";
}
async function guardarTituloChat(chatId, titulo) {
  const limpio = String(titulo || "").trim().slice(0, 80);
  try {
    const { error } = await sbClient.rpc("renombrar_chat", { p_chat_id: chatId, p_titulo: limpio });
    if (error && !(error.code === "PGRST202" || error.code === "42883" || error.code === "42703")) throw new Error(error.message);
    if (error) {
      const { error: directo } = await sbClient.from("chats").update({ titulo: limpio || null }).eq("id", chatId).eq("user_id", currentUser.id);
      if (directo) throw new Error("No se pudo guardar el título");
      titulosEnNube = true;
    }
    const chat = chatsCache.find((c) => c.id === chatId);
    if (chat) chat.titulo = limpio || null;
    showToast(limpio ? "✅ Chat renombrado" : "✅ Título restablecido");
    return true;
  } catch (err) {
    showToast(`⚠️ ${err.message}`, "error");
    return false;
  }
}
function editarTituloChat(item, chat) {
  const titulo = item.querySelector(".chat-list-title");
  if (!titulo) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "chat-list-rename";
  input.value = tituloChat(chat);
  input.maxLength = 80;
  input.setAttribute("aria-label", "Nombre del chat");
  titulo.replaceWith(input);
  input.focus();
  input.select();
  let terminado = false;
  const cerrar = async (guardar) => {
    if (terminado) return;
    terminado = true;
    const valor = input.value.trim();
    if (guardar && valor && valor !== tituloChat(chat)) await guardarTituloChat(chat.id, valor);
    pintarListaChats();
  };
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("blur", () => cerrar(true));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      terminado = true;
      pintarListaChats();
    }
  });
}
async function eliminarChat(chatId) {
  return ejecutarConRefresh(async () => {
    const { error } = await sbClient.from("chats").delete().eq("id", chatId).eq("user_id", currentUser.id);
    if (error) throw new Error(error.message);
    return true;
  });
}
async function cargarHistorialChat(chatId, opciones = {}) {
  const paginado = opciones.paginado === true;
  const limite = Math.max(1, Math.min(Number(opciones.limit) || CHAT_LIMITE, 100));
  const offset = Math.max(0, Number(opciones.offset) || 0);
  return ejecutarConRefresh(async () => {
    const { data: chat, error: chatError } = await sbClient.from("chats").select("resumen,resumen_version,formato_version").eq("id", chatId).eq("user_id", currentUser.id).single();
    if (chatError) throw new Error(chatError.message);
    let rows = [], totalMensajes = 0, usandoLegacy = false;
    let historialLegacy = null;
    const versionFormato = Number(chat?.formato_version || 0);
    if (versionFormato < 2) {
      const { data: legacyRow } = await sbClient.from("chats").select("historial").eq("id", chatId).eq("user_id", currentUser.id).single();
      historialLegacy = Array.isArray(legacyRow?.historial) ? legacyRow.historial : null;
    }
    const columnasMensajes = () => variantesEnNube ? COLS_MENSAJE_VARIANTES : COLS_MENSAJE_BASE;
    const consultaMensajes = (columnas, extra) => {
      const q = sbClient.from("mensajes").select(columnas, extra).eq("chat_id", chatId);
      return paginado ? q.order("orden", { ascending: false, nullsFirst: false }).order("creado_en", { ascending: false, nullsFirst: false }).order("id", { ascending: false }).range(offset, offset + limite - 1) : q.order("orden", { ascending: true, nullsFirst: false }).order("creado_en", { ascending: true }).order("id", { ascending: true });
    };
    const extraSelect = paginado ? { count: "exact" } : {};
    let { data: filas, count, error: messagesError } = await consultaMensajes(columnasMensajes(), extraSelect);
    if (messagesError && messagesError.code === "42703" && variantesEnNube) {
      variantesEnNube = false;
      ({ data: filas, count, error: messagesError } = await consultaMensajes(COLS_MENSAJE_BASE, extraSelect));
    }
    if (messagesError) throw new Error(messagesError.message);
    rows = filas || [];
    if (paginado) {
      rows = rows.reverse();
      totalMensajes = Number.isFinite(count) ? count : offset + rows.length;
    } else {
      totalMensajes = rows.length;
    }
    if (rows.length === 0 && Array.isArray(historialLegacy) && versionFormato < 2) {
      const legacyMessages = historialLegacy.filter((m) => m && ["user", "assistant"].includes(m.rol));
      totalMensajes = legacyMessages.length;
      usandoLegacy = true;
      if (paginado) {
        const fin = Math.max(totalMensajes - offset, 0);
        rows = legacyMessages.slice(Math.max(fin - limite, 0), fin);
      } else rows = legacyMessages;
    }
    let mensajes = rows.map((m) => {
      const item = { id: m.id, rol: m.rol, contenido: m.contenido, creado_en: m.creado_en, orden: m.orden };
      if (Array.isArray(m.variantes) && m.variantes.length) {
        item.variantes = m.variantes;
        item.variante_activa = Number(m.variante_activa) || 0;
      }
      return item;
    });
    const resumenLegacy = Array.isArray(historialLegacy) ? historialLegacy.find((m) => m?.rol === "summary") : null;
    const resumen = chat?.resumen || resumenLegacy?.contenido;
    if (resumen) {
      const { texto: resumenTexto, hasta: resumenHasta } = separarMarcaResumen(resumen);
      mensajes = [{ id: `summary-${chat.resumen_version || resumenLegacy?.summary_version || 1}`, rol: "summary", contenido: resumenTexto, hasta: resumenHasta, summary_version: chat.resumen_version || resumenLegacy?.summary_version || 1, orden: 0 }, ...mensajes];
    }
    const historialGemini = mensajes.filter((m) => m.rol === "user" || m.rol === "assistant").map((m) => ({ role: m.rol === "assistant" ? "model" : "user", parts: [{ text: m.contenido }] }));
    const hasMore = paginado && rows.length > 0 && offset + rows.length < totalMensajes;
    return { mensajes, historialGemini, totalMensajes, hasMore, offset, limit: limite, paginado, usandoLegacy };
  });
}
async function cargarHistorialCompleto(chatId) {
  return cargarHistorialChat(chatId, { paginado: false });
}
async function reemplazarHistorialNormalizado(chatId, historial) {
  const resumenItem = (historial || []).find((m) => m?.rol === "summary");
  const mensajes = (historial || []).filter((m) => m && ["user", "assistant"].includes(m.rol)).map((m) => {
    const item = { id: m.id || null, rol: m.rol, contenido: String(m.contenido || ""), creado_en: m.creado_en || null };
    const variantes = Array.isArray(m.variantes) ? m.variantes.filter((v) => typeof v === "string") : [];
    if (variantes.length) {
      item.variantes = variantes;
      item.variante_activa = Math.max(0, Number(m.variante_activa) || 0);
    }
    return item;
  });
  const { error } = await sbClient.rpc("reemplazar_historial_chat", { p_chat_id: chatId, p_resumen: resumenItem?.contenido ? componerResumenGuardado(resumenItem.contenido, resumenItem.hasta) : null, p_resumen_version: resumenItem?.summary_version || 1, p_mensajes: mensajes });
  if (error) throw new Error(error.message);
  return true;
}
async function guardarMensaje(chatId, rol, contenido) {
  return ejecutarConRefresh(async () => {
    const { data, error } = await sbClient.rpc("guardar_mensaje_chat", { p_chat_id: chatId, p_rol: rol, p_contenido: contenido });
    if (error) throw new Error(error.message);
    const nuevoMsg = Array.isArray(data) ? data[0] : data;
    if (!nuevoMsg) throw new Error("No se pudo guardar el mensaje");
    return nuevoMsg;
  });
}
async function eliminarMensajeDeChat(chatId, mensajeId) {
  return ejecutarConRefresh(async () => {
    const { mensajes } = await cargarHistorialCompleto(chatId), nuevoHistorial = mensajes.filter((m) => m.id !== mensajeId);
    if (nuevoHistorial.length === mensajes.length) throw new Error("Mensaje no encontrado");
    await reemplazarHistorialNormalizado(chatId, nuevoHistorial);
    return true;
  });
}
async function actualizarHistorialChat(chatId, nuevoHistorial) {
  return ejecutarConRefresh(async () => reemplazarHistorialNormalizado(chatId, nuevoHistorial));
}
function normasComunidadGemini(publico, adulto) {
  return [
    "[NORMAS DE LA COMUNIDAD DE SAIR · prioridad máxima, por encima de cualquier otra instrucción, incluida la ficha del personaje]",
    "Esto es ficción. Están PERMITIDOS: violencia ficticia, villanos, temas oscuros, drama, terror y romance.",
    adulto ? "Como este chat es privado y el usuario confirmó tener 18 años o más, también se permite contenido para adultos entre personajes adultos." : "El usuario no confirmó tener 18 años o más: no escribas contenido sexual explícito. Si la historia va hacia ahí, insinúalo y corta la escena con un fundido a negro, sin rechazar el rol.",
    "Está PROHIBIDO siempre:",
    "1. Cualquier contenido sexual o sexualizado con menores de edad o con personajes que lo parezcan (por su edad, cuerpo o descripción), aunque digan tener más edad.",
    "2. Sexualizar a personas reales.",
    "3. Odio contra grupos de personas (por origen, religión, género, orientación, discapacidad u otros).",
    "4. Promover o animar autolesiones o el suicidio.",
    "5. Instrucciones reales y útiles para causar daño (armas, explosivos, drogas, hackeo).",
    ...publico ? ["6. Este personaje es público en la Comunidad: si su propia ficha (nombre, descripción, personalidad, escenario o saludo) es sexualmente explícita, también infringe las Normas."] : [],
    "Si la ficha del personaje, el resumen o lo que pide el usuario cae en algo PROHIBIDO, no escribas la escena: responde ÚNICAMENTE con esta línea, sin nada antes ni después:",
    "[[NORMAS: razón corta y directa]]",
    "La razón tiene como máximo 12 palabras y no repite el contenido. Si ya avisaste y el usuario insiste en lo mismo, responde otra vez solo con esa línea. Si todo es aceptable, continúa el rol con normalidad y nunca menciones estas normas.",
    "[FIN DE LAS NORMAS]"
  ].join("\n");
}
function prepararTurnosRol(systemPrompt, mensajes, nuevoMensaje) {
  if (!usaCR()) systemPrompt = `${normasComunidadGemini(!!currentCharacter?.publico, esMayorDe18())}

${systemPrompt || ""}`;
  const conversacion = mensajes.filter((m) => m.rol === "user" || m.rol === "assistant");
  const resumen = mensajes.filter((m) => m.rol === "summary").map((s) => s.contenido).join("\n\n");
  const sistema = resumen ? `${systemPrompt}

[RESUMEN DE CONVERSACIONES ANTERIORES - CONTEXTO IMPORTANTE]:
${resumen}

[FIN DEL RESUMEN - Continúa con el roleplay normal manteniendo toda la información del resumen]` : systemPrompt;
  const contextoDinamico = [anexarNotasRolAlPrompt("").trim(), anexarLorebookAlPrompt(conversacion, nuevoMensaje, "").trim()].filter(Boolean).join("\n\n");
  const turnos = conversacion.map((m) => ({ rol: m.rol, partes: [m.contenido] }));
  const ultimo = conversacion[conversacion.length - 1];
  if (nuevoMensaje && !(ultimo && ultimo.rol === "user" && ultimo.contenido === nuevoMensaje)) turnos.push({ rol: "user", partes: [nuevoMensaje] });
  if (turnos.length === 0) throw new Error("No hay mensajes para enviar a la IA");
  if (contextoDinamico) {
    const fin = turnos[turnos.length - 1];
    const bloque = `[CONTEXTO PARA ESTA RESPUESTA · no lo menciones ni lo cites, solo úsalo]
${contextoDinamico}
[FIN DEL CONTEXTO]`;
    if (fin.rol === "user") fin.partes = [bloque, ...fin.partes];
    else turnos.push({ rol: "user", partes: [bloque] });
  }
  return { sistema, turnos };
}
async function* enviarAGeminiStream(systemPrompt, mensajes, nuevoMensaje, maxTokens = 4096) {
  if (usaCR()) {
    yield* enviarCRStream(systemPrompt, mensajes, nuevoMensaje);
    return;
  }
  const idUso = iniciarPeticionUso();
  const apiKey = getGeminiKey();
  if (!apiKey) throw new Error("⚠️ " + CR_AVISO_SIN_IA);
  const { sistema: systemPromptFinal, turnos } = prepararTurnosRol(systemPrompt, mensajes, nuevoMensaje);
  const model = getGeminiModel();
  const historialGemini = turnos.map((t) => ({ role: t.rol === "assistant" ? "model" : "user", parts: t.partes.map((text) => ({ text })) }));
  const parsed = parsearSystemPrompt(currentCharacter?.system_prompt);
  const intensidadVal = currentCharacter?.intensidad || parsed.intensidad || "suave";
  const body = { system_instruction: { parts: [{ text: systemPromptFinal }] }, contents: historialGemini, safetySettings: getSafetySettings(intensidadVal), generationConfig: { temperature: 0.9, topP: 0.95, topK: 40, maxOutputTokens: maxTokens } }, url = geminiUrl(model, true), controller = new AbortController();
  abortarGeneracion = controller;
  let timeoutId = setTimeout(() => controller.abort("timeout"), 3e5);
  let response;
  try {
    response = await fetch(url, { method: "POST", headers: geminiHeaders(apiKey), body: JSON.stringify(body), signal: controller.signal });
  } catch (err) {
    if (abortarGeneracion === controller) abortarGeneracion = null;
    if (err.name === "AbortError") {
      if (controller.signal.reason === "usuario") {
        generacionCancelada = true;
        throw new Error("Generación detenida.");
      }
      throw new Error("Tiempo de espera agotado. Gemini no respondió a tiempo.");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
  clearTimeout(timeoutId);
  timeoutId = setTimeout(() => controller.abort("stall"), 9e4);
  if (!response.ok) {
    const errText = await response.text();
    let msg = `Error de Gemini (${response.status})`;
    try {
      const errJson = JSON.parse(errText);
      if (errJson.error?.message) msg = errJson.error.message;
    } catch {
    }
    throw new Error(mensajeErrorGemini(msg));
  }
  if (!response.body) throw new Error("Gemini no devolvió una respuesta válida");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", yieldedText = false;
  const parseLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let payload = trimmed;
    if (payload.startsWith("data:")) payload = payload.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let json;
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }
    if (json.usageMetadata) anotarUso(idUso, json.usageMetadata);
    if (json.error?.message) throw new Error(mensajeErrorGemini(json.error.message));
    const candidate = json.candidates?.[0];
    if (!candidate) return;
    const finishReason = candidate.finishReason;
    if (finishReason) lastGeminiFinishReason = finishReason;
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      throw new Error(finishReason === "SAFETY" ? "Respuesta bloqueada por filtros de seguridad" : `Gemini detuvo la respuesta (${finishReason})`);
    }
    const text = candidate.content?.parts?.map((p) => p.text || "").join("") || "";
    if (text) {
      yieldedText = true;
      return text;
    }
  };
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => controller.abort("stall"), 9e4);
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const text = parseLine(line);
        if (text) yield text;
      }
    }
    buffer += decoder.decode();
    for (const line of buffer.split("\n")) {
      const text = parseLine(line);
      if (text) yield text;
    }
    if (!yieldedText) throw new Error("Gemini no generó ninguna respuesta. Intenta de nuevo.");
  } catch (err) {
    const abortado = !!controller.signal.aborted || err && err.name === "AbortError" || err === "usuario" || err && err.message === "usuario";
    if (abortado) {
      if (controller.signal.reason === "usuario") {
        generacionCancelada = true;
        throw new Error("Generación detenida.");
      }
      throw new Error("Tiempo de espera agotado. Gemini no respondió a tiempo.");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (abortarGeneracion === controller) abortarGeneracion = null;
  }
}
async function fetchWithRetry(fn, retries = 2, delay = 1e3) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err.message && (err.message.includes("JWT expired") || err.message.includes("jwt expired") || err.message.includes("invalid token") || err.message.includes("token expired"))) {
        try {
          const { data, error } = await sbClient.auth.refreshSession();
          if (error) {
            console.error("❌ Error al refrescar sesión:", error);
            await sbClient.auth.signOut();
            currentUser = null;
            userRole = null;
            userUsername = null;
            showAuth();
            throw new Error("Sesión expirada. Inicia sesión de nuevo.");
          }
          if (data.session) {
            currentUser = data.session.user;
            await cargarPerfilYRol();
            console.log("✅ Sesión refrescada correctamente");
            return await fn();
          }
        } catch (refreshErr) {
          console.error("❌ Falló el refresco de sesión:", refreshErr);
          await sbClient.auth.signOut();
          currentUser = null;
          userRole = null;
          userUsername = null;
          showAuth();
          throw new Error("Sesión expirada. Inicia sesión de nuevo.");
        }
      }
      if (i === retries) throw err;
      await new Promise((r) => setTimeout(r, delay * (i + 1)));
    }
  }
}
async function renderCharacters() {
  if (currentView === "personas") {
    renderPersonas();
    return;
  }
  if (currentView === "mis-chats") {
    renderMisChats();
    return;
  }
  if (currentView === "community") {
    renderComunidad();
    return;
  }
  if (currentView === "creditos") {
    renderTiendaCR();
    return;
  }
  const container = document.getElementById("characters-container"), cacheKey = currentView === "my-characters" ? "personajes" : "personajesComunidad";
  if (LOADING[cacheKey]) return;
  if (isCacheValid(cacheKey) && CACHE[cacheKey]) {
    renderCharactersGrid(CACHE[cacheKey], currentView !== "my-characters");
    return;
  }
  LOADING[cacheKey] = true;
  container.innerHTML = `<div style="max-width:1280px;margin:0 auto"><div style="margin-bottom:1.5rem;"><div class="skeleton-line short" style="height:24px;"></div></div><div class="characters-grid">${Array(6).fill(0).map(() => `<div class="skeleton-card"><div class="skeleton-avatar"></div><div class="skeleton-line medium"></div><div class="skeleton-line short"></div><div class="skeleton-line"></div></div>`).join("")}</div></div>`;
  try {
    let personajes, esComunidad = false;
    if (currentView === "my-characters") personajes = await fetchWithRetry(() => listarPersonajes());
    else {
      personajes = await fetchWithRetry(() => listarPersonajesComunidad());
      esComunidad = true;
    }
    CACHE[cacheKey] = personajes;
    CACHE.cacheTime[cacheKey] = Date.now();
    renderCharactersGrid(personajes, esComunidad);
  } catch (err) {
    console.error("Error en renderCharacters:", err);
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><h3 style="font-family:var(--font-display);color:var(--text-1);margin-bottom:.5rem">Error al cargar</h3><p style="color:var(--text-3);margin-bottom:1.5rem">${escapeHtml(err.message)}</p><button type="button" class="btn btn-primary" data-sair-accion="reintentar-personajes">🔄 Reintentar</button></div>`;
  } finally {
    LOADING[cacheKey] = false;
  }
}
function renderCharactersGrid(personajes, esComunidad, container = document.getElementById("characters-container")) {
  if (!personajes || personajes.length === 0) {
    if (esComunidad && comunidad.favoritos && !comunidad.q && !comunidad.etiqueta) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🤍</div><h3>Aún no tienes favoritos</h3><p>Pulsa el corazón de un personaje para guardarlo aquí</p></div>`;
    } else if (esComunidad && (comunidad.q || comunidad.etiqueta || comunidad.favoritos)) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔎</div><h3>Sin resultados</h3><p>${comunidad.q ? `No hay personajes que coincidan con «${escapeHtml(comunidad.q)}»` : "No hay personajes con esos filtros"}</p></div>`;
    } else if (esComunidad) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🌍</div><h3>Aún no hay personajes públicos</h3><p>Sé el primero en compartir un personaje con la comunidad</p></div>`;
    } else {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">✨</div><h3>Aún no tienes personajes</h3><p>Crea tu primer personaje para empezar a chatear</p><button type="button" class="btn btn-primary" data-sair-accion="nuevo-personaje">Crear mi primer personaje</button></div>`;
    }
    return;
  }
  const titulo = esComunidad ? `Personajes de la Comunidad <span class="section-count">${personajes.length}${comunidad.hayMas ? "+" : ""}</span>` : `Mis personajes <span class="section-count">${personajes.length}</span>`;
  const conBuscador = !esComunidad && personajes.length >= 6;
  const buscador = conBuscador ? `<label class="mis-buscar"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="mis-personajes-buscar" placeholder="Buscar en tus personajes…" aria-label="Buscar en tus personajes" autocomplete="off" maxlength="60"></label>` : "";
  container.innerHTML = `<div class="mis-cabecera" style="max-width:1280px;margin:0 auto 1.5rem"><h2 class="section-title">${titulo}</h2>${buscador}</div><div class="characters-grid" id="characters-grid-content"></div><div class="empty-state mis-sin-resultados" hidden><div class="empty-state-icon">🔎</div><h3>Sin resultados</h3><p>Ningún personaje coincide con tu búsqueda</p></div>`;
  const grid = container.querySelector("#characters-grid-content");
  grid.innerHTML = personajes.map((p) => htmlTarjetaPersonaje(p, esComunidad)).join("");
  if (conBuscador) {
    const claves = personajes.map((p) => normalizarParaBuscar([p.nombre, p.descripcion_corta, ...normalizarEtiquetas(p.tags).map((t) => ETIQUETAS_PERSONAJE[t] || t)].join(" ")));
    const vacio = container.querySelector(".mis-sin-resultados");
    container.querySelector("#mis-personajes-buscar").addEventListener("input", (e) => {
      const q = normalizarParaBuscar(e.target.value.trim());
      let visibles = 0;
      [...grid.children].forEach((card, i) => {
        const ok = !q || (claves[i] || "").includes(q);
        card.hidden = !ok;
        if (ok) visibles++;
      });
      vacio.hidden = visibles > 0;
    });
  }
  if (esComunidad) {
    const userIds = [...new Set(personajes.map((p) => p.user_id))];
    obtenerUsernamesBatch(userIds).then((usernamesMap) => {
      grid.querySelectorAll(".character-author[data-user-id]").forEach((authorEl) => {
        const uid = authorEl.dataset.userId;
        authorEl.textContent = uid === currentUser.id ? "Creado por ti" : `por @${usernamesMap[uid] || "anónimo"}`;
      });
    });
  }
  grid.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (await confirmarSAIR("¿Eliminar este personaje?", "Se borrarán también todos sus chats. No se puede deshacer.", { aceptar: "Eliminar", peligro: true })) {
        try {
          await fetchWithRetry(() => eliminarPersonaje(btn.dataset.id));
          showToast("Personaje eliminado");
          CACHE.personajes = null;
          CACHE.cacheTime.personajes = 0;
          renderCharacters();
        } catch (err) {
          showToast(err.message, "error");
        }
      }
    });
  });
  grid.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await abrirEditorPersonaje(btn.dataset.id);
    });
  });
  grid.querySelectorAll(".btn-chat").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await abrirChatConPersonaje(btn.dataset.id);
    });
  });
  grid.querySelectorAll(".btn-report").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const p = personajes.find((x) => String(x.id) === btn.dataset.id);
      abrirReporte(btn.dataset.id, p?.nombre || "este personaje");
    });
  });
}
