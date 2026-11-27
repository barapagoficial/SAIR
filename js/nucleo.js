const CONFIG = { SUPABASE_URL: "https://tcnzimhqjyivlrvqzwpb.supabase.co", SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjbnppbWhxanlpdmxydnF6d3BiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MTU3OTMsImV4cCI6MjA5ODA5MTc5M30.W9xY20IiIrkQHOsZYJNxrcE6tJ7WK-uE0cRiJNpMGqk", LS: { THEME: "sair1_theme", GEMINI_KEY: "sair1_gemini_key", GEMINI_MODEL: "sair1_gemini_model", GEMINI_SUMMARY_MODEL: "sair1_gemini_summary_model", DISPLAY_MODE: "sair1_display_mode" } };
let sbClient = null, currentUser = null, userRole = null, userUsername = null, userDescription = "", userAvatarUrl = null, userRoleName = null, userAvatarPos = { x: 50, y: 50 }, userBackgroundUrl = null, userBackgroundPos = { x: 50, y: 50 }, currentView = "my-characters", currentCharacter = null, currentChatId = null, isStreaming = false, rateLimitTimer = null, rateLimitCountdown = 0, pendingAction = null, pendingData = null, lastGeminiFinishReason = "";
const SAIR_RECUPERACION = (() => {
  const params = new URLSearchParams(location.hash.replace(/^#/, "") + "&" + location.search.replace(/^\?/, ""));
  return { activa: params.get("type") === "recovery", error: params.get("error_code") || params.get("error") || null, mostrada: false };
})();
if (window.supabase?.createClient) {
  sbClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage
    }
  });
  console.log("✅ Supabase client creado al inicio");
}
let historialCompleto = [];
let chatOffset = 0;
let historialTotalMensajes = 0, historialTieneMas = false, historialCargandoMas = false, historialEsLegacy = false;
const CHAT_LIMITE = 30;
const COLS_MENSAJE_BASE = "id,rol,contenido,creado_en,orden";
const COLS_MENSAJE_VARIANTES = COLS_MENSAJE_BASE + ",variantes,variante_activa";
const MAX_VARIANTES = 20;
let variantesEnNube = true;
let titulosEnNube = true;
let chatsCache = [];
let filtroChats = "";
const MAX_CONTINUACIONES_AUTO = 3;
const LIMITE_CARACTERES_AUTO = 4e4;
const PREFIJO_BUFFER_CONTINUACION = 400;
const INSTRUCCION_CONTINUACION = "[SISTEMA · CONTINUACIÓN OBLIGATORIA] Tu mensaje anterior quedó cortado a la mitad. Continúa EXACTAMENTE desde el punto donde se interrumpió: no repitas nada de lo ya escrito, no saludes, no resumas, no añadas preámbulos ni aclaraciones y no cierres la escena si todavía queda desarrollo. Mantén el mismo estilo, formato y narración.";
let motivoIncompletaUltimaGeneracion = null;
const respuestasIncompletas = /* @__PURE__ */ new Map();
const AURA_COLORS = ["#ff4d8f", "#4d79ff", "#a855f7", "#10b981", "#f97316", "#eab308"];
let scrollChatPending = false;
function sanitizeThemeColor(color) {
  return AURA_COLORS.includes(color) ? color : "#ff4d8f";
}
function scrollChatToBottom(force = false) {
  const messages = document.getElementById("chat-messages");
  if (!messages) return;
  if (force) {
    messages.scrollTop = messages.scrollHeight;
    return;
  }
  if (scrollChatPending) return;
  scrollChatPending = true;
  requestAnimationFrame(() => {
    messages.scrollTop = messages.scrollHeight;
    scrollChatPending = false;
  });
}
function registrarServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const register = () => navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((reg) => {
    console.log("✅ Service Worker registrado:", reg.scope);
    reg.addEventListener("updatefound", () => {
      const nuevo = reg.installing;
      if (!nuevo) return;
      nuevo.addEventListener("statechange", () => {
        if (nuevo.state === "installed" && navigator.serviceWorker.controller) {
          navigator.serviceWorker.addEventListener("controllerchange", () => {
            aplicarActualizacionNueva();
          }, { once: true });
        }
      });
    });
  }).catch((err) => console.error("❌ Falló el registro del Service Worker:", err));
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
let actualizacionPendiente = false;
function aplicarActualizacionNueva() {
  const ocupado = isStreaming || currentChatId && chatInput?.value.trim() || !!document.querySelector(".modal-overlay.visible");
  if (ocupado) {
    actualizacionPendiente = true;
    showToast("🔄 Nueva versión disponible. Se actualizará al terminar.");
    return;
  }
  showToast("🔄 Actualizando a la nueva versión...");
  setTimeout(() => window.location.reload(), 900);
}
document.addEventListener("visibilitychange", () => {
  if (actualizacionPendiente && document.visibilityState === "visible") {
    actualizacionPendiente = false;
    aplicarActualizacionNueva();
  }
});
registrarServiceWorker();
const CACHE = { personajes: null, personajesComunidad: null, anuncios: null, usernames: {}, cacheTime: { personajes: 0, personajesComunidad: 0, anuncios: 0 }, TTL: 3e4 }, LOADING = { personajes: false, personajesComunidad: false, anuncios: false };
function limpiarCacheUsuario() {
  CACHE.personajes = null;
  CACHE.personajesComunidad = null;
  CACHE.anuncios = null;
  CACHE.cacheTime.personajes = 0;
  CACHE.cacheTime.personajesComunidad = 0;
  CACHE.cacheTime.anuncios = 0;
}
function isCacheValid(k) {
  return CACHE[k] && Date.now() - CACHE.cacheTime[k] < CACHE.TTL;
}
async function ejecutarConRefresh(fn, maxRetries = 1) {
  for (let intent = 0; intent <= maxRetries; intent++) {
    try {
      return await fn();
    } catch (err) {
      if (err.message && (err.message.includes("JWT expired") || err.message.includes("jwt expired") || err.message.includes("invalid token") || err.message.includes("token expired"))) {
        if (intent < maxRetries) {
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
              continue;
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
      }
      throw err;
    }
  }
}
function anunciarEstado(texto) {
  const region = document.getElementById("aria-live-chat");
  if (region) region.textContent = String(texto || "");
}
const ICONOS = (() => {
  const svg = (d, extra = "") => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${extra}>${d}</svg>`;
  return {
    chat: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
    enlace: svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
    editar: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    borrar: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'),
    bandera: svg('<path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/>'),
    corazon: svg('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>'),
    usuario: svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>')
  };
})();
let toastTimer = null, toastRestante = 0, toastInicio = 0, toastDuracion = 0, toastArrastre = null;
const TOAST_ICONOS = { success: '<path d="M20 6 9 17l-5-5"/>', error: '<path d="M12 8v5"/><path d="M12 16.5h.01"/><circle cx="12" cy="12" r="9"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5h.01"/>' };
function barraToast() {
  return document.querySelector("#toast .toast-progreso");
}
function arrancarTemporizadorToast(ms) {
  clearTimeout(toastTimer);
  toastRestante = ms;
  toastInicio = Date.now();
  toastTimer = setTimeout(ocultarToast, ms);
  const bar = barraToast();
  if (!bar || !toastDuracion) return;
  bar.style.transition = "none";
  bar.style.transform = `scaleX(${ms / toastDuracion})`;
  void bar.offsetWidth;
  bar.style.transition = `transform ${ms}ms linear`;
  bar.style.transform = "scaleX(0)";
}
function pausarToast() {
  if (!toastTimer) return;
  clearTimeout(toastTimer);
  toastTimer = null;
  toastRestante = Math.max(600, toastRestante - (Date.now() - toastInicio));
  const bar = barraToast();
  if (bar) {
    const m = getComputedStyle(bar).transform;
    let x = 1;
    try {
      x = new DOMMatrixReadOnly(m).a;
    } catch {
    }
    bar.style.transition = "none";
    bar.style.transform = `scaleX(${x})`;
  }
}
function reanudarToast() {
  const t = document.getElementById("toast");
  if (t?.classList.contains("visible") && !toastTimer && !toastArrastre) arrancarTemporizadorToast(toastRestante);
}
function ocultarToast(salida) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  clearTimeout(toastTimer);
  toastTimer = null;
  toastArrastre = null;
  toast.classList.remove("swiping");
  if (typeof salida === "number") {
    toast.style.transition = "transform .22s ease,opacity .22s ease";
    toast.style.transform = `translateX(${salida > 0 ? "" : "-"}120%)`;
    toast.style.opacity = "0";
  }
  toast.classList.remove("visible");
  setTimeout(() => {
    if (!toast.classList.contains("visible")) {
      toast.style.transform = "";
      toast.style.opacity = "";
      toast.style.transition = "";
    }
  }, 260);
}
function prepararToastGestos() {
  const toast = document.getElementById("toast");
  if (!toast || toast.dataset.gestureReady) return;
  toast.dataset.gestureReady = "true";
  toast.addEventListener("mouseenter", pausarToast);
  toast.addEventListener("mouseleave", reanudarToast);
  toast.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || e.target.closest(".toast-close")) return;
    toastArrastre = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, t: Date.now() };
    pausarToast();
    toast.classList.add("swiping");
    try {
      toast.setPointerCapture?.(e.pointerId);
    } catch {
    }
  });
  toast.addEventListener("pointermove", (e) => {
    const a = toastArrastre;
    if (!a || e.pointerId !== a.id) return;
    a.dx = e.clientX - a.x;
    toast.style.transform = `translateX(${a.dx}px)`;
    toast.style.opacity = String(Math.max(0.25, 1 - Math.abs(a.dx) / (toast.offsetWidth || 300)));
  });
  const soltar = (e) => {
    const a = toastArrastre;
    if (!a || e.pointerId !== a.id) return;
    toastArrastre = null;
    toast.classList.remove("swiping");
    const v = Math.abs(a.dx) / Math.max(1, Date.now() - a.t);
    if (Math.abs(a.dx) > (toast.offsetWidth || 300) * 0.3 || Math.abs(a.dx) > 30 && v > 0.5) {
      ocultarToast(a.dx);
      return;
    }
    toast.style.transition = "transform .25s cubic-bezier(.16,1,.3,1),opacity .25s ease";
    toast.style.transform = "";
    toast.style.opacity = "";
    setTimeout(() => {
      toast.style.transition = "";
    }, 260);
    reanudarToast();
  };
  toast.addEventListener("pointerup", soltar);
  toast.addEventListener("pointercancel", soltar);
}
function hacerDeslizable(el, alCerrar) {
  if (!el || el.dataset.deslizable) return;
  el.dataset.deslizable = "1";
  let a = null;
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || e.target.closest("button,a")) return;
    a = { id: e.pointerId, x: e.clientX, dx: 0, t: Date.now() };
    el.classList.add("swiping");
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch {
    }
  });
  el.addEventListener("pointermove", (e) => {
    if (!a || e.pointerId !== a.id) return;
    a.dx = e.clientX - a.x;
    el.style.translate = `${a.dx}px 0`;
    el.style.opacity = String(Math.max(0.25, 1 - Math.abs(a.dx) / (el.offsetWidth || 300)));
  });
  const fin = (e) => {
    if (!a || e.pointerId !== a.id) return;
    const d = a.dx, v = Math.abs(d) / Math.max(1, Date.now() - a.t);
    a = null;
    el.classList.remove("swiping");
    if (Math.abs(d) > (el.offsetWidth || 300) * 0.3 || Math.abs(d) > 30 && v > 0.5) {
      el.style.transition = "translate .2s ease,opacity .2s ease";
      el.style.translate = `${d > 0 ? "" : "-"}120% 0`;
      el.style.opacity = "0";
      setTimeout(() => {
        alCerrar();
        el.style.translate = "";
        el.style.opacity = "";
        el.style.transition = "";
      }, 210);
    } else {
      el.style.transition = "translate .25s cubic-bezier(.16,1,.3,1),opacity .25s ease";
      el.style.translate = "";
      el.style.opacity = "";
      setTimeout(() => {
        el.style.transition = "";
      }, 260);
    }
  };
  el.addEventListener("pointerup", fin);
  el.addEventListener("pointercancel", fin);
}
function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  let safeMessage = String(message || "");
  if (safeMessage.includes("violates row-level security") || safeMessage.includes("permission denied") || safeMessage.includes("relation") || safeMessage.includes("column") || safeMessage.includes("table")) safeMessage = "Error de permisos. Contacta al administrador.";
  const tipo = ["success", "error", "info"].includes(type) ? type : "success";
  clearTimeout(toastTimer);
  toastArrastre = null;
  toast.innerHTML = "";
  toast.style.transform = "";
  toast.style.opacity = "";
  toast.style.transition = "";
  const ico = document.createElement("span");
  ico.className = "toast-ico";
  ico.setAttribute("aria-hidden", "true");
  ico.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${TOAST_ICONOS[tipo]}</svg>`;
  const content = document.createElement("div");
  content.className = "toast-content";
  content.textContent = safeMessage.replace(/^\s*(✅|❌|⚠️|ℹ️)\s*/u, "");
  const close = document.createElement("button");
  close.className = "toast-close";
  close.type = "button";
  close.setAttribute("aria-label", "Cerrar notificación");
  close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    ocultarToast();
  });
  const prog = document.createElement("span");
  prog.className = "toast-progreso";
  prog.setAttribute("aria-hidden", "true");
  toast.append(ico, content, close, prog);
  toast.className = `toast ${tipo}`;
  toast.setAttribute("role", tipo === "error" ? "alert" : "status");
  prepararToastGestos();
  toastDuracion = tipo === "error" ? 5200 : 3600;
  requestAnimationFrame(() => {
    toast.classList.add("visible");
    arrancarTemporizadorToast(toastDuracion);
  });
}
const ESCAPES_HTML = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(str) {
  if (str === null || str === void 0 || str === "") return "";
  return String(str).replace(/[&<>"']/g, (c) => ESCAPES_HTML[c]);
}
document.addEventListener("click", (e) => {
  const b = e.target?.closest?.("[data-sair-accion]");
  if (!b) return;
  const accion = b.dataset.sairAccion;
  if (accion === "reintentar-comunidad") cargarComunidad(true);
  else if (accion === "reintentar-anuncios") renderAnuncios();
  else if (accion === "reintentar-personajes") renderCharacters();
  else if (accion === "nuevo-personaje") document.getElementById("btn-nuevo-personaje")?.click();
});
function hexToRgba(hex, alpha) {
  if (!hex) return "rgba(255,77,143,0.35)";
  hex = hex.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function lightenColor(hex, percent) {
  if (!hex) return "#ff6ba0";
  hex = hex.replace("#", "");
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);
  r = Math.min(255, Math.floor(r + (255 - r) * (percent / 100)));
  g = Math.min(255, Math.floor(g + (255 - g) * (percent / 100)));
  b = Math.min(255, Math.floor(b + (255 - b) * (percent / 100)));
  const rHex = r.toString(16).padStart(2, "0");
  const gHex = g.toString(16).padStart(2, "0");
  const bHex = b.toString(16).padStart(2, "0");
  return `#${rHex}${gHex}${bHex}`;
}
function sanitizeImageUrl(url) {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim(), cleanData = trimmed.replace(/[\r\n\s]+/g, "");
  if (/^biblioteca\/(fotos|perfiles|banners|personajes|owner)\/[a-z0-9-]+\.(webp|gif|png|jpg)$/.test(trimmed)) return trimmed;
  if (cleanData.startsWith("data:image/")) return /^data:image\/[a-z0-9\+\-\.]+;(?:base64|utf8),/i.test(cleanData) ? cleanData : "";
  try {
    const u = new URL(trimmed);
    if (u.protocol === "https:" || u.protocol === "http:") return trimmed;
  } catch {
  }
  return "";
}
const AVISO_NORMAS_RE = /^\s*\[\[\s*NORMAS\s*:?\s*([^\]\n]*)\]?\]?/i;
function razonAvisoNormas(texto) {
  const m = AVISO_NORMAS_RE.exec(String(texto || ""));
  if (!m) return null;
  return m[1].trim().replace(/\s+/g, " ").slice(0, 160) || "contenido no permitido";
}
function htmlAvisoNormas(razon) {
  return `<div class="aviso-normas" role="note"><span class="aviso-normas-ico" aria-hidden="true">🚫</span><div class="aviso-normas-texto"><strong>No puedo continuar.</strong> Este personaje infringe las Normas de la comunidad.<span class="aviso-normas-razon">Razón: ${escapeHtml(razon)}</span></div></div>`;
}
function registrarAvisoNormas(razon) {
  if (!sbClient || !currentUser || !currentCharacter?.id || currentCharacter.publico === false) return;
  sbClient.rpc("registrar_aviso_normas", { p_personaje_id: currentCharacter.id, p_razon: razon }).then(() => {
  }, () => {
  });
}
function renderMarkdown(texto) {
  if (!texto) return "";
  const razonNormas = razonAvisoNormas(texto);
  if (razonNormas !== null) return htmlAvisoNormas(razonNormas);
  let textoProcesado = reemplazarUserEnTexto(texto);
  const escaped = textoProcesado.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped.replace(/\*\*(?=\S)([^*\n]+?)\*\*/g, "<strong>$1</strong>").replace(/\*([^*\n]+)\*/g, (m, p1) => `<em class="accion">*${p1}*</em>`).replace(/\n/g, "<br>");
}
function formatDate(dateStr) {
  const d = new Date(dateStr), now = /* @__PURE__ */ new Date(), diff = now - d;
  if (diff < 6e4) return "ahora";
  if (diff < 36e5) return `hace ${Math.floor(diff / 6e4)}m`;
  if (diff < 864e5) return `hace ${Math.floor(diff / 36e5)}h`;
  if (diff < 6048e5) return `hace ${Math.floor(diff / 864e5)}d`;
  return d.toLocaleDateString();
}
const GEMINI_KEY_STORAGE = window.localStorage;
const _obf_k = (str) => {
  if (!str) return "";
  return btoa(str.split("").map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ i % 10 + 3)).join(""));
}, _deobf_k = (str) => {
  if (!str) return "";
  try {
    const decoded = atob(str);
    return decoded.split("").map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ i % 10 + 3)).join("");
  } catch {
    return "";
  }
};
function isGeminiApiKey(key) {
  if (!key || typeof key !== "string") return false;
  const k = key.trim().replace(/\s+/g, "");
  return /^AIza[0-9A-Za-z_-]{20,}$/.test(k) || /^AQ\.[0-9A-Za-z_.-]{20,}$/.test(k) || /^[0-9A-Za-z_-]{32,}$/.test(k);
}
function getGeminiKey() {
  let stored = (GEMINI_KEY_STORAGE.getItem(CONFIG.LS.GEMINI_KEY) || "").trim();
  if (!stored) {
    const legacy = (window.sessionStorage.getItem(CONFIG.LS.GEMINI_KEY) || "").trim();
    if (legacy) {
      stored = legacy;
      try {
        GEMINI_KEY_STORAGE.setItem(CONFIG.LS.GEMINI_KEY, legacy);
      } catch {
      }
    }
  }
  try {
    window.sessionStorage.removeItem(CONFIG.LS.GEMINI_KEY);
  } catch {
  }
  if (!stored) return "";
  let candidate = stored, best = null;
  for (let i = 0; i < 5; i++) {
    const dec = (_deobf_k(candidate) || "").trim().replace(/\s+/g, "");
    if (!dec || dec === candidate) break;
    if (isGeminiApiKey(dec)) best = dec;
    candidate = dec;
  }
  const raw = stored.replace(/\s+/g, "");
  if (best) {
    try {
      GEMINI_KEY_STORAGE.setItem(CONFIG.LS.GEMINI_KEY, _obf_k(best));
    } catch {
    }
    return best;
  }
  if (isGeminiApiKey(raw)) {
    try {
      GEMINI_KEY_STORAGE.setItem(CONFIG.LS.GEMINI_KEY, _obf_k(raw));
    } catch {
    }
    return raw;
  }
  return "";
}
function mensajeErrorGemini(msg) {
  const m = String(msg || "");
  if (/invalid authentication credentials|API key not valid|API_KEY_INVALID/.test(m)) return "Tu API Key de Gemini es inválida o fue revocada. Reconfigúrala en Ajustes de Rol (🎭)";
  return m;
}
function saveGeminiKey(raw) {
  const key = (raw || "").trim().replace(/\s+/g, "");
  if (!isGeminiApiKey(key)) throw new Error("API Key inválida. Pega una clave válida de Google AI Studio.");
  GEMINI_KEY_STORAGE.setItem(CONFIG.LS.GEMINI_KEY, _obf_k(key));
  try {
    window.sessionStorage.removeItem(CONFIG.LS.GEMINI_KEY);
  } catch {
  }
  ;
  return key;
}
function geminiHeaders(apiKey) {
  return { "Content-Type": "application/json", "x-goog-api-key": apiKey };
}
function geminiUrl(model, stream = false) {
  const action = stream ? "streamGenerateContent" : "generateContent";
  const qs = stream ? "?alt=sse" : "";
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${action}${qs}`;
}
const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash"];
function getGeminiModel() {
  const saved = localStorage.getItem(CONFIG.LS.GEMINI_MODEL);
  return GEMINI_MODELS.includes(saved) ? saved : "gemini-3.5-flash";
}
function setGeminiModel(model) {
  const safe = GEMINI_MODELS.includes(model) ? model : "gemini-3.5-flash";
  localStorage.setItem(CONFIG.LS.GEMINI_MODEL, safe);
  return safe;
}
function etiquetaModelo(model) {
  const m = String(model || "gemini-3.5-flash").replace(/^gemini-/, "");
  return "Gemini " + m.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
const DEFAULT_SUMMARY_MODEL = "gemini-3.8-flash";
function getSummaryModel() {
  let saved = localStorage.getItem(CONFIG.LS.GEMINI_SUMMARY_MODEL);
  if (!saved) {
    const viejo = localStorage.getItem("undefined");
    if (GEMINI_MODELS.includes(viejo)) {
      saved = viejo;
      try {
        localStorage.setItem(CONFIG.LS.GEMINI_SUMMARY_MODEL, viejo);
        localStorage.removeItem("undefined");
      } catch {
      }
    }
  }
  return GEMINI_MODELS.includes(saved) ? saved : DEFAULT_SUMMARY_MODEL;
}
function setSummaryModel(model) {
  const safe = GEMINI_MODELS.includes(model) ? model : DEFAULT_SUMMARY_MODEL;
  localStorage.setItem(CONFIG.LS.GEMINI_SUMMARY_MODEL, safe);
  return safe;
}
function normalizarIntensidad(value) {
  const clean = String(value || "").toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return ["suave", "mediana", "maxima"].includes(clean) ? clean : "suave";
}
function obtenerIntensidadPersonaje(personaje = currentCharacter) {
  if (!personaje) return "suave";
  const parsed = parsearSystemPrompt(personaje.system_prompt || "");
  return normalizarIntensidad(personaje.intensidad || parsed.intensidad || "suave");
}
function etiquetaIntensidad(value) {
  return { suave: "🟢 Suave", mediana: "🟡 Mediana", maxima: "🔥 Máxima" }[normalizarIntensidad(value)];
}
function estimarTokens(texto) {
  return Math.ceil((texto || "").length / 3.5);
}
function contarTokensHistorial(historial) {
  return historial.reduce((t, m) => t + estimarTokens(m.contenido || ""), 0);
}
function getSafetySettings(intensidad = "suave") {
  let threshold = "BLOCK_MEDIUM_AND_ABOVE";
  const clean = normalizarIntensidad(intensidad);
  if (clean === "mediana") threshold = "BLOCK_ONLY_HIGH";
  if (clean === "maxima") threshold = "BLOCK_NONE";
  return [
    { category: "HARM_CATEGORY_HARASSMENT", threshold },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold }
  ];
}
const GEMINI_MODELOS_RESPALDO = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];
const CATEGORIAS_SEGURIDAD = ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"];
const SISTEMA_NEUTRO = "Eres un asistente que analiza y redacta textos con precisión, siguiendo exactamente las instrucciones del usuario.";
let diagnosticoGemini = [];
function registrarDiagnostico(entrada) {
  try {
    diagnosticoGemini.push(Object.assign({ hora: (/* @__PURE__ */ new Date()).toISOString() }, entrada));
    if (diagnosticoGemini.length > 80) diagnosticoGemini = diagnosticoGemini.slice(-80);
  } catch {
  }
}
window.sairDiagnostico = function() {
  console.log("🛡️ Diagnóstico de bloqueos de Gemini:", diagnosticoGemini);
  return diagnosticoGemini.slice();
};
function getSafetySettingsNivel(nivel) {
  let threshold = "BLOCK_MEDIUM_AND_ABOVE";
  if (nivel === "off") threshold = "OFF";
  else if (nivel === "bloqueo_minimo") threshold = "BLOCK_NONE";
  else threshold = getSafetySettings(nivel)[0].threshold;
  return CATEGORIAS_SEGURIDAD.map((category) => ({ category, threshold }));
}
function normalizarNivelSeguridad(valor) {
  const limpio = String(valor || "").toLowerCase().trim();
  if (limpio === "bloqueo_minimo" || limpio === "off") return limpio;
  return normalizarIntensidad(limpio);
}
function crearErrorBloqueo(mensaje, textoParcial, extra) {
  const err = new Error(mensaje);
  err.esBloqueoDeSeguridad = true;
  if (textoParcial) err.textoParcial = textoParcial;
  if (extra) Object.assign(err, extra);
  return err;
}
function esErrorDeBloqueo(err) {
  return !!(err && err.esBloqueoDeSeguridad);
}
function mensajeBloqueoConAyuda(err, intentos) {
  const base = String(err && err.message || "");
  const razon = (base.match(/\(([^)]+)\)/) || [])[1] || "";
  const cabecera = razon ? `Gemini bloqueó esta conversación con su filtro no configurable (${razon}).` : "Gemini bloqueó esta conversación con un filtro no configurable.";
  const n = intentos || err && err.intentos || 0;
  return `${cabecera} La app ya probó ${n || "varias"} estrategias (umbrales permisivos, modelos de respaldo, texto discretizado y resumen por tramos) sin conseguirlo. Suele ocurrir en chats muy explícitos o muy largos: recorta la conversación, cambia el modelo de resumen en Ajustes de Rol (🎭) e inténtalo otra vez.`;
}
const MASCARA_INTIMA = "[escena íntima]";
const PATRONES_EXPLICITOS = [
  /\bdesnud\w*/gi,
  /\b(sexo|sexual\w*)\b/gi,
  /\borgasmo\w*/gi,
  /\beyacul\w*/gi,
  /\berecci[oó]n\w*/gi,
  /\bmasturb\w*/gi,
  /\b(pene|penes|polla|pollas|verga|vergas)\b/gi,
  /\b(vagina|vaginas|coño|conio)\b/gi,
  /\bcl[ií]toris\b/gi,
  /\b(tetas|pezones?|nalgas|culo)\b/gi,
  /\b(semen|corrida)\b/gi,
  /\bfoll\w*/gi,
  /\bcachond\w*/gi,
  /\bporn\w*/gi
];
function discretizar(texto) {
  let t = String(texto || "");
  if (!t) return t;
  for (const patron of PATRONES_EXPLICITOS) t = t.replace(patron, MASCARA_INTIMA);
  return t.replace(/(\[escena íntima\]\s*){2,}/g, MASCARA_INTIMA);
}
function construirContenidoGemini(mensajes, discreto) {
  const turns = [];
  for (const m of Array.isArray(mensajes) ? mensajes : []) {
    if (!m) continue;
    const rol = m.rol === "assistant" ? "model" : "user";
    let texto = String(m.contenido || "");
    if (!texto.trim()) continue;
    if (discreto) texto = discretizar(texto);
    const ultimo = turns[turns.length - 1];
    if (ultimo && ultimo.role === rol) ultimo.parts[0].text += "\n\n" + texto;
    else turns.push({ role: rol, parts: [{ text: texto }] });
  }
  return turns;
}
function agregarTurnoUsuario(contents, texto) {
  if (!texto || !String(texto).trim()) return contents;
  const limpio = String(texto).trim();
  const ultimo = contents[contents.length - 1];
  if (ultimo && ultimo.role === "user") ultimo.parts[0].text += "\n\n" + limpio;
  else contents.push({ role: "user", parts: [{ text: limpio }] });
  return contents;
}
function limitarMensajesPorLongitud(mensajes, maximo, desdeElFinal = false) {
  if (!Array.isArray(mensajes) || !mensajes.length || !(maximo > 0)) return [];
  const lista = desdeElFinal ? mensajes.slice().reverse() : mensajes.slice();
  const resultado = [];
  let total = 0;
  for (const m of lista) {
    const texto = String(m.contenido || "");
    if (total >= maximo) break;
    if (total + texto.length > maximo) {
      const corte = texto.slice(0, Math.max(0, maximo - total));
      resultado.push({ ...m, contenido: (desdeElFinal ? "[...parte inicial del chat omitida por longitud...]\n\n" : "") + corte + (desdeElFinal ? "" : "... (truncado)") });
      total = maximo;
      break;
    }
    resultado.push(m);
    total += texto.length;
  }
  return desdeElFinal ? resultado.reverse() : resultado;
}
let ultimoFinishGemini = "";
async function peticionGeminiTexto({ systemPrompt, contenido, mensajes, instruccion, modelo, nivelSeguridad = "suave", maxOutputTokens = 4096, temperature = 0.3, discreto = false }) {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    const err = new Error("No hay API Key configurada");
    err.tipo = "clave";
    throw err;
  }
  let contents;
  if (Array.isArray(mensajes) && mensajes.length) {
    contents = construirContenidoGemini(mensajes, discreto);
    agregarTurnoUsuario(contents, discreto ? discretizar(instruccion) : instruccion);
    if (!contents.length) throw new Error("No hay mensajes para enviar a Gemini");
  } else {
    const cuerpo = discreto ? discretizar(contenido) : contenido;
    if (!String(cuerpo || "").trim()) throw new Error("No hay texto para enviar a Gemini");
    contents = [{ role: "user", parts: [{ text: cuerpo }] }];
    agregarTurnoUsuario(contents, discreto ? discretizar(instruccion) : instruccion);
  }
  const body = {
    contents,
    safetySettings: getSafetySettingsNivel(nivelSeguridad),
    generationConfig: { temperature, topP: 0.9, topK: 40, maxOutputTokens }
  };
  if (systemPrompt) body.system_instruction = { parts: [{ text: systemPrompt }] };
  let response;
  try {
    response = await fetch(geminiUrl(modelo, false), { method: "POST", headers: geminiHeaders(apiKey), body: JSON.stringify(body) });
  } catch (err) {
    const e2 = new Error("No se pudo conectar con Gemini. Revisa tu conexión e intenta de nuevo.");
    e2.tipo = "red";
    throw e2;
  }
  if (!response.ok) {
    const errText = await response.text();
    let msg = "";
    try {
      const errJson = JSON.parse(errText);
      msg = errJson.error?.message || "";
    } catch {
    }
    if (/API key not valid|invalid authentication|API_KEY_INVALID/i.test(msg)) {
      const e3 = new Error("Tu API Key de Gemini es inválida o fue revocada. Reconfígurala en Ajustes de Rol (🎭)");
      e3.tipo = "clave";
      throw e3;
    }
    if (response.status === 429 || /quota|rate limit|too many requests|resource_exhausted/i.test(msg)) {
      const e3 = new Error("Límite de peticiones alcanzado. Espera unos segundos y reintenta.");
      e3.tipo = "cuota";
      throw e3;
    }
    if (response.status === 400 && /safety|block|threshold|harm|prohibited/i.test(msg)) throw crearErrorBloqueo("La petición fue rechazada por los filtros de seguridad de Gemini.", null, { tipo: "bloqueo", detalle: String(msg).slice(0, 300) });
    const e2 = new Error(msg || `Error de Gemini (${response.status})`);
    e2.tipo = response.status >= 500 ? "servidor" : "modelo";
    throw e2;
  }
  const data = await response.json();
  anotarUsoUnico(data.usageMetadata);
  const candidato = data.candidates?.[0];
  const finish = String(candidato?.finishReason || "").toUpperCase();
  const texto = (candidato?.content?.parts || []).map((p) => p.text || "").join("").trim();
  ultimoFinishGemini = finish;
  if (texto && (!finish || finish === "STOP" || finish === "MAX_TOKENS")) return texto;
  if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") throw crearErrorBloqueo(`Gemini bloqueó la respuesta (${finish}).`, texto, { tipo: "bloqueo" });
  if (data.promptFeedback?.blockReason) {
    console.warn("🛡️ Gemini bloqueó la petición. promptFeedback:", JSON.stringify(data.promptFeedback));
    throw crearErrorBloqueo(`Gemini bloqueó la petición (${data.promptFeedback.blockReason}).`, texto, { tipo: "bloqueo", detalle: JSON.stringify(data.promptFeedback).slice(0, 400) });
  }
  if (texto) return texto;
  const e = new Error("Gemini no devolvió ninguna respuesta. Intenta de nuevo.");
  e.tipo = "generico";
  throw e;
}
function construirPlanesEscalada(nivelBase, modeloBase) {
  const modelos = [...new Set([modeloBase, getGeminiModel(), ...GEMINI_MODELOS_RESPALDO].filter(Boolean))].slice(0, 4);
  const base = modelos[0], alterno = modelos[1] || modelos[0];
  const planes = [
    { modelo: base, nivel: nivelBase, forma: "normal" },
    { modelo: base, nivel: "bloqueo_minimo", forma: "normal" },
    { modelo: alterno, nivel: "bloqueo_minimo", forma: "normal" },
    { modelo: base, nivel: "bloqueo_minimo", forma: "discreta" },
    { modelo: alterno, nivel: "bloqueo_minimo", forma: "discreta" },
    { modelo: base, nivel: "off", forma: "discreta" },
    { modelo: alterno, nivel: "off", forma: "discreta" },
    { modelo: base, nivel: "off", forma: "neutra" },
    { modelo: alterno, nivel: "off", forma: "neutra" }
  ];
  const vistos = /* @__PURE__ */ new Set(), finales = [];
  for (const plan of planes) {
    const clave = `${plan.modelo}|${plan.nivel}|${plan.forma}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    finales.push(plan);
  }
  return finales;
}
async function generarConGeminiResiliente({ systemPrompt, sistemaNeutro = null, contenido, mensajes, instruccion, instruccionNeutra = null, maxOutputTokens = 4096, temperature = 0.3, nivelInicial = null, modelo = null, maxIntentos = null, accionCR = "resumen" }) {
  if (usaCR()) {
    const r = await peticionCRTexto({ systemPrompt, contenido, mensajes, instruccion, accion: accionCR });
    return { texto: r.texto, modelo: `deepseek-${modeloCR()}`, nivel: "cr", forma: "normal", intentos: 1, parcial: false, cortado: r.cortado };
  }
  const parsed = parsearSystemPrompt(currentCharacter?.system_prompt);
  const nivelBase = normalizarNivelSeguridad(nivelInicial || currentCharacter?.intensidad || parsed.intensidad || "suave");
  const planes = construirPlanesEscalada(nivelBase, modelo || getSummaryModel());
  const limite = Math.max(1, Math.min(maxIntentos || planes.length, planes.length));
  let mejorParcial = "", ultimoError = null, intentos = 0, seguidos = 0, ultimoTipo = "";
  for (let i = 0; i < limite; i++) {
    const plan = planes[i];
    intentos++;
    const discreto = plan.forma !== "normal";
    const neutro = plan.forma === "neutra";
    try {
      const texto = await peticionGeminiTexto({
        systemPrompt: neutro ? sistemaNeutro || SISTEMA_NEUTRO : systemPrompt,
        contenido,
        mensajes,
        instruccion: neutro ? instruccionNeutra || instruccion : instruccion,
        modelo: plan.modelo,
        nivelSeguridad: plan.nivel,
        maxOutputTokens,
        temperature,
        discreto
      });
      registrarDiagnostico({ accion: "ok", modelo: plan.modelo, nivel: plan.nivel, forma: plan.forma, intento: intentos });
      if (intentos > 1) console.log(`🛡️ Gemini respondió tras ${intentos} intentos (${plan.modelo} · ${plan.nivel} · ${plan.forma})`);
      return { texto, modelo: plan.modelo, nivel: plan.nivel, forma: plan.forma, intentos, parcial: false, cortado: ultimoFinishGemini === "MAX_TOKENS" };
    } catch (err2) {
      if (err2.textoParcial && err2.textoParcial.length > mejorParcial.length) mejorParcial = err2.textoParcial;
      const tipo = err2.tipo || (esErrorDeBloqueo(err2) ? "bloqueo" : "generico");
      registrarDiagnostico({ accion: "fallo", modelo: plan.modelo, nivel: plan.nivel, forma: plan.forma, intento: intentos, tipo, mensaje: String(err2.message || "").slice(0, 220) });
      if (tipo === "clave") throw err2;
      if (tipo === ultimoTipo) seguidos++;
      else {
        seguidos = 1;
        ultimoTipo = tipo;
      }
      if (esErrorDeBloqueo(err2)) console.warn(`🛡️ Intento ${intentos} bloqueado (${plan.modelo} · ${plan.nivel} · ${plan.forma}). Probando otra estrategia…`);
      else console.warn(`⚠️ Intento ${intentos} con ${plan.modelo} falló (${tipo}): ${err2.message}`);
      if (esErrorDeBloqueo(err2)) ultimoError = err2;
      else if (!ultimoError) ultimoError = err2;
      if (seguidos >= 3 && tipo !== "bloqueo") throw err2;
    }
  }
  if (mejorParcial.trim().length >= 400) return { texto: mejorParcial.trim(), modelo: planes[0].modelo, nivel: "parcial", forma: "parcial", intentos, parcial: true };
  if (ultimoError) {
    ultimoError.intentos = intentos;
    throw ultimoError;
  }
  const err = new Error("No se pudo obtener respuesta de Gemini. Intenta de nuevo.");
  err.tipo = "generico";
  err.intentos = intentos;
  throw err;
}
function dividirTextoEnTramos(texto, maximo) {
  const parrafos = String(texto || "").split(/\n{2,}/);
  const tramos = [];
  let actual = "";
  for (const parrafo of parrafos) {
    if (parrafo.length > maximo) {
      let resto = parrafo;
      while (resto.length > maximo) {
        tramos.push(resto.slice(0, maximo));
        resto = resto.slice(maximo);
      }
      if (resto) actual = actual ? `${actual}

${resto}` : resto;
      continue;
    }
    if (actual && actual.length + parrafo.length + 2 > maximo) {
      tramos.push(actual);
      actual = parrafo;
    } else actual = actual ? `${actual}

${parrafo}` : parrafo;
  }
  if (actual.trim()) tramos.push(actual);
  return tramos.filter((t) => t.trim());
}
const RESUMEN_TRAMO_CARACTERES = 14e3;
const DIGESTO_TRAMO_CARACTERES = 9e3;
const MAX_TRAMOS = 40;
function textoDeMensajes(mensajes) {
  const nombreUsuario = userRoleName || "el usuario";
  const nombrePersonaje = currentCharacter?.nombre || "el personaje principal";
  return (Array.isArray(mensajes) ? mensajes : []).filter((m) => m && (m.rol === "user" || m.rol === "assistant")).map((m) => `${m.rol === "assistant" ? nombrePersonaje : nombreUsuario}: ${String(m.contenido || "")}`).join("\n\n");
}
function contextoDigesto() {
  return `Ficha: en los turnos "user" habla ${userRoleName || "el usuario"}; en los turnos "model" habla ${currentCharacter?.nombre || "el personaje principal"}.`;
}
function unirDigestoTramos(partes) {
  return partes.map((p, i) => `• Tramo ${i + 1}: ${p}`).join("\n\n");
}
const DIGESTO_PROMPT = `Vas a leer un fragmento de una conversación de ficción (turnos "user" y "model") y describir lo que ocurre.
Reglas:
- Escribe en tercera persona, de forma objetiva y neutral.
- Incluye hechos, decisiones, promesas, emociones y cómo cambia la relación entre los personajes.
- Menciona los nombres de los personajes que aparecen.
- No copies diálogos largos ni inventes nada que no aparezca en el fragmento.
- Responde solo con la descripción, en un máximo de 200 palabras.`;
async function digestoTramos(mensajes, { nivelInicial = "bloqueo_minimo", onProgreso = null, maxIntentosPorTramo = 3 } = {}) {
  const texto = textoDeMensajes(mensajes);
  const tramos = dividirTextoEnTramos(texto, DIGESTO_TRAMO_CARACTERES).slice(0, MAX_TRAMOS);
  if (!tramos.length) return { partes: [], omitidos: 0, total: 0, texto };
  const partes = [];
  let omitidos = 0;
  for (let i = 0; i < tramos.length; i++) {
    if (onProgreso) {
      try {
        onProgreso(i + 1, tramos.length);
      } catch {
      }
    }
    try {
      const { texto: parte } = await generarConGeminiResiliente({
        systemPrompt: DIGESTO_PROMPT,
        contenido: `${contextoDigesto()}

Fragmento ${i + 1} de ${tramos.length}:

${tramos[i]}`,
        maxOutputTokens: 1200,
        temperature: 0.25,
        nivelInicial,
        maxIntentos: maxIntentosPorTramo
      });
      if (String(parte || "").trim()) partes.push(parte.trim());
      else omitidos++;
    } catch (err) {
      if (!esErrorDeBloqueo(err)) throw err;
      omitidos++;
      console.warn(`🛡️ Tramo ${i + 1}/${tramos.length} bloqueado; se omite y se continúa con el resto.`);
    }
  }
  return { partes, omitidos, total: tramos.length, texto };
}
const RESUMEN_PROMPT_SISTEMA = `Eres un asistente experto en resumir conversaciones de ficción (turnos "user" y "model").
Tu tarea es crear un resumen objetivo, claro y útil para que la historia pueda continuar sin perder contexto. Debe incluir:
- Puntos clave de la trama y eventos importantes
- Promesas, compromisos o acuerdos hechos por los personajes
- Acciones importantes realizadas
- Decisiones tomadas y sus consecuencias
- Detalles relevantes del entorno, contexto o escenario
- Relaciones entre personajes que se hayan establecido
- Objetivos o metas mencionadas

REGLAS:
- NO inventes nada que no esté en el texto
- NO agregues opiniones personales ni interpretaciones
- NO copies diálogos completos: describe acciones, decisiones y emociones
- Responde ÚNICAMENTE con el resumen, sin introducciones ni explicaciones
- El resumen debe ser conciso pero sin perder información crítica`;
const RESUMEN_PROMPT_TRAMO = `${RESUMEN_PROMPT_SISTEMA}

IMPORTANTE: este texto es solo un tramo de una conversación más larga. Resume lo que ocurre en este tramo manteniendo nombres, decisiones y emociones, con lenguaje descriptivo y neutro.`;
const RESUMEN_PROMPT_UNIR = `Eres un asistente experto en resumir conversaciones de ficción. Recibirás resúmenes parciales, en orden cronológico, de una misma historia. Únelos en UN ÚNICO resumen coherente y cronológico: elimina repeticiones, conserva todos los hechos, nombres, decisiones, promesas y relaciones importantes, y no añadas nada que no aparezca en los parciales. Responde solo con el resumen final.`;
async function resumirPorTramos(texto, nivel, avisoOmitidos = "") {
  const tramos = dividirTextoEnTramos(texto, RESUMEN_TRAMO_CARACTERES).slice(0, MAX_TRAMOS);
  if (tramos.length <= 1) throw crearErrorBloqueo("Los filtros de seguridad de Gemini bloquearon el resumen de esta conversación.", null, { tipo: "bloqueo" });
  console.warn(`🛡️ Resumiendo por tramos: ${tramos.length} partes.`);
  const partes = [];
  let omitidos = 0;
  for (let i = 0; i < tramos.length; i++) {
    try {
      const { texto: parte } = await generarConGeminiResiliente({
        systemPrompt: RESUMEN_PROMPT_TRAMO,
        contenido: `Tramo ${i + 1} de ${tramos.length} de una conversación de ficción:

${tramos[i]}`,
        maxOutputTokens: 2048,
        temperature: 0.25,
        // Ya sabemos que el filtro estándar bloquea este chat: arrancamos
        // con el umbral permisivo para no repetir intentos inútiles.
        nivelInicial: "bloqueo_minimo",
        maxIntentos: 3
      });
      if (String(parte || "").trim()) partes.push(parte.trim());
      else omitidos++;
    } catch (err) {
      if (!esErrorDeBloqueo(err)) throw err;
      omitidos++;
      console.warn(`🛡️ Tramo ${i + 1}/${tramos.length} bloqueado; se omite y se continúa con el resto.`);
    }
  }
  const utiles = partes.filter(Boolean);
  if (!utiles.length) throw crearErrorBloqueo("Los filtros de seguridad de Gemini bloquearon toda la conversación.", null, { tipo: "bloqueo" });
  let resumen = utiles.length === 1 ? utiles[0] : unirDigestoTramos(utiles);
  if (utiles.length > 1) {
    try {
      const { texto: unido } = await generarConGeminiResiliente({ systemPrompt: RESUMEN_PROMPT_UNIR, contenido: resumen, maxOutputTokens: 4096, temperature: 0.25, nivelInicial: "bloqueo_minimo", maxIntentos: 3 });
      if (String(unido || "").trim()) resumen = unido.trim();
    } catch (err) {
      if (!esErrorDeBloqueo(err)) throw err;
      console.warn("🛡️ No se pudieron unir los tramos; se conservan por separado.");
    }
  }
  if (omitidos > 0) resumen += `

(Nota: ${omitidos} tramo${omitidos !== 1 ? "s" : ""} de la conversación no se pudo resumir por los filtros del modelo.)${avisoOmitidos}`;
  return resumen;
}
async function resumirHistorialConGemini({ mensajes, contenido, resumenPrevio = "", intensidad = null } = {}) {
  const lista = Array.isArray(mensajes) ? mensajes.filter((m) => m && (m.rol === "user" || m.rol === "assistant")) : [];
  const limpio = String(contenido || "").trim() || lista.map((m) => String(m.contenido || "")).join("\n\n").trim();
  if (!limpio) throw new Error("No hay texto para resumir");
  const parsed = parsearSystemPrompt(currentCharacter?.system_prompt);
  const nivelBase = normalizarIntensidad(intensidad || currentCharacter?.intensidad || parsed.intensidad || "suave");
  if (usaCR() && limpio.length > 6e4) return await resumirPorTramos(limpio, nivelBase);
  const contextoPrevio = String(resumenPrevio || "").trim() ? `CONTEXTO · Resumen anterior de la misma conversación (incorpóralo sin repetirlo textualmente):
${String(resumenPrevio).trim().slice(0, 6e3)}

` : "";
  try {
    const { texto: resumen } = await generarConGeminiResiliente({
      systemPrompt: contextoPrevio + RESUMEN_PROMPT_SISTEMA,
      sistemaNeutro: SISTEMA_NEUTRO,
      // La conversación se envía como turnos user/model, igual que en el chat.
      mensajes: lista.length ? lista : void 0,
      contenido: lista.length ? void 0 : `Conversación de ficción a resumir:

${limpio}`,
      instruccion: lista.length ? "Resume la conversación completa de forma objetiva: hechos, decisiones, promesas y relaciones, sin inventar nada." : void 0,
      instruccionNeutra: lista.length ? "Resume de forma objetiva la conversación anterior: hechos, decisiones, promesas y relaciones." : void 0,
      maxOutputTokens: 4096,
      temperature: 0.3,
      nivelInicial: nivelBase
    });
    return resumen.trim();
  } catch (err) {
    if (!esErrorDeBloqueo(err)) throw err;
    return await resumirPorTramos(limpio, nivelBase);
  }
}
const RECAP_PROMPT_SISTEMA = `Analiza una conversación de ficción (turnos "user" y "model") y entrega un informe estructurado en EXACTAMENTE DOS PARTES, separadas por el marcador "===ACTUALMENTE===" (escríbelo tal cual, en mayúsculas y con tres guiones a cada lado).

PARTE 1 - LA HISTORIA (antes del marcador): relata CRONOLÓGICAMENTE todo lo sucedido. Incluye los eventos importantes y puntos de giro, las decisiones clave, los conflictos o momentos emocionales destacados, la evolución de la relación entre los personajes y el contexto relevante. Resalta en **negrita** los momentos más importantes.

===ACTUALMENTE===

PARTE 2 - ACTUALMENTE (después del marcador): describe el estado presente: de qué están hablando en los últimos mensajes, qué están haciendo los personajes, su estado emocional, la situación inmediata y hacia dónde parece dirigirse la conversación.

REGLAS OBLIGATORIAS:
- NO uses introducciones ni despedidas (nada de "Aquí está el resumen")
- NO hables en primera persona ni te refieras a ti mismo
- Responde SOLO con las dos partes, separadas exactamente por el marcador
- Usa **negritas** para nombres, eventos clave y momentos importantes
- Usa *cursivas* para emociones, estados de ánimo o detalles sutiles
- Sé conciso pero completo. Si la conversación es larga, prioriza los puntos de giro`;
const RECAP_INSTRUCCION = "Entrega el informe completo: la historia y, tras el marcador ===ACTUALMENTE===, el estado actual.";
async function recapitularPorTramos(mensajes, { nivelInicial = "bloqueo_minimo", onProgreso = null } = {}) {
  const { partes, omitidos, total } = await digestoTramos(mensajes, { nivelInicial, onProgreso, maxIntentosPorTramo: 3 });
  if (!partes.length) throw crearErrorBloqueo("Los filtros de seguridad de Gemini bloquearon toda la conversación.", null, { tipo: "bloqueo" });
  const digest = unirDigestoTramos(partes);
  let textoFinal = "";
  try {
    const { texto } = await generarConGeminiResiliente({
      systemPrompt: RECAP_PROMPT_SISTEMA,
      sistemaNeutro: SISTEMA_NEUTRO,
      contenido: `NOTAS CRONOLÓGICAS DE LA HISTORIA (resumen por tramos, en orden):

${digest}`,
      instruccion: RECAP_INSTRUCCION,
      instruccionNeutra: RECAP_INSTRUCCION,
      maxOutputTokens: 6048,
      temperature: 0.4,
      nivelInicial: "bloqueo_minimo"
    });
    textoFinal = String(texto || "").trim();
  } catch (err) {
    if (!esErrorDeBloqueo(err)) throw err;
    console.warn("🛡️ No se pudo redactar el informe final; se entregan las notas por tramos.");
    textoFinal = `${partes.join("\n\n")}

===ACTUALMENTE===

${partes[partes.length - 1]}`;
  }
  if (omitidos > 0) textoFinal += `

(Nota: ${omitidos} de ${total} fragmentos de la conversación no se pudieron leer por los filtros de Gemini.)`;
  return { texto: textoFinal, omitidos, total };
}
const RESUMEN_LIMITE_TOKENS = 15e3, RESUMEN_RESERVA_TOKENS = 5e3;
const RESUMEN_MARCA = /^<!--sair:hasta=([^>]*)-->\n?/;
function separarMarcaResumen(texto) {
  const t = String(texto || "");
  const m = t.match(RESUMEN_MARCA);
  return m ? { texto: t.slice(m[0].length), hasta: m[1] || null } : { texto: t, hasta: null };
}
function componerResumenGuardado(texto, hasta) {
  const limpio = separarMarcaResumen(texto).texto;
  return hasta ? `<!--sair:hasta=${hasta}-->
${limpio}` : limpio;
}
function contextoActivoHistorial(historial) {
  const lista = Array.isArray(historial) ? historial : [];
  const resumen = lista.find((m) => m && m.rol === "summary") || null;
  const todos = lista.filter((m) => m && (m.rol === "user" || m.rol === "assistant"));
  let desde = 0;
  if (resumen?.hasta) {
    const i = todos.findIndex((m) => String(m.id) === String(resumen.hasta));
    if (i >= 0) desde = i + 1;
  }
  return { resumen, activos: todos.slice(desde), todos };
}
function tokensContextoChat(historial) {
  const { resumen, activos } = contextoActivoHistorial(historial);
  return estimarTokens(resumen?.contenido || "") + contarTokensHistorial(activos);
}
function chatNecesitaResumen(historial) {
  return tokensContextoChat(historial) > RESUMEN_LIMITE_TOKENS;
}
let medidorPeticion = 0;
function formatoMiles(n) {
  return n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(".", ",")}k` : String(n);
}
function pintarMedidorContexto(tokens, { hayResumen = false } = {}) {
  const btn = document.getElementById("contexto-medidor");
  if (!btn) return;
  if (tokens == null) {
    btn.hidden = true;
    cerrarPopoverContexto();
    return;
  }
  const pct = Math.min(100, Math.round(tokens / RESUMEN_LIMITE_TOKENS * 100));
  const nivel = pct >= 100 ? "lleno" : pct >= 80 ? "alto" : pct >= 55 ? "medio" : "bajo";
  btn.hidden = false;
  btn.dataset.nivel = nivel;
  document.getElementById("contexto-medidor-relleno").style.width = `${pct}%`;
  document.getElementById("contexto-medidor-texto").textContent = `${formatoMiles(tokens)} / ${formatoMiles(RESUMEN_LIMITE_TOKENS)}`;
  btn.title = `Memoria del chat: ${tokens.toLocaleString("es")} de ${RESUMEN_LIMITE_TOKENS.toLocaleString("es")} tokens (${pct}%). Pulsa para ver más.`;
  const pop = document.getElementById("contexto-popover");
  pop.dataset.nivel = nivel;
  document.getElementById("contexto-popover-cifra").innerHTML = `<strong>${tokens.toLocaleString("es")}</strong> de ${RESUMEN_LIMITE_TOKENS.toLocaleString("es")} tokens · ${pct}%`;
  document.getElementById("contexto-popover-relleno").style.width = `${pct}%`;
  const quedan = Math.max(0, RESUMEN_LIMITE_TOKENS - tokens);
  document.getElementById("contexto-popover-texto").textContent = pct >= 100 ? "Se llegó al límite: el chat se resumirá al enviar tu próximo mensaje. Puedes hacerlo ya con «Resumir ahora»." : `Quedan unos ${quedan.toLocaleString("es")} tokens (≈${Math.max(1, Math.round(quedan / 350))} respuestas medianas) antes de que la parte antigua se resuma sola.${hayResumen ? " Este chat ya tiene un resumen de lo anterior." : ""} Tus mensajes nunca se borran.`;
  const resumir = document.getElementById("contexto-resumir");
  resumir.hidden = tokens < RESUMEN_RESERVA_TOKENS * 1.5;
}
async function refrescarMedidorContexto(chatId = currentChatId, mensajesConocidos = null) {
  const id = ++medidorPeticion;
  if (!chatId) {
    pintarMedidorContexto(null);
    return null;
  }
  try {
    const mensajes = Array.isArray(mensajesConocidos) ? mensajesConocidos : (await cargarHistorialCompleto(chatId)).mensajes;
    if (id !== medidorPeticion || chatId !== currentChatId) return null;
    const { resumen } = contextoActivoHistorial(mensajes);
    pintarMedidorContexto(tokensContextoChat(mensajes), { hayResumen: !!resumen });
    return mensajes;
  } catch (err) {
    console.warn("⚠️ Medidor de contexto:", err);
    return null;
  }
}
function cerrarPopoverContexto() {
  const pop = document.getElementById("contexto-popover"), btn = document.getElementById("contexto-medidor");
  if (pop) pop.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
}
document.getElementById("contexto-medidor")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const pop = document.getElementById("contexto-popover");
  const abrir = pop.hidden;
  pop.hidden = !abrir;
  e.currentTarget.setAttribute("aria-expanded", String(abrir));
});
document.getElementById("contexto-cerrar")?.addEventListener("click", cerrarPopoverContexto);
document.addEventListener("click", (e) => {
  if (!e.target.closest?.(".contexto-zona")) cerrarPopoverContexto();
});
document.getElementById("contexto-resumir")?.addEventListener("click", async (e) => {
  const chatId = currentChatId;
  if (!chatId) return;
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = "Resumiendo…";
  try {
    const { mensajes } = await cargarHistorialCompleto(chatId);
    const r = await procesarHistorialSiEsNecesario(mensajes, { forzar: true });
    if (r.necesitaActualizacion) {
      await actualizarHistorialChat(chatId, r.historialGuardar || r.historialProcesado);
      showToast("✅ Chat resumido");
      if (chatId === currentChatId) await seleccionarChat(chatId);
    } else showToast("Aún no hay suficiente historia antigua para resumir");
    cerrarPopoverContexto();
  } catch (err) {
    showToast(`❌ ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Resumir ahora";
  }
});
function quitarAvisoResumen() {
  document.getElementById("aviso-resumen")?.remove();
}
async function avisarResumenPendiente(chatId, mensajesConocidos = null) {
  quitarAvisoResumen();
  const mensajes = await refrescarMedidorContexto(chatId, mensajesConocidos);
  if (!mensajes || chatId !== currentChatId || !chatNecesitaResumen(mensajes)) return;
  const main = document.querySelector("#chat-view .chat-main");
  if (!main) return;
  const nombre = escapeHtml(currentCharacter?.nombre || "el personaje");
  const aviso = document.createElement("div");
  aviso.className = "aviso-resumen";
  aviso.id = "aviso-resumen";
  aviso.setAttribute("role", "status");
  aviso.innerHTML = `<div class="aviso-resumen-icono" aria-hidden="true">📚</div><div class="aviso-resumen-texto"><strong>Este chat ya es largo</strong><span>Para que ${nombre} no olvide cosas ni se contradiga, conviene resumir la parte antigua antes de seguir. Tus mensajes no se borran.</span></div><div class="aviso-resumen-acciones"><button type="button" class="btn btn-primary btn-small" data-accion="resumir">Resumir y continuar</button><button type="button" class="btn btn-ghost btn-small" data-accion="luego">Luego</button></div>`;
  const zonaInput = main.querySelector(".chat-input-area");
  if (zonaInput) zonaInput.insertBefore(aviso, zonaInput.querySelector(".chat-input-wrapper"));
  else main.appendChild(aviso);
  aviso.querySelector('[data-accion="luego"]').addEventListener("click", () => {
    quitarAvisoResumen();
    showToast("Se resumirá solo al enviar tu próximo mensaje");
  });
  aviso.querySelector('[data-accion="resumir"]').addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "Resumiendo…";
    try {
      const { mensajes: actuales } = await cargarHistorialCompleto(chatId);
      const r = await procesarHistorialSiEsNecesario(actuales);
      if (r.necesitaActualizacion) await actualizarHistorialChat(chatId, r.historialGuardar || r.historialProcesado);
      quitarAvisoResumen();
      showToast("✅ Chat resumido: ya puedes seguir con el rol");
      if (chatId === currentChatId) await seleccionarChat(chatId);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Resumir y continuar";
      showToast(`❌ ${err.message}`, "error");
    }
  });
}
async function procesarHistorialSiEsNecesario(historial, { forzar = false } = {}) {
  const { resumen: resumenActual, activos, todos } = contextoActivoHistorial(historial);
  const paraGemini = [...resumenActual ? [resumenActual] : [], ...activos];
  if (!forzar && !chatNecesitaResumen(historial)) return { historialProcesado: paraGemini, necesitaActualizacion: false };
  const modal = document.getElementById("summary-modal");
  const content = document.getElementById("summary-content");
  function setSummaryUI(estado, mensaje, mostrarReintentar = false) {
    if (estado === "loading") {
      content.innerHTML = htmlCargaHerramienta({ tema: "resumen", titulo: "Guardando la memoria del chat…", sub: "Tu chat ya es largo: resumo lo más antiguo para que el personaje no lo olvide. Tus mensajes no se borran.", pasos: ["Leyendo los mensajes más antiguos", "Guardando lo importante en la memoria", "Dejando el chat listo para seguir"] });
      iniciarCargaHerramienta(content, 5e3);
    } else if (estado === "error") {
      content.innerHTML = `
        <div class="recap-confirm" style="padding:2rem 1.5rem;">
          <div class="recap-icon-wrapper" style="background:linear-gradient(135deg,rgba(239,68,68,.2),rgba(239,68,68,.1));margin-bottom:1rem;">
            <svg viewBox="0 0 24 24" style="stroke:#fca5a5;width:42px;height:42px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div class="recap-title" style="background:linear-gradient(135deg,#ef4444,#f59e0b);-webkit-background-clip:text;background-clip:text;font-size:1.3rem;">Error al resumir</div>
          <div class="recap-subtitle" style="color:#fca5a5;font-size:.9rem;">${escapeHtml(mensaje)}</div>
          ${mostrarReintentar ? `<button type="button" class="btn btn-primary" id="btn-retry-summary" style="margin-top:1.5rem;width:100%;">🔄 Reintentar</button>` : ""}
        </div>
      `;
    }
  }
  modal.classList.add("visible");
  setSummaryUI("loading");
  const ejecutarResumen = async () => {
    try {
      let tokensAcumulados = 0, indiceCorte = 0;
      for (let i = activos.length - 1; i >= 0; i--) {
        tokensAcumulados += estimarTokens(activos[i].contenido || "");
        if (tokensAcumulados >= RESUMEN_RESERVA_TOKENS) {
          indiceCorte = i;
          break;
        }
      }
      const mensajesRecientes = activos.slice(indiceCorte);
      const mensajesAntiguos = activos.slice(0, indiceCorte);
      const resumenPrevio = resumenActual?.contenido || "";
      if (mensajesAntiguos.length === 0) {
        modal.classList.remove("visible");
        return { historialProcesado: paraGemini, necesitaActualizacion: false };
      }
      const nuevoResumen = await resumirHistorialConGemini({ mensajes: mensajesAntiguos, resumenPrevio });
      const ultimo = mensajesAntiguos[mensajesAntiguos.length - 1];
      const hasta = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(ultimo?.id || "")) ? String(ultimo.id) : null;
      const mensajeResumen = {
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        rol: "summary",
        contenido: nuevoResumen,
        hasta,
        summary_version: (Number(resumenActual?.summary_version) || 0) + 1
      };
      const historialProcesado = [mensajeResumen, ...mensajesRecientes];
      const historialGuardar = hasta ? [mensajeResumen, ...todos] : historialProcesado;
      modal.classList.remove("visible");
      quitarAvisoResumen();
      return { historialProcesado, historialGuardar, necesitaActualizacion: true };
    } catch (err) {
      const errorMsg = esErrorRateLimit(err) ? "Límite de peticiones excedido. Espera unos segundos y reintenta." : err.message;
      setSummaryUI("error", errorMsg, true);
      return new Promise((resolve, reject) => {
        const btn = document.getElementById("btn-retry-summary");
        if (btn) {
          btn.addEventListener("click", async () => {
            setSummaryUI("loading");
            try {
              const resultado = await ejecutarResumen();
              resolve(resultado);
            } catch (e) {
              reject(e);
            }
          }, { once: true });
        } else {
          reject(new Error("No se pudo reintentar"));
        }
      });
    }
  };
  try {
    const resultado = await ejecutarResumen();
    return resultado;
  } catch (err) {
    modal.classList.remove("visible");
    throw new Error("No se pudo completar el resumen: " + err.message);
  }
}
function cargarInfoUsuarioLocal() {
  try {
    const cached = localStorage.getItem("sair_cached_user_info");
    if (cached) {
      const data = JSON.parse(cached);
      if (!currentUser || data.userId !== currentUser.id) return false;
      userRole = data.role || "user";
      userUsername = data.username || null;
      userDescription = data.description || "";
      userAvatarUrl = sanitizeImageUrl(data.avatarUrl || "");
      userBackgroundUrl = sanitizeImageUrl(data.backgroundUrl || "");
      userAvatarPos = { x: Number(data.avatarPosX) || 50, y: Number(data.avatarPosY) || 50 };
      userBackgroundPos = { x: Number(data.backgroundPosX) || 50, y: Number(data.backgroundPosY) || 50 };
      userRoleName = data.roleName || null;
      return true;
    }
  } catch (e) {
    console.warn("⚠️ Error leyendo info de usuario cacheada:", e);
  }
  return false;
}
function guardarInfoUsuarioLocal() {
  try {
    localStorage.setItem("sair_cached_user_info", JSON.stringify({
      userId: currentUser?.id || null,
      role: userRole,
      username: userUsername,
      description: userDescription || "",
      avatarUrl: userAvatarUrl || null,
      backgroundUrl: userBackgroundUrl || null,
      avatarPosX: userAvatarPos.x,
      avatarPosY: userAvatarPos.y,
      backgroundPosX: userBackgroundPos.x,
      backgroundPosY: userBackgroundPos.y,
      roleName: userRoleName
    }));
  } catch (e) {
    console.warn("⚠️ Error guardando info de usuario cacheada:", e);
  }
}
async function cargarPerfilYRol() {
  if (!currentUser) {
    userRole = null;
    userUsername = null;
    return;
  }
  try {
    const [rolResult, perfilResultInicial] = await Promise.all([
      sbClient.from("roles").select("rol").eq("user_id", currentUser.id).single(),
      sbClient.rpc("obtener_mi_perfil")
    ]);
    let perfilResult = perfilResultInicial;
    if (Array.isArray(perfilResult.data)) perfilResult = { ...perfilResult, data: perfilResult.data[0] || null };
    userRole = rolResult.data?.rol || "user";
    userUsername = perfilResult.data?.username || null;
    userDescription = perfilResult.data?.descripcion || "";
    userAvatarUrl = sanitizeImageUrl(perfilResult.data?.avatar_url || "");
    userBackgroundUrl = sanitizeImageUrl(perfilResult.data?.fondo_url || "");
    userAvatarPos = { x: Number(perfilResult.data?.avatar_pos_x) || 50, y: Number(perfilResult.data?.avatar_pos_y) || 50 };
    userBackgroundPos = { x: Number(perfilResult.data?.fondo_pos_x) || 50, y: Number(perfilResult.data?.fondo_pos_y) || 50 };
    console.log("👤 Perfil:", userUsername, "| Rol:", userRole);
    guardarInfoUsuarioLocal();
  } catch (err) {
    console.error("Error cargando perfil:", err);
    userRole = "user";
    userUsername = currentUser.email?.split("@")[0] || "usuario";
  }
  actualizarUIPerfil();
}
async function cargarNombreRol() {
  if (!currentUser) {
    userRoleName = null;
    return;
  }
  try {
    const { data, error } = await sbClient.from("roles_usuario").select("nombre_rol").eq("user_id", currentUser.id).single();
    if (error && error.code === "PGRST116") {
      userRoleName = null;
      return;
    }
    if (error) throw new Error(error.message);
    userRoleName = data?.nombre_rol || null;
    console.log("🎭 Nombre de rol:", userRoleName);
    guardarInfoUsuarioLocal();
  } catch (err) {
    console.error("Error cargando nombre de rol:", err);
    userRoleName = null;
  }
}
async function guardarNombreRol(nombre) {
  if (!currentUser) throw new Error("No hay sesión");
  const regex = /^[a-zA-Z0-9_]{3,30}$/;
  if (!regex.test(nombre)) throw new Error("Nombre de rol inválido. Usa 3-30 caracteres: letras, números o _");
  try {
    const { data, error } = await sbClient.from("roles_usuario").upsert({ user_id: currentUser.id, nombre_rol: nombre }, { onConflict: "user_id" }).select().single();
    if (error) throw new Error(error.message);
    userRoleName = nombre;
    return data;
  } catch (err) {
    console.error("Error guardando nombre de rol:", err);
    throw err;
  }
}
function reemplazarUserEnTexto(texto) {
  if (!userRoleName) return texto;
  return texto.replace(/\{\{user\}\}/gi, userRoleName);
}
async function verificarYMostrarModalRol() {
  if (!userRoleName) {
    if (typeof prepararModalRol === "function") prepararModalRol();
    openModal("role-modal");
    showToast("🎭 Configura tu nombre de rol para continuar", "success");
  }
}
function actualizarUIPerfil() {
  const displayName = userUsername || currentUser?.email?.split("@")[0] || "Usuario", initial = displayName.charAt(0).toUpperCase(), safeAvatar = sanitizeImageUrl(userAvatarUrl), safeBackground = sanitizeImageUrl(userBackgroundUrl);
  const badgeName = document.getElementById("user-badge-name"), badgeAvatar = document.getElementById("user-badge-avatar"), badgeRole = document.getElementById("user-badge-role"), profilePreview = document.getElementById("profile-avatar-preview"), cover = document.getElementById("profile-cover-preview"), profileUsername = document.getElementById("profile-username");
  if (badgeName) badgeName.textContent = displayName;
  if (badgeAvatar) badgeAvatar.innerHTML = safeAvatar ? `<img src="${safeAvatar.replace(/"/g, "&quot;")}" alt="">` : initial;
  if (badgeRole) {
    badgeRole.textContent = userRole;
    badgeRole.className = `role-tag ${userRole}`;
  }
  if (profilePreview) profilePreview.innerHTML = safeAvatar ? `<img src="${safeAvatar.replace(/"/g, "&quot;")}" alt="Foto de perfil">` : initial;
  if (profileUsername) profileUsername.value = userUsername || "";
  if (cover) {
    cover.style.backgroundImage = safeBackground ? `url("${safeBackground.replace(/"/g, "%22")}")` : "";
    cover.style.backgroundPosition = `${userBackgroundPos.x}% ${userBackgroundPos.y}%`;
    const avatarImg = profilePreview?.querySelector("img");
    if (avatarImg) avatarImg.style.objectPosition = `${userAvatarPos.x}% ${userAvatarPos.y}%`;
  }
  actualizarPreviewFondoPerfil(safeBackground);
  document.querySelectorAll("#user-badge-avatar img,#profile-avatar-preview img").forEach((img) => img.addEventListener("error", () => {
    img.remove();
    if (img.parentElement) img.parentElement.textContent = initial;
  }, { once: true }));
}
function playErrorSound() {
  try {
    document.getElementById("error-sound").play().catch(() => {
    });
  } catch (e) {
  }
}
function shakeElement(el) {
  if (!el) return;
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
  setTimeout(() => el.classList.remove("shake"), 500);
}
function isOwner() {
  return userRole === "owner";
}
async function obtenerUsernamesBatch(userIds) {
  if (!userIds || userIds.length === 0) return {};
  const map = {}, idsSinCaché = userIds.filter((id) => !CACHE.usernames[id]);
  if (idsSinCaché.length === 0) {
    userIds.forEach((id) => {
      map[id] = CACHE.usernames[id];
    });
    return map;
  }
  try {
    const { data, error } = await sbClient.rpc("obtener_usernames", { p_user_ids: idsSinCaché });
    if (data && !error) {
      data.forEach((p) => {
        CACHE.usernames[p.user_id] = p.username;
        map[p.user_id] = p.username;
      });
    }
  } catch (err) {
    console.error("Error obteniendo usernames batch:", err);
  }
  userIds.forEach((id) => {
    if (!map[id]) map[id] = CACHE.usernames[id] || id.substring(0, 8) + "...";
  });
  return map;
}
function applyTheme(theme) {
  document.documentElement.classList.add("no-transitions");
  document.body.setAttribute("data-theme", theme);
  localStorage.setItem(CONFIG.LS.THEME, theme);
  document.querySelectorAll(".theme-option").forEach((opt) => {
    opt.classList.toggle("active", opt.dataset.themeValue === theme);
  });
  const x = document.body.offsetHeight;
  requestAnimationFrame(() => {
    document.documentElement.classList.remove("no-transitions");
  });
}
applyTheme(localStorage.getItem(CONFIG.LS.THEME) || "dark");
function aplicarModoVisual(mode) {
  const valid = ["auto", "light", "full"].includes(mode) ? mode : "auto";
  const light = valid === "light" || valid === "auto" && window.matchMedia && window.matchMedia("(max-width: 700px)").matches;
  document.body.classList.toggle("performance-light", light);
  document.documentElement.dataset.displayMode = valid;
  localStorage.setItem(CONFIG.LS.DISPLAY_MODE, valid);
  document.querySelectorAll(".display-mode-option").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.displayMode === valid);
  });
}
aplicarModoVisual(localStorage.getItem(CONFIG.LS.DISPLAY_MODE) || "auto");
document.querySelectorAll(".display-mode-option").forEach((btn) => btn.addEventListener("click", () => {
  aplicarModoVisual(btn.dataset.displayMode);
  showToast(`Modo ${btn.dataset.displayMode === "auto" ? "automático" : btn.dataset.displayMode === "light" ? "ligero" : "completo"} activado`);
}));
if (window.matchMedia) {
  window.matchMedia("(max-width: 700px)").addEventListener?.("change", () => {
    if ((localStorage.getItem(CONFIG.LS.DISPLAY_MODE) || "auto") === "auto") aplicarModoVisual("auto");
  });
}
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el._focoPrevio = document.activeElement;
  el.classList.add("visible");
  const dialogo = el.querySelector(".modal");
  if (dialogo) setTimeout(() => {
    try {
      dialogo.focus({ preventScroll: true });
    } catch {
    }
  }, 40);
}
const SAIR_DIALOGO_ICONOS = {
  pregunta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5"/><path d="M12 17.5h.01"/></svg>',
  peligro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
  enlace: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>'
};
const sairDialogo = { resolver: null, focoPrevio: null };
function cerrarDialogoSAIR(valor) {
  const el = document.getElementById("sair-dialogo");
  if (!el || !sairDialogo.resolver) return;
  const resolver = sairDialogo.resolver;
  sairDialogo.resolver = null;
  el.classList.remove("visible");
  const previo = sairDialogo.focoPrevio;
  sairDialogo.focoPrevio = null;
  if (previo && typeof previo.focus === "function") {
    try {
      previo.focus({ preventScroll: true });
    } catch {
    }
  }
  resolver(valor);
}
function dialogoSAIR({ titulo = "¿Seguro?", texto = "", aceptar = "Aceptar", cancelar = "Cancelar", peligro = false, campo = null } = {}) {
  const el = document.getElementById("sair-dialogo");
  if (!el) return Promise.resolve(campo === null ? window.confirm(texto || titulo) : true);
  if (sairDialogo.resolver) cerrarDialogoSAIR(false);
  const caja = el.querySelector(".sair-dialogo");
  caja.classList.toggle("peligro", !!peligro);
  document.getElementById("sair-dialogo-ico").innerHTML = SAIR_DIALOGO_ICONOS[campo !== null ? "enlace" : peligro ? "peligro" : "pregunta"];
  document.getElementById("sair-dialogo-titulo").textContent = titulo;
  const p = document.getElementById("sair-dialogo-texto");
  p.textContent = texto;
  p.hidden = !texto;
  const input = document.getElementById("sair-dialogo-campo");
  input.hidden = campo === null;
  input.value = campo === null ? "" : String(campo);
  const btnSi = document.getElementById("sair-dialogo-aceptar");
  const btnNo = document.getElementById("sair-dialogo-cancelar");
  btnSi.textContent = aceptar;
  btnSi.className = `btn ${peligro ? "btn-danger" : "btn-primary"}`;
  btnNo.textContent = cancelar;
  sairDialogo.focoPrevio = document.activeElement;
  el.classList.add("visible");
  setTimeout(() => {
    try {
      if (campo !== null) {
        input.focus();
        input.select();
      } else (peligro ? btnNo : btnSi).focus({ preventScroll: true });
    } catch {
    }
  }, 40);
  return new Promise((resolve) => {
    sairDialogo.resolver = resolve;
  });
}
function confirmarSAIR(titulo, texto = "", opciones = {}) {
  return dialogoSAIR({ ...opciones, titulo, texto });
}
async function mostrarEnlaceSAIR(url) {
  const copiar = await dialogoSAIR({ titulo: "Copia este enlace", texto: "No pudimos copiarlo solo. Cópialo desde aquí:", campo: url, aceptar: "Copiar", cancelar: "Cerrar" });
  if (!copiar) return;
  try {
    await navigator.clipboard.writeText(url);
    showToast("🔗 Enlace copiado");
  } catch {
    const input = document.getElementById("sair-dialogo-campo");
    try {
      input.hidden = false;
      input.value = url;
      input.select();
      document.execCommand("copy");
      showToast("🔗 Enlace copiado");
    } catch {
      showToast("Selecciona el enlace y cópialo a mano", "error");
    } finally {
      input.hidden = true;
    }
  }
}
document.getElementById("sair-dialogo-aceptar")?.addEventListener("click", () => cerrarDialogoSAIR(true));
document.getElementById("sair-dialogo-cancelar")?.addEventListener("click", () => cerrarDialogoSAIR(false));
document.getElementById("sair-dialogo")?.addEventListener("click", (e) => {
  if (e.target.id === "sair-dialogo") cerrarDialogoSAIR(false);
});
window.addEventListener("keydown", (e) => {
  if (!sairDialogo.resolver) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    cerrarDialogoSAIR(false);
  } else if (e.key === "Tab") {
    const focos = [document.getElementById("sair-dialogo-campo"), document.getElementById("sair-dialogo-cancelar"), document.getElementById("sair-dialogo-aceptar")].filter((b) => b && !b.hidden);
    const i = focos.indexOf(document.activeElement);
    e.preventDefault();
    e.stopPropagation();
    focos[(i + (e.shiftKey ? -1 : 1) + focos.length) % focos.length].focus();
  }
}, true);
function closeModal(id) {
  if (id === "politicas-modal") {
    const modal = document.getElementById("politicas-modal");
    if (modal && modal._preventClose) return;
  }
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("visible");
  const previo = el._focoPrevio;
  el._focoPrevio = null;
  if (previo && typeof previo.focus === "function") {
    try {
      previo.focus({ preventScroll: true });
    } catch {
    }
  }
}
document.getElementById("settings-btn").addEventListener("click", () => {
  updateApiKeyUI();
  aplicarFondoChat();
  openModal("settings-modal");
});
document.querySelectorAll("[data-close-modal]").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
});
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", function(e) {
    if (this.id === "politicas-modal" && this._preventClose) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.target === this && this.id !== "summary-modal") {
      closeModal(this.id);
    }
  });
});
document.addEventListener("keydown", function(e) {
  if (e.key === "Tab") {
    const abierto = document.querySelector(".modal-overlay.visible .modal");
    if (abierto) {
      const focos = Array.from(abierto.querySelectorAll('button:not([hidden]):not([disabled]),[href],input:not([type="hidden"]):not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null);
      if (focos.length) {
        const primero = focos[0], ultimo = focos[focos.length - 1];
        if (e.shiftKey && (document.activeElement === primero || document.activeElement === abierto)) {
          e.preventDefault();
          ultimo.focus();
        } else if (!e.shiftKey && document.activeElement === ultimo) {
          e.preventDefault();
          primero.focus();
        }
      }
    }
  }
  if (e.key === "Escape") {
    const politicas = document.getElementById("politicas-modal");
    if (politicas.classList.contains("visible") && politicas._preventClose) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    document.querySelectorAll(".modal-overlay.visible").forEach((m) => {
      if (m.id !== "summary-modal" && m.id !== "politicas-modal") {
        closeModal(m.id);
      }
    });
  }
});
document.querySelectorAll(".theme-option").forEach((opt) => {
  opt.addEventListener("click", () => {
    applyTheme(opt.dataset.themeValue);
    showToast(`Tema ${opt.dataset.themeValue === "dark" ? "oscuro" : "claro"} activado`);
  });
});
document.getElementById("toggle-api-key").addEventListener("click", () => {
  const input = document.getElementById("gemini-api-key");
  input.type = input.type === "password" ? "text" : "password";
});
document.getElementById("save-api-key").addEventListener("click", () => {
  const input = document.getElementById("gemini-api-key");
  const raw = (input?.value || "").trim();
  const model = modelSelector?.value || getGeminiModel();
  const summaryModel = summaryModelSelector?.value || getSummaryModel();
  if (raw) {
    if (!isGeminiApiKey(raw)) {
      showToast("API Key inválida. Verifica que pegaste la clave completa.", "error");
      if (input) shakeElement(input);
      return;
    }
    try {
      saveGeminiKey(raw);
    } catch (err) {
      showToast("❌ " + err.message, "error");
      if (input) shakeElement(input);
      return;
    }
  } else if (!getGeminiKey()) {
    showToast("Pega tu API Key de Google AI Studio", "error");
    if (input) input.focus();
    return;
  }
  setGeminiModel(model);
  setSummaryModel(summaryModel);
  updateApiKeyUI();
  actualizarIndicadoresChat();
  showToast(raw ? "✅ API Key y modelos guardados" : "✅ Modelos guardados");
});
document.getElementById("clear-api-key").addEventListener("click", async () => {
  if (getGeminiKey() && await confirmarSAIR("¿Eliminar tu API Key?", "Se borran tu API Key y los modelos elegidos de este dispositivo. Podrás volver a ponerla cuando quieras.", { aceptar: "Eliminar", peligro: true })) {
    GEMINI_KEY_STORAGE.removeItem(CONFIG.LS.GEMINI_KEY);
    try {
      window.sessionStorage.removeItem(CONFIG.LS.GEMINI_KEY);
    } catch {
    }
    ;
    localStorage.removeItem(CONFIG.LS.GEMINI_MODEL);
    localStorage.removeItem(CONFIG.LS.GEMINI_SUMMARY_MODEL);
    updateApiKeyUI();
    showToast("API Key y modelos eliminados");
  }
});
const BG_STORAGE_KEY = "sair1_chat_bg";
function actualizarIndicadoresChat() {
  const sub = document.getElementById("chat-char-sub");
  if (!sub) return;
  const intensidad = obtenerIntensidadPersonaje(currentCharacter), modelo = getGeminiModel(), count = document.getElementById("chat-count-label")?.textContent || "Chats";
  sub.innerHTML = `<span id="chat-count-label">${escapeHtml(count)}</span><span id="chat-intensity-indicator" class="chat-status-badge intensity-${intensidad}">${etiquetaIntensidad(intensidad)}</span><span id="chat-model-indicator" class="chat-status-badge${usaCR() ? " cr" : ""}">${usaCR() ? "⚡" : "🤖"} ${escapeHtml(etiquetaMotorChat())}</span>`;
}
const chatSubObserver = new MutationObserver(() => {
  if (!document.getElementById("chat-intensity-indicator")) actualizarIndicadoresChat();
});
chatSubObserver.observe(document.getElementById("chat-char-sub"), { childList: true });
const modelSelector = document.getElementById("gemini-model");
if (modelSelector) {
  modelSelector.value = getGeminiModel();
  modelSelector.addEventListener("change", () => {
    setGeminiModel(modelSelector.value);
    actualizarIndicadoresChat();
    showToast(`✅ Modelo seleccionado: ${modelSelector.options[modelSelector.selectedIndex].text}`);
  });
}
const summaryModelSelector = document.getElementById("gemini-summary-model");
if (summaryModelSelector) {
  summaryModelSelector.value = getSummaryModel();
  summaryModelSelector.addEventListener("change", () => {
    const safe = setSummaryModel(summaryModelSelector.value);
    showToast(`✅ Modelo de resúmenes: ${etiquetaModelo(safe)}`);
  });
}
function updateApiKeyUI() {
  const key = getGeminiKey(), model = getGeminiModel(), sumModel = getSummaryModel(), statusEl = document.getElementById("api-key-status"), input = document.getElementById("gemini-api-key"), modelInput = document.getElementById("gemini-model"), sumModelInput = document.getElementById("gemini-summary-model");
  if (modelInput) modelInput.value = model;
  if (sumModelInput) sumModelInput.value = sumModel;
  if (key) {
    statusEl.className = "api-key-status saved";
    statusEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><span>API Key configurada (${key.substring(0, 8)}...${key.substring(key.length - 4)}) · Rol: ${etiquetaModelo(model)} · Recap: ${etiquetaModelo(sumModel)}</span>`;
    input.value = key;
  } else {
    statusEl.className = "api-key-status empty";
    statusEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span>No hay API Key configurada</span>`;
    input.value = "";
  }
  const tutorial = document.getElementById("api-tutorial");
  if (tutorial) tutorial.open = !key;
  const mayor = document.getElementById("rol-mayor-18");
  if (mayor) mayor.checked = esMayorDe18();
}
function esMayorDe18() {
  return currentUser?.user_metadata?.mayor_18 === true;
}
document.getElementById("rol-mayor-18")?.addEventListener("change", async (e) => {
  const caja = e.target, valor = caja.checked;
  if (!currentUser || !sbClient) {
    caja.checked = !valor;
    return;
  }
  if (valor && !await confirmarSAIR("¿Tienes 18 años o más?", "Al confirmarlo, en tus chats privados con tu API Key de Gemini se permitirá contenido para adultos entre personajes adultos. Las Normas de la comunidad se siguen aplicando siempre.", { aceptar: "Sí, tengo 18 o más" })) {
    caja.checked = false;
    return;
  }
  caja.disabled = true;
  try {
    const { data, error } = await sbClient.auth.updateUser({ data: { mayor_18: valor } });
    if (error) throw error;
    if (data?.user) currentUser = data.user;
    showToast(valor ? "✅ Confirmaste que tienes 18 años o más" : "Contenido para adultos desactivado");
  } catch {
    caja.checked = !valor;
    showToast("No se pudo guardar. Inténtalo de nuevo.", "error");
  } finally {
    caja.disabled = false;
  }
});
function aplicarFondoChat() {
  const raw = localStorage.getItem(BG_STORAGE_KEY), bg = sanitizeImageUrl(raw), chatMain = document.querySelector(".chat-main"), bgImg = document.getElementById("chat-bg-img"), btnPreview = document.getElementById("btn-bg-preview");
  if (bg && chatMain) {
    chatMain.classList.add("has-background");
    if (bgImg) {
      bgImg.src = bg;
      bgImg.alt = "Fondo del chat";
    }
    if (btnPreview) btnPreview.style.display = "inline-flex";
  } else {
    if (chatMain) chatMain.classList.remove("has-background");
    if (bgImg) {
      bgImg.removeAttribute("src");
      bgImg.alt = "";
    }
    if (btnPreview) btnPreview.style.display = "none";
  }
}
const observer = new MutationObserver(() => {
  if (document.getElementById("chat-view").classList.contains("visible")) aplicarFondoChat();
});
observer.observe(document.getElementById("chat-view"), { attributes: true, attributeFilter: ["class"] });
document.getElementById("btn-bg-none").addEventListener("click", () => {
  localStorage.removeItem(BG_STORAGE_KEY);
  aplicarFondoChat();
  showToast("Fondo eliminado");
});
document.getElementById("btn-bg-upload").addEventListener("click", () => {
  document.getElementById("chat-bg-file").click();
});
document.getElementById("chat-bg-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("❌ Solo se permiten imágenes", "error");
    e.target.value = "";
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast("❌ Imagen muy grande (máx 5MB)", "error");
    e.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onerror = () => {
      showToast("❌ Imagen inválida", "error");
      e.target.value = "";
    };
    img.onload = () => {
      const maxDim = 1280, ratio = Math.min(1, maxDim / Math.max(img.width, img.height)), w = Math.max(1, Math.round(img.width * ratio)), h = Math.max(1, Math.round(img.height * ratio)), canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#0c0c12";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      const bytes = new Blob([dataUrl]).size;
      if (bytes > 2 * 1024 * 1024) {
        showToast("❌ La imagen sigue pesando más de 2MB tras comprimir. Prueba con otra.", "error");
        e.target.value = "";
        return;
      }
      try {
        localStorage.setItem(BG_STORAGE_KEY, dataUrl);
        aplicarFondoChat();
        showToast("✅ Fondo aplicado y comprimido");
      } catch (err) {
        showToast("❌ No se pudo guardar: almacenamiento local lleno. Elimina el fondo actual o usa una imagen más pequeña.", "error");
      }
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = "";
});
document.getElementById("btn-bg-preview")?.addEventListener("click", () => {
  const bg = sanitizeImageUrl(localStorage.getItem(BG_STORAGE_KEY));
  if (bg) {
    const win = window.open("", "_blank", "noopener,noreferrer");
    if (win) {
      win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Vista previa</title></head><body style="margin:0;background:#111;display:flex;justify-content:center;align-items:center;min-height:100vh"><img src="' + bg.replace(/"/g, "&quot;") + '" style="max-width:100%;height:auto" alt="Fondo"></body></html>');
      win.document.close();
    }
  }
});
const bgImgEl = document.getElementById("chat-bg-img");
if (bgImgEl) bgImgEl.addEventListener("error", () => {
  if (localStorage.getItem(BG_STORAGE_KEY)) {
    localStorage.removeItem(BG_STORAGE_KEY);
    aplicarFondoChat();
    showToast("❌ El fondo guardado no se pudo cargar y fue eliminado", "error");
  }
});
let avatarData = { original: null };
let avatarModificado = false;
const avatarContainer = document.getElementById("avatar-preview-container"), avatarPreview = document.getElementById("avatar-preview"), avatarPlaceholder = document.getElementById("avatar-placeholder"), avatarControls = document.getElementById("avatar-controls");
function mostrarAvatarPersonaje(url) {
  const safe = sanitizeImageUrl(url);
  avatarData.original = safe || null;
  if (safe) avatarPreview.src = safe;
  else avatarPreview.removeAttribute("src");
  avatarPreview.style.display = safe ? "block" : "none";
  avatarPlaceholder.style.display = safe ? "none" : "block";
  avatarContainer.classList.toggle("has-image", !!safe);
  avatarControls.classList.toggle("visible", !!safe);
  actualizarVistaPersonaje();
}
async function elegirAvatarPersonaje() {
  const ruta = await elegirDeBiblioteca("personaje", avatarData.original);
  if (!ruta) return;
  avatarModificado = true;
  mostrarAvatarPersonaje(ruta);
}
avatarContainer.addEventListener("click", elegirAvatarPersonaje);
avatarContainer.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  elegirAvatarPersonaje();
});
document.getElementById("avatar-change").addEventListener("click", elegirAvatarPersonaje);
document.getElementById("avatar-remove").addEventListener("click", () => {
  avatarModificado = true;
  mostrarAvatarPersonaje(null);
});
function procesarAvatar() {
  if (!avatarModificado) return Promise.resolve(void 0);
  return Promise.resolve(esImagenBiblioteca(avatarData.original) ? avatarData.original : null);
}
function setAvatarForEdit(avatarUrl) {
  mostrarAvatarPersonaje(avatarUrl);
  avatarModificado = false;
}
function actualizarAvatarEnUI(personaje) {
  if (!personaje) return;
  const safeAvatar = sanitizeImageUrl(personaje.avatar_url);
  if (currentCharacter && currentCharacter.id === personaje.id) {
    currentCharacter = { ...currentCharacter, ...personaje };
    const avatarEl = document.getElementById("chat-char-avatar");
    if (avatarEl) {
      if (safeAvatar) avatarEl.innerHTML = `<img src="${safeAvatar.replace(/"/g, "&quot;")}" alt="">`;
      else avatarEl.textContent = personaje.nombre.charAt(0).toUpperCase();
    }
    const mAv = document.getElementById("chat-mobile-avatar");
    if (mAv && avatarEl) mAv.innerHTML = avatarEl.innerHTML;
  }
}
function construirSystemPrompt({ nombre, personalidad, escenario, ejemplos, themeColor, intensidad }) {
  const LIMITS = { nombre: 60, personalidad: 3e3, escenario: 2e3, ejemplos: 4e3 };
  if (nombre && nombre.length > LIMITS.nombre) throw new Error(`Nombre demasiado largo (máx. ${LIMITS.nombre})`);
  if (personalidad && personalidad.length > LIMITS.personalidad) throw new Error(`Personalidad demasiado larga (máx. ${LIMITS.personalidad})`);
  if (escenario && escenario.length > LIMITS.escenario) throw new Error(`Escenario demasiado largo (máx. ${LIMITS.escenario})`);
  if (ejemplos && ejemplos.length > LIMITS.ejemplos) throw new Error(`Ejemplos demasiado largos (máx. ${LIMITS.ejemplos})`);
  const partes = [];
  partes.push(`[Sistema de Roleplay]`);
  partes.push(`Interpretarás al personaje "${nombre}" de forma inmersiva y consistente.`);
  partes.push(``);
  partes.push(`REGLAS ESTRICTAS DE FORMATO:`);
  partes.push(`- Usa *asteriscos* para acciones, pensamientos, expresiones y entorno.`);
  partes.push(`- Escribe el diálogo normal sin comillas.`);
  partes.push(`- NUNCA rompas el personaje. NUNCA hables como IA.`);
  partes.push(`- Responde siempre en primera persona como ${nombre}.`);
  partes.push(`- Sé descriptivo con las acciones.`);
  partes.push(``);
  if (personalidad?.trim()) {
    partes.push(`[Personalidad de ${nombre}]`);
    partes.push(personalidad.trim());
    partes.push(``);
  }
  if (escenario?.trim()) {
    partes.push(`[Escenario]`);
    partes.push(escenario.trim());
    partes.push(``);
  }
  if (ejemplos?.trim()) {
    partes.push(`[Ejemplos de diálogo - imita este estilo]`);
    partes.push(ejemplos.trim());
    partes.push(``);
  }
  if (themeColor) {
    partes.push(`[ConfiguracionTema]`);
    partes.push(sanitizeThemeColor(themeColor));
    partes.push(``);
  }
  if (intensidad) {
    partes.push(`[ConfiguracionIntensidad]`);
    partes.push(intensidad);
    partes.push(``);
  }
  partes.push(`[Final] Mantén siempre el rol de ${nombre}.`);
  return partes.join("\n");
}
(function protegerConsolaSAIR() {
  const host = location.hostname;
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host) || host.endsWith(".localhost")) return;
  try {
    console.log("%c¡Alto!", "color:#ff4d8f;font-size:44px;font-weight:800;");
    console.log("%cEsta consola es solo para desarrolladores. Si alguien te pidió pegar algo aquí para «desbloquear» funciones o «ganar créditos», es una estafa: podría robarte la cuenta.", "font-size:15px;line-height:1.5;");
  } catch {
  }
  const TECLAS = ["KeyI", "KeyJ", "KeyC"];
  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const bloquear = e.key === "F12" || mod && (e.shiftKey || e.altKey) && TECLAS.includes(e.code) || mod && !e.shiftKey && !e.altKey && e.code === "KeyU";
    if (!bloquear) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
})();
