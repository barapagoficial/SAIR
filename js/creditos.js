const CR_LS = { MOTOR: "sair1_motor_ia", MODELO: "sair1_cr_modelo" };
const CR_PAGO_KEY = "sair1_cr_pago";
const CR_COSTOS = { mensaje: 1, regenerar: 1, editar: 1, continuar: 1, historiador: 20, historiador_sigue: 3, recap: 8, diario: 8, generar_personaje: 3, resumen: 0 };
const CR_MODELOS = { flash: "DeepSeek Flash", pro: "DeepSeek Pro" };
const CR_MAX_CARACTERES = 88e3, CR_MAX_MENSAJES = 390;
let crSaldo = { flash: 0, pro: 0, cargado: false };
let crLotes = [];
let crAccionSiguiente = "mensaje";
function crLeer(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function crEscribir(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {
  }
}
function usaCR() {
  return crLeer(CR_LS.MOTOR) === "cr";
}
function modeloCR() {
  return crLeer(CR_LS.MODELO) === "pro" ? "pro" : "flash";
}
function fijarMotorIA(motor, modelo) {
  crEscribir(CR_LS.MOTOR, motor === "cr" ? "cr" : "gemini");
  if (modelo) crEscribir(CR_LS.MODELO, modelo === "pro" ? "pro" : "flash");
  pintarSaldoCR();
  pintarMotorCR();
  if (typeof actualizarIndicadoresChat === "function") actualizarIndicadoresChat();
}
function iaDisponible() {
  return usaCR() || !!getGeminiKey();
}
const CR_AVISO_SIN_IA = "Configura tu API Key de Gemini o activa tus Créditos de Rol en Ajustes de Rol (🎭)";
function exigirIA(mostrarError) {
  if (iaDisponible()) return true;
  if (typeof mostrarError === "function") mostrarError(CR_AVISO_SIN_IA);
  else showToast("⚠️ " + CR_AVISO_SIN_IA, "error");
  return false;
}
function prepararAccionCR(accion) {
  crAccionSiguiente = accion in CR_COSTOS ? accion : "mensaje";
}
function etiquetaMotorChat() {
  return usaCR() ? CR_MODELOS[modeloCR()] : etiquetaModelo(getGeminiModel());
}
function etiquetaMotorHerramientas(accion) {
  if (!usaCR()) return etiquetaModelo(getSummaryModel());
  const c = CR_COSTOS[accion];
  return `${CR_MODELOS[modeloCR()]}${c ? ` · ${c} CR` : ""}`;
}
function formatoCOP(n) {
  return "$" + Number(n || 0).toLocaleString("es-CO");
}
function fechaCortaCR(iso) {
  try {
    return new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "";
  }
}
function fechaHoraCR(iso) {
  try {
    return new Date(iso).toLocaleString("es", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}
function faltaCR(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (!(ms > 0)) return "";
  const h = Math.floor(ms / 36e5), d = Math.floor(h / 24);
  if (d >= 1) return `${d} d ${h % 24} h`;
  if (h >= 1) return `${h} h ${Math.floor(ms / 6e4) % 60} min`;
  return `${Math.max(1, Math.floor(ms / 6e4))} min`;
}
async function tokenSesionCR() {
  const { data } = await sbClient.auth.getSession();
  let s = data?.session;
  if (s && s.expires_at && s.expires_at * 1e3 < Date.now() + 6e4) {
    const r = await sbClient.auth.refreshSession();
    if (r.data?.session) s = r.data.session;
  }
  if (!s?.access_token) {
    const e = new Error("Inicia sesión para usar tus Créditos de Rol");
    e.status = 401;
    throw e;
  }
  return s.access_token;
}
async function llamarFuncionCR(nombre, cuerpo, signal) {
  const token = await tokenSesionCR();
  try {
    return await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/${nombre}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: CONFIG.SUPABASE_ANON_KEY },
      body: JSON.stringify(cuerpo),
      signal
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    const e = new Error("No se pudo conectar con el servicio de Créditos de Rol. Revisa tu conexión.");
    e.tipo = "red";
    throw e;
  }
}
async function errorRespuestaCR(res) {
  let d = null;
  try {
    d = await res.json();
  } catch {
  }
  const e = new Error(d?.error || `El servicio de Créditos de Rol falló (${res.status})`);
  e.status = res.status;
  e.codigo = d?.codigo || null;
  e.tipo = res.status === 429 ? "cuota" : "cr";
  if (e.codigo === "SALDO_INSUFICIENTE") {
    e.message = "No te quedan Créditos de Rol suficientes. Recarga en la pestaña 💜 Créditos de Rol.";
    if (typeof d?.saldo === "number") actualizarSaldoCR({ [modeloCR()]: d.saldo });
  }
  return e;
}
async function jsonFuncionCR(nombre, cuerpo) {
  const res = await llamarFuncionCR(nombre, cuerpo);
  if (!res.ok) throw await errorRespuestaCR(res);
  return res.json();
}
function mensajesParaCR(sistema, turnos) {
  const lista = [];
  for (const t of turnos) {
    const texto = String(t?.texto || "").trim();
    if (!texto) continue;
    const role = t.rol === "assistant" ? "assistant" : "user";
    const ultimo = lista[lista.length - 1];
    if (ultimo && ultimo.role === role) ultimo.content += "\n\n" + texto;
    else lista.push({ role, content: texto });
  }
  if (lista.length && lista[0].role === "assistant") lista.unshift({ role: "user", content: "(Comienza el rol.)" });
  const sys = String(sistema || "").trim();
  return sys ? [{ role: "system", content: sys }, ...lista] : lista;
}
function caracteresCR(lista) {
  return lista.reduce((n, m) => n + m.content.length, 0);
}
async function* streamCR({ accion, mensajes, onFin = null, conAbort = false }) {
  if (caracteresCR(mensajes) > CR_MAX_CARACTERES) throw new Error("La conversación es demasiado larga para enviarla de una vez. Resume el chat (🧠) e inténtalo de nuevo.");
  const controller = new AbortController();
  if (conAbort) abortarGeneracion = controller;
  let timeoutId = setTimeout(() => controller.abort("timeout"), 3e5);
  const traducirAbort = () => {
    if (controller.signal.reason === "usuario") {
      generacionCancelada = true;
      return new Error("Generación detenida.");
    }
    return new Error("Tiempo de espera agotado. La IA no respondió a tiempo.");
  };
  let res;
  try {
    res = await llamarFuncionCR("cr-chat", { modelo: modeloCR(), accion, mensajes, chat_id: currentChatId || null }, controller.signal);
  } catch (err) {
    clearTimeout(timeoutId);
    if (conAbort && abortarGeneracion === controller) abortarGeneracion = null;
    if (err?.name === "AbortError" || controller.signal.aborted) throw traducirAbort();
    throw err;
  }
  clearTimeout(timeoutId);
  if (!res.ok) {
    if (conAbort && abortarGeneracion === controller) abortarGeneracion = null;
    throw await errorRespuestaCR(res);
  }
  if (!res.body) throw new Error("El servicio de Créditos de Rol no devolvió una respuesta válida");
  timeoutId = setTimeout(() => controller.abort("stall"), 9e4);
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buffer = "", escribio = false, fin = null;
  const leer = (linea) => {
    const l = linea.trim();
    if (!l.startsWith("data:")) return null;
    let obj;
    try {
      obj = JSON.parse(l.slice(5).trim());
    } catch {
      return null;
    }
    if (obj.fin) {
      fin = obj;
      return null;
    }
    return typeof obj.t === "string" ? obj.t : null;
  };
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => controller.abort("stall"), 9e4);
      buffer += decoder.decode(value, { stream: true });
      const lineas = buffer.split("\n");
      buffer = lineas.pop() || "";
      for (const linea of lineas) {
        const t = leer(linea);
        if (t) {
          escribio = true;
          yield t;
        }
      }
    }
    buffer += decoder.decode();
    for (const linea of buffer.split("\n")) {
      const t = leer(linea);
      if (t) {
        escribio = true;
        yield t;
      }
    }
  } catch (err) {
    if (controller.signal.aborted || err?.name === "AbortError") throw traducirAbort();
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (conAbort && abortarGeneracion === controller) abortarGeneracion = null;
    if (fin && typeof fin.saldo === "number") actualizarSaldoCR({ [modeloCR()]: fin.saldo });
    if (onFin) try {
      onFin(fin);
    } catch {
    }
  }
  if (!escribio) {
    const e = new Error(fin?.devuelto ? "La IA no generó ninguna respuesta. Tus créditos fueron devueltos; intenta de nuevo." : "La IA no generó ninguna respuesta. Intenta de nuevo.");
    e.tipo = "generico";
    throw e;
  }
}
async function* enviarCRStream(systemPrompt, mensajes, nuevoMensaje) {
  const accion = crAccionSiguiente;
  crAccionSiguiente = "mensaje";
  const { sistema, turnos } = prepararTurnosRol(systemPrompt, mensajes, nuevoMensaje);
  const lista = mensajesParaCR(sistema, turnos.map((t) => ({ rol: t.rol, texto: t.partes.join("\n\n") })));
  lastGeminiFinishReason = "";
  yield* streamCR({ accion, mensajes: lista, conAbort: true, onFin: (fin) => {
    const m = String(fin?.motivo || "");
    lastGeminiFinishReason = !fin ? "SIN_FINAL" : m === "length" ? "MAX_TOKENS" : m === "content_filter" ? "FILTRO" : "STOP";
  } });
}
async function peticionCRTexto({ systemPrompt, contenido, mensajes, instruccion, accion = "resumen" }) {
  const turnos = [];
  if (Array.isArray(mensajes) && mensajes.length) {
    for (const m of mensajes) if (m && (m.rol === "user" || m.rol === "assistant")) turnos.push({ rol: m.rol, texto: m.contenido });
  } else turnos.push({ rol: "user", texto: contenido });
  if (instruccion) turnos.push({ rol: "user", texto: instruccion });
  let lista = mensajesParaCR(systemPrompt, turnos);
  if (lista.length > CR_MAX_MENSAJES) {
    const texto2 = typeof textoDeMensajes === "function" ? textoDeMensajes(mensajes) : turnos.map((t) => t.texto).join("\n\n");
    lista = mensajesParaCR(systemPrompt, [{ rol: "user", texto: `CONVERSACIÓN:

${texto2}` }, { rol: "user", texto: instruccion || "" }]);
  }
  let texto = "", fin = null;
  try {
    for await (const t of streamCR({ accion, mensajes: lista, onFin: (f) => {
      fin = f;
    } })) texto += t;
  } catch (err) {
    if (texto.trim().length >= 200) return { texto: texto.trim(), cortado: true };
    throw err;
  }
  return { texto: texto.trim(), cortado: !fin || fin.motivo === "length" };
}
function actualizarSaldoCR(s) {
  if (!s) return;
  if (typeof s.flash === "number") crSaldo.flash = s.flash;
  if (typeof s.pro === "number") crSaldo.pro = s.pro;
  crSaldo.cargado = true;
  pintarSaldoCR();
  pintarMotorCR();
}
async function cargarLotesCR() {
  if (!currentUser || !sbClient) return crLotes;
  const { data, error } = await sbClient.from("cr_lotes").select("id,modelo,creditos_iniciales,creditos_restantes,vence_en").eq("user_id", currentUser.id).gt("vence_en", (/* @__PURE__ */ new Date()).toISOString()).gt("creditos_restantes", 0).order("vence_en", { ascending: true });
  if (error) {
    console.warn("ℹ️ Créditos de Rol no disponibles:", error.message);
    return crLotes;
  }
  crLotes = data || [];
  const s = { flash: 0, pro: 0 };
  for (const l of crLotes) s[l.modelo] = (s[l.modelo] || 0) + (Number(l.creditos_restantes) || 0);
  actualizarSaldoCR(s);
  return crLotes;
}
function proximoVencimientoCR(modelo) {
  const l = crLotes.find((x) => x.modelo === modelo);
  return l ? l.vence_en : null;
}
function pintarSaldoCR() {
  const chip = document.getElementById("cr-saldo-chip");
  if (!chip) return;
  const activo = usaCR();
  chip.hidden = false;
  chip.classList.toggle("inactivo", !activo);
  const m = activo ? modeloCR() : crSaldo.flash <= 0 && crSaldo.pro > 0 ? "pro" : "flash", n = crSaldo[m] || 0;
  chip.dataset.nivel = !crSaldo.cargado || !activo ? "" : n <= 0 ? "vacio" : n <= 20 ? "bajo" : "";
  document.getElementById("cr-saldo-chip-texto").textContent = crSaldo.cargado ? `${n.toLocaleString("es")} CR` : "… CR";
  const vence = proximoVencimientoCR(m);
  const detalle = `${n} Créditos de Rol (${CR_MODELOS[m]})${vence ? ` · los próximos vencen el ${fechaCortaCR(vence)}` : ""}`;
  chip.title = n <= 0 ? "Aún no tienes Créditos de Rol. Pulsa para ver la tienda." : activo ? `${detalle}. Pulsa para ver tu saldo y recargar.` : `${detalle}. Ahora responde tu API Key de Gemini: pulsa para cambiar a tus CR.`;
  chip.setAttribute("aria-label", chip.title);
}
function pintarMotorCR() {
  const card = document.getElementById("cr-motor-card");
  if (!card) return;
  const actual = usaCR() ? modeloCR() : "gemini";
  card.querySelectorAll('input[name="motor-ia"]').forEach((r) => {
    r.checked = r.value === actual;
  });
  const flash = document.getElementById("cr-opcion-flash-saldo"), pro = document.getElementById("cr-opcion-pro-saldo");
  const vence = proximoVencimientoCR("flash");
  if (flash) flash.textContent = crSaldo.cargado ? crSaldo.flash > 0 ? `${crSaldo.flash.toLocaleString("es")} CR${vence ? ` · vencen el ${fechaCortaCR(vence)}` : ""}` : "Sin créditos · cómpralos en la tienda" : "Cargando saldo…";
  const radioPro = card.querySelector('input[value="pro"]');
  const hayPro = crSaldo.pro > 0;
  if (radioPro) {
    radioPro.disabled = !hayPro && actual !== "pro";
    radioPro.closest(".cr-opcion")?.classList.toggle("deshabilitada", radioPro.disabled);
  }
  if (pro) pro.textContent = hayPro ? `${crSaldo.pro.toLocaleString("es")} CR` : "Próximamente";
  const motor = document.getElementById("rol-motor"), resumen = document.getElementById("rol-motor-resumen");
  if (motor) motor.classList.toggle("cr-en-pausa", usaCR());
  if (resumen && usaCR()) resumen.textContent = "En pausa: ahora responden tus Créditos de Rol";
}
function irATiendaCR() {
  document.querySelectorAll(".modal-overlay.visible").forEach((m) => {
    if (m.id !== "politicas-modal") closeModal(m.id);
  });
  const chat = document.getElementById("chat-view");
  if (chat && chat.classList.contains("visible")) document.getElementById("chat-back-btn")?.click();
  const tab = document.querySelector('.dashboard-tab[data-view="creditos"]');
  tab?.click();
  try {
    tab?.scrollIntoView({ inline: "center", block: "nearest" });
  } catch {
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}
document.getElementById("cr-motor-card")?.addEventListener("change", (e) => {
  const r = e.target.closest('input[name="motor-ia"]');
  if (!r) return;
  if (r.value === "gemini") {
    fijarMotorIA("gemini");
    showToast(getGeminiKey() ? "🔑 Ahora responde tu API Key de Gemini" : "🔑 Modo API Key: pega tu clave de Gemini abajo", "info");
    const motor = document.getElementById("rol-motor");
    if (motor && !getGeminiKey()) motor.open = true;
    if (typeof prepararModalRol === "function") prepararModalRol();
    return;
  }
  fijarMotorIA("cr", r.value);
  const n = crSaldo[r.value] || 0;
  if (crSaldo.cargado && n <= 0) showToast("💜 Modo Créditos de Rol activado. Aún no tienes créditos: consíguelos en la tienda", "info");
  else showToast(`⚡ Ahora responde ${CR_MODELOS[r.value]} con tus Créditos de Rol`, "success");
});
document.getElementById("cr-ir-tienda")?.addEventListener("click", irATiendaCR);
document.getElementById("cr-saldo-chip")?.addEventListener("click", () => {
  if (crSaldo.cargado && (crSaldo.flash || 0) <= 0 && (crSaldo.pro || 0) <= 0) {
    irATiendaCR();
    return;
  }
  if (typeof prepararModalRol === "function") prepararModalRol();
  openModal("role-modal");
});
const CR_ICONO = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>';
const CR_PAQUETE_INFO = {
  flash_pequeno: { lema: "Para probar y rolear tranquilo", ico: "✨" },
  flash_grande: { lema: "El favorito para rolear todos los días", ico: "🔥", destacado: true },
  pro_pequeno: { lema: "Respuestas más profundas y elaboradas", ico: "💎" }
};
let crTienda = { paquetes: [], drops: [], cupos: {}, apartados: {}, compras: [], consumos: [], cargando: false, turno: 0 };
const CR_ACCIONES = {
  mensaje: { uno: "mensaje", varios: "mensajes", ico: "💬" },
  regenerar: { uno: "respuesta regenerada", varios: "respuestas regeneradas", ico: "🔄" },
  editar: { uno: "mensaje editado", varios: "mensajes editados", ico: "✏️" },
  continuar: { uno: "respuesta continuada", varios: "respuestas continuadas", ico: "➡️" },
  historiador: { uno: "capítulo del Historiador", varios: "capítulos del Historiador", ico: "📜" },
  historiador_sigue: { uno: "continuación de capítulo", varios: "continuaciones de capítulo", ico: "📜" },
  recap: { uno: "recapitulación", varios: "recapitulaciones", ico: "🎬" },
  diario: { uno: "diario de personajes", varios: "diarios de personajes", ico: "📖" },
  generar_personaje: { uno: "personaje creado con IA", varios: "personajes creados con IA", ico: "✨" },
  resumen: { uno: "resumen de memoria", varios: "resúmenes de memoria", ico: "🧠" }
};
function diaRelativoCR(fecha) {
  const d = new Date(fecha), hoy = /* @__PURE__ */ new Date();
  const clave = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const ayer = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1);
  if (clave(d) === clave(hoy)) return "Hoy";
  if (clave(d) === clave(ayer)) return "Ayer";
  return d.toLocaleDateString("es", { weekday: "short", day: "numeric", month: "short" });
}
function htmlMovimientosCR(consumos) {
  if (!consumos.length) return "";
  const dias = [];
  for (const c of consumos) {
    const dia = diaRelativoCR(c.creado_en);
    let g = dias[dias.length - 1];
    if (!g || g.dia !== dia) dias.push(g = { dia, total: 0, filas: /* @__PURE__ */ new Map() });
    const devuelto = c.estado === "devuelto";
    const clave = `${c.accion}|${devuelto ? "d" : c.estado === "reservado" ? "r" : "c"}`;
    const f = g.filas.get(clave) || { accion: c.accion, estado: devuelto ? "devuelto" : c.estado === "reservado" ? "reservado" : "cobrado", n: 0, cr: 0 };
    f.n++;
    f.cr += Number(c.creditos) || 0;
    g.filas.set(clave, f);
    if (!devuelto) g.total += Number(c.creditos) || 0;
  }
  const filaHtml = (f) => {
    const a = CR_ACCIONES[f.accion] || { uno: f.accion, varios: f.accion, ico: "•" };
    const nombre = `${f.n} ${f.n === 1 ? a.uno : a.varios}`;
    const valor = f.estado === "devuelto" ? '<span class="cr-mov-valor devuelto">Devuelto</span>' : f.estado === "reservado" ? '<span class="cr-mov-valor">En curso</span>' : f.cr === 0 ? '<span class="cr-mov-valor gratis">Gratis</span>' : `<span class="cr-mov-valor">−${f.cr.toLocaleString("es")} CR</span>`;
    return `<li><span class="cr-mov-ico" aria-hidden="true">${a.ico}</span><span class="cr-mov-nombre">${escapeHtml(nombre)}</span>${valor}</li>`;
  };
  return `<section class="cr-seccion"><details class="cr-movimientos"><summary><h3 class="cr-seccion-titulo">En qué se fueron tus créditos</h3><span class="cr-mov-resumen">Últimos 30 días</span></summary>${dias.map((g) => `<div class="cr-mov-dia"><div class="cr-mov-dia-cab"><span>${escapeHtml(g.dia)}</span><strong>${g.total ? `−${g.total.toLocaleString("es")} CR` : "0 CR"}</strong></div><ul>${[...g.filas.values()].map(filaHtml).join("")}</ul></div>`).join("")}</details></section>`;
}
async function cargarTiendaCR() {
  const ahora = (/* @__PURE__ */ new Date()).toISOString();
  const desde30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const [paq, drops, compras, consumos] = await Promise.all([
    sbClient.from("cr_paquetes").select("id,nombre,modelo,creditos,precio_cop,dias_vigencia,orden").order("orden"),
    sbClient.from("cr_drops").select("id,nombre,paquete_id,cupos,bono_pct,abre_en,cierra_en").or(`cierra_en.is.null,cierra_en.gt."${ahora}"`).order("abre_en"),
    sbClient.from("cr_compras").select("referencia,paquete_id,drop_id,monto_cop,creditos,estado,creado_en,reservado_hasta").eq("user_id", currentUser.id).order("creado_en", { ascending: false }).limit(6),
    sbClient.from("cr_consumos").select("accion,creditos,estado,creado_en").eq("user_id", currentUser.id).gt("creado_en", desde30).order("creado_en", { ascending: false }).limit(400),
    cargarLotesCR()
  ]);
  const error = paq.error || drops.error;
  if (error) throw new Error(error.message);
  const abiertos = (drops.data || []).filter((d) => new Date(d.abre_en).getTime() <= Date.now());
  const cupos = {}, apartados = {};
  await Promise.all(abiertos.map(async (d) => {
    const [c, a] = await Promise.all([
      sbClient.rpc("cr_cupos_disponibles", { p_drop_id: d.id }),
      sbClient.rpc("cr_apartados_drop", { p_drop_id: d.id })
    ]);
    cupos[d.id] = c.error ? null : Number(c.data) || 0;
    const fila = Array.isArray(a.data) ? a.data[0] : a.data;
    apartados[d.id] = !a.error && fila ? { n: Number(fila.apartados) || 0, libera: fila.libera_en } : { n: 0, libera: null };
  }));
  return { paquetes: paq.data || [], drops: drops.data || [], cupos, apartados, compras: compras.data || [], consumos: consumos.error ? [] : consumos.data || [] };
}
async function renderTiendaCR() {
  const container = document.getElementById("characters-container");
  if (!container || !currentUser) return;
  const turno = ++crTienda.turno;
  container.innerHTML = `<div class="cr-tienda"><div class="cr-cargando"><div class="recap-spinner"><div class="recap-spinner-core"></div></div><p>Cargando la tienda…</p></div></div>`;
  try {
    const datos = await cargarTiendaCR();
    if (turno !== crTienda.turno || currentView !== "creditos") return;
    Object.assign(crTienda, datos);
    pintarTiendaCR();
  } catch (err) {
    if (turno !== crTienda.turno) return;
    console.error("Tienda de CR:", err);
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><h3>No se pudo cargar la tienda</h3><p>${escapeHtml(err.message || "Intenta de nuevo en un momento")}</p><button type="button" class="btn btn-primary" id="cr-reintentar">🔄 Reintentar</button></div>`;
    document.getElementById("cr-reintentar")?.addEventListener("click", renderTiendaCR);
  }
}
function estadoPaqueteCR(p) {
  const ahora = Date.now();
  const propios = crTienda.drops.filter((d) => d.paquete_id === p.id);
  const abiertos = propios.filter((d) => new Date(d.abre_en).getTime() <= ahora);
  const conCupo = abiertos.find((d) => crTienda.cupos[d.id] === null || crTienda.cupos[d.id] > 0);
  const mia = abiertos.find((d) => crTienda.compras.some((c) => c.drop_id === d.id && c.estado === "pendiente" && new Date(c.reservado_hasta).getTime() > ahora));
  if (mia) return { tipo: "mia", drop: mia, libera: crTienda.compras.find((c) => c.drop_id === mia.id && c.estado === "pendiente").reservado_hasta };
  if (conCupo) return { tipo: "abierto", drop: conCupo, quedan: crTienda.cupos[conCupo.id] };
  const apartado = abiertos.find((d) => (crTienda.apartados[d.id]?.n || 0) > 0);
  if (apartado) return { tipo: "apartado", drop: apartado, libera: crTienda.apartados[apartado.id].libera };
  if (abiertos.length) return { tipo: "agotado", drop: abiertos[0] };
  const proximo = propios.find((d) => new Date(d.abre_en).getTime() > ahora);
  if (proximo) return { tipo: "proximo", drop: proximo };
  return { tipo: "sin_drop" };
}
function htmlPaqueteCR(p) {
  const info = CR_PAQUETE_INFO[p.id] || { lema: "", ico: "💜" };
  const est = estadoPaqueteCR(p);
  const bono = est.drop && est.drop.bono_pct > 0 ? Math.floor(p.creditos * est.drop.bono_pct / 100) : 0;
  const costoMensaje = Math.round(p.precio_cop / p.creditos);
  let estado = "", boton = "";
  if (est.tipo === "abierto") {
    const total = Number(est.drop.cupos) || 0, sabe = est.quedan !== null;
    const pct = sabe && total ? Math.max(6, Math.round(est.quedan / total * 100)) : 100;
    const cupos = sabe ? `quedan <strong>${est.quedan}</strong> de ${total} cupos` : `${total} cupos (no se pudo cargar cuántos quedan)`;
    estado = `<div class="cr-drop-estado abierto"><span class="cr-pulso" aria-hidden="true"></span><strong>Drop abierto</strong> · ${cupos}${est.drop.cierra_en ? ` · cierra en ${escapeHtml(faltaCR(est.drop.cierra_en))}` : ""}</div>${sabe ? `<div class="cr-cupos-barra" aria-hidden="true"><span style="width:${pct}%"></span></div>` : ""}`;
    const yaTiene = crTienda.compras.some((c) => c.drop_id === est.drop.id && c.estado === "aprobada");
    boton = yaTiene ? `<button type="button" class="btn btn-ghost" disabled>✅ Ya tienes tu cupo en este drop</button>` : `<button type="button" class="btn btn-primary cr-comprar" data-drop="${escapeHtml(est.drop.id)}" data-paquete="${escapeHtml(p.id)}">Comprar · ${formatoCOP(p.precio_cop)}</button>`;
  } else if (est.tipo === "mia") {
    estado = `<div class="cr-drop-estado abierto">⏳ <strong>Tienes este cupo apartado</strong> · se libera en ${escapeHtml(faltaCR(est.libera))} si no completas el pago</div>`;
    boton = `<button type="button" class="btn btn-primary cr-comprar" data-drop="${escapeHtml(est.drop.id)}" data-paquete="${escapeHtml(p.id)}">Continuar mi pago · ${formatoCOP(p.precio_cop)}</button>`;
  } else if (est.tipo === "apartado") {
    estado = `<div class="cr-drop-estado proximo">⏳ <strong>Alguien está pagando el último cupo.</strong> Si no completa el pago, se libera en ${escapeHtml(faltaCR(est.libera))}.</div>`;
    boton = `<button type="button" class="btn btn-ghost cr-recargar">Volver a revisar</button>`;
  } else if (est.tipo === "agotado") {
    estado = `<div class="cr-drop-estado agotado">🥀 <strong>Cupos agotados</strong> en este drop. Pronto sale otro.</div>`;
    boton = `<button type="button" class="btn btn-ghost" disabled>Agotado</button>`;
  } else if (est.tipo === "proximo") {
    estado = `<div class="cr-drop-estado proximo">⏳ <strong>Próximo drop:</strong> ${escapeHtml(fechaHoraCR(est.drop.abre_en))} · ${est.drop.cupos} cupos</div>`;
    boton = `<button type="button" class="btn btn-ghost" disabled>Abre en ${escapeHtml(faltaCR(est.drop.abre_en))}</button>`;
  } else {
    estado = `<div class="cr-drop-estado cerrado">Sin drop abierto ahora. Los cupos salen por tandas: te avisamos en Anuncios.</div>`;
    boton = `<button type="button" class="btn btn-ghost" disabled>Sin cupos ahora</button>`;
  }
  return `<article class="cr-paquete${info.destacado ? " destacado" : ""}${est.tipo === "abierto" ? " con-drop" : ""}" data-modelo="${escapeHtml(p.modelo)}">
${info.destacado ? '<span class="cr-paquete-cinta">Más elegido</span>' : ""}
<header class="cr-paquete-head"><span class="cr-paquete-ico" aria-hidden="true">${info.ico}</span><div><h3>${escapeHtml(p.nombre)}</h3><p>${escapeHtml(info.lema)}</p></div></header>
<div class="cr-paquete-cifra"><strong>${p.creditos.toLocaleString("es")}</strong><span>CR</span>${bono ? `<em class="cr-bono">+${bono} de regalo</em>` : ""}</div>
<ul class="cr-paquete-lista">
<li>≈ ${(p.creditos + bono).toLocaleString("es")} mensajes de rol</li>
<li>Vigencia de ${p.dias_vigencia} días</li>
<li>${escapeHtml(CR_MODELOS[p.modelo] || p.modelo)}${p.modelo === "flash" ? " con razonamiento" : ""}</li>
</ul>
<div class="cr-paquete-precio">${formatoCOP(p.precio_cop)} <small>COP · ${formatoCOP(costoMensaje)} por mensaje</small></div>
${estado}
${boton}
</article>`;
}
function htmlProProximamenteCR() {
  return `<article class="cr-paquete proximamente" data-modelo="pro">
<header class="cr-paquete-head"><span class="cr-paquete-ico" aria-hidden="true">💎</span><div><h3>Pro</h3><p>${escapeHtml(CR_PAQUETE_INFO.pro_pequeno.lema)}</p></div></header>
<div class="cr-paquete-cifra"><strong>Pronto</strong></div>
<ul class="cr-paquete-lista"><li>${CR_MODELOS.pro}</li><li>Llega en un próximo drop</li></ul>
<button type="button" class="btn btn-ghost" disabled>Próximamente</button>
</article>`;
}
const CR_ESTADOS_COMPRA = { pendiente: "⏳ Pendiente", sin_completar: "⌛ Sin completar", aprobada: "✅ Aprobada", rechazada: "❌ Rechazada", expirada: "⌛ Sin completar", reversada: "↩️ Reversada" };
function estadoCompraCR(c) {
  if (c.estado === "pendiente" && c.reservado_hasta && new Date(c.reservado_hasta).getTime() + 30 * 6e4 < Date.now()) return "sin_completar";
  return c.estado;
}
function pintarTiendaCR() {
  const container = document.getElementById("characters-container");
  if (!container) return;
  const { paquetes, compras, consumos = [] } = crTienda;
  const m = usaCR() ? modeloCR() : "flash";
  const saldo = crSaldo[m] || 0;
  const porFecha = /* @__PURE__ */ new Map();
  for (const l of crLotes.filter((x) => x.modelo === m)) {
    const f = fechaCortaCR(l.vence_en);
    porFecha.set(f, (porFecha.get(f) || 0) + (Number(l.creditos_restantes) || 0));
  }
  const lotesHtml = porFecha.size ? `<ul class="cr-lotes">${[...porFecha].map(([f, n]) => `<li><strong>${n.toLocaleString("es")} CR</strong> vencen el ${escapeHtml(f)}</li>`).join("")}</ul>` : '<p class="cr-saldo-vacio">Aún no tienes créditos. Cuando abra un drop, compra un paquete y empieza a rolear sin configurar nada.</p>';
  const motorBtn = usaCR() ? `<span class="cr-motor-activo">${CR_ICONO}Estás usando tus Créditos de Rol</span>` : `<button type="button" class="btn btn-primary btn-small" id="cr-activar">${CR_ICONO}Usar mis Créditos de Rol</button>`;
  const hayPro = paquetes.some((p) => p.modelo === "pro");
  const comprasHtml = compras.length ? `<section class="cr-seccion"><h3 class="cr-seccion-titulo">Tus compras</h3><ul class="cr-compras">${compras.map((c) => {
    const p = paquetes.find((x) => x.id === c.paquete_id);
    return `<li><span class="cr-compra-nombre">${escapeHtml(p?.nombre || c.paquete_id)} · ${Number(c.creditos).toLocaleString("es")} CR</span><span class="cr-compra-fecha">${escapeHtml(fechaCortaCR(c.creado_en))} · ${formatoCOP(c.monto_cop)}</span><span class="cr-compra-estado ${escapeHtml(estadoCompraCR(c))}">${CR_ESTADOS_COMPRA[estadoCompraCR(c)] || escapeHtml(c.estado)}</span></li>`;
  }).join("")}</ul></section>` : "";
  container.innerHTML = `<div class="cr-tienda">
<section class="cr-hero">
<div class="cr-hero-texto">
<span class="cr-kicker">${CR_ICONO}Créditos de Rol</span>
<h2>Rolea sin API Key</h2>
<p>Compra un paquete y tu personaje responde con DeepSeek al instante: sin claves, sin límites por minuto y sin configurar nada. Tu modo gratis con API Key de Gemini sigue ahí cuando quieras.</p>
</div>
<div class="cr-saldo-card">
<span class="cr-saldo-label">Tu saldo · ${escapeHtml(CR_MODELOS[m])}</span>
<div class="cr-saldo-cifra"><strong>${saldo.toLocaleString("es")}</strong><span>CR</span></div>
${lotesHtml}
${motorBtn}
</div>
</section>
<section class="cr-seccion">
<h3 class="cr-seccion-titulo">Paquetes</h3>
<div class="cr-paquetes">${paquetes.map(htmlPaqueteCR).join("")}${hayPro ? "" : htmlProProximamenteCR()}</div>
</section>
<section class="cr-seccion">
<h3 class="cr-seccion-titulo">¿Cuánto gasta cada cosa?</h3>
<div class="cr-costos">
<div class="cr-costo"><strong>1 CR</strong><span>Cada mensaje, regenerar, editar o continuar una respuesta</span></div>
<div class="cr-costo"><strong>${CR_COSTOS.historiador} CR</strong><span>Un capítulo del Historiador</span></div>
<div class="cr-costo"><strong>${CR_COSTOS.recap} CR</strong><span>Recapitulación o diario de los personajes</span></div>
<div class="cr-costo"><strong>${CR_COSTOS.generar_personaje} CR</strong><span>Crear un personaje con IA</span></div>
<div class="cr-costo gratis"><strong>Gratis</strong><span>Los resúmenes automáticos de memoria del chat</span></div>
</div>
<p class="cr-nota">Si la IA falla y no escribe nada, el crédito se devuelve solo. Al recargar, los créditos que te queden se extienden hasta la fecha del paquete nuevo.</p>
</section>
${comprasHtml}
${htmlMovimientosCR(consumos)}
<p class="cr-legal">🔒 Pagos seguros con Wompi (Bancolombia): tarjeta, PSE, Nequi y más. SAIR nunca ve los datos de tu tarjeta. Al pagar apartas tu cupo durante 15 minutos. <button type="button" class="cr-compra-terminos cr-ver-terminos">Términos de compra</button></p>
</div>`;
  container.querySelectorAll(".cr-recargar").forEach((b) => b.addEventListener("click", renderTiendaCR));
  container.querySelector(".cr-ver-terminos")?.addEventListener("click", () => abrirPoliticas("terminos"));
  container.querySelectorAll(".cr-comprar").forEach((b) => b.addEventListener("click", () => abrirCompraCR(b.dataset.drop, b.dataset.paquete)));
  document.getElementById("cr-activar")?.addEventListener("click", () => {
    fijarMotorIA("cr", crSaldo.flash <= 0 && crSaldo.pro > 0 ? "pro" : "flash");
    showToast("⚡ Listo: tus personajes ahora responden con tus Créditos de Rol", "success");
    pintarTiendaCR();
  });
}
let crCompraActual = null;
function abrirCompraCR(dropId, paqueteId) {
  const p = crTienda.paquetes.find((x) => x.id === paqueteId);
  const d = crTienda.drops.find((x) => x.id === dropId);
  if (!p || !d) return;
  crCompraActual = { dropId, paqueteId };
  const bono = d.bono_pct > 0 ? Math.floor(p.creditos * d.bono_pct / 100) : 0;
  document.getElementById("cr-compra-resumen").innerHTML = `
<div class="cr-compra-fila"><span>Paquete</span><strong>${escapeHtml(p.nombre)}</strong></div>
<div class="cr-compra-fila"><span>Créditos</span><strong>${(p.creditos + bono).toLocaleString("es")} CR${bono ? ` <em class="cr-bono">incluye +${bono}</em>` : ""}</strong></div>
<div class="cr-compra-fila"><span>Vigencia</span><strong>${p.dias_vigencia} días</strong></div>
<div class="cr-compra-fila total"><span>Total</span><strong>${formatoCOP(p.precio_cop)} COP</strong></div>`;
  const btn = document.getElementById("cr-compra-ir");
  const acepto = document.getElementById("cr-compra-acepto");
  acepto.checked = false;
  btn.disabled = true;
  btn.textContent = "Ir a pagar con Wompi";
  openModal("cr-compra-modal");
}
async function irAPagarCR() {
  if (!crCompraActual || !document.getElementById("cr-compra-acepto").checked) return;
  const btn = document.getElementById("cr-compra-ir");
  btn.disabled = true;
  btn.textContent = "Apartando tu cupo…";
  try {
    const redirect = `${location.origin}${location.pathname}?cr_pago=1`;
    const r = await jsonFuncionCR("cr-compra", { accion: "reservar", drop_id: crCompraActual.dropId, redirect_url: redirect });
    if (!r.checkout_url) throw new Error("No se pudo preparar el pago");
    if (r.pruebas) showToast("🧪 Modo de prueba de Wompi: no se cobra dinero real", "info");
    btn.textContent = "Abriendo Wompi…";
    location.href = r.checkout_url;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Ir a pagar con Wompi";
    showToast(`❌ ${err.message}`, "error");
    if (err.codigo) {
      closeModal("cr-compra-modal");
      if (currentView === "creditos") renderTiendaCR();
    }
  }
}
document.getElementById("cr-compra-ir")?.addEventListener("click", irAPagarCR);
document.getElementById("cr-compra-acepto")?.addEventListener("change", (e) => {
  document.getElementById("cr-compra-ir").disabled = !e.target.checked;
});
document.getElementById("cr-compra-terminos")?.addEventListener("click", (e) => {
  e.preventDefault();
  abrirPoliticas("terminos");
});
(function capturarRegresoWompi() {
  try {
    const params = new URLSearchParams(location.search);
    if (!params.has("cr_pago")) return;
    const id = params.get("id");
    if (id && /^[A-Za-z0-9_-]{4,80}$/.test(id)) sessionStorage.setItem(CR_PAGO_KEY, id);
    ["cr_pago", "id", "env"].forEach((k) => params.delete(k));
    const q = params.toString();
    history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash);
  } catch {
  }
})();
function avisarResultadoCompraCR(r) {
  if (!r) return;
  if (r.estado === "aprobada") {
    if (r.ya_estaba) return;
    showToast(`🎉 ¡+${Number(r.creditos || 0).toLocaleString("es")} Créditos de Rol! Ya puedes usarlos`, "success");
    if (!usaCR()) fijarMotorIA("cr", crSaldo.flash <= 0 && crSaldo.pro > 0 ? "pro" : "flash");
  } else if (r.estado === "rechazada") showToast("❌ El pago no se completó. No se te cobró y el cupo quedó libre.", "error");
  else if (r.estado === "pendiente") showToast("⏳ Tu pago sigue en proceso. Te avisamos al confirmarse.", "info");
  else if (r.estado === "expirada") showToast("⌛ Una reserva sin pagar venció y se liberó el cupo.", "info");
  else if (r.estado === "revisar") showToast(`⚠️ ${r.mensaje || "Hay algo raro con tu pago. Escríbenos a soporte."}`, "error");
}
async function verificarPagoPendienteCR() {
  let id = null;
  try {
    id = sessionStorage.getItem(CR_PAGO_KEY);
  } catch {
  }
  if (!id || !currentUser) return false;
  showToast("⏳ Confirmando tu pago con Wompi…", "info");
  try {
    const r = await jsonFuncionCR("cr-compra", { accion: "verificar", transaccion_id: id });
    try {
      sessionStorage.removeItem(CR_PAGO_KEY);
    } catch {
    }
    if (r.saldo) actualizarSaldoCR(r.saldo);
    await cargarLotesCR();
    avisarResultadoCompraCR(r);
    irATiendaCR();
  } catch (err) {
    if (err.status === 403 || err.status === 400) {
      try {
        sessionStorage.removeItem(CR_PAGO_KEY);
      } catch {
      }
    }
    showToast(`⚠️ ${err.message}${err.status >= 500 || err.tipo === "red" ? " Lo intentaremos de nuevo al volver a abrir SAIR." : ""}`, "error");
  }
  return true;
}
let crPendientesRevisados = null;
async function revisarComprasPendientesCR() {
  if (!currentUser || crPendientesRevisados === currentUser.id) return;
  crPendientesRevisados = currentUser.id;
  const desde = new Date(Date.now() - 3 * 24 * 36e5).toISOString();
  const { data, error } = await sbClient.from("cr_compras").select("referencia").eq("user_id", currentUser.id).eq("estado", "pendiente").gt("creado_en", desde).limit(1);
  if (error || !data?.length) return;
  try {
    const r = await jsonFuncionCR("cr-compra", { accion: "pendientes" });
    if (r.saldo) actualizarSaldoCR(r.saldo);
    const aprobadas = (r.resultados || []).filter((x) => x.estado === "aprobada" && !x.ya_estaba);
    if (aprobadas.length) {
      await cargarLotesCR();
      avisarResultadoCompraCR({ estado: "aprobada", creditos: aprobadas.reduce((n, x) => n + (Number(x.creditos) || 0), 0) });
      if (currentView === "creditos") renderTiendaCR();
    }
  } catch (err) {
    console.warn("ℹ️ No se pudieron revisar las compras pendientes:", err.message);
  }
}
async function iniciarCreditosRol() {
  if (!currentUser) return;
  pintarSaldoCR();
  try {
    await cargarLotesCR();
  } catch {
  }
  const verificando = await verificarPagoPendienteCR();
  if (!verificando) revisarComprasPendientesCR();
}
