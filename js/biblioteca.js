const BIBLIOTECA = {
  fotos: ["ritsu-anime-girl-pfp.webp", "anime-girl.webp", "naoya-zenin-manga.webp", "lonely-girl-animated.gif", "pink-anime.webp", "gtavi.webp", "frieren.webp", "red-talking.gif", "gothic-bat-girl.webp", "pink-anime-girl.webp", "anime-girl-2.webp", "fern.webp", "purple-anime.webp", "anime-girl-3.webp", "tuff.webp", "anime-pfp.webp", "stark.webp", "bel.webp", "asako-natsume.webp", "hood-anime-boy-hoodie-10-10.webp", "bill-cipher-animated-pfp.gif", "anime-girl-animated.gif", "anime-guys.webp", "anime-girl-cool-pfp.webp", "yoru-red-pfp.webp", "anime-guys-2.webp", "frieren-2.webp", "anime-guys-user-icon.webp"],
  banners: ["musashi-katana-black.webp", "hunter-x-hunter.webp", "citrus.webp", "jjk.webp", "hanekawa-hasumi.webp", "banner.webp", "black-rock-shooter.gif", "pink-white-sakura.webp", "mylove.webp", "animegif.gif", "takemyhand.webp", "moon.webp"],
  owner: ["foto-bruh.webp", "foto-lo-que-sea-esto-xd.webp", "banner-dark-black.gif", "banner-l.gif"]
};
const BIBLIOTECA_TIPOS = {
  avatar: { titulo: "Elige tu foto de perfil", carpeta: "fotos", owner: "foto-", forma: "circulo" },
  fondo: { titulo: "Elige tu fondo", carpeta: "banners", owner: "banner-", forma: "banner" },
  personaje: { titulo: "Elige la foto del personaje", carpeta: "fotos", owner: "foto-", forma: "cuadro" }
};
const BIBLIOTECA_RUTA = /^biblioteca\/(fotos|perfiles|banners|personajes|owner)\/[a-z0-9-]+\.(webp|gif|png|jpg)$/;
const bibliotecaEstado = { resolver: null };
function esImagenBiblioteca(url) {
  return typeof url === "string" && BIBLIOTECA_RUTA.test(url);
}
function mensajeErrorImagen(mensaje) {
  return /IMAGEN_NO_PERMITIDA/.test(mensaje || "") ? "Esa imagen no está permitida: elige una de la biblioteca de SAIR" : mensaje;
}
function rutasBiblioteca(carpeta, filtro = "") {
  return (BIBLIOTECA[carpeta] || []).filter((f) => f.startsWith(filtro)).map((f) => `biblioteca/${carpeta}/${f}`);
}
function crearModalBiblioteca() {
  let el = document.getElementById("biblioteca-modal");
  if (el) return el;
  el = document.createElement("div");
  el.className = "modal-overlay biblioteca-overlay";
  el.id = "biblioteca-modal";
  el.innerHTML = `<div class="modal biblioteca-modal" role="dialog" aria-modal="true" aria-labelledby="biblioteca-titulo" tabindex="-1">
<div class="modal-header"><h2 class="modal-title" id="biblioteca-titulo">Biblioteca</h2><button type="button" class="modal-close" data-biblioteca-cerrar aria-label="Cerrar ventana">✕</button></div>
<div class="biblioteca-cuerpo" id="biblioteca-cuerpo"></div>
<p class="biblioteca-nota">Para que SAIR sea un lugar seguro para todos, las imágenes se eligen de la biblioteca. ¡Iremos sumando más!</p>
</div>`;
  document.body.appendChild(el);
  el.addEventListener("click", (e) => {
    if (e.target === el || e.target.closest("[data-biblioteca-cerrar]")) {
      cerrarBiblioteca(null);
      return;
    }
    const opcion = e.target.closest(".biblioteca-opcion");
    if (opcion) cerrarBiblioteca(opcion.dataset.ruta);
  });
  return el;
}
function htmlGrupoBiblioteca(titulo, rutas, actual, forma, especial) {
  if (!rutas.length) return "";
  const opciones = rutas.map((ruta) => {
    const sel = ruta === actual;
    return `<button type="button" class="biblioteca-opcion${sel ? " seleccionada" : ""}" data-ruta="${escapeHtml(ruta)}" aria-pressed="${sel}" aria-label="${sel ? "Imagen actual" : "Elegir esta imagen"}"><img src="${escapeHtml(ruta)}" alt="" loading="lazy" decoding="async"></button>`;
  }).join("");
  return `<section class="biblioteca-grupo${especial ? " especial" : ""}"><h3 class="biblioteca-grupo-titulo">${titulo}</h3><div class="biblioteca-grid forma-${forma}">${opciones}</div></section>`;
}
function elegirDeBiblioteca(tipo, actual = null) {
  const cfg = BIBLIOTECA_TIPOS[tipo];
  if (!cfg) return Promise.resolve(null);
  if (bibliotecaEstado.resolver) cerrarBiblioteca(null);
  const el = crearModalBiblioteca();
  el.querySelector("#biblioteca-titulo").textContent = cfg.titulo;
  let html = htmlGrupoBiblioteca("Biblioteca de SAIR", rutasBiblioteca(cfg.carpeta), actual, cfg.forma, false);
  if (isOwner()) html += htmlGrupoBiblioteca("✨ Especial del Owner", rutasBiblioteca("owner", cfg.owner), actual, cfg.forma, true);
  el.querySelector("#biblioteca-cuerpo").innerHTML = html;
  return new Promise((resolve) => {
    bibliotecaEstado.resolver = resolve;
    openModal("biblioteca-modal");
    setTimeout(() => (el.querySelector(".biblioteca-opcion.seleccionada") || el.querySelector(".biblioteca-opcion"))?.focus({ preventScroll: true }), 60);
  });
}
function cerrarBiblioteca(valor) {
  const resolver = bibliotecaEstado.resolver;
  bibliotecaEstado.resolver = null;
  closeModal("biblioteca-modal");
  if (resolver) resolver(valor || null);
}
window.addEventListener("keydown", (e) => {
  if (!bibliotecaEstado.resolver || e.key !== "Escape") return;
  e.preventDefault();
  e.stopPropagation();
  cerrarBiblioteca(null);
}, true);
