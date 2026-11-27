const COMUNIDAD_POR_PAGINA = 24;
const ORDENES_COMUNIDAD = { recientes: [["creado_en", false]], antiguos: [["creado_en", true]], nombre: [["nombre", true]], populares: [["likes_count", false], ["creado_en", false]] };
const comunidad = { q: "", orden: "recientes", etiqueta: "", favoritos: false, panel: false, lista: [], hayMas: false, peticion: 0 };
const MOTIVOS_REPORTE = { normas_ia: "La IA avisó que infringe las Normas", contenido_sexual_menores: "Contenido sexual con menores", contenido_sexual: "Contenido sexual explícito", odio_acoso: "Odio o acoso", violencia_extrema: "Violencia extrema", spam: "Spam o publicidad", suplantacion: "Suplanta a una persona real", otro: "Otro motivo" };
function limpiarBusquedaComunidad(q) {
  return String(q || "").replace(/[%_,()*\\:."'`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}
async function listarPersonajesComunidad({ q = "", orden = "recientes", etiqueta = "", favoritos = false, desde = 0 } = {}) {
  if (!currentUser) return { filas: [], hayMas: false };
  if (favoritos && !misLikes.size) return { filas: [], hayMas: false };
  return ejecutarConRefresh(async () => {
    const construir = (cols) => {
      const extras = cols.includes("likes_count");
      let consulta = sbClient.from("personajes").select(cols).eq("publico", true);
      const texto = limpiarBusquedaComunidad(q);
      if (texto) consulta = consulta.or(`nombre.ilike.*${texto}*,descripcion_corta.ilike.*${texto}*`);
      if (etiqueta && extras && ETIQUETAS_PERSONAJE[etiqueta]) consulta = consulta.contains("tags", [etiqueta]);
      if (favoritos) consulta = consulta.in("id", [...misLikes].slice(0, 300));
      const criterios = orden === "populares" && !extras ? ORDENES_COMUNIDAD.recientes : ORDENES_COMUNIDAD[orden] || ORDENES_COMUNIDAD.recientes;
      for (const [col, asc] of criterios) consulta = consulta.order(col, { ascending: asc });
      return consulta.order("id", { ascending: true }).range(desde, desde + COMUNIDAD_POR_PAGINA);
    };
    const { data, error } = await consultarConExtras(construir);
    if (error) throw new Error(error.message);
    const filas = data || [];
    return { filas: filas.slice(0, COMUNIDAD_POR_PAGINA), hayMas: filas.length > COMUNIDAD_POR_PAGINA };
  });
}
const NOMBRES_ORDEN_COMUNIDAD = { recientes: "Recientes", populares: "Populares", nombre: "A-Z", antiguos: "Antiguos" };
function renderComunidad() {
  const container = document.getElementById("characters-container");
  const lupa = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>';
  const icoFiltros = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>';
  container.innerHTML = `<div class="comunidad-toolbar com-barra">
<label class="comunidad-busqueda-wrap">${lupa}<input id="comunidad-q" class="form-input comunidad-busqueda" type="search" placeholder="Buscar personajes…" maxlength="60" autocomplete="off" aria-label="Buscar personajes de la comunidad"></label>
<button type="button" class="btn btn-ghost btn-small com-filtros-btn" id="btn-comunidad-filtros" aria-expanded="false" aria-controls="comunidad-panel">${icoFiltros}<span class="com-filtros-txt">Filtros</span><span class="com-filtros-n" id="comunidad-filtros-n" hidden></span></button>
${isOwner() ? `<button type="button" class="btn btn-ghost btn-small com-icono" id="btn-ver-reportes" title="Reportes" aria-label="Ver reportes">${ICONOS.bandera}</button>` : ""}
</div>
<div class="com-panel" id="comunidad-panel" hidden>
<div class="com-panel-grupo"><span class="com-panel-titulo">Ordenar por</span><div class="com-segmento" id="comunidad-orden" role="group" aria-label="Ordenar personajes">${Object.entries(NOMBRES_ORDEN_COMUNIDAD).map(([k, v]) => `<button type="button" data-orden="${k}" aria-pressed="false">${v}</button>`).join("")}</div></div>
<div class="com-panel-grupo" id="comunidad-grupo-etiquetas"><span class="com-panel-titulo">Género</span><div class="comunidad-etiquetas" id="comunidad-etiquetas" role="group" aria-label="Filtrar por género"><button type="button" class="etiqueta-chip" data-tag="" aria-pressed="true">Todos</button>${Object.entries(ETIQUETAS_PERSONAJE).map(([k, v]) => `<button type="button" class="etiqueta-chip" data-tag="${k}" aria-pressed="false">${v}</button>`).join("")}</div></div>
<div class="com-panel-pie"><button type="button" class="btn btn-ghost btn-small comunidad-fav" id="btn-comunidad-favoritos" aria-pressed="false">${ICONOS.corazon}<span>Solo mis favoritos</span></button><button type="button" class="com-limpiar" id="btn-comunidad-limpiar">Quitar filtros</button></div>
</div>
<div class="com-activos" id="comunidad-activos"></div>
<div id="comunidad-resultados" aria-live="polite"></div><div class="comunidad-mas"><button type="button" class="btn btn-ghost" id="btn-comunidad-mas" hidden>Cargar más</button></div>`;
  const input = document.getElementById("comunidad-q"), panel = document.getElementById("comunidad-panel"), btnFiltros = document.getElementById("btn-comunidad-filtros");
  input.value = comunidad.q;
  panel.hidden = !comunidad.panel;
  btnFiltros.setAttribute("aria-expanded", String(!!comunidad.panel));
  actualizarToolbarComunidad();
  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = input.value.trim();
      if (q === comunidad.q) return;
      comunidad.q = q;
      cargarComunidad(true);
    }, 350);
  });
  btnFiltros.addEventListener("click", () => {
    comunidad.panel = panel.hidden;
    panel.hidden = !comunidad.panel;
    btnFiltros.setAttribute("aria-expanded", String(comunidad.panel));
  });
  const cambiar = (cambios) => {
    Object.assign(comunidad, cambios);
    pintarFiltrosComunidad();
    cargarComunidad(true);
  };
  document.getElementById("comunidad-orden").addEventListener("click", (e) => {
    const b = e.target.closest("[data-orden]");
    if (b && b.dataset.orden !== comunidad.orden) cambiar({ orden: b.dataset.orden });
  });
  document.getElementById("comunidad-etiquetas").addEventListener("click", (e) => {
    const b = e.target.closest(".etiqueta-chip");
    if (b && b.dataset.tag !== comunidad.etiqueta) cambiar({ etiqueta: b.dataset.tag });
  });
  document.getElementById("btn-comunidad-favoritos").addEventListener("click", () => cambiar({ favoritos: !comunidad.favoritos }));
  document.getElementById("btn-comunidad-limpiar").addEventListener("click", () => cambiar({ orden: "recientes", etiqueta: "", favoritos: false }));
  document.getElementById("comunidad-activos").addEventListener("click", (e) => {
    const b = e.target.closest("[data-quitar]");
    if (!b) return;
    const q = b.dataset.quitar;
    cambiar(q === "orden" ? { orden: "recientes" } : q === "etiqueta" ? { etiqueta: "" } : { favoritos: false });
  });
  document.getElementById("btn-comunidad-mas").addEventListener("click", () => cargarComunidad(false));
  document.getElementById("btn-ver-reportes")?.addEventListener("click", abrirReportes);
  cargarComunidad(true);
}
function pintarFiltrosComunidad() {
  document.querySelectorAll("#comunidad-orden [data-orden]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.orden === comunidad.orden)));
  document.querySelectorAll("#comunidad-etiquetas .etiqueta-chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tag === comunidad.etiqueta)));
  document.getElementById("btn-comunidad-favoritos")?.setAttribute("aria-pressed", String(comunidad.favoritos));
  const x = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const activos = [];
  if (comunidad.orden !== "recientes") activos.push(["orden", NOMBRES_ORDEN_COMUNIDAD[comunidad.orden]]);
  if (comunidad.etiqueta) activos.push(["etiqueta", ETIQUETAS_PERSONAJE[comunidad.etiqueta]]);
  if (comunidad.favoritos) activos.push(["favoritos", "❤️ Favoritos"]);
  const cont = document.getElementById("comunidad-activos");
  if (cont) cont.innerHTML = activos.map(([k, v]) => `<button type="button" class="com-activo" data-quitar="${k}" aria-label="Quitar filtro ${escapeHtml(v)}">${escapeHtml(v)}${x}</button>`).join("");
  const n = document.getElementById("comunidad-filtros-n");
  if (n) {
    n.hidden = !activos.length;
    n.textContent = activos.length;
  }
  const limpiar = document.getElementById("btn-comunidad-limpiar");
  if (limpiar) limpiar.hidden = !activos.length;
}
function actualizarToolbarComunidad() {
  const extras = extrasPersonajeEnNube, likes = likesEnNube && extras;
  const grupo = document.getElementById("comunidad-grupo-etiquetas");
  if (grupo) grupo.hidden = !extras;
  const fav = document.getElementById("btn-comunidad-favoritos");
  if (fav) fav.hidden = !likes;
  const pop = document.querySelector('#comunidad-orden [data-orden="populares"]');
  if (pop) pop.hidden = !extras;
  if (!extras) {
    comunidad.etiqueta = "";
    if (comunidad.orden === "populares") comunidad.orden = "recientes";
  }
  if (!likes) comunidad.favoritos = false;
  pintarFiltrosComunidad();
}
async function cargarComunidad(reiniciar) {
  const res = document.getElementById("comunidad-resultados");
  if (!res) return;
  const btn = document.getElementById("btn-comunidad-mas");
  const id = ++comunidad.peticion;
  if (reiniciar) {
    comunidad.lista = [];
    comunidad.hayMas = false;
    res.innerHTML = `<div class="characters-grid">${Array(6).fill(0).map(() => `<div class="skeleton-card"><div class="skeleton-avatar"></div><div class="skeleton-line medium"></div><div class="skeleton-line short"></div><div class="skeleton-line"></div></div>`).join("")}</div>`;
    if (btn) btn.hidden = true;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Cargando…";
  }
  try {
    await cargarMisLikes();
    const { filas, hayMas } = await fetchWithRetry(() => listarPersonajesComunidad({ q: comunidad.q, orden: comunidad.orden, etiqueta: comunidad.etiqueta, favoritos: comunidad.favoritos, desde: comunidad.lista.length }));
    if (id !== comunidad.peticion) return;
    actualizarToolbarComunidad();
    const vistos = new Set(comunidad.lista.map((p) => p.id));
    comunidad.lista.push(...filas.filter((p) => !vistos.has(p.id)));
    comunidad.hayMas = hayMas;
    renderCharactersGrid(comunidad.lista, true, res);
    if (btn) {
      btn.hidden = !hayMas;
      btn.disabled = false;
      btn.textContent = "Cargar más";
    }
  } catch (err) {
    if (id !== comunidad.peticion) return;
    console.error("Error cargando la Comunidad:", err);
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Cargar más";
    }
    if (reiniciar) res.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><h3>Error al cargar</h3><p>${escapeHtml(err.message)}</p><button type="button" class="btn btn-primary" data-sair-accion="reintentar-comunidad">🔄 Reintentar</button></div>`;
    else showToast(`❌ ${err.message}`, "error");
  }
}
document.getElementById("characters-container")?.addEventListener("click", (e) => {
  const like = e.target.closest(".btn-like");
  if (like) {
    e.stopPropagation();
    if (!like.disabled) alternarLike(like);
    return;
  }
  const share = e.target.closest(".btn-share");
  if (share) {
    e.stopPropagation();
    compartirPersonaje(share.dataset.id, share.dataset.nombre || "este personaje");
  }
});
function esErrorTablaInexistente(error) {
  const t = `${error?.code || ""} ${error?.message || ""}`;
  return /42P01|PGRST20[0-5]|does not exist|schema cache|Could not find/i.test(t);
}
let reportePersonajeId = null;
function abrirReporte(id, nombre) {
  reportePersonajeId = id;
  document.getElementById("report-personaje").textContent = `Vas a reportar «${nombre}». El equipo de SAIR revisará el reporte y, si incumple las normas, lo retirará de la Comunidad.`;
  document.getElementById("form-report").reset();
  openModal("report-modal");
}
document.getElementById("form-report")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!reportePersonajeId || !currentUser) return;
  const btn = e.target.querySelector('button[type="submit"]');
  const motivo = document.getElementById("report-motivo").value;
  const detalle = document.getElementById("report-detalle").value.trim().slice(0, 500) || null;
  btn.disabled = true;
  try {
    const { error } = await sbClient.from("reportes_personajes").insert({ personaje_id: reportePersonajeId, reportado_por: currentUser.id, motivo, detalle });
    if (error) {
      if (error.code === "23505") {
        closeModal("report-modal");
        showToast("Ya habías reportado este personaje. Gracias");
        return;
      }
      if (esErrorTablaInexistente(error)) throw new Error("Los reportes todavía no están activados en el servidor");
      throw new Error(error.message);
    }
    closeModal("report-modal");
    showToast("✅ Reporte enviado. Gracias por ayudar a cuidar la Comunidad");
  } catch (err) {
    showToast(`❌ ${err.message}`, "error");
  } finally {
    btn.disabled = false;
  }
});
async function abrirReportes() {
  if (!isOwner()) return;
  const lista = document.getElementById("reportes-lista");
  lista.innerHTML = '<p class="reportes-vacio">Cargando reportes…</p>';
  openModal("reportes-modal");
  try {
    const { data, error } = await sbClient.from("reportes_personajes").select("id,motivo,detalle,creado_en,personaje_id,personajes(nombre,oculto)").order("creado_en", { ascending: false }).limit(200);
    if (error) {
      if (esErrorTablaInexistente(error)) throw new Error("Los reportes no están disponibles en este momento");
      throw new Error(error.message);
    }
    const grupos = /* @__PURE__ */ new Map();
    for (const r of data || []) {
      if (!grupos.has(r.personaje_id)) grupos.set(r.personaje_id, { nombre: r.personajes?.nombre || "(personaje eliminado)", oculto: !!r.personajes?.oculto, reportes: [] });
      grupos.get(r.personaje_id).reportes.push(r);
    }
    if (!grupos.size) {
      lista.innerHTML = '<p class="reportes-vacio">🎉 No hay reportes pendientes</p>';
      return;
    }
    const prioridad = (g) => (g.reportes.some((r) => r.motivo === "normas_ia") ? 1e3 : 0) + (g.oculto ? 500 : 0) + g.reportes.length;
    lista.innerHTML = [...grupos.entries()].sort((a, b) => prioridad(b[1]) - prioridad(a[1])).map(([pid, g]) => `<div class="reporte-item${g.reportes.some((r) => r.motivo === "normas_ia") ? " reporte-ia" : ""}" data-personaje-id="${escapeHtml(pid)}">
<div class="reporte-cabecera"><strong>${escapeHtml(g.nombre)}</strong>${g.oculto ? '<span class="reporte-oculto">Oculto automáticamente</span>' : ""}<span class="reporte-contador">${g.reportes.length} ${g.reportes.length === 1 ? "reporte" : "reportes"}</span></div>
<ul class="reporte-motivos">${g.reportes.slice(0, 5).map((r) => `<li>${escapeHtml(MOTIVOS_REPORTE[r.motivo] || r.motivo)}${r.detalle ? ` — <em>${escapeHtml(r.detalle)}</em>` : ""}</li>`).join("")}${g.reportes.length > 5 ? `<li>…y ${g.reportes.length - 5} más</li>` : ""}</ul>
<div class="reporte-acciones"><button type="button" class="btn btn-danger btn-small" data-accion="retirar">Retirar de la Comunidad</button><button type="button" class="btn btn-ghost btn-small" data-accion="descartar">${g.oculto ? "Descartar y volver a mostrar" : "Descartar"}</button></div>
</div>`).join("");
  } catch (err) {
    lista.innerHTML = `<p class="reportes-vacio">⚠️ ${escapeHtml(err.message)}</p>`;
  }
}
document.getElementById("reportes-lista")?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-accion]");
  if (!btn) return;
  const item = btn.closest(".reporte-item"), pid = item?.dataset.personajeId;
  if (!pid) return;
  const retirar = btn.dataset.accion === "retirar";
  if (retirar && !await confirmarSAIR("¿Retirar este personaje de la Comunidad?", "Pasará a ser privado para su autor.", { aceptar: "Retirar", peligro: true })) return;
  item.querySelectorAll("button").forEach((b) => b.disabled = true);
  try {
    const { error } = retirar ? await sbClient.rpc("retirar_personaje_reportado", { p_personaje_id: pid }) : await sbClient.from("reportes_personajes").delete().eq("personaje_id", pid);
    if (error) throw new Error(error.message);
    showToast(retirar ? "✅ Personaje retirado de la Comunidad" : "Reportes descartados");
    if (retirar && currentView === "community") cargarComunidad(true);
    abrirReportes();
  } catch (err) {
    showToast(`❌ ${err.message}`, "error");
    item.querySelectorAll("button").forEach((b) => b.disabled = false);
  }
});
async function renderAnuncios() {
  const container = document.getElementById("characters-container");
  if (LOADING.anuncios) return;
  if (isCacheValid("anuncios") && CACHE.anuncios) {
    renderAnunciosContent(CACHE.anuncios);
    return;
  }
  LOADING.anuncios = true;
  container.innerHTML = '<p style="color:var(--text-3);text-align:center;padding:2rem">Cargando anuncios...</p>';
  try {
    const anuncios = await fetchWithRetry(() => listarAnuncios());
    CACHE.anuncios = anuncios;
    CACHE.cacheTime.anuncios = Date.now();
    renderAnunciosContent(anuncios);
  } catch (err) {
    console.error("Error en renderAnuncios:", err);
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><h3 style="font-family:var(--font-display);color:var(--text-1);margin-bottom:.5rem">Error al cargar anuncios</h3><p style="color:var(--text-3);margin-bottom:1.5rem">${escapeHtml(err.message)}</p><button type="button" class="btn btn-primary" data-sair-accion="reintentar-anuncios">🔄 Reintentar</button></div>`;
  } finally {
    LOADING.anuncios = false;
  }
}
const RANGOS_SAIR = { owner: "Owner", admin: "Admin", moderador: "Moderador" };
function datosPerfilPropio() {
  return { user_id: currentUser?.id, username: userUsername, descripcion: userDescription, avatar_url: userAvatarUrl, fondo_url: userBackgroundUrl, avatar_pos_x: userAvatarPos?.x, avatar_pos_y: userAvatarPos?.y, fondo_pos_x: userBackgroundPos?.x, fondo_pos_y: userBackgroundPos?.y, rol: userRole || "user" };
}
async function cargarAutoresAnuncios(ids) {
  const autores = {};
  const otros = ids.filter((id) => id !== currentUser?.id);
  if (ids.includes(currentUser?.id) && userUsername) autores[currentUser.id] = datosPerfilPropio();
  if (!otros.length) return autores;
  const nombres = await obtenerUsernamesBatch(otros);
  await Promise.all(otros.map(async (id) => {
    const username = nombres[id];
    if (!username) return;
    autores[id] = { username };
    try {
      const { data } = await sbClient.rpc("buscar_usuarios", { p_busqueda: username });
      const u = (data || []).find((x) => x.user_id === id);
      if (u) autores[id] = u;
    } catch {
    }
  }));
  return autores;
}
function tiempoRelativoAnuncio(iso) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 6e4);
  if (!(min >= 0)) return formatDate(iso);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return d === 1 ? "ayer" : `hace ${d} días`;
  return formatDate(iso);
}
function renderAnunciosContent(anuncios) {
  const container = document.getElementById("characters-container");
  const megafono = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M16 8a5 5 0 0 1 0 8"/></svg>';
  const papelera = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>';
  let html = "";
  if (isOwner()) {
    html += `<details class="anuncio-nuevo"><summary><span class="anuncio-nuevo-mas" aria-hidden="true">+</span>Publicar un anuncio</summary><form id="form-anuncio"><input type="text" id="anuncio-titulo" class="form-input" placeholder="Título" required maxlength="100"><textarea id="anuncio-contenido" class="form-textarea" placeholder="¿Qué quieres contarle a la comunidad?" required maxlength="2000"></textarea><div class="anuncio-nuevo-acciones"><button type="submit" class="btn btn-primary btn-small">Publicar</button></div></form></details>`;
  }
  html += `<a class="anuncio-discord" href="https://discord.gg/yFVjc4E9jr" target="_blank" rel="noopener"><span class="anuncio-discord-ico"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 5.5a14 14 0 0 0-4 1.3C2.6 9.8 2 12.7 2.3 15.6a14 14 0 0 0 4.3 2.2l1-1.6"/><path d="M15.5 5.5a14 14 0 0 1 4 1.3c1.9 3 2.5 5.9 2.2 8.8a14 14 0 0 1-4.3 2.2l-1-1.6"/><path d="M7 16.2c3.3 1.4 6.7 1.4 10 0"/><path d="M7.5 7.6c3-1 6-1 9 0"/><circle cx="9" cy="12.3" r="1.2"/><circle cx="15" cy="12.3" r="1.2"/></svg></span><span class="anuncio-discord-texto"><strong>Únete al Discord de SAIR</strong><small>Comparte tus personajes, pide ayuda y entérate primero de los drops.</small></span><span class="btn btn-primary btn-small">Unirme</span></a>`;
  if (anuncios.length === 0) {
    html += `<div class="anuncios-vacio">${megafono}<h3>Todavía no hay anuncios</h3><p>Aquí verás las novedades de SAIR, los drops de Créditos de Rol y los avisos importantes.</p></div>`;
  } else {
    const ahora = Date.now();
    html += `<div class="anuncios-lista">${anuncios.map((a, i) => {
      const nuevo = ahora - new Date(a.creado_en).getTime() < 3 * 864e5;
      return `<article class="anuncio${i === 0 ? " destacado" : ""}" data-id="${a.id}"><header class="anuncio-cabeza"><button type="button" class="anuncio-autor-btn" data-user-id="${a.user_id}" aria-label="Ver el perfil del autor" disabled><span class="anuncio-ico">${megafono}</span><span class="anuncio-meta"><span class="anuncio-autor-fila"><span class="anuncio-autor">SAIR</span><span class="anuncio-rango" hidden></span></span><time datetime="${escapeHtml(a.creado_en)}" title="${escapeHtml(formatDate(a.creado_en))}">${escapeHtml(tiempoRelativoAnuncio(a.creado_en))}</time></span></button>${nuevo ? '<span class="anuncio-nuevo-pill">Nuevo</span>' : ""}${isOwner() ? `<button type="button" class="anuncio-borrar" data-id="${a.id}" title="Eliminar anuncio" aria-label="Eliminar anuncio">${papelera}</button>` : ""}</header><h3 class="anuncio-titulo">${escapeHtml(a.titulo)}</h3><p class="anuncio-texto">${escapeHtml(a.contenido)}</p></article>`;
    }).join("")}</div>`;
  }
  container.innerHTML = html;
  const authorUserIds = [...new Set(anuncios.map((a) => a.user_id))];
  cargarAutoresAnuncios(authorUserIds).then((autores) => {
    container.querySelectorAll(".anuncio-autor-btn[data-user-id]").forEach((btn) => {
      const u = autores[btn.dataset.userId];
      if (!u?.username) return;
      btn.dataset.username = u.username;
      btn.disabled = false;
      btn.setAttribute("aria-label", `Ver el perfil de ${u.username}`);
      btn.querySelector(".anuncio-autor").textContent = `@${u.username}`;
      const foto = sanitizeImageUrl(u.avatar_url), ico = btn.querySelector(".anuncio-ico");
      if (foto) {
        ico.classList.add("con-foto");
        ico.innerHTML = `<img src="${escapeHtml(foto)}" alt="" loading="lazy" style="object-position:${Number(u.avatar_pos_x) || 50}% ${Number(u.avatar_pos_y) || 50}%">`;
      }
      const rango = RANGOS_SAIR[u.rol], badge = btn.querySelector(".anuncio-rango");
      if (rango) {
        badge.hidden = false;
        badge.textContent = rango;
        badge.dataset.rol = u.rol;
      }
    });
  }).catch(() => {
  });
  container.querySelectorAll(".anuncio-autor-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.username) abrirPerfilBuscado(btn.dataset.username);
    });
  });
  container.querySelectorAll(".anuncio-borrar").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (await confirmarSAIR("¿Eliminar este anuncio?", "Dejará de verse para todos.", { aceptar: "Eliminar", peligro: true })) {
        try {
          await fetchWithRetry(() => eliminarAnuncio(btn.dataset.id));
          showToast("Anuncio eliminado");
          CACHE.anuncios = null;
          CACHE.cacheTime.anuncios = 0;
          renderAnuncios();
        } catch (err) {
          showToast(err.message, "error");
        }
      }
    });
  });
  const formAnuncio = document.getElementById("form-anuncio");
  if (formAnuncio) {
    formAnuncio.addEventListener("submit", async (e) => {
      e.preventDefault();
      const titulo = document.getElementById("anuncio-titulo").value.trim(), contenido = document.getElementById("anuncio-contenido").value.trim();
      if (!titulo || !contenido) return;
      try {
        await fetchWithRetry(() => crearAnuncio(titulo, contenido));
        showToast("✅ Anuncio publicado");
        CACHE.anuncios = null;
        CACHE.cacheTime.anuncios = 0;
        renderAnuncios();
      } catch (err) {
        showToast(`❌ ${err.message}`, "error");
      }
    });
  }
}
async function abrirEditorPersonaje(id = null) {
  const form = document.getElementById("form-personaje");
  form.reset();
  irAPasoCharacter(1, false);
  document.getElementById("avatar-remove").click();
  document.getElementById("char-id").value = "";
  marcarEtiquetasEditor([]);
  actualizarDisponibilidadEtiquetas();
  if (id) {
    document.getElementById("character-modal-title").textContent = "✏️ Editar Personaje";
    document.getElementById("btn-crear-personaje").textContent = "Guardar cambios";
    try {
      const p = await obtenerPersonaje(id);
      document.getElementById("char-id").value = p.id;
      document.getElementById("char-nombre").value = p.nombre;
      document.getElementById("char-desc").value = p.descripcion_corta || "";
      document.getElementById("char-publico").checked = !!p.publico;
      marcarEtiquetasEditor(p.tags);
      const parsed = parsearSystemPrompt(p.system_prompt);
      document.getElementById("char-personalidad").value = parsed.personalidad;
      document.getElementById("char-escenario").value = parsed.escenario;
      document.getElementById("char-ejemplos").value = parsed.ejemplos;
      document.getElementById("char-saludo").value = p.saludo || "";
      document.getElementById("char-max-tokens").value = p.max_tokens || 4096;
      const intensidadVal = normalizarIntensidad(p.intensidad || parsed.intensidad || "suave");
      document.getElementById("char-intensidad").value = intensidadVal;
      document.querySelectorAll("#intensity-picker .intensity-card").forEach((card) => {
        card.classList.toggle("active", card.dataset.value === intensidadVal);
      });
      setAvatarForEdit(p.avatar_url);
      const themeColor = parsed.themeColor || "#ff4d8f";
      document.getElementById("char-color").value = themeColor;
      document.querySelectorAll(".aura-color-option").forEach((opt) => {
        if (opt.dataset.color === themeColor) {
          opt.classList.add("active");
          opt.style.borderColor = "#fff";
          opt.style.boxShadow = `0 0 12px ${hexToRgba(themeColor, 0.6)}`;
        } else {
          opt.classList.remove("active");
          opt.style.borderColor = "transparent";
          opt.style.boxShadow = "none";
        }
      });
    } catch (err) {
      showToast(err.message, "error");
      return;
    }
  } else {
    document.getElementById("character-modal-title").textContent = "✨ Crear Personaje";
    document.getElementById("btn-crear-personaje").textContent = "Crear personaje";
    document.getElementById("char-color").value = "#ff4d8f";
    document.getElementById("char-intensidad").value = "suave";
    document.querySelectorAll("#intensity-picker .intensity-card").forEach((card) => {
      card.classList.toggle("active", card.dataset.value === "suave");
    });
    document.querySelectorAll(".aura-color-option").forEach((opt) => {
      if (opt.dataset.color === "#ff4d8f") {
        opt.classList.add("active");
        opt.style.borderColor = "#fff";
        opt.style.boxShadow = `0 0 12px ${hexToRgba("#ff4d8f", 0.6)}`;
      } else {
        opt.classList.remove("active");
        opt.style.borderColor = "transparent";
        opt.style.boxShadow = "none";
      }
    });
  }
  actualizarVistaPersonaje();
  openModal("character-modal");
}
function parsearSystemPrompt(sp) {
  const result = { personalidad: "", escenario: "", ejemplos: "", themeColor: "#ff4d8f", intensidad: "suave" };
  if (!sp) return result;
  const secciones = sp.split(/\n\[(?=[^\]]+\])/);
  for (const sec of secciones) {
    if (sec.startsWith("Personalidad de")) result.personalidad = sec.replace(/^Personalidad de[^]]*\]\n?/, "").trim();
    else if (sec.startsWith("Escenario]")) result.escenario = sec.replace(/^Escenario\]\n?/, "").trim();
    else if (sec.startsWith("Ejemplos de diálogo")) result.ejemplos = sec.replace(/^Ejemplos de diálogo[^]]*\]\n?/, "").trim();
    else if (sec.startsWith("ConfiguracionTema]")) result.themeColor = sec.replace(/^ConfiguracionTema\]\n?/, "").trim();
    else if (sec.startsWith("ConfiguracionIntensidad]")) result.intensidad = sec.replace(/^ConfiguracionIntensidad\]\n?/, "").trim();
  }
  return result;
}
document.getElementById("btn-nuevo-personaje").addEventListener("click", () => {
  abrirEditorPersonaje(null);
});
document.querySelectorAll("#intensity-picker .intensity-card").forEach((card) => {
  card.addEventListener("click", () => {
    document.querySelectorAll("#intensity-picker .intensity-card").forEach((c) => c.classList.remove("active"));
    card.classList.add("active");
    document.getElementById("char-intensidad").value = card.dataset.value;
  });
});
document.querySelectorAll(".aura-color-option").forEach((opt) => {
  opt.addEventListener("click", () => {
    document.querySelectorAll(".aura-color-option").forEach((o) => {
      o.classList.remove("active");
      o.style.borderColor = "transparent";
      o.style.boxShadow = "none";
    });
    opt.classList.add("active");
    opt.style.borderColor = "#fff";
    opt.style.boxShadow = `0 0 12px ${hexToRgba(opt.dataset.color, 0.6)}`;
    document.getElementById("char-color").value = opt.dataset.color;
  });
});
document.getElementById("form-personaje").addEventListener("submit", async (e) => {
  e.preventDefault();
  const invalido = document.querySelector("#form-personaje [required]:invalid");
  if (invalido) {
    const paso = invalido.closest(".char-step");
    if (paso) irAPasoCharacter(parseInt(paso.dataset.step), false);
    showToast("Completa los campos obligatorios antes de guardar", "error");
    setTimeout(() => invalido.reportValidity(), 80);
    return;
  }
  const btn = document.getElementById("btn-crear-personaje"), originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Guardando...";
  try {
    const fd = new FormData(e.target);
    const datos = {
      nombre: fd.get("nombre"),
      descripcion_corta: fd.get("descripcion_corta"),
      personalidad: fd.get("personalidad"),
      escenario: fd.get("escenario"),
      ejemplos: fd.get("ejemplos"),
      saludo: fd.get("saludo"),
      publico: document.getElementById("char-publico").checked,
      max_tokens: Math.min(16384, Math.max(256, parseInt(document.getElementById("char-max-tokens").value) || 4096)),
      themeColor: sanitizeThemeColor(document.getElementById("char-color").value || "#ff4d8f"),
      tags: etiquetasSeleccionadas(),
      intensidad: normalizarIntensidad(document.getElementById("char-intensidad").value)
    };
    const id = document.getElementById("char-id").value;
    if (id) {
      const updated = await actualizarPersonaje(id, datos);
      actualizarAvatarEnUI(updated);
      showToast("✅ Personaje actualizado");
    } else {
      const created = await crearPersonaje(datos);
      showToast("✅ Personaje creado");
    }
    closeModal("character-modal");
    CACHE.personajes = null;
    CACHE.cacheTime.personajes = 0;
    CACHE.personajesComunidad = null;
    CACHE.cacheTime.personajesComunidad = 0;
    renderCharacters();
  } catch (err) {
    showToast(`❌ ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});
let currentCharStep = 1;
function irAPasoCharacter(n, validar = true) {
  if (n === currentCharStep) return;
  if (validar && n > currentCharStep) {
    for (let s = currentCharStep; s < n; s++) {
      const paso = document.querySelector(`.char-step[data-step="${s}"]`);
      const invalido = paso && paso.querySelector("[required]:invalid");
      if (invalido) {
        invalido.reportValidity();
        return;
      }
    }
  }
  currentCharStep = n;
  document.querySelectorAll("#form-personaje .char-step").forEach((p) => p.classList.toggle("hidden", parseInt(p.dataset.step) !== n));
  document.querySelectorAll(".stepper-step").forEach((s) => {
    const step = parseInt(s.dataset.step);
    s.classList.toggle("active", step === n);
    s.classList.toggle("done", step < n);
  });
  document.getElementById("btn-step-back").textContent = n === 1 ? "Cancelar" : "← Atrás";
  document.getElementById("btn-step-next").classList.toggle("hidden", n === 3);
  document.getElementById("btn-crear-personaje").classList.toggle("hidden", n !== 3);
  const modal = document.querySelector("#character-modal .modal");
  if (modal) modal.scrollTop = 0;
  const overlay = document.getElementById("character-modal");
  if (overlay) overlay.scrollTop = 0;
}
document.querySelectorAll(".stepper-step").forEach((s) => s.addEventListener("click", () => irAPasoCharacter(parseInt(s.dataset.step))));
document.getElementById("btn-step-next").addEventListener("click", () => irAPasoCharacter(currentCharStep + 1));
document.getElementById("btn-step-back").addEventListener("click", () => {
  if (currentCharStep === 1) {
    closeModal("character-modal");
    return;
  }
  irAPasoCharacter(currentCharStep - 1, false);
});
function extraerJSONDeTexto(texto) {
  const limpiado = String(texto || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(limpiado);
  } catch {
  }
  const m = limpiado.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("La IA no devolvió un JSON válido. Prueba de nuevo.");
  return JSON.parse(m[0]);
}
function setAuraColorUI(color) {
  const validos = ["#ff4d8f", "#4d79ff", "#a855f7", "#10b981", "#f97316", "#eab308"];
  if (!validos.includes(color)) return;
  document.getElementById("char-color").value = color;
  document.querySelectorAll(".aura-color-option").forEach((o) => {
    const activo = o.dataset.color === color;
    o.classList.toggle("active", activo);
    o.style.borderColor = activo ? "#fff" : "transparent";
    o.style.boxShadow = activo ? `0 0 12px ${hexToRgba(color, 0.6)}` : "none";
  });
}
async function generarPersonajeConIA() {
  const idea = document.getElementById("ai-idea").value.trim();
  const statusEl = document.getElementById("ai-status");
  if (!idea) {
    showToast("Escribe una idea para tu personaje", "error");
    return;
  }
  if (!exigirIA()) return;
  const genBtn = document.getElementById("btn-ai-generar");
  genBtn.disabled = true;
  genBtn.textContent = "Generando...";
  statusEl.textContent = "⏳ Pensando tu personaje...";
  try {
    const systemPrompt = `Eres un diseñador experto de personajes para una app de roleplay narrativo con IA. A partir de la idea del usuario, crea un personaje completo, coherente e inmersivo.
Devuelve EXCLUSIVAMENTE un objeto JSON válido, sin markdown, sin explicaciones ni texto adicional, con EXACTAMENTE estas claves:
{"nombre":"Nombre corto y atractivo (máx 60 caracteres)","descripcion_corta":"Descripción en 1 frase para una tarjeta (máx 200 caracteres)","personalidad":"Rasgos de personalidad detallados y forma de hablar (2-4 párrafos breves)","saludo":"*acción entre asteriscos* + diálogo de presentación del personaje (1-2 frases)","escenario":"Descripción del lugar y la situación donde empieza la historia (1-2 párrafos)","ejemplos":"2 ejemplos de diálogo en este formato exacto con salto de línea: {{user}}: ...
{{char}}: ...","color":"uno de estos hex exactos: #ff4d8f, #4d79ff, #a855f7, #10b981, #f97316, #eab308"}
El tono debe ser consistente con la idea del usuario.
La idea puede ser muy detallada: RESPETA y conserva TODOS los datos que dé el usuario (nombre, apariencia, edad, historia, relaciones, forma de hablar, escenario, gustos, etc.) e intégralos en los campos correspondientes sin contradecirlos; solo inventa lo que falte. Si la idea es larga, la personalidad puede tener hasta 6 párrafos, pero nunca más de 2900 caracteres; el escenario, máx 1900 caracteres.`;
    let texto;
    if (usaCR()) {
      ({ texto } = await peticionCRTexto({ systemPrompt, contenido: `Idea: ${idea}`, accion: "generar_personaje" }));
      if (!texto) throw new Error("No se pudo generar el personaje");
    } else {
      const apiKey = getGeminiKey();
      const body = { system_instruction: { parts: [{ text: systemPrompt }] }, contents: [{ role: "user", parts: [{ text: `Idea: ${idea}` }] }], safetySettings: getSafetySettings("mediana"), generationConfig: { temperature: 1, topP: 0.95, topK: 40, maxOutputTokens: 8192 } };
      const response = await fetch(geminiUrl(getSummaryModel(), false), { method: "POST", headers: geminiHeaders(apiKey), body: JSON.stringify(body) });
      if (!response.ok) {
        const errText = await response.text();
        let msg = `Error al generar (${response.status})`;
        try {
          const errJson = JSON.parse(errText);
          if (errJson.error?.message) msg = errJson.error.message;
        } catch {
        }
        throw new Error(msg);
      }
      const data = await response.json();
      anotarUsoUnico(data.usageMetadata);
      texto = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!texto) {
        if (data.promptFeedback && data.promptFeedback.blockReason) throw new Error(`Generación bloqueada (${data.promptFeedback.blockReason}). Probá con otra idea.`);
        throw new Error("No se pudo generar el personaje");
      }
    }
    const res = extraerJSONDeTexto(texto);
    const nombre = (res.nombre || "").trim().slice(0, 60);
    if (!nombre) throw new Error("La IA no generó un nombre válido. Prueba de nuevo.");
    document.getElementById("char-nombre").value = nombre;
    document.getElementById("char-desc").value = (res.descripcion_corta || "").trim().slice(0, 200);
    document.getElementById("char-personalidad").value = (res.personalidad || "").trim().slice(0, 3e3);
    document.getElementById("char-escenario").value = (res.escenario || "").trim().slice(0, 2e3);
    document.getElementById("char-saludo").value = (res.saludo || "").trim().slice(0, 2e3);
    document.getElementById("char-ejemplos").value = (res.ejemplos || "").trim().slice(0, 4e3);
    setAuraColorUI(String(res.color || "").toLowerCase());
    actualizarVistaPersonaje();
    statusEl.textContent = "✅ Personaje generado. Revisa los campos y ajusta lo que quieras.";
    showToast("✅ Personaje generado con IA");
    irAPasoCharacter(1, false);
  } catch (err) {
    statusEl.textContent = "";
    showToast(`❌ ${err.message}`, "error");
  } finally {
    genBtn.disabled = false;
    genBtn.textContent = "⚡ Generar";
  }
}
document.getElementById("btn-ai-crear").addEventListener("click", () => {
  const panel = document.getElementById("ai-assistant");
  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) document.getElementById("ai-idea").focus();
});
document.getElementById("btn-ai-generar").addEventListener("click", generarPersonajeConIA);
document.getElementById("btn-ai-cancel").addEventListener("click", () => {
  document.getElementById("ai-assistant").classList.add("hidden");
  document.getElementById("ai-status").textContent = "";
  document.getElementById("ai-idea").value = "";
  actualizarContadorIdeaIA();
});
function actualizarContadorIdeaIA() {
  const el = document.getElementById("ai-idea"), c = document.getElementById("ai-idea-count");
  if (el && c) c.textContent = `${el.value.length} / ${el.maxLength}`;
}
document.getElementById("ai-idea").addEventListener("input", actualizarContadorIdeaIA);
const CHAR_ESENCIALES = { foto: () => !!avatarData.original, nombre: () => !!valorCampoPersonaje("char-nombre"), desc: () => !!valorCampoPersonaje("char-desc"), personalidad: () => !!valorCampoPersonaje("char-personalidad"), saludo: () => !!valorCampoPersonaje("char-saludo") };
let vistaPersonajeFrame = 0;
function valorCampoPersonaje(id) {
  return (document.getElementById(id)?.value || "").trim();
}
function actualizarVistaPersonaje() {
  cancelAnimationFrame(vistaPersonajeFrame);
  vistaPersonajeFrame = requestAnimationFrame(pintarVistaPersonaje);
}
function pintarVistaPersonaje() {
  const vista = document.getElementById("char-vista");
  if (!vista) return;
  const nombre = valorCampoPersonaje("char-nombre"), desc = valorCampoPersonaje("char-desc"), color = sanitizeThemeColor(document.getElementById("char-color").value || "#ff4d8f"), foto = sanitizeImageUrl(avatarData.original);
  vista.style.setProperty("--cv-color", color);
  vista.style.setProperty("--cv-glow", hexToRgba(color, 0.35));
  document.getElementById("cv-avatar").innerHTML = foto ? `<img src="${escapeHtml(foto)}" alt="">` : escapeHtml((nombre || "?").charAt(0).toUpperCase());
  document.getElementById("cv-banner").style.backgroundImage = foto ? `url("${foto.replace(/"/g, "%22")}")` : "";
  document.getElementById("cv-nombre").textContent = nombre || "Tu personaje";
  const descEl = document.getElementById("cv-desc");
  descEl.textContent = desc || "Aquí aparecerá la descripción corta.";
  descEl.classList.toggle("vacio", !desc);
  document.getElementById("cv-tags").innerHTML = etiquetasSeleccionadas().slice(0, 3).map((t) => `<span class="character-tag">${ETIQUETAS_PERSONAJE[t] || ""}</span>`).join("");
  const publico = document.getElementById("char-publico").checked, badge = document.getElementById("cv-badge");
  badge.textContent = publico ? "Público" : "Privado";
  badge.classList.toggle("publico", publico);
  const items = document.querySelectorAll("#cv-lista li");
  let hechos = 0;
  items.forEach((li) => {
    const ok = !!CHAR_ESENCIALES[li.dataset.item]?.();
    li.classList.toggle("hecho", ok);
    if (ok) hechos++;
  });
  document.getElementById("cv-progreso").style.width = `${Math.round(hechos / (items.length || 1) * 100)}%`;
  document.querySelectorAll("#form-personaje .char-contador").forEach((c) => {
    const campo = document.getElementById(c.dataset.para);
    if (!campo) return;
    const n = campo.value.length, max = campo.maxLength > 0 ? campo.maxLength : 0;
    c.textContent = max ? `${n} / ${max}` : String(n);
    c.classList.toggle("cerca", !!max && n > max * 0.9);
  });
  const tokens = parseInt(document.getElementById("char-max-tokens").value) || 0;
  document.querySelectorAll("#form-personaje .char-largo").forEach((b) => {
    const activo = parseInt(b.dataset.tokens) === tokens;
    b.classList.toggle("activo", activo);
    b.setAttribute("aria-pressed", String(activo));
  });
}
function insertarEnEjemplos(texto) {
  const ta = document.getElementById("char-ejemplos");
  if (!ta) return;
  const ini = ta.selectionStart ?? ta.value.length, fin = ta.selectionEnd ?? ta.value.length;
  const antes = ta.value.slice(0, ini), salto = texto.startsWith("{{") && antes && !antes.endsWith("\n") ? "\n" : "";
  ta.setRangeText(salto + texto, ini, fin, "end");
  ta.focus();
}
const formularioPersonaje = document.getElementById("form-personaje");
formularioPersonaje.addEventListener("input", actualizarVistaPersonaje);
formularioPersonaje.addEventListener("change", actualizarVistaPersonaje);
formularioPersonaje.addEventListener("click", (e) => {
  const insertar = e.target.closest(".char-insertar");
  if (insertar) insertarEnEjemplos(insertar.dataset.insertar);
  const largo = e.target.closest(".char-largo");
  if (largo) document.getElementById("char-max-tokens").value = largo.dataset.tokens;
  actualizarVistaPersonaje();
});
document.querySelectorAll("#intensity-picker .intensity-card").forEach((card) => card.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  card.click();
}));
let friendsSearchTimer = null;
function mostrarPerfilPublico(user) {
  const cover = document.getElementById("public-profile-cover"), avatar = document.getElementById("public-profile-avatar"), name = document.getElementById("public-profile-name"), role = document.getElementById("public-profile-role"), description = document.getElementById("public-profile-description"), safeAvatar = sanitizeImageUrl(user.avatar_url), safeCover = sanitizeImageUrl(user.fondo_url), initial = (user.username || "U").charAt(0).toUpperCase();
  name.textContent = user.username || "Usuario";
  role.textContent = (user.rol || "user").toUpperCase();
  description.textContent = user.descripcion || "Este usuario aún no ha añadido una descripción.";
  description.className = `public-profile-description${user.descripcion ? "" : " public-profile-empty"}`;
  avatar.innerHTML = safeAvatar ? `<img src="${safeAvatar.replace(/"/g, "&quot;")}" alt="">` : initial;
  avatar.style.transform = "none";
  if (safeAvatar) avatar.querySelector("img").style.objectPosition = `${Number(user.avatar_pos_x) || 50}% ${Number(user.avatar_pos_y) || 50}%`;
  cover.style.backgroundImage = safeCover ? `url("${safeCover.replace(/"/g, "%22")}")` : "";
  cover.style.backgroundPosition = `${Number(user.fondo_pos_x) || 50}% ${Number(user.fondo_pos_y) || 50}%`;
  openModal("public-profile-modal");
}
async function abrirPerfilBuscado(username) {
  try {
    const { data, error } = await sbClient.rpc("buscar_usuarios", { p_busqueda: username });
    if (error) throw error;
    const user = (data || []).find((item) => item.username === username) || (username === userUsername ? datosPerfilPropio() : data?.[0]);
    if (user) mostrarPerfilPublico(user);
  } catch (err) {
    const { data, error } = await sbClient.from("perfiles").select("user_id,username,descripcion,avatar_url,fondo_url,avatar_pos_x,avatar_pos_y,fondo_pos_x,fondo_pos_y").eq("username", username).maybeSingle();
    if (!error && data) mostrarPerfilPublico({ ...data, rol: "user" });
  }
}
document.getElementById("user-badge").addEventListener("click", () => {
  const description = document.getElementById("profile-description");
  if (description) description.value = userDescription || "";
});
const personasEstado = { q: "", peticion: 0 };
const ICONO_BUSCAR_PERSONAS = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>';
function renderPersonas() {
  const container = document.getElementById("characters-container");
  container.innerHTML = `<div class="personas-vista"><div class="personas-buscador">${ICONO_BUSCAR_PERSONAS}<input id="personas-input" class="form-input" type="search" placeholder="Busca por nombre de usuario" autocomplete="off" spellcheck="false" maxlength="50" aria-label="Buscar personas" value="${escapeHtml(personasEstado.q)}"></div><h2 class="personas-titulo" id="personas-titulo"></h2><div class="personas-grid" id="personas-resultados" aria-live="polite"></div></div>`;
  const input = document.getElementById("personas-input");
  input.addEventListener("input", () => {
    clearTimeout(friendsSearchTimer);
    friendsSearchTimer = setTimeout(() => {
      personasEstado.q = input.value.trim();
      buscarPersonas();
    }, 280);
  });
  buscarPersonas();
}
async function contarPersonajesPublicos(ids) {
  if (!ids.length) return {};
  const { data, error } = await sbClient.from("personajes").select("user_id").eq("publico", true).in("user_id", ids).limit(1e3);
  if (error) return {};
  const cuenta = {};
  for (const fila of data || []) cuenta[fila.user_id] = (cuenta[fila.user_id] || 0) + 1;
  return cuenta;
}
async function buscarPersonas() {
  const out = document.getElementById("personas-resultados"), titulo = document.getElementById("personas-titulo");
  if (!out || !currentUser) return;
  const term = personasEstado.q, peticion = ++personasEstado.peticion;
  titulo.textContent = term ? `Resultados para «${term}»` : "Recién llegados a SAIR";
  out.innerHTML = Array(6).fill('<div class="persona-card persona-esqueleto" aria-hidden="true"><span class="persona-banner"></span><span class="persona-avatar"></span><span class="skeleton-line short"></span><span class="skeleton-line"></span></div>').join("");
  try {
    const { data, error } = await sbClient.rpc("buscar_usuarios", { p_busqueda: term || "" });
    if (error) throw error;
    const filas = data || [];
    const cuenta = await contarPersonajesPublicos(filas.map((u) => u.user_id));
    if (peticion !== personasEstado.peticion) return;
    renderPersonasResultados(filas.map((u) => ({ ...u, publicos: cuenta[u.user_id] || 0 })), term);
  } catch (err) {
    if (peticion !== personasEstado.peticion) return;
    console.error("Error buscando personas:", err);
    out.innerHTML = '<div class="personas-vacio"><strong>No se pudo cargar</strong>Intenta de nuevo en un momento.</div>';
  }
}
function renderPersonasResultados(personas, term) {
  const out = document.getElementById("personas-resultados");
  if (!out) return;
  if (!personas.length) {
    out.innerHTML = term ? '<div class="personas-vacio"><strong>No encontramos a nadie con ese nombre</strong>Revisa cómo se escribe o prueba con una parte del nombre.</div>' : '<div class="personas-vacio"><strong>Todavía no hay nadie más por aquí</strong>Comparte SAIR con tus amigos para rolear juntos.</div>';
    return;
  }
  const fmt = new Intl.DateTimeFormat("es", { month: "long", year: "numeric" });
  out.innerHTML = personas.map((u, i) => {
    const nombre = escapeHtml(u.username || "Usuario"), avatar = sanitizeImageUrl(u.avatar_url), fondo = sanitizeImageUrl(u.fondo_url);
    const esOwner = u.rol === "owner";
    const desc = u.descripcion ? escapeHtml(u.descripcion) : "Sin descripción todavía.";
    const desde = u.creado_en ? fmt.format(new Date(u.creado_en)) : "";
    const personajes = u.publicos ? `${u.publicos} ${u.publicos === 1 ? "personaje público" : "personajes públicos"}` : "Sin personajes públicos";
    const avatarHtml = avatar ? `<img src="${escapeHtml(avatar)}" alt="" loading="lazy" style="object-position:${Number(u.avatar_pos_x) || 50}% ${Number(u.avatar_pos_y) || 50}%">` : escapeHtml((u.username || "U").charAt(0).toUpperCase());
    const banner = fondo ? `background-image:url(&quot;${escapeHtml(fondo).replace(/"/g, "%22")}&quot;);background-position:${Number(u.fondo_pos_x) || 50}% ${Number(u.fondo_pos_y) || 50}%` : "";
    return `<button type="button" class="persona-card" data-username="${nombre}" style="animation-delay:${Math.min(i, 8) * 35}ms" aria-label="Ver el perfil de ${nombre}"><span class="persona-banner" style="${banner}"></span><span class="persona-avatar">${avatarHtml}</span><span class="persona-nombre">${nombre}${esOwner ? '<span class="persona-owner">Owner</span>' : ""}</span><span class="persona-desc${u.descripcion ? "" : " vacio"}">${desc}</span><span class="persona-meta"><span>🎭 ${personajes}</span>${desde ? `<span>Desde ${escapeHtml(desde)}</span>` : ""}</span></button>`;
  }).join("");
}
document.getElementById("characters-container").addEventListener("click", (e) => {
  const card = e.target.closest(".persona-card[data-username]");
  if (card) abrirPerfilBuscado(card.dataset.username);
});
const misChatsEstado = { q: "", lista: [], peticion: 0 };
function textoPreviaMisChats(texto, personaje) {
  const limpio = String(texto || "").replace(/\{\{\s*user\s*\}\}/gi, userRoleName || userUsername || "Tú").replace(/\{\{\s*char\s*\}\}/gi, personaje || "").replace(/\[\[\s*NORMAS[^\]]*\]?\]?/gi, "🚫 Aviso de las Normas").replace(/[*_~`>#]+/g, "").replace(/\s+/g, " ").trim();
  return limpio.length > 110 ? limpio.slice(0, 110).trimEnd() + "…" : limpio;
}
function renderMisChats() {
  const container = document.getElementById("characters-container");
  container.innerHTML = `<div class="mischats-vista"><div class="personas-buscador mischats-buscador">${ICONO_BUSCAR_PERSONAS}<input id="mischats-input" class="form-input" type="search" placeholder="Buscar por personaje" autocomplete="off" maxlength="60" aria-label="Buscar en tus chats" value="${escapeHtml(misChatsEstado.q)}"></div><div class="mischats-lista" id="mischats-lista" aria-live="polite">${Array(4).fill('<div class="mischat mischat-esqueleto" aria-hidden="true"><span class="mischat-avatar"></span><span class="mischat-cuerpo"><span class="skeleton-line short"></span><span class="skeleton-line"></span></span></div>').join("")}</div></div>`;
  let timer = null;
  document.getElementById("mischats-input").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      misChatsEstado.q = e.target.value.trim();
      pintarMisChats();
    }, 200);
  });
  cargarMisChats();
}
async function cargarMisChats() {
  if (!currentUser || !sbClient) return;
  const peticion = ++misChatsEstado.peticion;
  try {
    const columnas = titulosEnNube ? "id,personaje_id,actualizado_en,titulo" : "id,personaje_id,actualizado_en";
    const { data: chats, error } = await sbClient.from("chats").select(columnas).eq("user_id", currentUser.id).order("actualizado_en", { ascending: false }).limit(400);
    if (error) throw error;
    const grupos = new Map();
    for (const c of chats || []) {
      const g = grupos.get(c.personaje_id);
      if (g) g.n++;
      else grupos.set(c.personaje_id, { personajeId: c.personaje_id, n: 1, ultimo: c });
    }
    const ids = [...grupos.keys()];
    let personajes = [];
    if (ids.length) {
      const r = await sbClient.from("personajes").select("id,nombre,avatar_url,descripcion_corta,user_id,publico").in("id", ids);
      if (r.error) throw r.error;
      personajes = r.data || [];
    }
    const porId = new Map(personajes.map((p) => [p.id, p]));
    const lista = [...grupos.values()].map((g) => ({ ...g, personaje: porId.get(g.personajeId) || null }));
    const autores = [...new Set(personajes.filter((p) => p.user_id !== currentUser.id).map((p) => p.user_id))];
    const [nombres, previas] = await Promise.all([
      autores.length ? obtenerUsernamesBatch(autores).catch(() => ({})) : {},
      Promise.all(lista.slice(0, 30).map((g) => sbClient.from("mensajes").select("rol,contenido").eq("chat_id", g.ultimo.id).order("creado_en", { ascending: false }).limit(1).maybeSingle().then((r) => r.data || null, () => null)))
    ]);
    if (peticion !== misChatsEstado.peticion) return;
    lista.forEach((g, i) => {
      g.previa = previas[i] || null;
      g.autor = g.personaje && g.personaje.user_id !== currentUser.id ? nombres[g.personaje.user_id] || "" : "";
    });
    misChatsEstado.lista = lista;
    pintarMisChats();
  } catch (err) {
    if (peticion !== misChatsEstado.peticion) return;
    console.error("Error cargando Mis chats:", err);
    const out = document.getElementById("mischats-lista");
    if (out) out.innerHTML = '<div class="personas-vacio"><strong>No se pudieron cargar tus chats</strong>Intenta de nuevo en un momento.</div>';
  }
}
function pintarMisChats() {
  const out = document.getElementById("mischats-lista");
  if (!out) return;
  const todos = misChatsEstado.lista;
  if (!todos.length) {
    out.innerHTML = '<div class="personas-vacio"><strong>Aún no tienes chats</strong>Cuando chatees con un personaje, tuyo o de la Comunidad, aparecerá aquí para que retomes la historia.</div>';
    return;
  }
  const q = normalizarParaBuscar(misChatsEstado.q);
  const lista = q ? todos.filter((g) => normalizarParaBuscar(g.personaje?.nombre || "").includes(q)) : todos;
  if (!lista.length) {
    out.innerHTML = '<div class="personas-vacio"><strong>Ningún personaje coincide</strong>Prueba con otra parte del nombre.</div>';
    return;
  }
  out.innerHTML = lista.map((g, i) => {
    const p = g.personaje, cuando = tiempoRelativoAnuncio(g.ultimo.actualizado_en);
    const chats = `${g.n} ${g.n === 1 ? "chat" : "chats"}`;
    if (!p) {
      return `<div class="mischat no-disponible" style="animation-delay:${Math.min(i, 8) * 30}ms"><span class="mischat-avatar">?</span><span class="mischat-cuerpo"><span class="mischat-fila"><strong class="mischat-nombre">Personaje no disponible</strong><time>${escapeHtml(cuando)}</time></span><span class="mischat-previa">Su creador lo hizo privado o lo eliminó, o está en revisión. Tus ${escapeHtml(chats)} siguen guardados.</span></span></div>`;
    }
    const avatar = sanitizeImageUrl(p.avatar_url), nombre = escapeHtml(p.nombre || "Personaje");
    const avatarHtml = avatar ? `<img src="${escapeHtml(avatar)}" alt="" loading="lazy">` : escapeHtml((p.nombre || "?").charAt(0).toUpperCase());
    const previa = g.previa ? `${g.previa.rol === "user" ? '<span class="mischat-tu">Tú:</span> ' : ""}${escapeHtml(textoPreviaMisChats(g.previa.contenido, p.nombre))}` : escapeHtml(p.descripcion_corta || "Sin mensajes todavía");
    const origen = p.user_id === currentUser.id ? "Tuyo" : g.autor ? `por @${escapeHtml(g.autor)}` : "Comunidad";
    return `<div class="mischat" style="animation-delay:${Math.min(i, 8) * 30}ms"><button type="button" class="mischat-abrir" data-personaje="${escapeHtml(p.id)}" aria-label="Ver tus chats con ${nombre}"><span class="mischat-avatar">${avatarHtml}</span><span class="mischat-cuerpo"><span class="mischat-fila"><strong class="mischat-nombre">${nombre}</strong><time datetime="${escapeHtml(g.ultimo.actualizado_en || "")}">${escapeHtml(cuando)}</time></span><span class="mischat-previa">${previa}</span><span class="mischat-meta"><span>${escapeHtml(chats)}</span><span>${origen}</span></span></span></button><button type="button" class="btn btn-primary btn-small mischat-seguir" data-personaje="${escapeHtml(p.id)}" data-chat="${escapeHtml(g.ultimo.id)}">${ICONOS.chat}<span>Continuar</span></button></div>`;
  }).join("");
}
document.getElementById("characters-container").addEventListener("click", async (e) => {
  const seguir = e.target.closest(".mischat-seguir[data-chat]");
  const abrir = seguir || e.target.closest(".mischat-abrir[data-personaje]");
  if (!abrir || abrir.disabled) return;
  abrir.disabled = true;
  try {
    await abrirChatConPersonaje(abrir.dataset.personaje);
    if (seguir && currentCharacter?.id === seguir.dataset.personaje) await seleccionarChat(seguir.dataset.chat);
  } finally {
    abrir.disabled = false;
  }
});
document.querySelectorAll(".dashboard-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (!tab.dataset.view) return;
    document.querySelectorAll(".dashboard-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    currentView = tab.dataset.view;
    const title = document.getElementById("dashboard-title"), subtitle = document.getElementById("dashboard-subtitle"), btnNuevo = document.getElementById("btn-nuevo-personaje");
    if (currentView === "my-characters") {
      title.textContent = "Tus personajes";
      subtitle.textContent = "Crea, edita y chatea con tus personajes de IA";
      btnNuevo.style.display = "inline-flex";
      renderCharacters();
    } else if (currentView === "community") {
      title.textContent = "Comunidad";
      subtitle.textContent = "Descubre personajes creados por otros usuarios";
      btnNuevo.style.display = "none";
      renderCharacters();
    } else if (currentView === "announcements") {
      title.textContent = "Anuncios";
      subtitle.textContent = isOwner() ? "Publica anuncios para toda la comunidad" : "Anuncios oficiales del Owner";
      btnNuevo.style.display = "none";
      renderAnuncios();
    } else if (currentView === "mis-chats") {
      title.textContent = "Mis chats";
      subtitle.textContent = "Retoma tus historias justo donde las dejaste";
      btnNuevo.style.display = "none";
      renderMisChats();
    } else if (currentView === "personas") {
      title.textContent = "Personas";
      subtitle.textContent = "Encuentra a otros roleros de SAIR y mira sus perfiles";
      btnNuevo.style.display = "none";
      renderPersonas();
    } else if (currentView === "creditos") {
      title.textContent = "Créditos de Rol";
      subtitle.textContent = "Rolea sin API Key: tu personaje responde con DeepSeek";
      btnNuevo.style.display = "none";
      renderTiendaCR();
    }
  });
});
async function abrirChatConPersonaje(personajeId) {
  guardarBorradorAhora();
  try {
    currentCharacter = await obtenerPersonaje(personajeId);
    cargarLorebook(currentCharacter.id).catch((err) => console.warn("⚠️ Lorebook:", err));
    currentChatId = null;
    await verificarYMostrarModalRol();
    const avatarEl = document.getElementById("chat-char-avatar");
    const safeAvatar = sanitizeImageUrl(currentCharacter.avatar_url);
    if (safeAvatar) avatarEl.innerHTML = `<img src="${safeAvatar.replace(/"/g, "&quot;")}" alt="">`;
    else avatarEl.textContent = currentCharacter.nombre.charAt(0).toUpperCase();
    document.getElementById("chat-char-name").textContent = currentCharacter.nombre;
    {
      const mAv = document.getElementById("chat-mobile-avatar"), mNom = document.getElementById("chat-mobile-name");
      if (mAv) mAv.innerHTML = avatarEl.innerHTML;
      if (mNom) mNom.textContent = currentCharacter.nombre;
    }
    document.getElementById("chat-char-sub").textContent = "Chats";
    document.getElementById("chat-view").classList.add("visible");
    document.getElementById("dashboard").style.display = "none";
    document.body.style.overflow = "hidden";
    const parsed = parsearSystemPrompt(currentCharacter.system_prompt);
    const themeColor = sanitizeThemeColor(currentCharacter.theme_color || parsed.themeColor);
    const glowColor = hexToRgba(themeColor, 0.35);
    const hoverColor = lightenColor(themeColor, 15);
    const chatViewEl = document.getElementById("chat-view");
    chatViewEl.style.setProperty("--pink", themeColor);
    chatViewEl.style.setProperty("--pink-glow", glowColor);
    chatViewEl.style.setProperty("--grad-main", `linear-gradient(135deg, ${themeColor} 0%, var(--purple) 50%, var(--blue) 100%)`);
    chatViewEl.style.setProperty("--grad-main-hover", `linear-gradient(135deg, ${hoverColor} 0%, var(--purple) 50%, var(--blue) 100%)`);
    aplicarFondoChat();
    await renderChatList();
    mostrarChatVacio();
  } catch (err) {
    showToast(err.message, "error");
  }
}
function pintarListaChats() {
  const list = document.getElementById("chat-list");
  if (!list) return;
  const buscador = document.getElementById("chat-list-search");
  const chats = chatsCache.filter((c) => !filtroChats || tituloChat(c).toLowerCase().includes(filtroChats) || vistaPreviaChat(c).toLowerCase().includes(filtroChats));
  if (buscador) buscador.hidden = chatsCache.length < 2;
  if (!chats.length) {
    list.innerHTML = chatsCache.length ? '<p class="chat-list-empty">Ningún chat coincide con la búsqueda</p>' : '<p class="chat-list-empty">Sin chats aún</p>';
    return;
  }
  list.innerHTML = chats.map((c) => `<div class="chat-list-item ${c.id === currentChatId ? "active" : ""}" data-id="${c.id}"><button type="button" class="chat-list-open" data-id="${c.id}"><span class="chat-list-title">${escapeHtml(tituloChat(c))}</span><span class="chat-list-preview">${escapeHtml(vistaPreviaChat(c))}</span></button><span class="chat-list-date">${formatDate(c.creado_en)}</span><button type="button" class="chat-list-delete" data-id="${c.id}" title="Eliminar chat" aria-label="Eliminar este chat"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg></button></div>`).join("");
  list.querySelectorAll(".chat-list-item").forEach((item) => {
    const chat = chats.find((c) => c.id === item.dataset.id);
    item.querySelector(".chat-list-open")?.addEventListener("click", () => {
      if (item.querySelector(".chat-list-rename")) return;
      seleccionarChat(item.dataset.id);
    });
    item.querySelector(".chat-list-title")?.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      editarTituloChat(item, chat);
    });
  });
  list.querySelectorAll(".chat-list-delete").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (await confirmarSAIR("¿Eliminar este chat?", "Se borran sus mensajes, notas y diario. No se puede deshacer.", { aceptar: "Eliminar", peligro: true })) {
        try {
          await eliminarChat(btn.dataset.id);
          borrarNotasRolLocal(btn.dataset.id);
          borrarDiarioLocal(btn.dataset.id);
          if (currentChatId === btn.dataset.id) {
            currentChatId = null;
            notasRolCache = { chatId: null, texto: "" };
            diarioCache = { chatId: null, diario: null };
            actualizarIndicadorNotasRol();
            actualizarIndicadorDiario();
            mostrarChatVacio();
          }
          renderChatList();
          showToast("Chat eliminado");
        } catch (err) {
          showToast(err.message, "error");
        }
      }
    });
  });
}
async function renderChatList() {
  const list = document.getElementById("chat-list");
  try {
    const chats = await listarChats(currentCharacter.id);
    chatsCache = chats;
    document.getElementById("chat-char-sub").textContent = `${chats.length} chat${chats.length !== 1 ? "s" : ""}`;
    pintarListaChats();
  } catch (err) {
    console.error("Error en renderChatList:", err);
    list.innerHTML = `<p style="color:#fca5a5;padding:1rem;font-size:.85rem">Error al cargar chats</p>`;
  }
}
function mostrarChatVacio() {
  quitarAvisoResumen();
  pintarMedidorContexto(null);
  const messages = document.getElementById("chat-messages");
  messages.innerHTML = `<div class="chat-empty" id="chat-empty"><div class="chat-empty-icon">💬</div><h3 style="font-family:var(--font-display);color:var(--text-1);margin-bottom:.5rem">Comienza una conversación</h3><p>Selecciona un chat o crea uno nuevo</p></div>`;
}
async function seleccionarChat(chatId, { historialConocido = null } = {}) {
  guardarBorradorAhora();
  currentChatId = chatId;
  restaurarBorrador(chatId);
  actualizarIndicadorUso();
  cargarNotasRol(chatId);
  prepararDiarioLocal(chatId);
  document.querySelectorAll(".chat-list-item").forEach((i) => {
    i.classList.toggle("active", i.dataset.id === chatId);
  });
  const messages = document.getElementById("chat-messages");
  if (Array.isArray(historialConocido)) {
    historialCompleto = historialConocido.slice();
    historialTotalMensajes = historialCompleto.filter((m) => m.rol === "user" || m.rol === "assistant").length;
    historialTieneMas = false;
    historialEsLegacy = false;
    chatOffset = historialTotalMensajes;
    renderizarChatPaginado();
    avisarResumenPendiente(chatId, historialCompleto);
    return;
  }
  messages.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:2rem">Cargando mensajes...</div>';
  try {
    const resultadoInicial = await cargarHistorialChat(chatId, { paginado: true });
    let { mensajes } = resultadoInicial;
    if (mensajes.filter((m) => m.rol === "user" || m.rol === "assistant").length === 0 && currentCharacter.saludo) {
      const saludoMsg = { id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2, 5), rol: "assistant", contenido: currentCharacter.saludo };
      mensajes.push(saludoMsg);
      await actualizarHistorialChat(chatId, mensajes);
      resultadoInicial.totalMensajes = 1;
      resultadoInicial.hasMore = false;
    }
    historialCompleto = mensajes;
    historialTotalMensajes = resultadoInicial.totalMensajes;
    historialTieneMas = resultadoInicial.hasMore;
    historialEsLegacy = resultadoInicial.usandoLegacy;
    chatOffset = historialCompleto.filter((m) => m.rol === "user" || m.rol === "assistant").length;
    renderizarChatPaginado();
    avisarResumenPendiente(chatId);
  } catch (err) {
    console.error("Error en seleccionarChat:", err);
    messages.innerHTML = `<p style="color:#fca5a5;text-align:center;padding:2rem">Error al cargar mensajes</p>`;
  }
}
const chatNewBtn = document.getElementById("chat-new-btn");
chatNewBtn.addEventListener("click", async () => {
  if (chatNewBtn.dataset.creando) return;
  chatNewBtn.dataset.creando = "1";
  chatNewBtn.disabled = true;
  try {
    let historialInicial = [];
    if (currentCharacter.saludo) {
      historialInicial = [{ id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2, 5), rol: "assistant", contenido: currentCharacter.saludo }];
    }
    const chat = await crearNuevoChat(currentCharacter.id);
    const [, notasHeredadas] = await Promise.all([
      historialInicial.length ? ejecutarConRefresh(() => reemplazarHistorialNormalizado(chat.id, historialInicial)) : null,
      heredarNotasRol(currentCharacter.id, chat.id)
    ]);
    chatsCache = [chat, ...chatsCache.filter((c) => c.id !== chat.id)];
    document.getElementById("chat-char-sub").textContent = `${chatsCache.length} chat${chatsCache.length !== 1 ? "s" : ""}`;
    pintarListaChats();
    await seleccionarChat(chat.id, { historialConocido: historialInicial });
    showToast(notasHeredadas ? "Nuevo chat creado · 📝 Notas para Rol heredadas del chat anterior" : "Nuevo chat creado");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    delete chatNewBtn.dataset.creando;
    chatNewBtn.disabled = false;
  }
});
document.getElementById("chat-back-btn").addEventListener("click", () => {
  guardarBorradorAhora();
  detenerLectura();
  detenerDictado();
  const chatViewEl = document.getElementById("chat-view");
  chatViewEl.style.removeProperty("--pink");
  chatViewEl.style.removeProperty("--pink-glow");
  chatViewEl.style.removeProperty("--grad-main");
  chatViewEl.style.removeProperty("--grad-main-hover");
  document.getElementById("chat-view").classList.remove("visible");
  document.getElementById("dashboard").style.display = "block";
  document.body.style.overflow = "";
  currentCharacter = null;
  currentChatId = null;
  renderCharacters();
});
document.getElementById("btn-immersive").addEventListener("click", () => {
  const chatView = document.getElementById("chat-view"), btn = document.getElementById("btn-immersive");
  chatView.classList.toggle("immersive");
  if (chatView.classList.contains("immersive")) {
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>`;
    btn.title = "Salir del modo inmersivo";
    showToast("🎯 Modo inmersivo activado");
  } else {
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;
    btn.title = "Modo inmersivo";
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "F11" && document.getElementById("chat-view").classList.contains("visible")) {
    e.preventDefault();
    document.getElementById("btn-immersive").click();
  }
});
document.getElementById("chat-export-btn").addEventListener("click", async () => {
  if (!currentChatId) {
    showToast("Selecciona un chat primero", "error");
    return;
  }
  try {
    const { mensajes } = await cargarHistorialCompleto(currentChatId), fecha = (/* @__PURE__ */ new Date()).toISOString().split("T")[0], nombreChar = currentCharacter?.nombre || "chat", nombreArchivo = `${nombreChar}_${currentChatId.substring(0, 8)}_${fecha}`;
    const data = { format_version: 4, character: { id: currentCharacter.id, name: currentCharacter.nombre, system_prompt: currentCharacter.system_prompt }, export_date: (/* @__PURE__ */ new Date()).toISOString(), notes: obtenerNotasRolActual(), diary: obtenerDiarioActual(), messages: mensajes.map((m) => {
      const item = { id: m.id || null, role: m.rol, content: m.contenido, timestamp: m.creado_en || null, summary_version: m.summary_version || null };
      if (m.rol === "summary" && m.hasta) item.covers_until = m.hasta;
      if (Array.isArray(m.variantes) && m.variantes.length) {
        item.variants = m.variantes;
        item.active_variant = Number(m.variante_activa) || 0;
      }
      return item;
    }) };
    const contenido = JSON.stringify(data, null, 2), blob = new Blob([contenido], { type: "application/json" }), url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url;
    a.download = `${nombreArchivo}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("✅ Chat exportado como JSON");
  } catch (err) {
    console.error("Error al exportar:", err);
    showToast("❌ Error al exportar", "error");
  }
});
const chatSearchInput = document.getElementById("chat-search-input");
if (chatSearchInput) {
  chatSearchInput.addEventListener("input", () => {
    filtroChats = chatSearchInput.value.trim().toLowerCase();
    pintarListaChats();
  });
}
const chatInput = document.getElementById("chat-input"), chatSendBtn = document.getElementById("chat-send-btn");
chatInput.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + "px";
  chatSendBtn.disabled = !chatInput.value.trim() || isStreaming || !currentChatId;
});
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!chatSendBtn.disabled) enviarMensaje();
  }
});
chatSendBtn.addEventListener("click", () => enviarMensaje());
document.getElementById("chat-import-btn").addEventListener("click", () => {
  document.getElementById("chat-import-file").click();
});
document.getElementById("chat-import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.name.endsWith(".json")) {
    showToast("❌ Solo se permiten archivos JSON", "error");
    e.target.value = "";
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast("❌ Archivo demasiado grande (máx. 5MB)", "error");
    e.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.character || !data.messages || !Array.isArray(data.messages)) {
        throw new Error("Estructura JSON inválida");
      }
      if (data.messages.length > 5e3) {
        throw new Error("Demasiados mensajes (máx. 5000)");
      }
      if (!currentCharacter) {
        showToast("❌ Selecciona un personaje primero", "error");
        return;
      }
      if (data.character.id !== currentCharacter.id) {
        if (!await confirmarSAIR("¿Importar de todos modos?", `Este chat es de «${data.character.name}», pero estás en «${currentCharacter.nombre}».`, { aceptar: "Importar" })) {
          return;
        }
      }
      const rolesPermitidos = ["user", "assistant", "summary"];
      const nuevoId = () => crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
      const mapaIds = /* @__PURE__ */ new Map();
      const historial = data.messages.filter((m) => m && typeof m.content === "string" && rolesPermitidos.includes(m.role)).slice(0, 5e3).map((m) => {
        const id = nuevoId();
        if (typeof m.id === "string" && m.id) mapaIds.set(m.id, id);
        const item = { id, rol: m.role, contenido: String(m.content).slice(0, m.role === "summary" ? 2e4 : 8e3), creado_en: m.timestamp || null };
        if (m.role === "summary") {
          item.summary_version = Number(m.summary_version) || 1;
          if (typeof m.covers_until === "string") item.hastaOriginal = m.covers_until;
        } else if (Array.isArray(m.variants)) {
          const v = m.variants.filter((x) => typeof x === "string").slice(0, 10).map((x) => x.slice(0, 8e3));
          if (v.length) {
            item.variantes = v;
            item.variante_activa = Math.min(Math.max(0, Number(m.active_variant) || 0), v.length - 1);
          }
        }
        return item;
      });
      historial.forEach((m) => {
        if (m.hastaOriginal) {
          m.hasta = mapaIds.get(m.hastaOriginal) || null;
          delete m.hastaOriginal;
        }
      });
      if (!historial.some((m) => m.rol === "user" || m.rol === "assistant")) {
        throw new Error("No hay mensajes válidos para importar");
      }
      const nuevoChat = await crearNuevoChat(currentCharacter.id);
      await actualizarHistorialChat(nuevoChat.id, historial);
      if (typeof data.notes === "string" && data.notes.trim()) await guardarNotasRol(nuevoChat.id, data.notes.slice(0, 8e3));
      const diarioImportado = normalizarDiario(data.diary);
      if (diarioImportado) await guardarDiario(nuevoChat.id, diarioImportado);
      await renderChatList();
      await seleccionarChat(nuevoChat.id);
      showToast(`✅ Chat importado (${historial.filter((m) => m.rol !== "summary").length} mensajes${historial.some((m) => m.rol === "summary") ? " + resumen" : ""})`);
    } catch (err) {
      console.error("Error al importar:", err);
      showToast(`❌ Error al importar: ${err.message}`, "error");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});
async function cargarMensajesAnteriores() {
  if (!currentChatId || historialCargandoMas || !historialTieneMas) return;
  historialCargandoMas = true;
  renderizarChatPaginado({ scrollToBottom: false });
  try {
    const actuales = historialCompleto.filter((m) => m.rol === "user" || m.rol === "assistant");
    const resultado = await cargarHistorialChat(currentChatId, { paginado: true, offset: actuales.length, limit: CHAT_LIMITE });
    const anteriores = resultado.mensajes.filter((m) => m.rol === "user" || m.rol === "assistant");
    const resumen = historialCompleto.find((m) => m.rol === "summary") || resultado.mensajes.find((m) => m.rol === "summary");
    const idsActuales = new Set(actuales.filter((m) => m.id).map((m) => m.id));
    const anterioresUnicos = anteriores.filter((m) => !m.id || !idsActuales.has(m.id));
    historialCompleto = [...resumen ? [resumen] : [], ...anterioresUnicos, ...actuales];
    historialTotalMensajes = resultado.totalMensajes;
    historialTieneMas = resultado.hasMore && anterioresUnicos.length > 0;
    historialEsLegacy = resultado.usandoLegacy;
    chatOffset = historialCompleto.filter((m) => m.rol === "user" || m.rol === "assistant").length;
  } catch (err) {
    console.error("Error cargando mensajes anteriores:", err);
    showToast(`❌ ${err.message}`, "error");
  } finally {
    historialCargandoMas = false;
    renderizarChatPaginado({ scrollToBottom: false, preserveScroll: true });
  }
}
function renderizarChatPaginado(opciones = {}) {
  const { scrollToBottom = true, preserveScroll = false } = opciones, messages = document.getElementById("chat-messages");
  let prevScrollHeight = 0, prevScrollTop = 0;
  if (preserveScroll) {
    prevScrollHeight = messages.scrollHeight;
    prevScrollTop = messages.scrollTop;
  }
  messages.innerHTML = "";
  const mensajesAMostrar = historialCompleto.filter((m) => m.rol === "user" || m.rol === "assistant");
  const fragment = document.createDocumentFragment();
  if (historialTieneMas || historialCargandoMas) {
    const restantes = Math.max(historialTotalMensajes - mensajesAMostrar.length, 0), loadMore = document.createElement("button");
    loadMore.className = "load-more-btn";
    loadMore.type = "button";
    loadMore.disabled = historialCargandoMas;
    loadMore.setAttribute("aria-label", "Cargar mensajes anteriores");
    loadMore.innerHTML = historialCargandoMas ? "<span>⏳ Cargando mensajes anteriores…</span>" : `<svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"></polyline></svg>Cargar ${Math.min(CHAT_LIMITE, restantes || CHAT_LIMITE)} mensajes anteriores`;
    if (!historialCargandoMas) loadMore.addEventListener("click", cargarMensajesAnteriores);
    fragment.appendChild(loadMore);
  }
  mensajesAMostrar.forEach((m) => agregarBubble(contenidoVariante(m), m.rol, false, m.id, false, fragment, m));
  messages.appendChild(fragment);
  if (preserveScroll) requestAnimationFrame(() => requestAnimationFrame(() => {
    messages.scrollTop = prevScrollTop + (messages.scrollHeight - prevScrollHeight);
  }));
  else if (scrollToBottom) scrollChatToBottom(true);
}
function agregarBubble(texto, rol, conTyping = false, mensajeId = null, autoScroll = true, parent = null, mensaje = null) {
  const container = parent || document.getElementById("chat-messages"), div = document.createElement("div");
  div.className = `message-bubble ${rol}`;
  if (mensajeId) div.dataset.mensajeId = mensajeId;
  if (conTyping) div.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
  else {
    div.innerHTML = rol === "assistant" ? renderMarkdown(texto) : escapeHtml(texto);
    div.dataset.originalText = texto;
    agregarBotones(div, rol);
    aplicarAvisoRespuestaIncompleta(div);
    if (mensaje) aplicarVariantesUI(div, mensaje);
  }
  container.appendChild(div);
  if (autoScroll && !parent) scrollChatToBottom();
  return div;
}
function agregarBotones(bubble, rol) {
  const oldActions = bubble.querySelector(".message-actions");
  if (oldActions) oldActions.remove();
  const actionsDiv = document.createElement("div");
  actionsDiv.className = "message-actions";
  let buttonsHTML = "";
  buttonsHTML += `<button type="button" class="btn-message btn-copy" title="Copiar mensaje"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>Copiar</button>`;
  buttonsHTML += `<button type="button" class="btn-message btn-delete-msg" title="Eliminar mensaje" aria-label="Eliminar este mensaje"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>Eliminar</button>`;
  const esAvisoNormas = rol === "assistant" && razonAvisoNormas(bubble.dataset.originalText) !== null;
  if (rol === "user") {
    buttonsHTML += `<button type="button" class="btn-message btn-edit-msg" title="Editar mensaje"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>Editar</button>`;
  } else if (rol === "assistant" && !esAvisoNormas) {
    if (vozDisponible) buttonsHTML += `<button type="button" class="btn-message btn-leer" title="Leer en voz alta" aria-pressed="false">${ICONO_ALTAVOZ}Leer</button>`;
    buttonsHTML += `<button type="button" class="btn-message btn-regenerate" data-mensaje-id="${bubble.dataset.mensajeId || ""}" title="Regenerar respuesta"><svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.63 4.36a9 9 0 0 0 14.85-3.36L23 14"></path></svg>Regenerar</button>`;
  }
  actionsDiv.innerHTML = buttonsHTML;
  bubble.appendChild(actionsDiv);
}
function mostrarErrorRateLimit(bubble, errorMessage, actionType, actionData) {
  if (rateLimitTimer) {
    clearInterval(rateLimitTimer);
    rateLimitTimer = null;
  }
  let segundos = 60;
  const match = errorMessage.match(/(\d+)\s*seconds?/i);
  if (match) segundos = parseInt(match[1]) || 60;
  rateLimitCountdown = segundos;
  pendingAction = actionType;
  pendingData = actionData;
  const messages = document.getElementById("chat-messages");
  const div = document.createElement("div");
  div.className = "message-bubble error";
  div.style.maxWidth = "90%";
  const updateContent = () => {
    div.innerHTML = `<div style="display:flex;flex-direction:column;gap:.5rem;"><span style="color:#fca5a5;">⏳ Límite de peticiones excedido. Espera <strong>${rateLimitCountdown}s</strong> para reintentar.</span><div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:.3rem;"><button type="button" class="btn-message btn-retry" style="${rateLimitCountdown > 0 ? "opacity:.5;pointer-events:none;" : ""}"><svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.63 4.36a9 9 0 0 0 14.85-3.36L23 14"></path></svg>Reintentar</button></div></div>`;
  };
  updateContent();
  if (bubble) {
    bubble.innerHTML = div.innerHTML;
    bubble.className = "message-bubble error";
    bubble._rateLimitDiv = div;
  } else {
    messages.appendChild(div);
    window._rateLimitBubble = div;
  }
  rateLimitTimer = setInterval(() => {
    rateLimitCountdown--;
    if (rateLimitCountdown <= 0) {
      clearInterval(rateLimitTimer);
      rateLimitTimer = null;
      const targetBubble = bubble || window._rateLimitBubble;
      if (targetBubble) {
        const btn = targetBubble.querySelector(".btn-retry");
        if (btn) {
          btn.style.opacity = "1";
          btn.style.pointerEvents = "auto";
        }
        const span = targetBubble.querySelector("span");
        if (span) span.innerHTML = "⏳ Límite de peticiones excedido. <strong>¡Ya puedes reintentar!</strong>";
      }
    } else {
      const targetBubble = bubble || window._rateLimitBubble;
      if (targetBubble) {
        const span = targetBubble.querySelector("span");
        if (span) span.innerHTML = `⏳ Límite de peticiones excedido. Espera <strong>${rateLimitCountdown}s</strong> para reintentar.`;
      }
    }
  }, 1e3);
  if (rateLimitRetryHandler) document.removeEventListener("click", rateLimitRetryHandler);
  const retryHandler = (e) => {
    const btn = e.target.closest(".btn-retry");
    if (!btn) return;
    if (rateLimitCountdown > 0) return;
    if (rateLimitTimer) {
      clearInterval(rateLimitTimer);
      rateLimitTimer = null;
    }
    const targetBubble = bubble || window._rateLimitBubble;
    if (targetBubble) targetBubble.remove();
    if (window._rateLimitBubble) delete window._rateLimitBubble;
    if (pendingAction === "send") reintentarRespuestaAsistente(pendingData.bubbleIA, pendingData.text);
    else if (pendingAction === "regenerate") {
      const { mensajeId, bubbleElement } = pendingData;
      regenerarRespuesta(mensajeId, bubbleElement);
    }
    pendingAction = null;
    pendingData = null;
    if (rateLimitRetryHandler) {
      document.removeEventListener("click", rateLimitRetryHandler);
      rateLimitRetryHandler = null;
    }
  };
  rateLimitRetryHandler = retryHandler;
  document.addEventListener("click", retryHandler);
}
let ultimoMensajeEnviado = "";
