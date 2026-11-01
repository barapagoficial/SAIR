/* ── Versión de SAIR: ÚNICO sitio donde se cambia ──
   La usan index.html (pantalla de entrada y etiqueta de versión) y sw.js
   (nombre de la caché). Al cambiar este número, el navegador detecta un
   service worker nuevo y los usuarios reciben la actualización.
   Recuerda añadir la entrada correspondiente en Changelog.txt. */
self.SAIR_VERSION = {
  numero: '4.1.0',
  canal: 'Oficial A'
};
self.SAIR_VERSION.texto = self.SAIR_VERSION.numero + ' ' + self.SAIR_VERSION.canal;
self.SAIR_VERSION.cache = 'sair-v' + self.SAIR_VERSION.numero + '-' +
  self.SAIR_VERSION.canal.toLowerCase().replace(/[^a-z0-9]+/g, '-');
