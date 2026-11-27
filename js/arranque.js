const ARRANQUE_TIMEOUT_MS = 8e3;
function conTimeout(promesa, ms, etiqueta) {
  let timer;
  const limite = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tiempo agotado: ${etiqueta}`)), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(timer));
}
function hayPantallaVisible() {
  return ["auth-screen", "dashboard", "chat-view"].some((id) => document.getElementById(id)?.classList.contains("visible"));
}
function mostrarPantallaDeRespaldo() {
  if (hayPantallaVisible()) return;
  if (currentUser && cargarInfoUsuarioLocal()) {
    actualizarUIPerfil();
    showDashboard();
  } else showAuth();
}
async function initApp() {
  setTimeout(() => {
    if (!hayPantallaVisible()) {
      console.warn("⚠️ Arranque lento: mostrando pantalla de respaldo");
      mostrarPantallaDeRespaldo();
    }
  }, ARRANQUE_TIMEOUT_MS + 2e3);
  try {
    if (!sbClient) {
      if (!window.supabase?.createClient) {
        console.error("❌ Supabase no cargó");
        showAuth();
        return;
      }
      sbClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage }
      });
      console.log("✅ Supabase client creado en initApp (fallback)");
    }
    sbClient.auth.onAuthStateChange((event, session2) => {
      if (event === "PASSWORD_RECOVERY") {
        SAIR_RECUPERACION.activa = true;
        if (session2) currentUser = session2.user;
        if (dashboard.classList.contains("visible")) revisarRecuperacionClave();
      }
      if (event === "SIGNED_OUT") {
        currentUser = null;
        userRole = null;
        userUsername = null;
        userDescription = "";
        userAvatarUrl = null;
        userBackgroundUrl = null;
        userAvatarPos = { x: 50, y: 50 };
        userBackgroundPos = { x: 50, y: 50 };
        userRoleName = null;
        limpiarCacheUsuario();
        try {
          localStorage.removeItem("sair_cached_user_info");
        } catch (e) {
        }
        showAuth();
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        if (session2) {
          currentUser = session2.user;
          if (document.getElementById("auth-screen").classList.contains("visible")) {
            cargarPerfilYRol().then(() => cargarNombreRol()).then(() => showDashboard());
          }
        }
      }
    });
    let session = null;
    try {
      const { data, error: sessionError } = await conTimeout(sbClient.auth.getSession(), ARRANQUE_TIMEOUT_MS, "getSession");
      if (sessionError) {
        console.warn("⚠️ Error obteniendo sesión:", sessionError.message);
      }
      session = data?.session || null;
    } catch (err) {
      console.warn("⚠️ No se pudo comprobar la sesión a tiempo:", err.message);
    }
    if (session) {
      currentUser = session.user;
      const tieneCache = cargarInfoUsuarioLocal();
      if (tieneCache) {
        actualizarUIPerfil();
        showDashboard();
      }
      conTimeout(Promise.all([cargarPerfilYRol(), cargarNombreRol()]), ARRANQUE_TIMEOUT_MS, "perfil").catch((err) => console.warn("⚠️ Perfil no cargado a tiempo:", err.message)).finally(() => {
        if (!tieneCache) {
          actualizarUIPerfil();
          showDashboard();
        }
      });
    } else {
      console.log("👤 No session");
      showAuth();
    }
    iniciarNotificaciones();
  } catch (err) {
    console.error("❌", err);
    mostrarPantallaDeRespaldo();
  }
}
const settingsBtn = document.getElementById("settings-btn");
function showAuth() {
  document.querySelectorAll(".modal-overlay.visible").forEach((m) => m.classList.remove("visible"));
  const politicasEl = document.getElementById("politicas-modal");
  if (politicasEl) {
    politicasEl.classList.remove("visible");
    politicasEl._preventClose = false;
  }
  document.querySelectorAll(".modal-overlay").forEach((m) => {
    if (m.id !== "politicas-modal") {
      m.style.pointerEvents = "";
      m.style.opacity = "";
    }
  });
  authScreen.classList.add("visible");
  authScreen.classList.add("guest-welcome");
  dashboard.classList.remove("visible");
  document.getElementById("chat-view").classList.remove("visible");
  settingsBtn.classList.add("hidden");
  currentCharacter = null;
  currentChatId = null;
  const loginBtn = document.querySelector('#login-form button[type="submit"]');
  if (loginBtn) {
    loginBtn.disabled = false;
    loginBtn.textContent = "Iniciar Sesión";
  }
  void authScreen.offsetWidth;
  forzarRepintado();
  avisarEnlaceRecuperacionInvalido();
}
function showDashboard() {
  authScreen.classList.remove("visible", "guest-welcome");
  dashboard.classList.add("visible");
  settingsBtn.classList.remove("hidden");
  limpiarCacheUsuario();
  verificarPoliticas();
  renderCharacters();
  forzarRepintado();
  abrirPersonajeCompartidoPendiente();
  iniciarCreditosRol();
  revisarRecuperacionClave();
}
const OJO_CLAVE = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const OJO_CLAVE_TACHADO = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.6 3.4"/><path d="M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m2 2 20 20"/></svg>';
function ocultarClave(input) {
  const b = input.parentNode?.querySelector(".clave-ver");
  input.type = "password";
  if (b) {
    b.innerHTML = OJO_CLAVE;
    b.setAttribute("aria-label", "Mostrar contraseña");
    b.setAttribute("aria-pressed", "false");
  }
}
function prepararVerClave() {
  document.querySelectorAll('#auth-screen input[type="password"], #nueva-clave-modal input[type="password"]').forEach((input) => {
    if (input.dataset.verClave) return;
    input.dataset.verClave = "1";
    const caja = document.createElement("div");
    caja.className = "clave-caja";
    input.parentNode.insertBefore(caja, input);
    caja.appendChild(input);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "clave-ver";
    caja.appendChild(b);
    ocultarClave(input);
    b.addEventListener("click", () => {
      if (input.type !== "password") return ocultarClave(input);
      input.type = "text";
      b.innerHTML = OJO_CLAVE_TACHADO;
      b.setAttribute("aria-label", "Ocultar contraseña");
      b.setAttribute("aria-pressed", "true");
    });
  });
}
prepararVerClave();
const TEXTOS_AUTH = {
  recover: { titulo: "Recupera tu cuenta", sub: "Te ayudamos a crear una contraseña nueva" },
  otro: { titulo: "Bienvenido a SAIR", sub: "Inicia sesión o crea una cuenta para continuar" }
};
function mostrarFormularioAuth(cual) {
  const textos = TEXTOS_AUTH[cual] || TEXTOS_AUTH.otro;
  const titulo = document.querySelector("#auth-screen .auth-title"), sub = document.querySelector("#auth-screen .auth-subtitle");
  if (titulo) titulo.textContent = textos.titulo;
  if (sub) sub.textContent = textos.sub;
  document.querySelector("#auth-screen .auth-tabs")?.classList.toggle("oculto", cual === "recover");
  document.querySelectorAll('#auth-screen input[data-ver-clave]').forEach(ocultarClave);
  document.querySelectorAll(".auth-form").forEach((f) => f.classList.toggle("active", f.id === `${cual}-form`));
  document.querySelectorAll(".auth-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === cual));
  document.querySelectorAll(".form-message").forEach((m) => {
    m.className = "form-message";
    m.textContent = "";
  });
}
function avisarEnlaceRecuperacionInvalido() {
  if (!SAIR_RECUPERACION.error || SAIR_RECUPERACION.mostrada) return;
  SAIR_RECUPERACION.mostrada = true;
  try {
    history.replaceState(null, "", location.pathname);
  } catch (e) {
  }
  showToast("⚠️ El enlace del correo expiró o ya se usó. Si querías cambiar tu contraseña, pide otro desde «¿Olvidaste tu contraseña?».", "error");
}
function revisarRecuperacionClave() {
  avisarEnlaceRecuperacionInvalido();
  if (!SAIR_RECUPERACION.activa || SAIR_RECUPERACION.mostrada || !currentUser) return;
  SAIR_RECUPERACION.mostrada = true;
  document.getElementById("nueva-clave-form").reset();
  document.querySelectorAll('#nueva-clave-modal input[data-ver-clave]').forEach(ocultarClave);
  document.getElementById("nueva-clave-message").className = "form-message";
  document.getElementById("nueva-clave-message").textContent = "";
  openModal("nueva-clave-modal");
  setTimeout(() => document.getElementById("nueva-clave")?.focus(), 300);
}
function unirListaES(partes) {
  if (partes.length <= 1) return partes.join("");
  return partes.slice(0, -1).join(", ") + " y " + partes[partes.length - 1];
}
function requisitosClaveFaltantes(err) {
  const m = String(err?.message || "");
  const razones = Array.isArray(err?.reasons) ? err.reasons : [];
  const partes = [];
  const largo = m.match(/at least (\d+) characters?/i);
  if (largo) partes.push(`al menos ${largo[1]} caracteres`);
  else if (razones.includes("length")) partes.push("más caracteres");
  const lista = (m.split(/of each:/i)[1] || "").trim();
  if (lista) {
    if (/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ/.test(lista)) partes.push("una letra");
    else {
      if (/abcdefghijklmnopqrstuvwxyz/.test(lista)) partes.push("una minúscula");
      if (/ABCDEFGHIJKLMNOPQRSTUVWXYZ/.test(lista)) partes.push("una mayúscula");
    }
    if (/0123456789/.test(lista)) partes.push("un número");
    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|<>?~`]/.test(lista)) partes.push("un símbolo");
  } else if (razones.includes("characters")) partes.push("letras y números");
  return partes;
}
function traducirErrorClave(err) {
  const m = String(err?.message || err || "");
  const razones = Array.isArray(err?.reasons) ? err.reasons : [];
  if (/different from the old/i.test(m)) return "La contraseña nueva debe ser distinta de la anterior.";
  if (razones.includes("pwned") || /pwned|easy to guess|known to be weak/i.test(m)) return "Esa contraseña es muy común y aparece en filtraciones. Elige otra.";
  if (err?.code === "weak_password" || /password should|weak password|too short/i.test(m)) {
    const faltan = requisitosClaveFaltantes(err);
    return faltan.length ? `Tu contraseña necesita ${unirListaES(faltan)}.` : "La contraseña es muy débil. Prueba con una más larga, con letras y números.";
  }
  if (/already registered|already been registered|already exists/i.test(m)) return "Ya existe una cuenta con ese correo. Inicia sesión o recupera tu contraseña.";
  if (/email not confirmed/i.test(m)) return "Primero confirma tu correo: abre el enlace que te enviamos (revisa también spam).";
  if (/invalid login|invalid credentials/i.test(m)) return "Correo o contraseña incorrectos.";
  if (/valid email|invalid email|unable to validate email/i.test(m)) return "Ese correo no parece válido.";
  if (/security purposes|rate limit|too many/i.test(m)) return "Hiciste muchos intentos seguidos. Espera un momento y vuelve a intentarlo.";
  if (/signups? not allowed|signup is disabled/i.test(m)) return "El registro de cuentas nuevas está cerrado por ahora.";
  if (/session|jwt|expired/i.test(m)) return "Tu enlace expiró. Pide uno nuevo desde «¿Olvidaste tu contraseña?».";
  return "No se pudo completar. Revisa tu conexión e intenta de nuevo.";
}
document.getElementById("btn-olvide-clave")?.addEventListener("click", () => {
  const email = document.getElementById("login-email").value.trim();
  mostrarFormularioAuth("recover");
  if (email) document.getElementById("recover-email").value = email;
  requestAnimationFrame(() => document.getElementById("recover-email")?.focus());
});
document.getElementById("btn-volver-login")?.addEventListener("click", () => mostrarFormularioAuth("login"));
document.getElementById("recover-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("recover-email").value.trim();
  const msgEl = document.getElementById("recover-message");
  const btn = e.target.querySelector('button[type="submit"]');
  if (!email || !sbClient) return;
  btn.disabled = true;
  btn.textContent = "Enviando…";
  msgEl.className = "form-message";
  msgEl.textContent = "";
  try {
    const { error } = await sbClient.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}` });
    if (error) throw error;
    msgEl.className = "form-message success";
    msgEl.textContent = "Listo. Si hay una cuenta con ese correo, te llegará un enlace en unos minutos. Revisa también la carpeta de spam.";
    btn.textContent = "Enviar de nuevo";
    setTimeout(() => {
      btn.disabled = false;
    }, 30e3);
  } catch (err) {
    console.warn("Recuperar contraseña:", err);
    playErrorSound();
    msgEl.className = "form-message error";
    msgEl.textContent = traducirErrorClave(err);
    btn.disabled = false;
    btn.textContent = "Enviar enlace";
  }
});
document.getElementById("nueva-clave-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const clave = document.getElementById("nueva-clave").value;
  const confirmar = document.getElementById("nueva-clave-confirmar").value;
  const msgEl = document.getElementById("nueva-clave-message");
  const btn = document.getElementById("nueva-clave-guardar");
  msgEl.className = "form-message";
  msgEl.textContent = "";
  if (clave !== confirmar) {
    playErrorSound();
    shakeElement(document.getElementById("nueva-clave-confirmar"));
    msgEl.className = "form-message error";
    msgEl.textContent = "Las contraseñas no coinciden";
    return;
  }
  btn.disabled = true;
  btn.textContent = "Guardando…";
  try {
    const { error } = await sbClient.auth.updateUser({ password: clave });
    if (error) throw error;
    SAIR_RECUPERACION.activa = false;
    closeModal("nueva-clave-modal");
    showToast("✅ Contraseña actualizada", "success");
  } catch (err) {
    console.warn("Nueva contraseña:", err);
    playErrorSound();
    msgEl.className = "form-message error";
    msgEl.textContent = traducirErrorClave(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar contraseña";
  }
});
document.getElementById("auth-start-btn")?.addEventListener("click", () => {
  authScreen.classList.remove("guest-welcome");
  requestAnimationFrame(() => document.getElementById("login-email")?.focus());
});
document.querySelectorAll(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (typeof mostrarFormularioAuth === "function") return mostrarFormularioAuth(tab.dataset.tab);
    document.querySelectorAll(".auth-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".auth-form").forEach((f) => f.classList.remove("active"));
    document.getElementById(`${tab.dataset.tab}-form`).classList.add("active");
    document.querySelectorAll(".form-message").forEach((m) => {
      m.className = "form-message";
      m.textContent = "";
    });
  });
});
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value, password = document.getElementById("login-password").value, msgEl = document.getElementById("login-message"), btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "Iniciando...";
  msgEl.className = "form-message";
  try {
    const { data, error } = await sbClient.auth.signInWithPassword({ email, password });
    if (error) {
      playErrorSound();
      shakeElement(document.getElementById("login-email"));
      shakeElement(document.getElementById("login-password"));
      msgEl.className = "form-message error";
      msgEl.textContent = traducirErrorClave(error);
      btn.disabled = false;
      btn.textContent = "Iniciar Sesión";
    } else {
      currentUser = data.user;
      const perfilPromise = cargarPerfilYRol();
      const rolePromise = cargarNombreRol();
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout cargando perfil")), 3e3));
      try {
        await Promise.race([Promise.all([perfilPromise, rolePromise]), timeoutPromise]);
      } catch (perfilErr) {
        console.warn("⚠️ Error cargando perfil:", perfilErr);
        userRole = "user";
        userUsername = email.split("@")[0];
      }
      msgEl.className = "form-message success";
      msgEl.textContent = `¡Bienvenido, ${userUsername || "usuario"}!`;
      document.querySelectorAll(".modal-overlay.visible").forEach((m) => m.classList.remove("visible"));
      document.getElementById("chat-view").classList.remove("visible");
      limpiarCacheUsuario();
      setTimeout(showDashboard, 800);
    }
  } catch (err) {
    console.error("Error login:", err);
    playErrorSound();
    shakeElement(document.getElementById("login-email"));
    shakeElement(document.getElementById("login-password"));
    msgEl.className = "form-message error";
    msgEl.textContent = "Error de conexión. Intenta de nuevo.";
    btn.disabled = false;
    btn.textContent = "Iniciar Sesión";
  }
});
document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("register-email").value, password = document.getElementById("register-password").value, confirm = document.getElementById("register-confirm").value, msgEl = document.getElementById("register-message"), btn = e.target.querySelector("button[type=submit]");
  if (password !== confirm) {
    playErrorSound();
    shakeElement(document.getElementById("register-password"));
    shakeElement(document.getElementById("register-confirm"));
    msgEl.className = "form-message error";
    msgEl.textContent = "Las contraseñas no coinciden";
    return;
  }
  const edad13 = document.getElementById("register-edad13"), edad18 = document.getElementById("register-edad18");
  if (!edad13?.checked) {
    playErrorSound();
    if (edad13) shakeElement(edad13.closest("label") || edad13);
    msgEl.className = "form-message error";
    msgEl.textContent = "Necesitas tener al menos 13 años para usar SAIR";
    return;
  }
  btn.disabled = true;
  btn.textContent = "Creando...";
  msgEl.className = "form-message";
  try {
    const { error } = await sbClient.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}${location.pathname}`, data: { mayor_13: true, mayor_18: !!edad18?.checked } } });
    if (error) {
      playErrorSound();
      shakeElement(document.getElementById("register-email"));
      shakeElement(document.getElementById("register-password"));
      msgEl.className = "form-message error";
      msgEl.textContent = traducirErrorClave(error);
      btn.disabled = false;
      btn.textContent = "Crear Cuenta";
    } else {
      msgEl.className = "form-message success";
      msgEl.textContent = "¡Cuenta creada! Revisa tu correo si es necesario.";
      btn.disabled = false;
      btn.textContent = "Crear Cuenta";
      setTimeout(() => document.querySelector('[data-tab="login"]').click(), 2e3);
    }
  } catch (err) {
    playErrorSound();
    shakeElement(document.getElementById("register-email"));
    shakeElement(document.getElementById("register-password"));
    msgEl.className = "form-message error";
    msgEl.textContent = "Error de conexión";
    btn.disabled = false;
    btn.textContent = "Crear Cuenta";
  }
});
document.getElementById("logout-btn").addEventListener("click", () => {
  document.getElementById("settings-modal").classList.remove("visible");
  document.getElementById("logout-modal").classList.add("visible");
});
document.getElementById("cancel-logout").addEventListener("click", () => {
  document.getElementById("logout-modal").classList.remove("visible");
});
document.getElementById("confirm-logout").addEventListener("click", async () => {
  const btn = document.getElementById("confirm-logout");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Cerrando...";
  try {
    await sbClient.auth.signOut();
    currentUser = null;
    userRole = null;
    userUsername = null;
    userAvatarUrl = null;
    userRoleName = null;
    limpiarCacheUsuario();
    document.querySelectorAll(".modal-overlay.visible").forEach((m) => m.classList.remove("visible"));
    document.getElementById("chat-view").classList.remove("visible");
    document.getElementById("dashboard").classList.remove("visible");
    document.getElementById("auth-screen").classList.remove("visible");
    settingsBtn.classList.add("hidden");
    await new Promise((r) => setTimeout(r, 100));
    showAuth();
    showToast("👋 Sesión cerrada correctamente", "success");
    document.querySelectorAll(".auth-form").forEach((f) => f.classList.remove("active"));
    document.querySelector('[data-tab="login"]').classList.add("active");
    document.getElementById("login-form").classList.add("active");
    document.querySelectorAll(".form-message").forEach((m) => {
      m.className = "form-message";
      m.textContent = "";
    });
    document.getElementById("login-email").value = "";
    document.getElementById("login-password").value = "";
  } catch (err) {
    showToast("❌ Error al cerrar sesión", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});
document.getElementById("logout-modal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("logout-modal")) document.getElementById("logout-modal").classList.remove("visible");
});
let perfilAvatarPendiente = null, perfilFondoPendiente = null, perfilAvatarPosPendiente = { x: 50, y: 50 }, perfilFondoPosPendiente = { x: 50, y: 50 };
function actualizarPreviewAvatarPerfil(url) {
  const preview = document.getElementById("profile-avatar-preview"), displayName = userUsername || currentUser?.email?.split("@")[0] || "Usuario";
  if (!preview) return;
  const safe = sanitizeImageUrl(url);
  preview.innerHTML = safe ? `<img src="${safe.replace(/"/g, "&quot;")}" alt="Foto de perfil">` : displayName.charAt(0).toUpperCase();
}
function actualizarPreviewFondoPerfil(url, pos = perfilFondoPosPendiente) {
  const preview = document.getElementById("profile-cover-preview");
  if (!preview) return;
  const safe = sanitizeImageUrl(url);
  preview.style.backgroundImage = safe ? `url("${safe.replace(/"/g, "%22")}")` : "";
  preview.style.backgroundPosition = `${pos.x}% ${pos.y}%`;
}
function actualizarPosicionesPerfil() {
  const avatar = document.getElementById("profile-avatar-preview"), cover = document.getElementById("profile-cover-preview");
  const avatarImg = avatar?.querySelector("img");
  if (avatarImg) avatarImg.style.objectPosition = `${perfilAvatarPosPendiente.x}% ${perfilAvatarPosPendiente.y}%`;
  if (cover) cover.style.backgroundPosition = `${perfilFondoPosPendiente.x}% ${perfilFondoPosPendiente.y}%`;
}
document.getElementById("user-badge").addEventListener("click", () => {
  actualizarUIPerfil();
  perfilAvatarPendiente = userAvatarUrl;
  perfilFondoPendiente = userBackgroundUrl;
  perfilAvatarPosPendiente = { ...userAvatarPos };
  perfilFondoPosPendiente = { ...userBackgroundPos };
  terminarAjustePerfil();
  actualizarContadorDescripcionPerfil();
  actualizarPreviewFondoPerfil(perfilFondoPendiente);
  actualizarPosicionesPerfil();
  openModal("profile-modal");
});
document.getElementById("user-badge").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    document.getElementById("user-badge").click();
  }
});
document.getElementById("profile-avatar-change").addEventListener("click", async () => {
  const ruta = await elegirDeBiblioteca("avatar", perfilAvatarPendiente);
  if (!ruta) return;
  terminarAjustePerfil();
  perfilAvatarPendiente = ruta;
  perfilAvatarPosPendiente = { x: 50, y: 50 };
  actualizarPreviewAvatarPerfil(perfilAvatarPendiente);
  actualizarPosicionesPerfil();
});
document.getElementById("profile-avatar-remove").addEventListener("click", () => {
  perfilAvatarPendiente = null;
  terminarAjustePerfil();
  actualizarPreviewAvatarPerfil(null);
});
document.getElementById("profile-background-change").addEventListener("click", async () => {
  const ruta = await elegirDeBiblioteca("fondo", perfilFondoPendiente);
  if (!ruta) return;
  terminarAjustePerfil();
  perfilFondoPendiente = ruta;
  perfilFondoPosPendiente = { x: 50, y: 50 };
  actualizarPreviewFondoPerfil(perfilFondoPendiente);
  actualizarPosicionesPerfil();
});
document.getElementById("profile-background-remove").addEventListener("click", () => {
  perfilFondoPendiente = null;
  terminarAjustePerfil();
  actualizarPreviewFondoPerfil(null);
});
let perfilAjuste = null, perfilArrastre = null;
const perfilCoverEl = document.getElementById("profile-cover-preview"), perfilAvatarEl = document.getElementById("profile-avatar-preview");
function medidasImagen(url) {
  return new Promise((resolve) => {
    const safe = sanitizeImageUrl(url);
    if (!safe) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = safe;
  });
}
function sobranteCover(caja, nat) {
  if (!nat || !nat.w || !nat.h) return { x: 0, y: 0 };
  const esc = Math.max(caja.width / nat.w, caja.height / nat.h);
  return { x: Math.max(0, nat.w * esc - caja.width), y: Math.max(0, nat.h * esc - caja.height) };
}
async function iniciarAjustePerfil(tipo) {
  const url = tipo === "avatar" ? perfilAvatarPendiente : perfilFondoPendiente;
  if (!sanitizeImageUrl(url)) {
    showToast(tipo === "avatar" ? "Primero elige una foto de perfil" : "Primero elige un fondo", "error");
    return;
  }
  const el = tipo === "avatar" ? perfilAvatarEl : perfilCoverEl;
  const nat = await medidasImagen(url), sob = sobranteCover(el.getBoundingClientRect(), nat);
  if (sob.x < 2 && sob.y < 2) {
    terminarAjustePerfil();
    showToast(tipo === "avatar" ? "Esta foto ya cabe entera en el círculo: no hay nada que encuadrar" : "Este fondo ya se ve completo: no hay nada que encuadrar");
    return;
  }
  perfilAjuste = { tipo, nat };
  perfilCoverEl.classList.toggle("ajustando-fondo", tipo === "fondo");
  perfilCoverEl.classList.toggle("ajustando-avatar", tipo === "avatar");
  document.querySelectorAll(".profile-adjust-btn").forEach((b) => {
    const activo = b.id === (tipo === "avatar" ? "profile-avatar-adjust" : "profile-background-adjust");
    b.classList.toggle("activo", activo);
    b.setAttribute("aria-pressed", String(activo));
  });
  const aviso = document.getElementById("profile-ajuste-aviso");
  aviso.hidden = false;
  document.getElementById("profile-ajuste-texto").textContent = tipo === "avatar" ? "✋ Arrastra la foto dentro del círculo" : "✋ Arrastra el fondo para encuadrarlo";
}
function terminarAjustePerfil() {
  perfilAjuste = null;
  perfilArrastre = null;
  perfilCoverEl?.classList.remove("ajustando-fondo", "ajustando-avatar", "arrastrando");
  document.querySelectorAll(".profile-adjust-btn").forEach((b) => {
    b.classList.remove("activo");
    b.setAttribute("aria-pressed", "false");
  });
  const aviso = document.getElementById("profile-ajuste-aviso");
  if (aviso) aviso.hidden = true;
}
document.getElementById("profile-avatar-adjust").addEventListener("click", () => perfilAjuste?.tipo === "avatar" ? terminarAjustePerfil() : iniciarAjustePerfil("avatar"));
document.getElementById("profile-background-adjust").addEventListener("click", () => perfilAjuste?.tipo === "fondo" ? terminarAjustePerfil() : iniciarAjustePerfil("fondo"));
document.getElementById("profile-ajuste-listo").addEventListener("click", terminarAjustePerfil);
perfilCoverEl.addEventListener("pointerdown", (e) => {
  if (!perfilAjuste) return;
  const el = perfilAjuste.tipo === "avatar" ? perfilAvatarEl : perfilCoverEl;
  if (perfilAjuste.tipo === "avatar" && !perfilAvatarEl.contains(e.target)) return;
  if (perfilAjuste.tipo === "fondo" && perfilAvatarEl.contains(e.target)) return;
  e.preventDefault();
  perfilCoverEl.setPointerCapture?.(e.pointerId);
  const pos = perfilAjuste.tipo === "avatar" ? perfilAvatarPosPendiente : perfilFondoPosPendiente;
  perfilArrastre = { id: e.pointerId, x: e.clientX, y: e.clientY, px: pos.x, py: pos.y, sob: sobranteCover(el.getBoundingClientRect(), perfilAjuste.nat) };
  perfilCoverEl.classList.add("arrastrando");
});
perfilCoverEl.addEventListener("pointermove", (e) => {
  if (!perfilArrastre || e.pointerId !== perfilArrastre.id || !perfilAjuste) return;
  const d = perfilArrastre, lim = (v) => Math.max(0, Math.min(100, Math.round(v * 10) / 10));
  const nx = d.sob.x > 0 ? lim(d.px - (e.clientX - d.x) / d.sob.x * 100) : d.px, ny = d.sob.y > 0 ? lim(d.py - (e.clientY - d.y) / d.sob.y * 100) : d.py;
  if (perfilAjuste.tipo === "avatar") perfilAvatarPosPendiente = { x: nx, y: ny };
  else perfilFondoPosPendiente = { x: nx, y: ny };
  actualizarPosicionesPerfil();
});
function soltarArrastrePerfil(e) {
  if (perfilArrastre && e.pointerId === perfilArrastre.id) {
    perfilArrastre = null;
    perfilCoverEl.classList.remove("arrastrando");
  }
}
["pointerup", "pointercancel", "lostpointercapture"].forEach((ev) => perfilCoverEl.addEventListener(ev, soltarArrastrePerfil));
function actualizarContadorDescripcionPerfil() {
  const el = document.getElementById("profile-description"), c = document.getElementById("profile-description-count");
  if (el && c) c.textContent = `${el.value.length} / ${el.maxLength}`;
}
document.getElementById("profile-description")?.addEventListener("input", actualizarContadorDescripcionPerfil);
function posEntera(v) {
  return Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
}
const formProfile = document.getElementById("form-profile");
formProfile.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("profile-username"), description = document.getElementById("profile-description"), hint = document.getElementById("profile-username-hint"), btn = e.target.querySelector('button[type="submit"]'), nuevoUsername = input.value.trim(), nuevoDescription = description?.value.trim().slice(0, 280) || "", regex = /^[a-zA-Z0-9_]{3,20}$/;
  if (!regex.test(nuevoUsername)) {
    hint.textContent = "❌ Usa 3-20 caracteres: letras, números y _.";
    hint.className = "username-hint error";
    shakeElement(input);
    return;
  }
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Guardando...";
  try {
    const { error } = await sbClient.from("perfiles").update({ username: nuevoUsername, descripcion: nuevoDescription || null, avatar_url: sanitizeImageUrl(perfilAvatarPendiente) || null, fondo_url: sanitizeImageUrl(perfilFondoPendiente) || null, avatar_pos_x: posEntera(perfilAvatarPosPendiente.x), avatar_pos_y: posEntera(perfilAvatarPosPendiente.y), fondo_pos_x: posEntera(perfilFondoPosPendiente.x), fondo_pos_y: posEntera(perfilFondoPosPendiente.y) }).eq("user_id", currentUser.id);
    if (error) throw new Error(mensajeErrorImagen(error.message));
    userUsername = nuevoUsername;
    userDescription = nuevoDescription;
    userAvatarUrl = sanitizeImageUrl(perfilAvatarPendiente) || null;
    userBackgroundUrl = sanitizeImageUrl(perfilFondoPendiente) || null;
    userAvatarPos = { ...perfilAvatarPosPendiente };
    userBackgroundPos = { ...perfilFondoPosPendiente };
    guardarInfoUsuarioLocal();
    actualizarUIPerfil();
    closeModal("profile-modal");
    showToast("✅ Perfil actualizado");
  } catch (err) {
    playErrorSound();
    showToast(`❌ ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});
document.getElementById("settings-btn").addEventListener("click", () => {
  actualizarUIPerfil();
});
const formRole = document.getElementById("form-role");
if (formRole) {
  const inputRole = document.getElementById("role-name"), hintRole = document.getElementById("role-hint");
  inputRole.addEventListener("input", () => {
    const val = inputRole.value, regex = /^[a-zA-Z0-9_]{3,30}$/;
    if (val.length === 0) {
      hintRole.textContent = "3-30 caracteres. Solo letras, números y guion bajo (_).";
      hintRole.className = "username-hint";
    } else if (!regex.test(val)) {
      let msg = "❌ ";
      if (val.length < 3) msg += "Mínimo 3 caracteres";
      else if (val.length > 30) msg += "Máximo 30 caracteres";
      else msg += "Solo letras, números y _";
      hintRole.textContent = msg;
      hintRole.className = "username-hint error";
    } else {
      hintRole.textContent = "✅ Nombre válido";
      hintRole.className = "username-hint success";
    }
  });
  formRole.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nuevoRole = inputRole.value.trim(), btn = e.target.querySelector('button[type="submit"]'), originalText = btn.textContent;
    if (!nuevoRole) return;
    const keyInput = document.getElementById("gemini-api-key"), rawKey = (keyInput?.value || "").trim(), modelSel = document.getElementById("gemini-model");
    btn.disabled = true;
    btn.textContent = "Guardando...";
    try {
      setGeminiModel(modelSel?.value || getGeminiModel());
      setSummaryModel(document.getElementById("gemini-summary-model")?.value || getSummaryModel());
      if (rawKey) {
        saveGeminiKey(rawKey);
      }
      updateApiKeyUI();
      actualizarIndicadoresChat();
      await guardarNombreRol(nuevoRole);
      showToast(`✅ Nombre de rol configurado: ${nuevoRole}`);
      inputRole.value = "";
      hintRole.textContent = "3-30 caracteres. Solo letras, números y guion bajo (_).";
      hintRole.className = "username-hint";
      closeModal("role-modal");
    } catch (err) {
      playErrorSound();
      shakeElement(inputRole);
      showToast(`❌ ${err.message}`, "error");
      hintRole.textContent = "❌ " + err.message;
      hintRole.className = "username-hint error";
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
}
function actualizarPreviewRol() {
  const input = document.getElementById("role-name");
  if (!input) return;
  const val = input.value.trim(), nom = document.getElementById("rol-preview-nombre"), cont = document.getElementById("rol-contador");
  if (nom) nom.textContent = val || userRoleName || "tú";
  if (cont) cont.textContent = `${input.value.length}/30`;
  const charEl = document.getElementById("rol-preview-char"), av = document.getElementById("rol-preview-avatar");
  const nombreChar = currentCharacter?.nombre || "Tu personaje";
  if (charEl) charEl.textContent = nombreChar;
  if (av) {
    const safe = sanitizeImageUrl(currentCharacter?.avatar_url);
    av.innerHTML = safe ? `<img src="${safe.replace(/"/g, "&quot;")}" alt="">` : escapeHtml(nombreChar.charAt(0).toUpperCase());
  }
}
function prepararModalRol() {
  const inputRole = document.getElementById("role-name");
  if (userRoleName && !inputRole.value) inputRole.value = userRoleName;
  updateApiKeyUI();
  const motor = document.getElementById("rol-motor"), resumen = document.getElementById("rol-motor-resumen");
  const hayKey = !!getGeminiKey(), conCR = usaCR();
  if (motor) motor.open = !hayKey && !conCR;
  if (resumen) resumen.textContent = hayKey ? `API Key guardada · ${etiquetaModelo(getGeminiModel())}` : conCR ? "Opcional mientras uses Créditos de Rol" : "Falta tu API Key: sin ella el personaje no puede responder";
  pintarMotorCR();
  cargarLotesCR().catch(() => {
  });
  actualizarPreviewRol();
}
document.getElementById("role-name")?.addEventListener("input", actualizarPreviewRol);
document.getElementById("chat-role-btn").addEventListener("click", () => {
  prepararModalRol();
  openModal("role-modal");
});
const hamburgerBtn = document.getElementById("btn-hamburger"), sidebar = document.getElementById("chat-sidebar");
hamburgerBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  sidebar.classList.toggle("open");
});
document.addEventListener("click", (e) => {
  if (window.innerWidth <= 768 && sidebar.classList.contains("open")) {
    if (!sidebar.contains(e.target) && !hamburgerBtn.contains(e.target)) sidebar.classList.remove("open");
  }
});
document.getElementById("chat-list").addEventListener("click", () => {
  if (window.innerWidth <= 768) setTimeout(() => sidebar.classList.remove("open"), 300);
});
const scrollBtn = document.getElementById("scroll-to-bottom-btn");
const messagesContainer = document.getElementById("chat-messages");
let scrollRaf = null, scrollBtnVisible = false, nuevosMientrasArriba = 0;
function distanciaAlFinal() {
  return messagesContainer.scrollHeight - messagesContainer.clientHeight - messagesContainer.scrollTop;
}
function pintarBotonFinal() {
  if (!scrollBtn) return;
  scrollBtn.classList.toggle("visible", scrollBtnVisible);
  scrollBtn.classList.toggle("has-new", scrollBtnVisible && nuevosMientrasArriba > 0);
  const badge = document.getElementById("scroll-nuevo");
  if (badge) badge.textContent = scrollBtnVisible && nuevosMientrasArriba > 0 ? nuevosMientrasArriba > 9 ? "9+" : String(nuevosMientrasArriba) : "";
  scrollBtn.setAttribute("aria-hidden", String(!scrollBtnVisible));
  scrollBtn.tabIndex = scrollBtnVisible ? 0 : -1;
}
function toggleScrollButton() {
  if (!messagesContainer || !scrollBtn || scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = null;
    const d = distanciaAlFinal(), umbral = Math.max(220, messagesContainer.clientHeight * 0.5);
    if (!scrollBtnVisible && d > umbral) scrollBtnVisible = true;
    else if (scrollBtnVisible && d < 60) {
      scrollBtnVisible = false;
      nuevosMientrasArriba = 0;
    }
    pintarBotonFinal();
  });
}
if (messagesContainer) {
  messagesContainer.addEventListener("scroll", toggleScrollButton, { passive: true });
  let ultimoMensaje = null;
  const observer = new MutationObserver(() => {
    const burbujas = messagesContainer.querySelectorAll(":scope > .message-bubble");
    const last = burbujas[burbujas.length - 1];
    const id = last ? last.dataset.mensajeId || "tmp" : null;
    if (scrollBtnVisible && id && ultimoMensaje && id !== ultimoMensaje && ultimoMensaje !== "tmp") nuevosMientrasArriba++;
    ultimoMensaje = id;
    toggleScrollButton();
  });
  observer.observe(messagesContainer, { childList: true, subtree: true });
  setTimeout(toggleScrollButton, 100);
}
if (scrollBtn) {
  scrollBtn.addEventListener("click", () => {
    const d = distanciaAlFinal(), pantalla = messagesContainer.clientHeight;
    if (d > pantalla * 3) messagesContainer.scrollTop = messagesContainer.scrollHeight - messagesContainer.clientHeight - pantalla;
    messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: "smooth" });
    nuevosMientrasArriba = 0;
    scrollBtnVisible = false;
    pintarBotonFinal();
  });
}
console.log("✅ SAIR cargado correctamente");
