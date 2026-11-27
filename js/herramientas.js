const POLITICAS_ACEPTADAS_KEY = "sair1_politicas_aceptadas";
const POLITICAS_VERSION = "2026-11-27b";
const politicasModal = document.getElementById("politicas-modal");
function verificarPoliticas() {
  if (!currentUser) return;
  const aceptadas = localStorage.getItem(POLITICAS_ACEPTADAS_KEY) === POLITICAS_VERSION;
  if (!aceptadas) {
    politicasModal.classList.add("visible");
    politicasModal._preventClose = true;
    document.querySelectorAll(".modal-overlay").forEach((m) => {
      if (m.id !== "politicas-modal") {
        m.style.pointerEvents = "none";
        m.style.opacity = "0.3";
      }
    });
    console.log("🔒 Políticas no aceptadas - modal mostrado");
  } else {
    politicasModal.classList.remove("visible");
    document.querySelectorAll(".modal-overlay").forEach((m) => {
      if (m.id !== "politicas-modal") {
        m.style.pointerEvents = "";
        m.style.opacity = "";
      }
    });
    console.log("✅ Políticas ya aceptadas");
  }
}
document.getElementById("btn-aceptar-politicas").addEventListener("click", function() {
  localStorage.setItem(POLITICAS_ACEPTADAS_KEY, POLITICAS_VERSION);
  politicasModal._preventClose = false;
  politicasModal.classList.remove("visible");
  document.querySelectorAll(".modal-overlay").forEach((m) => {
    if (m.id !== "politicas-modal") {
      m.style.pointerEvents = "";
      m.style.opacity = "";
    }
  });
  showToast("✅ Privacidad y Términos aceptados", "success");
  setTimeout(mostrarNovedadesSiToca, 800);
  console.log("✅ Políticas aceptadas por el usuario");
});
document.getElementById("btn-rechazar-politicas")?.addEventListener("click", async function() {
  if (await confirmarSAIR("¿Rechazar y cerrar sesión?", "Sin aceptar la Privacidad y los Términos no puedes usar SAIR. Se cerrará tu sesión.", { aceptar: "Rechazar y salir", cancelar: "Volver", peligro: true })) {
    if (sbClient) {
      sbClient.auth.signOut().then(() => {
        localStorage.removeItem(POLITICAS_ACEPTADAS_KEY);
        currentUser = null;
        userRole = null;
        userUsername = null;
        userRoleName = null;
        limpiarCacheUsuario();
        document.querySelectorAll(".modal-overlay.visible").forEach((m) => m.classList.remove("visible"));
        document.getElementById("chat-view").classList.remove("visible");
        document.getElementById("dashboard").classList.remove("visible");
        document.getElementById("auth-screen").classList.remove("visible");
        settingsBtn.classList.add("hidden");
        showAuth();
        showToast("👋 Has rechazado las políticas", "error");
      }).catch((err) => {
        showToast("Error al cerrar sesión", "error");
      });
    } else {
      window.location.reload();
    }
  }
});
politicasModal.addEventListener("click", function(e) {
  if (e.target === politicasModal && politicasModal._preventClose) {
    e.stopPropagation();
  }
});
function mostrarPestanaPoliticas(cual) {
  document.querySelectorAll(".politicas-tab").forEach((t) => {
    const activa = t.dataset.politica === cual;
    t.classList.toggle("active", activa);
    t.setAttribute("aria-selected", activa ? "true" : "false");
  });
  document.getElementById("politicas-privacidad").hidden = cual !== "privacidad";
  document.getElementById("politicas-terminos").hidden = cual !== "terminos";
  const panel = document.getElementById(cual === "terminos" ? "politicas-terminos" : "politicas-privacidad");
  panel.scrollTop = 0;
  const overlay = document.getElementById("politicas-modal");
  if (overlay.scrollTop > 0) overlay.scrollTop = 0;
}
document.querySelectorAll(".politicas-tab").forEach((t) => t.addEventListener("click", () => mostrarPestanaPoliticas(t.dataset.politica)));
function abrirPoliticas(cual = "privacidad") {
  mostrarPestanaPoliticas(cual);
  const modal = document.getElementById("politicas-modal");
  modal._preventClose = false;
  modal.classList.add("visible");
  modal.addEventListener("click", function handler(e) {
    if (e.target === modal) {
      modal.classList.remove("visible");
      modal._preventClose = true;
      modal.removeEventListener("click", handler);
    }
  }, { once: true });
}
document.getElementById("btn-ver-politicas").addEventListener("click", () => abrirPoliticas());
function prosaHtml(texto) {
  return String(texto || "").trim().split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${renderMarkdown(p)}</p>`).join("");
}
function contarPalabras(texto) {
  return (String(texto || "").match(/\S+/g) || []).length;
}
function htmlCargaHerramienta({ tema = "recap", titulo, sub = "", pasos = [], idSub = "" }) {
  const spin = tema === "historiador" ? "historiador-spinner" : "recap-spinner";
  return `<div class="herr-carga tema-${tema}" role="status" aria-live="polite">
<div class="${spin}"><div class="${spin}-core"></div></div>
<div class="herr-carga-titulo">${escapeHtml(titulo)}</div>
<div class="herr-carga-sub recap-loading-sub"${idSub ? ` id="${idSub}"` : ""}>${escapeHtml(sub)}</div>
${pasos.length ? `<ol class="herr-pasos">${pasos.map((p, i) => `<li class="${i === 0 ? "activo" : ""}"><span class="herr-paso-marca" aria-hidden="true"></span><span>${escapeHtml(p)}</span></li>`).join("")}</ol>` : ""}
<div class="herr-carga-pie"><div class="recap-progress"><div class="recap-progress-bar"></div></div><span class="herr-tiempo" aria-hidden="true">0:00</span></div>
</div>`;
}
function iniciarCargaHerramienta(contenedor, msPorPaso = 6e3) {
  if (!contenedor) return;
  if (contenedor._cargaTimer) clearInterval(contenedor._cargaTimer);
  const t0 = Date.now();
  contenedor._cargaTimer = setInterval(() => {
    const carga = contenedor.querySelector(".herr-carga");
    if (!carga || !contenedor.isConnected) {
      clearInterval(contenedor._cargaTimer);
      contenedor._cargaTimer = null;
      return;
    }
    const ms = Date.now() - t0, s = Math.floor(ms / 1e3);
    const tiempo = carga.querySelector(".herr-tiempo");
    if (tiempo) tiempo.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    const pasos = [...carga.querySelectorAll(".herr-pasos li")];
    const idx = Math.min(pasos.length - 1, Math.floor(ms / msPorPaso));
    pasos.forEach((li, i) => {
      li.classList.toggle("hecho", i < idx);
      li.classList.toggle("activo", i === idx);
    });
  }, 500);
}
function htmlBarraHerramienta(botones) {
  return `<footer class="herr-barra">${botones}</footer>`;
}
[["recap-content", ".recap-resultado"], ["historiador-content", ".historiador-res"], ["diario-content", ".diario-grid"]].forEach(([id, sel]) => {
  const cont = document.getElementById(id), modal = cont && cont.closest(".modal");
  if (!cont || !modal) return;
  new MutationObserver(() => modal.classList.toggle("con-resultado", !!cont.querySelector(sel))).observe(cont, { childList: true });
});
function descargarTexto(nombre, texto) {
  try {
    const url = URL.createObjectURL(new Blob([texto], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2e3);
  } catch {
    showToast("❌ No se pudo descargar", "error");
  }
}
function nombreArchivo(base) {
  return `${String(base || "SAIR").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "sair"}.txt`;
}
const recapContent = document.getElementById("recap-content");
const recapModal = document.getElementById("recap-modal");
function mostrarRecapConfirm() {
  if (!currentChatId) {
    showToast("⚠️ Selecciona un chat primero", "error");
    return;
  }
  recapContent.innerHTML = `
<div class="recap-confirm">
<div class="recap-icon-wrapper">
<svg viewBox="0 0 24 24"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10" stroke-dasharray="4 3"/></svg>
</div>
<div class="recap-title">¿Generar Recapitulación?</div>
<div class="recap-subtitle">Analizaré toda la conversación para darte un resumen completo de la historia y el estado actual del roleplay.</div>
<div class="recap-features">
<div class="recap-feature">
<div class="recap-feature-icon"><svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div>
<span><strong style="color:var(--pink)">La Historia:</strong> Todo lo que ha sucedido, resaltando momentos clave</span>
</div>
<div class="recap-feature">
<div class="recap-feature-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
<span><strong style="color:var(--blue)">Actualmente:</strong> Qué está pasando ahora en la conversación</span>
</div>
<div class="recap-feature">
<div class="recap-feature-icon"><svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>
<span>Powered by <strong style="color:var(--purple)">${escapeHtml(etiquetaMotorHerramientas("recap"))}</strong></span>
</div>
</div>
<div class="recap-actions">
<button type="button" class="btn btn-ghost" data-close-modal="recap-modal">Cancelar</button>
<button type="button" class="btn btn-primary" id="btn-confirm-recap">✨ Sí, generar</button>
</div>
</div>`;
  openModal("recap-modal");
  document.getElementById("btn-confirm-recap").addEventListener("click", ejecutarRecapitulacion);
  recapContent.querySelectorAll("[data-close-modal]").forEach((b) => b.addEventListener("click", () => closeModal("recap-modal")));
}
function mostrarRecapLoading(textoSub) {
  recapContent.innerHTML = htmlCargaHerramienta({ tema: "recap", titulo: "Analizando la conversación…", sub: textoSub || "Esto puede tardar unos segundos según la longitud del chat", pasos: ["Leyendo toda la conversación", "Ordenando lo que pasó", "Escribiendo la historia", "Describiendo cómo están ahora"] });
  iniciarCargaHerramienta(recapContent);
}
function mostrarRecapProgreso(i, n) {
  const sub = recapContent?.querySelector(".recap-loading-sub");
  if (!sub) return;
  sub.textContent = String(i && n ? `Resumiendo la historia por partes… (${i}/${n})` : "Resumiendo la historia por partes…");
}
function mostrarRecapError(msg) {
  recapContent.innerHTML = `
<div class="recap-confirm">
<div class="recap-icon-wrapper" style="background:linear-gradient(135deg,rgba(239,68,68,.2),rgba(239,68,68,.1))">
<svg viewBox="0 0 24 24" style="stroke:#fca5a5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
</div>
<div class="recap-title" style="background:linear-gradient(135deg,#ef4444,#f59e0b);-webkit-background-clip:text;background-clip:text">Error al generar</div>
<div class="recap-subtitle" style="color:#fca5a5">${escapeHtml(msg)}</div>
<div class="recap-actions">
<button type="button" class="btn btn-ghost" data-close-modal="recap-modal">Cerrar</button>
<button type="button" class="btn btn-primary" id="btn-retry-recap">🔄 Reintentar</button>
</div>
</div>`;
  recapContent.querySelectorAll("[data-close-modal]").forEach((b) => b.addEventListener("click", () => closeModal("recap-modal")));
  document.getElementById("btn-retry-recap").addEventListener("click", ejecutarRecapitulacion);
}
let ultimaRecapTexto = "";
function mostrarRecapResultado(historia, actualmente) {
  const nombre = currentCharacter?.nombre || "el personaje";
  ultimaRecapTexto = `RECAPITULACIÓN — ${nombre}

📜 LA HISTORIA
${String(historia || "").trim()}

⚡ ACTUALMENTE
${String(actualmente || "").trim()}`;
  const palabras = contarPalabras(historia) + contarPalabras(actualmente);
  const fecha = (/* @__PURE__ */ new Date()).toLocaleDateString("es", { day: "numeric", month: "long" });
  recapContent.innerHTML = `
<div class="herr-resultado recap-resultado">
<header class="herr-res-head">
<span class="herr-res-kicker">📖 Recapitulación</span>
<h2 class="herr-res-titulo">Tu historia con ${escapeHtml(nombre)}</h2>
<p class="herr-res-meta">${escapeHtml(fecha)} · ${palabras.toLocaleString("es")} palabras · ${Math.max(1, Math.round(palabras / 220))} min de lectura</p>
</header>
<div class="recap-res-grid">
<aside class="recap-ahora">
<div class="recap-bloque-label"><span class="recap-bloque-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>Actualmente</div>
<div class="recap-ahora-texto herr-prosa">${prosaHtml(actualmente)}</div>
</aside>
<article class="recap-historia">
<div class="recap-bloque-label"><span class="recap-bloque-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></span>La historia hasta ahora</div>
<div class="recap-historia-texto herr-prosa">${prosaHtml(historia)}</div>
</article>
</div>
${htmlBarraHerramienta(`<button type="button" class="btn btn-ghost" id="btn-copiar-recap" title="Copiar" aria-label="Copiar">📋<span class="herr-btn-txt"> Copiar</span></button><button type="button" class="btn btn-ghost" id="btn-descargar-recap" title="Descargar" aria-label="Descargar">⬇️<span class="herr-btn-txt"> Descargar</span></button><button type="button" class="btn btn-primary" data-close-modal="recap-modal">✨ Volver al rol</button>`)}
</div>`;
  recapContent.querySelectorAll("[data-close-modal]").forEach((b) => b.addEventListener("click", () => closeModal("recap-modal")));
  document.getElementById("btn-copiar-recap").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(ultimaRecapTexto);
      showToast("📋 Recapitulación copiada");
    } catch {
      showToast("❌ No se pudo copiar", "error");
    }
  });
  document.getElementById("btn-descargar-recap").addEventListener("click", () => descargarTexto(nombreArchivo(`recap-${nombre}`), ultimaRecapTexto));
  const dialogo = recapModal?.querySelector(".modal");
  if (dialogo) dialogo.scrollTop = 0;
  recapModal?.scrollTo?.(0, 0);
}
async function ejecutarRecapitulacion() {
  mostrarRecapLoading();
  if (!exigirIA(mostrarRecapError)) return;
  try {
    const { mensajes } = await cargarHistorialCompleto(currentChatId);
    const mensajesUtiles = mensajes.filter((m) => m.rol === "user" || m.rol === "assistant");
    if (mensajesUtiles.length < 2) {
      mostrarRecapError("La conversación es muy corta para generar una recapitulación (mínimo 2 mensajes)");
      return;
    }
    const MAX_TEXT_LENGTH = 5e4;
    const mensajesLimitados = limitarMensajesPorLongitud(mensajesUtiles, MAX_TEXT_LENGTH);
    const systemPrompt = `${RECAP_PROMPT_SISTEMA}

CONTEXTO DE LA CONVERSACIÓN: participan ${userRoleName || "el usuario"} (turnos del rol "user") y ${currentCharacter?.nombre || "el personaje"} (turnos del rol "model").`;
    const parsedRecap = parsearSystemPrompt(currentCharacter?.system_prompt);
    const intensidadRecap = currentCharacter?.intensidad || parsedRecap.intensidad || "maxima";
    let textoCompleto = "", omitidosRecap = 0;
    try {
      const respuesta = await generarConGeminiResiliente({
        systemPrompt,
        sistemaNeutro: SISTEMA_NEUTRO,
        mensajes: mensajesLimitados,
        instruccion: RECAP_INSTRUCCION,
        instruccionNeutra: RECAP_INSTRUCCION,
        maxOutputTokens: 6048,
        temperature: 0.4,
        nivelInicial: intensidadRecap,
        accionCR: "recap"
      });
      textoCompleto = respuesta.texto;
    } catch (err) {
      if (!esErrorDeBloqueo(err)) throw err;
      console.warn("🛡️ Recapitulación bloqueada; leyendo la historia por tramos…");
      const respuesta = await recapitularPorTramos(mensajesLimitados, { nivelInicial: intensidadRecap, onProgreso: (i, n) => mostrarRecapProgreso(i, n) });
      textoCompleto = respuesta.texto;
      omitidosRecap = respuesta.omitidos;
    }
    let partes = textoCompleto.split(/===\s*ACTUALMENTE\s*===/i);
    let historia, actualmente;
    if (partes.length >= 2) {
      historia = partes[0].replace(/^(?:PARTE 1[-:\s]*|La Historia[-:\s]*|##\s*La Historia\s*|📜\s*)/i, "").trim();
      actualmente = partes.slice(1).join("\n\n").replace(/^(?:PARTE 2[-:\s]*|Actualmente[-:\s]*|##\s*Actualmente\s*|⚡\s*)/i, "").trim();
    } else {
      const match = textoCompleto.match(/\n\s*(?:PARTE 2|Actualmente:|⚡)\s*/i);
      if (match) {
        const index = match.index;
        historia = textoCompleto.substring(0, index).replace(/^(?:PARTE 1[-:\s]*|La Historia[-:\s]*|##\s*La Historia\s*|📜\s*)/i, "").trim();
        actualmente = textoCompleto.substring(index).replace(/^(?:PARTE 2[-:\s]*|Actualmente[-:\s]*|##\s*Actualmente\s*|⚡\s*)/i, "").trim();
      } else {
        const lines = textoCompleto.split("\n\n");
        if (lines.length > 1) {
          const mid = Math.floor(lines.length / 2);
          historia = lines.slice(0, mid).join("\n\n").trim();
          actualmente = lines.slice(mid).join("\n\n").trim();
        } else {
          historia = textoCompleto.trim();
          actualmente = "No se pudo determinar el estado actual.";
        }
      }
    }
    historia = historia.replace(/^(?:PARTE 1|La Historia|📜)\s*[:.-]?\s*/i, "").trim();
    actualmente = actualmente.replace(/^(?:PARTE 2|Actualmente|⚡)\s*[:.-]?\s*/i, "").trim();
    mostrarRecapResultado(historia, actualmente);
    if (omitidosRecap > 0) showToast(`⚠️ Recapitulación generada sin ${omitidosRecap} fragmento${omitidosRecap !== 1 ? "s" : ""} (bloqueados por los filtros)`, "error");
    else showToast("✅ Recapitulación generada", "success");
  } catch (err) {
    console.error("Error en recapitulación:", err);
    mostrarRecapError(esErrorDeBloqueo(err) ? mensajeBloqueoConAyuda(err) : err.message || "Error desconocido");
  }
}
document.getElementById("chat-recap-btn").addEventListener("click", mostrarRecapConfirm);
const historiadorContent = document.getElementById("historiador-content");
const historiadorBtn = document.getElementById("chat-historiador-btn");
let historiadorGenerando = false;
let ultimoCapituloTexto = "";
const HISTORIADOR_PROMPT_SISTEMA = `Eres el Historiador oficial de una saga de ficción. Tu única tarea es leer la ficha del rol y la conversación completa entre el usuario y el personaje, y escribir UN CAPÍTULO de la historia en prosa narrativa.

REGLAS DEL CAPÍTULO:
- Narrativa en tercera persona, como un capítulo de novela. Sin saludos, introducciones, despedidas ni comentarios sobre ti mismo.
- FIDELIDAD ABSOLUTA: narra SOLO lo que ocurrió en la conversación. No inventes eventos, diálogos, lugares, objetos ni decisiones que no aparezcan. No añadas escenas nuevas ni "mejoras" la historia.
- Respeta el rol: el mundo, el escenario, el tono y la personalidad de la ficha definen el estilo de la prosa. Si el rol es épico, la prosa es épica; si es íntimo, la prosa es íntima.
- Integra los diálogos tal como ocurrieron, entre comillas, sin alterar las palabras de los personajes.
- Describe acciones, gestos y pensamientos con *un asterisco a cada lado*, igual que en el chat.
- Mantén los nombres propios exactamente como aparecen en la conversación.
- Es prosa corrida: párrafos separados por líneas en blanco. NO uses encabezados (##), listas ni viñetas.
- El capítulo cubre toda la conversación, del primer mensaje al último, como un arco completo. Extensión generosa: un capítulo, no un resumen.

FORMATO DE SALIDA OBLIGATORIO (dos marcadores en mayúsculas, tres guiones a cada lado, cada uno en su propia línea):
===TITULO===
Capítulo: "Título evocador del capítulo"
===CAPITULO===
Aquí va la prosa del capítulo.`;
const HISTORIADOR_INSTRUCCION = "Escribe el capítulo completo: el título tras el marcador ===TITULO=== y la prosa tras el marcador ===CAPITULO===.";
function mostrarHistoriadorConfirm() {
  if (!currentChatId) {
    showToast("⚠️ Selecciona un chat primero", "error");
    return;
  }
  historiadorContent.innerHTML = `
<div class="recap-confirm">
<div class="recap-icon-wrapper" style="background:linear-gradient(135deg,rgba(245,158,11,.2),rgba(217,119,6,.12))">
<svg viewBox="0 0 24 24" style="stroke:url(#historiadorGradient)"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
</div>
<div class="recap-title" style="background:linear-gradient(135deg,#f59e0b,#fbbf24);-webkit-background-clip:text;background-clip:text">📖 El Historiador</div>
<div class="recap-subtitle">Tomaré toda la conversación y la ficha del rol para escribir el capítulo de la historia: en prosa, con el estilo del rol y fiel a lo ocurrido.</div>
<div class="recap-features">
<div class="recap-feature"><div class="recap-feature-icon" style="background:linear-gradient(135deg,rgba(245,158,11,.18),rgba(217,119,6,.1))"><svg viewBox="0 0 24 24" style="stroke:#fbbf24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div><span><strong style="color:#fbbf24">Fiel al rol:</strong> el mundo, el tono y la personalidad de tu personaje</span></div>
<div class="recap-feature"><div class="recap-feature-icon" style="background:linear-gradient(135deg,rgba(245,158,11,.18),rgba(217,119,6,.1))"><svg viewBox="0 0 24 24" style="stroke:#fbbf24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div><span><strong style="color:#fbbf24">Fiel a los hechos:</strong> narra solo lo que sucedió, sin inventos</span></div>
<div class="recap-feature"><div class="recap-feature-icon" style="background:linear-gradient(135deg,rgba(245,158,11,.18),rgba(217,119,6,.1))"><svg viewBox="0 0 24 24" style="stroke:#fbbf24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div><span>Powered by <strong style="color:#fbbf24">${escapeHtml(etiquetaMotorHerramientas("historiador"))}</strong></span></div>
</div>
<div class="recap-actions">
<button type="button" class="btn btn-ghost" data-close-modal="historiador-modal">Cancelar</button>
<button type="button" class="btn btn-primary" id="btn-confirm-historiador" style="background:linear-gradient(135deg,#f59e0b,#d97706);box-shadow:0 8px 25px rgba(245,158,11,.3)">✍️ Escribir capítulo</button>
</div>
</div>`;
  openModal("historiador-modal");
  document.getElementById("btn-confirm-historiador").addEventListener("click", ejecutarHistoriador);
  historiadorContent.querySelectorAll("[data-close-modal]").forEach((b) => b.addEventListener("click", () => closeModal("historiador-modal")));
}
function mostrarHistoriadorLoading() {
  historiadorContent.innerHTML = htmlCargaHerramienta({ tema: "historiador", titulo: "El Historiador está escribiendo…", sub: "Convirtiendo toda la conversación en un capítulo. Esto puede tardar unos segundos.", idSub: "historiador-loading-sub", pasos: ["Leyendo la conversación y la ficha del rol", "Buscando los momentos clave", "Escribiendo el capítulo", "Puliendo la prosa"] });
  iniciarCargaHerramienta(historiadorContent, 8e3);
}
function mostrarHistoriadorProgreso(i, n) {
  const sub = document.getElementById("historiador-loading-sub");
  if (!sub) return;
  sub.textContent = String(i && n ? `El Historiador lee la historia por partes… (${i}/${n})` : "El Historiador está escribiendo…");
}
function mostrarHistoriadorError(msg) {
  historiadorContent.innerHTML = `
<div class="recap-confirm">
<div class="recap-icon-wrapper" style="background:linear-gradient(135deg,rgba(239,68,68,.2),rgba(245,158,11,.1))">
<svg viewBox="0 0 24 24" style="stroke:#fca5a5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
</div>
<div class="recap-title" style="background:linear-gradient(135deg,#ef4444,#f59e0b);-webkit-background-clip:text;background-clip:text">Error al escribir el capítulo</div>
<div class="recap-subtitle" style="color:#fca5a5">${escapeHtml(msg)}</div>
<div class="recap-actions">
<button type="button" class="btn btn-ghost" data-close-modal="historiador-modal">Cerrar</button>
<button type="button" class="btn btn-primary" id="btn-retry-historiador" style="background:linear-gradient(135deg,#f59e0b,#d97706)">🔄 Reintentar</button>
</div>
</div>`;
  historiadorContent.querySelectorAll("[data-close-modal]").forEach((b) => b.addEventListener("click", () => closeModal("historiador-modal")));
  document.getElementById("btn-retry-historiador").addEventListener("click", ejecutarHistoriador);
}
function mostrarHistoriadorResultado(titulo, capitulo) {
  ultimoCapituloTexto = `${titulo}

${capitulo}`;
  const nombre = currentCharacter?.nombre || "el personaje";
  let numero = "Capítulo", nombreCap = String(titulo || "").trim();
  const m = nombreCap.match(/^(cap[ií]tulo[^:]{0,20}):\s*(.+)$/i);
  if (m) {
    numero = m[1].trim();
    nombreCap = m[2].trim();
  }
  const q = nombreCap.match(/^(["'“”‘’«])([\s\S]*)(["'“”‘’»])$/);
  if (q) nombreCap = q[2].trim();
  const palabras = contarPalabras(capitulo);
  historiadorContent.innerHTML = `
<div class="herr-resultado historiador-res">
<header class="herr-res-head historiador-res-head">
<span class="herr-res-kicker">📖 ${escapeHtml(numero)}</span>
<h2 class="historiador-libro-titulo">${escapeHtml(nombreCap)}</h2>
<div class="historiador-ornamento" aria-hidden="true"><span></span>✦<span></span></div>
<p class="herr-res-meta">Escrito por el Historiador a partir de tu rol con ${escapeHtml(nombre)} · ${palabras.toLocaleString("es")} palabras · ${Math.max(1, Math.round(palabras / 220))} min de lectura</p>
</header>
<article class="historiador-pagina herr-prosa${/^[A-Za-zÀ-ÿ]/.test(String(capitulo || "").trim()) ? " con-capitular" : ""}">${prosaHtml(capitulo)}</article>
${htmlBarraHerramienta(`<button type="button" class="btn btn-ghost" id="btn-copiar-capitulo" title="Copiar" aria-label="Copiar">📋<span class="herr-btn-txt"> Copiar</span></button><button type="button" class="btn btn-ghost" id="btn-descargar-capitulo" title="Descargar" aria-label="Descargar">⬇️<span class="herr-btn-txt"> Descargar</span></button><button type="button" class="btn btn-primary btn-historiador" data-close-modal="historiador-modal">Cerrar</button>`)}
</div>`;
  document.getElementById("btn-copiar-capitulo").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(ultimoCapituloTexto);
      showToast("📋 Capítulo copiado al portapapeles");
    } catch (err) {
      showToast("❌ No se pudo copiar el capítulo", "error");
    }
  });
  document.getElementById("btn-descargar-capitulo").addEventListener("click", () => descargarTexto(nombreArchivo(nombreCap), ultimoCapituloTexto));
  historiadorContent.querySelectorAll("[data-close-modal]").forEach((b) => b.addEventListener("click", () => closeModal("historiador-modal")));
  const dialogo = document.querySelector("#historiador-modal .modal");
  if (dialogo) dialogo.scrollTop = 0;
  document.getElementById("historiador-modal")?.scrollTo?.(0, 0);
}
function parsearCapitulo(textoCompleto) {
  const fallbackTitulo = `Capítulo de ${currentCharacter?.nombre || "la historia"}`;
  const texto = String(textoCompleto || "");
  let titulo = "", capitulo = texto.trim();
  const match = texto.match(/===\s*TITULO\s*===\s*([\s\S]*?)\s*===\s*CAPITULO\s*===/i);
  if (match) {
    titulo = match[1].trim();
    capitulo = texto.slice(match.index + match[0].length).trim();
  } else {
    const lineas = texto.split("\n");
    if (lineas.length > 1 && /^cap[ií]tulo\b/i.test(lineas[0].trim())) {
      titulo = lineas[0].trim();
      capitulo = lineas.slice(1).join("\n").trim();
    }
  }
  const comillas = titulo.match(/^(["'“”‘’])([\s\S]*)(["'“”‘’])$/);
  if (comillas && ({ "“": "”", "‘": "’" }[comillas[1]] || comillas[1]) === comillas[3]) titulo = comillas[2].trim();
  if (!titulo) titulo = fallbackTitulo;
  capitulo = capitulo.replace(/^(?:cap[ií]tulo\s*\d*\s*[:\-.]?\s*)/i, "").trim();
  if (!capitulo) capitulo = texto.trim() || fallbackTitulo;
  return { titulo, capitulo };
}
async function escribirCapituloPorTramos(mensajes, { nivelInicial = "bloqueo_minimo", onProgreso = null } = {}) {
  const { partes, omitidos, total } = await digestoTramos(mensajes, { nivelInicial, onProgreso, maxIntentosPorTramo: 3 });
  if (!partes.length) throw crearErrorBloqueo("Los filtros de seguridad de Gemini bloquearon toda la conversación.", null, { tipo: "bloqueo" });
  const digest = unirDigestoTramos(partes);
  let textoFinal = "";
  try {
    const { texto } = await generarConGeminiResiliente({
      systemPrompt: `${HISTORIADOR_PROMPT_SISTEMA}

NOTA: en lugar de la conversación completa recibes notas cronológicas por tramos. Escribe el capítulo a partir de esas notas con la misma fidelidad, sin inventar hechos que no estén en las notas.`,
      sistemaNeutro: SISTEMA_NEUTRO,
      contenido: `NOTAS CRONOLÓGICAS DE LA HISTORIA (en orden):

${digest}`,
      instruccion: HISTORIADOR_INSTRUCCION,
      instruccionNeutra: HISTORIADOR_INSTRUCCION,
      maxOutputTokens: HISTORIADOR_MAX_TOKENS,
      temperature: 0.7,
      nivelInicial: "bloqueo_minimo"
    });
    textoFinal = String(texto || "").trim();
  } catch (err) {
    if (!esErrorDeBloqueo(err)) throw err;
    console.warn("🛡️ No se pudo redactar el capítulo final; se entrega la crónica por tramos.");
    textoFinal = `===TITULO===
Capítulo: "Crónica de la historia"
===CAPITULO===
${partes.join("\n\n")}`;
  }
  if (omitidos > 0) textoFinal += `

(Nota: ${omitidos} de ${total} fragmentos de la conversación no se pudieron leer por los filtros de Gemini.)`;
  return { texto: textoFinal, omitidos, total };
}
const HISTORIADOR_MAX_TOKENS = 24576, HISTORIADOR_MAX_CONTINUACIONES = 4;
async function continuarCapituloSiSeCorto(respuesta, base) {
  let texto = String(respuesta.texto || ""), cortado = !!respuesta.cortado, n = 0;
  const maxContinuaciones = usaCR() ? 2 : HISTORIADOR_MAX_CONTINUACIONES;
  while (cortado && n < maxContinuaciones) {
    n++;
    mostrarHistoriadorContinuando(n);
    const cola = texto.slice(-4e3);
    const instruccion = `El capítulo que estabas escribiendo se cortó por longitud. Este es el final exacto de lo que ya escribiste:
"""
${cola}
"""
Continúa EXACTAMENTE desde la última palabra, sin repetir nada de lo anterior, sin marcadores ni título, con el mismo estilo, hasta terminar el capítulo.`;
    try {
      const sig = await generarConGeminiResiliente({ ...base, instruccion, instruccionNeutra: instruccion, maxIntentos: 3, accionCR: "historiador_sigue" });
      const extra = String(sig.texto || "").replace(/^\s*===\s*CAPITULO\s*===\s*/i, "");
      if (!extra.trim()) break;
      const pegado = /[\s\n]$/.test(texto) || /^[\s,.;:!?…»”)]/.test(extra) ? "" : " ";
      texto += pegado + extra;
      cortado = !!sig.cortado;
    } catch (err) {
      console.warn("⚠️ No se pudo continuar el capítulo:", err);
      break;
    }
  }
  return { texto, incompleto: cortado };
}
function mostrarHistoriadorContinuando(n) {
  const sub = document.getElementById("historiador-loading-sub");
  if (sub) sub.textContent = `El capítulo es largo: el Historiador sigue escribiendo… (parte ${n + 1})`;
}
async function ejecutarHistoriador() {
  if (historiadorGenerando) return;
  if (!currentChatId) {
    mostrarHistoriadorError("Selecciona un chat primero.");
    return;
  }
  if (!exigirIA(mostrarHistoriadorError)) return;
  historiadorGenerando = true;
  if (historiadorBtn) historiadorBtn.disabled = true;
  mostrarHistoriadorLoading();
  try {
    const { mensajes } = await cargarHistorialCompleto(currentChatId);
    const mensajesUtiles = mensajes.filter((m) => m.rol === "user" || m.rol === "assistant");
    if (mensajesUtiles.length < 2) {
      mostrarHistoriadorError("La conversación es muy corta para escribir un capítulo (mínimo 2 mensajes).");
      return;
    }
    const MAX_TEXT_LENGTH = 5e4;
    const mensajesLimitados = limitarMensajesPorLongitud(mensajesUtiles, MAX_TEXT_LENGTH);
    const parsedHist = parsearSystemPrompt(currentCharacter?.system_prompt);
    const fichaRol = [
      currentCharacter?.nombre ? `Personaje: ${currentCharacter.nombre}` : null,
      parsedHist.personalidad ? `[Personalidad]
${parsedHist.personalidad}` : null,
      parsedHist.escenario ? `[Escenario]
${parsedHist.escenario}` : null,
      parsedHist.ejemplos ? `[Estilo de diálogo]
${parsedHist.ejemplos}` : null
    ].filter(Boolean).join("\n\n");
    const systemPrompt = anexarNotasRolAlPrompt(`${HISTORIADOR_PROMPT_SISTEMA}

FICHA DEL ROL:
${fichaRol}

CONTEXTO DE LA CONVERSACIÓN: participan ${userRoleName || "el usuario"} (turnos "user") y ${currentCharacter?.nombre || "el personaje"} (turnos "model"). Los turnos aparecen en orden cronológico, del inicio al final de la historia.`);
    const intensidadHist = currentCharacter?.intensidad || parsedHist.intensidad || "maxima";
    let textoCompleto = "", omitidosHist = 0, incompletoHist = false;
    try {
      const baseHist = { systemPrompt, sistemaNeutro: SISTEMA_NEUTRO, mensajes: mensajesLimitados, maxOutputTokens: HISTORIADOR_MAX_TOKENS, temperature: 0.7, nivelInicial: intensidadHist };
      const respuesta = await generarConGeminiResiliente({ ...baseHist, instruccion: HISTORIADOR_INSTRUCCION, instruccionNeutra: HISTORIADOR_INSTRUCCION, accionCR: "historiador" });
      const completo = await continuarCapituloSiSeCorto(respuesta, baseHist);
      textoCompleto = completo.texto;
      incompletoHist = completo.incompleto;
    } catch (err) {
      if (!esErrorDeBloqueo(err)) throw err;
      console.warn("🛡️ Capítulo bloqueado; leyendo la historia por tramos…");
      const respuesta = await escribirCapituloPorTramos(mensajesLimitados, { nivelInicial: intensidadHist, onProgreso: (i, n) => mostrarHistoriadorProgreso(i, n) });
      textoCompleto = respuesta.texto;
      omitidosHist = respuesta.omitidos;
    }
    const { titulo, capitulo } = parsearCapitulo(textoCompleto);
    if (!capitulo) {
      mostrarHistoriadorError("La IA no generó el capítulo. Intenta de nuevo.");
      return;
    }
    mostrarHistoriadorResultado(titulo, capitulo);
    if (omitidosHist > 0) showToast(`⚠️ Capítulo generado sin ${omitidosHist} fragmento${omitidosHist !== 1 ? "s" : ""} (bloqueados por los filtros)`, "error");
    else if (incompletoHist) showToast("⚠️ El capítulo es muy largo y quedó sin terminar. Prueba de nuevo o con un chat más corto.", "error");
    else showToast("✅ Capítulo generado por el Historiador", "success");
  } catch (err) {
    console.error("Error en el Historiador:", err);
    mostrarHistoriadorError(esErrorDeBloqueo(err) ? mensajeBloqueoConAyuda(err) : err.message || "Error desconocido");
  } finally {
    historiadorGenerando = false;
    if (historiadorBtn) historiadorBtn.disabled = false;
  }
}
historiadorBtn.addEventListener("click", mostrarHistoriadorConfirm);
const chatMoreBtn = document.getElementById("chat-more-btn");
const chatExtraPopover = document.getElementById("chat-extra-popover");
function setExtraPopoverOpen(v) {
  if (!chatMoreBtn || !chatExtraPopover) return;
  chatExtraPopover.classList.toggle("open", v);
  chatMoreBtn.setAttribute("aria-expanded", v ? "true" : "false");
  chatExtraPopover.setAttribute("aria-hidden", v ? "false" : "true");
}
if (chatMoreBtn && chatExtraPopover) {
  chatMoreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setExtraPopoverOpen(!chatExtraPopover.classList.contains("open"));
  });
  chatExtraPopover.querySelectorAll(".chat-extra-popover-item").forEach((item) => {
    item.addEventListener("click", () => {
      const targetId = item.getAttribute("data-target");
      const target = document.getElementById(targetId);
      setExtraPopoverOpen(false);
      if (target) target.click();
    });
  });
  document.addEventListener("click", (e) => {
    if (!chatExtraPopover.contains(e.target) && e.target !== chatMoreBtn && !chatMoreBtn.contains(e.target)) setExtraPopoverOpen(false);
  });
  chatExtraPopover.addEventListener("click", (e) => e.stopPropagation());
}
let channelNotificaciones = null;
const banner = document.getElementById("update-banner");
const btnReload = document.getElementById("btn-reload-page");
function mostrarBanner(show) {
  banner.classList.toggle("visible", show);
}
async function consultarEstadoApp() {
  if (!sbClient) return;
  try {
    const { data, error } = await sbClient.from("estado_app").select("actualizacion_pendiente").eq("id", 1).single();
    if (error) {
      console.warn("⚠️ Error consultando estado_app:", error.message);
      return;
    }
    mostrarBanner(!!data?.actualizacion_pendiente);
  } catch (err) {
    console.warn("⚠️ Error en consulta inicial:", err);
  }
}
function suscribirActualizaciones() {
  if (channelNotificaciones) {
    sbClient.removeChannel(channelNotificaciones);
    channelNotificaciones = null;
  }
  if (!sbClient) return;
  channelNotificaciones = sbClient.channel("estado_app_changes").on("postgres_changes", { event: "UPDATE", schema: "public", table: "estado_app", filter: "id=eq.1" }, (payload) => {
    const nuevoValor = payload.new?.actualizacion_pendiente;
    if (typeof nuevoValor === "boolean") mostrarBanner(nuevoValor);
  }).subscribe((status) => {
    if (status === "SUBSCRIBED") console.log("🔔 Suscrito a cambios de estado_app");
    else if (status === "CHANNEL_ERROR") console.warn("⚠️ Error en canal de estado_app");
  });
}
function iniciarNotificaciones() {
  if (!sbClient) return;
  consultarEstadoApp();
  suscribirActualizaciones();
}
btnReload.addEventListener("click", () => {
  window.location.reload();
});
document.getElementById("update-banner-close")?.addEventListener("click", () => mostrarBanner(false));
hacerDeslizable(banner, () => mostrarBanner(false));
let deferredPrompt = null;
const installSection = document.getElementById("pwa-install-section");
const installBtn = document.getElementById("btn-install-pwa");
const installModal = document.getElementById("pwa-install-modal");
const installBody = document.getElementById("pwa-install-body");
const installBanner = document.getElementById("pwa-install-banner");
const bannerInstall = document.getElementById("pwa-banner-install");
const bannerClose = document.getElementById("pwa-banner-close");
function estaInstaladaComoPWA() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function plataformaInstalacion() {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua) && !window.MSStream) return "ios";
  if (/android/i.test(ua)) return "android";
  return "desktop";
}
function ocultarBannerInstalacion() {
  if (installBanner) installBanner.classList.add("hidden");
  sessionStorage.setItem("sair1_pwa_banner_cerrado", "1");
}
function mostrarBannerInstalacion() {
  if (estaInstaladaComoPWA() || !installBanner) return;
  if (sessionStorage.getItem("sair1_pwa_banner_cerrado")) return;
  installBanner.classList.remove("hidden");
}
function navegadorInstalacion() {
  const ua = navigator.userAgent;
  if (/brave/i.test(ua)) return "brave";
  if (/edg\//i.test(ua)) return "edge";
  if (/firefox/i.test(ua)) return "firefox";
  if (/chrome|chromium|crios|opr\//i.test(ua)) return "chrome";
  if (/safari/i.test(ua)) return "safari";
  return "other";
}
function abrirModalInstalacion() {
  if (!installModal || !installBody) return;
  const plat = plataformaInstalacion();
  let html = "";
  if (plat === "ios") {
    html = `<p style="color:var(--text-3);font-size:.9rem;line-height:1.6;margin-bottom:1.2rem;">iOS no permite instalación automática desde el navegador (restricción de Apple), pero son solo <strong>3 toques</strong>:</p>
    <ol class="pwa-steps">
    <li><span class="pwa-step-num">1</span><span>Toca el botón <strong>Compartir</strong> (cuadrado con flecha ↗) en la barra inferior de Safari.</span></li>
    <li><span class="pwa-step-num">2</span><span>Desliza hacia abajo y toca <strong>“Añadir a pantalla de inicio”</strong>.</span></li>
    <li><span class="pwa-step-num">3</span><span>Confirma tocando <strong>“Añadir”</strong>. SAIR quedará como una app en tu pantalla.</span></li>
    </ol>`;
  } else if (plat === "android" && navegadorInstalacion() === "brave") {
    html = `<p style="color:var(--text-3);font-size:.9rem;line-height:1.6;margin-bottom:1.2rem;">En Brave para Android son <strong>2 toques</strong>:</p>
    <ol class="pwa-steps">
    <li><span class="pwa-step-num">1</span><span>Toca el menú <strong>⋮</strong> (arriba a la derecha).</span></li>
    <li><span class="pwa-step-num">2</span><span>Toca <strong>“Instalar aplicación”</strong> (o “Añadir a pantalla de inicio”) y confirma. Se verá la barra de progreso de instalación de SAIR.</span></li>
    </ol>`;
  } else if (navegadorInstalacion() === "brave") {
    html = `<p style="color:var(--text-3);font-size:.9rem;line-height:1.6;margin-bottom:1.2rem;">En Brave (escritorio) no aparece el ícono en la barra de direcciones; se instala desde el menú:</p>
    <ol class="pwa-steps">
    <li><span class="pwa-step-num">1</span><span>Toca el menú <strong>⋮</strong> (arriba a la derecha) → <strong>“Guardar y compartir”</strong> → <strong>“Instalar página como app”</strong> → <strong>“Instalar”</strong>.</span></li>
    </ol>
    <p style="font-size:.75rem;color:var(--text-4);margin-top:.8rem;">¿Solo aparece <strong>“Crear acceso directo”</strong>? Brave solo muestra “Instalar página como app” cuando reconoce la PWA. Escribe <code>:> install pwa</code> en la barra de direcciones y Enter (Quick Commands de Brave), o activa <code>brave://flags/#web-app-universal-install</code> → Reiniciar → vuelve a ⋮ → “Guardar y compartir”.</p>`;
  } else if (navegadorInstalacion() === "chrome" || navegadorInstalacion() === "edge") {
    html = `<p style="color:var(--text-3);font-size:.9rem;line-height:1.6;margin-bottom:1.2rem;">Son <strong>2 toques</strong>:</p>
    <ol class="pwa-steps">
    <li><span class="pwa-step-num">1</span><span>En la <strong>barra de direcciones</strong>, a la derecha, toca el ícono de instalar: un <strong>monitor con una flecha hacia abajo (⬇)</strong>.</span></li>
    <li><span class="pwa-step-num">2</span><span>Toca <strong>“Instalar”</strong> en el diálogo que aparece.</span></li>
    </ol>
    <p style="font-size:.75rem;color:var(--text-4);margin-top:.8rem;">Si el ícono no aparece, usa el menú ⋮ → “Instalar aplicación” o “Guardar y compartir” → “Instalar página como app”.</p>`;
  } else if (navegadorInstalacion() === "firefox") {
    html = `<p style="color:var(--text-3);font-size:.9rem;line-height:1.6;margin-bottom:1.2rem;">En Firefox son <strong>2 toques</strong>:</p>
    <ol class="pwa-steps">
    <li><span class="pwa-step-num">1</span><span>Toca el menú <strong>☰</strong> (arriba a la derecha).</span></li>
    <li><span class="pwa-step-num">2</span><span>Toca <strong>“Instalar aplicación”</strong> y confirma. En Android: menú ⋮ → “Añadir a pantalla de inicio”.</span></li>
    </ol>`;
  } else {
    html = `<p style="color:var(--text-3);font-size:.9rem;line-height:1.6;margin-bottom:1.2rem;">Son <strong>2 toques</strong>:</p>
    <ol class="pwa-steps">
    <li><span class="pwa-step-num">1</span><span>Busca el botón de instalar en la barra del navegador (ícono de <strong>monitor con flecha ⬇</strong>) o en el menú <strong>(⋮ o ☰)</strong>.</span></li>
    <li><span class="pwa-step-num">2</span><span>Toca <strong>“Instalar aplicación”</strong> o <strong>“Añadir al escritorio / pantalla de inicio”</strong>.</span></li>
    </ol>`;
  }
  installBody.innerHTML = html;
  openModal("pwa-install-modal");
}
async function instalarPwa() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to install prompt: ${outcome}`);
    if (outcome === "accepted") {
      deferredPrompt = null;
      ocultarBannerInstalacion();
      showToast("✅ ¡SAIR instalada con éxito!");
    }
  } else {
    abrirModalInstalacion();
  }
}
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  mostrarBannerInstalacion();
});
window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  if (installSection) installSection.classList.add("installed");
  ocultarBannerInstalacion();
  closeModal("pwa-install-modal");
  showToast("✅ ¡SAIR instalada con éxito!");
});
if (estaInstaladaComoPWA() && installSection) installSection.classList.add("installed");
if (installBtn) installBtn.addEventListener("click", instalarPwa);
if (bannerInstall) bannerInstall.addEventListener("click", instalarPwa);
if (bannerClose) bannerClose.addEventListener("click", ocultarBannerInstalacion);
hacerDeslizable(installBanner, ocultarBannerInstalacion);
if (!estaInstaladaComoPWA()) {
  const plat = plataformaInstalacion();
  if (plat === "ios" || plat === "android") {
    setTimeout(() => {
      if (!deferredPrompt) mostrarBannerInstalacion();
    }, 4e3);
  }
}
const REGLA_ESPANOL_NEUTRAL = '\n\n[Idioma] Usa español neutral en todas tus respuestas. Evita el voseo y las formas regionales; usa formas como "describe", "escribe", "toca", "confirma", "revisa", "prueba", "quieres" y "tienes".';
const reemplazosEspanolNeutral = [["Describí", "Describe"], ["Escribí", "Escribe"], ["Tocá", "Toca"], ["Deslizá", "Desliza"], ["Confirmá", "Confirma"], ["Activá", "Activa"], ["Volvé", "Vuelve"], ["Usá", "Usa"], ["Completá", "Completa"], ["Probá", "Prueba"], ["Revisá", "Revisa"], ["Ajustá", "Ajusta"], ["Verificá", "Verifica"]];
function normalizarTextoInterfaz(texto) {
  return reemplazosEspanolNeutral.reduce((resultado, [regional, neutral]) => resultado.replaceAll(regional, neutral), texto);
}
const normalizadorInterfaz = new MutationObserver((cambios) => {
  for (const cambio of cambios) {
    for (const nodo of cambio.type === "characterData" ? [cambio.target] : Array.from(cambio.addedNodes)) {
      if (nodo.nodeType !== Node.TEXT_NODE) continue;
      const padre = nodo.parentElement;
      if (!padre || padre.closest("#chat-messages,.message-bubble,.character-desc,.announcement-content,.anuncio-texto,.anuncio-titulo,textarea,input,code")) continue;
      const texto = normalizarTextoInterfaz(nodo.nodeValue);
      if (texto !== nodo.nodeValue) nodo.nodeValue = texto;
    }
  }
});
normalizadorInterfaz.observe(document.body, { subtree: true, childList: true, characterData: true });
const construirSystemPromptBase = construirSystemPrompt;
construirSystemPrompt = function(datos) {
  return construirSystemPromptBase(datos) + REGLA_ESPANOL_NEUTRAL;
};
const NOTAS_ROL_PREFIX = "sair1_notas_rol_";
const NOTAS_ROL_MAX = 8e3;
let notasRolCache = { chatId: null, texto: "" };
let notasRolEnNube = true;
function leerNotasRolLocal(chatId) {
  try {
    return String(localStorage.getItem(NOTAS_ROL_PREFIX + chatId) || "").trim();
  } catch {
    return "";
  }
}
function guardarNotasRolLocal(chatId, texto) {
  try {
    const limpio = String(texto || "").trim();
    if (limpio) localStorage.setItem(NOTAS_ROL_PREFIX + chatId, limpio);
    else localStorage.removeItem(NOTAS_ROL_PREFIX + chatId);
  } catch {
  }
}
function borrarNotasRolLocal(chatId) {
  try {
    localStorage.removeItem(NOTAS_ROL_PREFIX + chatId);
  } catch {
  }
}
function obtenerNotasRolActual() {
  if (!currentChatId) return "";
  if (notasRolCache.chatId === currentChatId) return notasRolCache.texto || "";
  const local = leerNotasRolLocal(currentChatId);
  notasRolCache = { chatId: currentChatId, texto: local };
  return local;
}
function anexarNotasRolAlPrompt(systemPrompt) {
  const notas = obtenerNotasRolActual();
  if (!notas) return systemPrompt;
  const recorte = notas.length > NOTAS_ROL_MAX ? notas.slice(0, NOTAS_ROL_MAX) : notas;
  return `${systemPrompt}

[NOTAS PARA ROL DEL USUARIO · CONTEXTO OBLIGATORIO]
El usuario dejó estas notas canónicas para este chat. Son hechos verdaderos de la historia y tienen prioridad sobre cualquier improvisación previa. Úsalas de forma natural, sin mencionar que existen "notas":
${recorte}
[FIN DE LAS NOTAS PARA ROL]`;
}
function actualizarIndicadorNotasRol() {
  const btn = document.getElementById("chat-notas-btn");
  if (!btn) return;
  const activo = notasRolCache.chatId === currentChatId && !!String(notasRolCache.texto || "").trim();
  btn.classList.toggle("notas-rol-active", activo);
  btn.title = activo ? "Notas para Rol: activas en este chat" : "Notas para Rol: añade contexto permanente a este chat";
}
async function cargarNotasRol(chatId) {
  if (!chatId) {
    notasRolCache = { chatId: null, texto: "" };
    actualizarIndicadorNotasRol();
    return "";
  }
  const local = leerNotasRolLocal(chatId);
  notasRolCache = { chatId, texto: local };
  actualizarIndicadorNotasRol();
  try {
    const { data, error } = await sbClient.from("chats").select("notas_rol").eq("id", chatId).eq("user_id", currentUser.id).single();
    if (error) throw new Error(error.message);
    const nube = String(data?.notas_rol || "").trim();
    notasRolEnNube = true;
    if (nube) {
      notasRolCache = { chatId, texto: nube };
      guardarNotasRolLocal(chatId, nube);
    } else if (local) {
      const { error: uploadError } = await sbClient.from("chats").update({ notas_rol: local }).eq("id", chatId).eq("user_id", currentUser.id);
      if (uploadError) throw new Error(uploadError.message);
    }
  } catch (err) {
    notasRolEnNube = false;
    console.warn("📝 Notas para Rol sin sincronización en la nube:", err.message);
    notasRolCache = { chatId, texto: local };
  }
  actualizarIndicadorNotasRol();
  return notasRolCache.texto || "";
}
async function guardarNotasRol(chatId, texto) {
  if (!chatId) return false;
  const limpio = String(texto || "").trim().slice(0, NOTAS_ROL_MAX);
  guardarNotasRolLocal(chatId, limpio);
  notasRolCache = { chatId, texto: limpio };
  actualizarIndicadorNotasRol();
  try {
    const { error } = await sbClient.from("chats").update({ notas_rol: limpio || null }).eq("id", chatId).eq("user_id", currentUser.id);
    if (error) throw new Error(error.message);
    notasRolEnNube = true;
    return true;
  } catch (err) {
    notasRolEnNube = false;
    console.warn("📝 Notas para Rol guardadas en este dispositivo:", err.message);
    return false;
  }
}
async function heredarNotasRol(personajeId, nuevoChatId) {
  try {
    const { data, error } = await sbClient.from("chats").select("id,notas_rol,actualizado_en").eq("user_id", currentUser.id).eq("personaje_id", personajeId).order("actualizado_en", { ascending: false }).limit(12);
    if (error) throw new Error(error.message);
    const origen = (data || []).find((c) => c.id !== nuevoChatId && String(c.notas_rol || "").trim());
    if (!origen) return false;
    await guardarNotasRol(nuevoChatId, origen.notas_rol);
    return true;
  } catch (err) {
    notasRolEnNube = false;
    console.warn("📝 No se pudieron heredar las Notas para Rol:", err.message);
    return false;
  }
}
function actualizarContadorNotasRol() {
  const input = document.getElementById("notas-rol-input"), contador = document.getElementById("notas-rol-counter");
  if (!input || !contador) return;
  contador.textContent = `${input.value.length}/${NOTAS_ROL_MAX}`;
}
function estatusNotasRol(texto, esError = false) {
  const el = document.getElementById("notas-rol-status");
  if (!el) return;
  el.textContent = texto || "";
  el.style.color = esError ? "#fca5a5" : "var(--text-4)";
}
async function abrirNotasRol() {
  if (!currentChatId) {
    showToast("⚠️ Selecciona un chat primero", "error");
    return;
  }
  const input = document.getElementById("notas-rol-input");
  if (!input) return;
  delete input.dataset.tocado;
  const inicial = obtenerNotasRolActual();
  input.value = inicial;
  actualizarContadorNotasRol();
  estatusNotasRol("Solo se aplican a este chat.");
  openModal("notas-rol-modal");
  setTimeout(() => {
    try {
      input.focus();
    } catch {
    }
  }, 140);
  const texto = await cargarNotasRol(currentChatId);
  if (!input.dataset.tocado && input.value === inicial) {
    input.value = texto;
    actualizarContadorNotasRol();
  }
  estatusNotasRol(notasRolEnNube ? "Solo se aplican a este chat." : "Solo en este dispositivo (pendiente de sincronizar).");
}
document.getElementById("chat-notas-btn")?.addEventListener("click", abrirNotasRol);
document.getElementById("chat-notas-btn")?.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  abrirNotasRol();
});
document.getElementById("notas-rol-input")?.addEventListener("input", (e) => {
  e.target.dataset.tocado = "1";
  actualizarContadorNotasRol();
  estatusNotasRol("Sin guardar");
});
document.getElementById("notas-rol-clear")?.addEventListener("click", () => {
  const input = document.getElementById("notas-rol-input");
  if (!input) return;
  input.value = "";
  input.dataset.tocado = "1";
  actualizarContadorNotasRol();
  estatusNotasRol("Pulsa “Guardar notas” para confirmar.");
  try {
    input.focus();
  } catch {
  }
});
document.getElementById("notas-rol-save")?.addEventListener("click", async () => {
  if (!currentChatId) {
    showToast("⚠️ Selecciona un chat primero", "error");
    return;
  }
  const input = document.getElementById("notas-rol-input"), btn = document.getElementById("notas-rol-save");
  const original = btn ? btn.textContent : "Guardar notas";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Guardando...";
  }
  try {
    const texto = String(input?.value || "").trim();
    const sincronizado = await guardarNotasRol(currentChatId, texto);
    estatusNotasRol(sincronizado ? "Guardadas." : "Guardadas en este dispositivo.", !sincronizado);
    if (input) delete input.dataset.tocado;
    if (!texto) showToast("🧹 Notas para Rol vaciadas", "success");
    else if (sincronizado) showToast("📝 Notas para Rol guardadas", "success");
    else showToast("📝 Notas guardadas solo en este dispositivo", "success");
    closeModal("notas-rol-modal");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = original;
    }
  }
});
const MOTIVOS_RESPUESTA_INCOMPLETA = {
  MAX_TOKENS: "⚠️ La respuesta se cortó: se alcanzó el límite de tokens del personaje.",
  BLOQUEO: "⚠️ La respuesta se interrumpió por los filtros de seguridad de Gemini.",
  FILTRO: "⚠️ La respuesta se interrumpió por el filtro de contenido de la IA.",
  SIN_FINAL: "⚠️ La respuesta quedó incompleta (el stream terminó antes de tiempo).",
  DETENIDA: "⏹️ Respuesta detenida por ti. Puedes continuarla cuando quieras."
};
function renderAvisoRespuestaIncompleta(bubble, motivo) {
  if (!bubble) return;
  const previo = bubble.querySelector(".respuesta-incompleta");
  if (previo) previo.remove();
  const aviso = document.createElement("div");
  aviso.className = "respuesta-incompleta" + (motivo === "BLOQUEO" ? " bloqueo" : "");
  aviso.innerHTML = `<span class="respuesta-incompleta-texto">${escapeHtml(MOTIVOS_RESPUESTA_INCOMPLETA[motivo] || MOTIVOS_RESPUESTA_INCOMPLETA.SIN_FINAL)}</span><button type="button" class="btn-continuar-respuesta">✂️ Continuar respuesta</button>`;
  bubble.appendChild(aviso);
}
function aplicarAvisoRespuestaIncompleta(bubble) {
  if (!bubble) return;
  const id = bubble.dataset?.mensajeId;
  if (id && respuestasIncompletas.has(String(id))) renderAvisoRespuestaIncompleta(bubble, respuestasIncompletas.get(String(id)));
}
function marcarRespuestaIncompleta(mensajeId) {
  const motivo = motivoIncompletaUltimaGeneracion;
  motivoIncompletaUltimaGeneracion = null;
  const id = mensajeId ? String(mensajeId) : "";
  if (!id) return false;
  if (!motivo) {
    respuestasIncompletas.delete(id);
    return false;
  }
  respuestasIncompletas.set(id, motivo);
  renderAvisoRespuestaIncompleta(document.querySelector(`.message-bubble[data-mensaje-id="${id}"]`), motivo);
  return true;
}
async function continuarRespuesta(bubble) {
  if (isStreaming) {
    showToast("Espera a que termine la respuesta actual", "error");
    return;
  }
  if (!currentChatId || !currentCharacter) return;
  if (!exigirIA()) return;
  const mensajeId = bubble?.dataset?.mensajeId;
  if (!mensajeId) {
    showToast("No se puede continuar esta respuesta", "error");
    return;
  }
  empezarGeneracion();
  chatSendBtn.disabled = true;
  const btn = bubble.querySelector(".btn-continuar-respuesta");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Continuando...";
  }
  try {
    const { mensajes } = await cargarHistorialCompleto(currentChatId);
    const idx = mensajes.findIndex((m) => m.id === mensajeId);
    if (idx < 0 || mensajes[idx].rol !== "assistant") throw new Error("Respuesta no encontrada");
    if (idx !== mensajes.length - 1) throw new Error("Solo puedes continuar la última respuesta del chat");
    const parcial = String(mensajes[idx].contenido || "");
    const procesado = await procesarHistorialSiEsNecesario(mensajes.slice(0, idx + 1));
    const historialProcesado = procesado.historialProcesado;
    const historialFinal = (procesado.necesitaActualizacion ? procesado.historialGuardar || historialProcesado : mensajes.slice(0, idx + 1)).slice();
    let objetivo = historialFinal.findIndex((m) => m.id === mensajeId);
    if (objetivo < 0) objetivo = historialFinal.length - 1;
    prepararAccionCR("continuar");
    const generator = enviarAGeminiStream(currentCharacter.system_prompt, historialProcesado, INSTRUCCION_CONTINUACION, currentCharacter.max_tokens || 4096);
    const extra = await transmitirStream(bubble, generator, parcial);
    const completo = parcial + extra;
    if (!extra.trim()) throw new Error("La IA no añadió contenido nuevo. Intenta de nuevo.");
    historialFinal[objetivo] = { ...historialFinal[objetivo], id: mensajeId, rol: "assistant", contenido: completo };
    await actualizarHistorialChat(currentChatId, historialFinal);
    respuestasIncompletas.delete(String(mensajeId));
    establecerHistorialChat(historialFinal);
    if (marcarRespuestaIncompleta(mensajeId)) showToast("⚠️ La respuesta sigue incompleta", "error");
    else showToast("✅ Respuesta completada", "success");
  } catch (err) {
    if (generacionCancelada) {
      generacionCancelada = false;
      if (bubble) {
        bubble.innerHTML = renderMarkdown(bubble.dataset.originalText || "");
        agregarBotones(bubble, "assistant");
        aplicarAvisoRespuestaIncompleta(bubble);
      }
      showToast("⏹️ Generación detenida");
      return;
    }
    console.error("Error al continuar la respuesta:", err);
    if (bubble) {
      bubble.innerHTML = renderMarkdown(bubble.dataset.originalText || "");
      agregarBotones(bubble, "assistant");
      aplicarAvisoRespuestaIncompleta(bubble);
    }
    showToast(`❌ ${err.message}`, "error");
  } finally {
    terminarGeneracion();
    chatSendBtn.disabled = !chatInput.value.trim() || !currentChatId;
  }
}
const enviarAGeminiStreamOriginal = enviarAGeminiStream;
function esCorteRecuperable(mensaje) {
  return /PROHIBITED_CONTENT|SAFETY|BLOCKLIST|SPII|RECITATION|MAX_TOKENS|Respuesta bloqueada por filtros|Gemini detuvo la respuesta/i.test(String(mensaje || ""));
}
function combinarContinuacion(previo, extra) {
  let limpio = String(extra || "").replace(/^\s+/, "");
  limpio = limpio.replace(/^\s*\[(?:SISTEMA|CONTINUACI[ÓO]N)[^\]]{0,120}\]\s*:?\s*/i, "");
  const base = String(previo || "");
  const max = Math.min(base.length, limpio.length, 2400);
  for (let n = max; n >= 12; n--) {
    if (base.slice(-n) === limpio.slice(0, n)) return limpio.slice(n);
  }
  return limpio;
}
enviarAGeminiStream = async function* (systemPrompt, mensajes, nuevoMensaje, maxTokens) {
  motivoIncompletaUltimaGeneracion = null;
  let historial = Array.isArray(mensajes) ? mensajes.slice() : [];
  let pendiente = nuevoMensaje;
  let acumulado = "";
  let ultimaGeneracion = "";
  for (let vuelta = 0; vuelta <= MAX_CONTINUACIONES_AUTO; vuelta++) {
    if (generacionCancelada) return;
    if (vuelta > 0) historial = historial.concat([{ id: `continuacion-${vuelta}`, rol: "assistant", contenido: ultimaGeneracion }]);
    lastGeminiFinishReason = "";
    let textoVuelta = "", emitidoVuelta = "", bufferPrefijo = "", corte = null;
    let prefijoListo = vuelta === 0;
    try {
      for await (const chunk of enviarAGeminiStreamOriginal(systemPrompt, historial, pendiente, maxTokens)) {
        textoVuelta += chunk;
        if (prefijoListo) {
          emitidoVuelta += chunk;
          yield chunk;
          continue;
        }
        bufferPrefijo += chunk;
        if (bufferPrefijo.length >= PREFIJO_BUFFER_CONTINUACION) {
          const limpio = combinarContinuacion(acumulado, bufferPrefijo);
          prefijoListo = true;
          emitidoVuelta += limpio;
          if (limpio) yield limpio;
        }
      }
    } catch (err) {
      const mensaje = String(err?.message || "");
      if (textoVuelta.trim() && esCorteRecuperable(mensaje)) corte = "bloqueo";
      else if (usaCR() && textoVuelta.trim() && !generacionCancelada) corte = "sin_final";
      else if (vuelta > 0 && acumulado.trim() && /no generó ninguna respuesta|no devolvió una respuesta válida|Tiempo de espera agotado/i.test(mensaje)) corte = "nada";
      else throw err;
    }
    if (!prefijoListo) {
      const limpio = combinarContinuacion(acumulado, bufferPrefijo);
      emitidoVuelta += limpio;
      if (limpio) yield limpio;
    }
    acumulado += emitidoVuelta;
    ultimaGeneracion = textoVuelta;
    if (corte === "nada") return;
    if (corte === "bloqueo") {
      motivoIncompletaUltimaGeneracion = "BLOQUEO";
      return;
    }
    if (corte === "sin_final") {
      motivoIncompletaUltimaGeneracion = "SIN_FINAL";
      return;
    }
    const finish = String(lastGeminiFinishReason || "").toUpperCase();
    if (finish === "SIN_FINAL" || finish === "FILTRO") {
      motivoIncompletaUltimaGeneracion = finish;
      return;
    }
    const bloqueado = !!finish && finish !== "STOP" && finish !== "MAX_TOKENS";
    if (bloqueado) {
      motivoIncompletaUltimaGeneracion = "BLOQUEO";
      return;
    }
    if (finish !== "MAX_TOKENS") {
      motivoIncompletaUltimaGeneracion = null;
      return;
    }
    motivoIncompletaUltimaGeneracion = "MAX_TOKENS";
    if (usaCR()) return;
    if (vuelta >= MAX_CONTINUACIONES_AUTO) return;
    if (!textoVuelta.trim()) return;
    if (acumulado.length >= LIMITE_CARACTERES_AUTO) return;
    pendiente = INSTRUCCION_CONTINUACION;
  }
};

const NOVEDADES_VISTA_KEY = "sair1_novedades_vista";
let changelogSAIR = null;
async function cargarChangelogSAIR() {
  if (changelogSAIR) return changelogSAIR;
  const r = await fetch("./Changelog.txt", { cache: "no-cache" });
  if (!r.ok) throw new Error("No se pudo cargar el historial de cambios");
  const versiones = [];
  let v = null, s = null;
  for (const bruta of (await r.text()).split(/\r?\n/)) {
    const linea = bruta.trim();
    if (!linea) continue;
    const cab = linea.match(/^\[([^\]]+)\]\s*[—-]?\s*(.*)$/);
    if (cab) {
      v = { version: cab[1].replace(/\s*Oficial A$/i, "").trim(), fecha: cab[2].trim(), secciones: [] };
      versiones.push(v);
      s = null;
    } else if (!v) {
      continue;
    } else if (linea.startsWith("- ")) {
      if (!s) {
        s = { titulo: "", items: [] };
        v.secciones.push(s);
      }
      s.items.push(linea.slice(2));
    } else {
      s = { titulo: linea, items: [] };
      v.secciones.push(s);
    }
  }
  changelogSAIR = versiones;
  return versiones;
}
function fechaNovedad(f) {
  const m = String(f || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return f || "";
  try {
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return f;
  }
}
function htmlVersionNovedad(v, abierta, desplegada) {
  const cuerpo = v.secciones.map((s) => `${s.titulo ? `<h4 class="nov-seccion">${escapeHtml(s.titulo)}</h4>` : ""}<ul class="nov-items">${s.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`).join("");
  return abierta ? `<div class="nov-version">${cuerpo}</div>` : `<details class="nov-version nov-plegada"${desplegada ? " open" : ""}><summary><strong>SAIR ${escapeHtml(v.version)}</strong><span>${escapeHtml(fechaNovedad(v.fecha))}</span></summary>${cuerpo}</details>`;
}
function cerrarNovedades() {
  const m = document.getElementById("novedades-modal");
  if (!m) return;
  m.classList.remove("visible");
  setTimeout(() => m.remove(), 200);
}
async function abrirNovedades(historial = false) {
  let versiones;
  try {
    versiones = await cargarChangelogSAIR();
  } catch (err) {
    if (historial) showToast(err.message, "error");
    return false;
  }
  if (!versiones.length) return false;
  document.getElementById("novedades-modal")?.remove();
  const actual = window.SAIR_VERSION?.numero || versiones[0].version;
  const ultima = versiones.find((v) => v.version === actual) || versiones[0];
  const m = document.createElement("div");
  m.id = "novedades-modal";
  m.className = "nov-overlay";
  m.setAttribute("role", "dialog");
  m.setAttribute("aria-modal", "true");
  m.setAttribute("aria-labelledby", "nov-titulo");
  m.innerHTML = `<div class="nov-modal"><header class="nov-cabeza"><span class="nov-chip">✨ ${historial ? "Historial de cambios" : "Novedades"}</span><button type="button" class="modal-close nov-cerrar" aria-label="Cerrar">✕</button><h2 id="nov-titulo">${historial ? "Todo lo que ha cambiado" : `SAIR ${escapeHtml(ultima.version)} ya está aquí`}</h2><p>${historial ? `Estás usando SAIR ${escapeHtml(actual)}.` : `Esto es lo nuevo de la actualización del ${escapeHtml(fechaNovedad(ultima.fecha))}.`}</p></header><div class="nov-cuerpo">${historial ? versiones.map((v, i) => htmlVersionNovedad(v, false, i === 0)).join("") : htmlVersionNovedad(ultima, true)}</div><footer class="nov-pie">${historial ? "" : '<button type="button" class="btn btn-ghost btn-small" id="nov-historial">Ver historial completo</button>'}<button type="button" class="btn btn-primary btn-small" id="nov-ok">${historial ? "Cerrar" : "¡Entendido!"}</button></footer></div>`;
  document.body.appendChild(m);
  m.addEventListener("click", (e) => {
    if (e.target === m || e.target.closest(".nov-cerrar, #nov-ok")) cerrarNovedades();
    else if (e.target.closest("#nov-historial")) abrirNovedades(true);
  });
  requestAnimationFrame(() => m.classList.add("visible"));
  m.querySelector("#nov-ok")?.focus({ preventScroll: true });
  return true;
}
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.getElementById("novedades-modal")) {
    e.stopPropagation();
    cerrarNovedades();
  }
}, true);
async function mostrarNovedadesSiToca() {
  const actual = window.SAIR_VERSION?.numero;
  if (!actual) return;
  try {
    if (localStorage.getItem(NOVEDADES_VISTA_KEY) === actual) return;
  } catch {
    return;
  }
  if (politicasModal?.classList.contains("visible") || document.getElementById("novedades-modal")) return;
  if (currentUser && localStorage.getItem(POLITICAS_ACEPTADAS_KEY) !== POLITICAS_VERSION) return;
  if (await abrirNovedades(false)) {
    try {
      localStorage.setItem(NOVEDADES_VISTA_KEY, actual);
    } catch {
    }
  }
}
document.getElementById("btn-ver-novedades")?.addEventListener("click", () => {
  closeModal("settings-modal");
  abrirNovedades(true);
});
setTimeout(mostrarNovedadesSiToca, (typeof INTRO_LIMPIEZA_MS === "number" ? INTRO_LIMPIEZA_MS : 2600) + 600);
