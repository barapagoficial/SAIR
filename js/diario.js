const DIARIO_PREFIX = "sair1_diario_";
const DIARIO_VERSION = 2;
const DIARIO_MAX_PERSONAJES = 16;
const DIARIO_PARTES = ["opina", "gustaria_saber", "siente", "como_se_siente"];
const DIARIO_MAX_LECTURA_SIN_MARCA = 24e3;
const DIARIO_MAX_SECCION = 2200;
const DIARIO_MAX_TEXTO = 6e4;
const DIARIO_COLORES = ["#ff4d8f", "#a855f7", "#4d79ff", "#22c1a6", "#f59e0b", "#ef4444", "#06b6d4", "#84cc16"];
let diarioCache = { chatId: null, diario: null };
let diarioEnNube = true;
let diarioGenerando = false;
let diarioMensajesTimer = null;
const DIARIO_ESQUEMA_JSON = '{"personajes":[{"nombre":"Nombre del personaje","rol":"personaje principal / secundario / aliado / rival…","opina":"...","gustaria_saber":"...","siente":"...","como_se_siente":"..."}]}';
const DIARIO_INSTRUCCION = 'Escribe ahora el "Diario de Personajes" de los personajes que han compartido escena con el usuario. Responde ÚNICAMENTE con el JSON indicado, sin texto antes ni después.';
const DIARIO_INSTRUCCION_NEUTRA = 'Escribe, para cada personaje de las notas anteriores, un diario breve en primera persona con estas cuatro claves: "opina", "gustaria_saber", "siente" y "como_se_siente" (entre 2 y 6 frases cada una). Responde ÚNICAMENTE con este JSON: ' + DIARIO_ESQUEMA_JSON;
const DIARIO_PROMPT = `Eres un escritor experto en ficción. Vas a redactar el "Diario de Personajes" de una historia de rol: el diario personal de cada personaje que ha compartido escena con el usuario.

CONTEXTO:
- El usuario de la app interpreta a un personaje al que llamamos {{user}}. Los personajes se dirigen a él/ella como "{{user}}".
- La historia es ficción narrativa entre personajes imaginarios.

TAREA:
1) Identifica a los personajes que REALMENTE han interactuado con {{user}} en la historia: quienes hablaron, actuaron o reaccionaron con él/ella. Incluye siempre al personaje principal del chat. NO incluyas a {{user}}, ni a personajes que solo se mencionan de pasada, ni a objetos o lugares. Escribe como máximo 8 personajes, ordenados por importancia en la historia.
2) Para cada personaje, redacta su diario en PRIMERA PERSONA, con la voz de ese personaje y un tono que encaje con su personalidad y con lo que ha vivido. El diario debe tener EXACTAMENTE estas cuatro partes:
   - "opina": Qué opina de {{user}} (su juicio personal: confianza, admiración, celos, molestias, ternura, respeto…).
   - "gustaria_saber": Qué le gustaría saber de {{user}} (dudas, curiosidades, cosas que intuye y no se atreve a preguntar).
   - "siente": Qué siente (emociones, deseos, miedos, nervios, cariño, dolor… hacia {{user}} o por la situación que viven).
   - "como_se_siente": Cómo se siente con {{user}} (cómo es estar a su lado, qué cambia en él/ella, qué le aporta o le cuesta).
3) Escribe entre 2 y 6 frases por parte, en el mismo idioma de la conversación, y menciona a {{user}} escribiendo exactamente "{{user}}".
4) Básate SOLO en lo que ocurre en la historia. No contradigas los hechos ni inventes sucesos nuevos; lo que no se ha contado, exprésalo como duda o suposición.
5) No escribas narración externa, acotaciones ni resúmenes de la trama: solo la voz del personaje en su propio diario.

FORMATO DE RESPUESTA: responde ÚNICAMENTE con un JSON válido, sin texto antes ni después, con esta forma exacta:
` + DIARIO_ESQUEMA_JSON;
const DIARIO_ESQUEMA_CAMBIOS = '{"personajes":[{"nombre":"Nombre exacto del personaje","nuevo":false,"rol":"solo si es nuevo o cambió","opina":"solo si cambia","gustaria_saber":"solo si cambia","siente":"solo si cambia","como_se_siente":"solo si cambia","novedad":"..."}]}';
const DIARIO_INSTRUCCION_ACTUALIZAR = 'Actualiza ahora el "Diario de Personajes" con lo que ocurrió en los mensajes nuevos. Incluye solo a los personajes que aparecen en ellos y solo las partes que cambian. Responde ÚNICAMENTE con el JSON indicado, sin texto antes ni después.';
const DIARIO_INSTRUCCION_ACTUALIZAR_NEUTRA = 'Con lo ocurrido en las notas anteriores, actualiza el diario breve en primera persona de los personajes que aparecen en ellas. Incluye solo las claves que cambian ("opina", "gustaria_saber", "siente", "como_se_siente") y siempre "novedad" (1 a 3 frases). Responde ÚNICAMENTE con este JSON: ' + DIARIO_ESQUEMA_CAMBIOS;
const DIARIO_PROMPT_ACTUALIZAR = `Eres un escritor experto en ficción. Vas a ACTUALIZAR el "Diario de Personajes" de una historia de rol: el diario personal de cada personaje que ha compartido escena con el usuario. El diario YA EXISTE y se te entrega abajo como "DIARIO ACTUAL". NO lo reescribas desde cero: solo anota lo que cambió.

CONTEXTO:
- El usuario de la app interpreta a un personaje al que llamamos {{user}}. Los personajes se dirigen a él/ella como "{{user}}".
- La historia es ficción narrativa entre personajes imaginarios.
- La conversación que recibes contiene SOLO los mensajes nuevos desde la última vez que se escribió el diario. Lo anterior ya está reflejado en el DIARIO ACTUAL y en el resumen.

CADA DIARIO TIENE CUATRO PARTES:
- "opina": Qué opina de {{user}}.
- "gustaria_saber": Qué le gustaría saber de {{user}}.
- "siente": Qué siente (hacia {{user}} o por la situación que viven).
- "como_se_siente": Cómo se siente con {{user}}.

TAREA:
1) Lee los mensajes nuevos y busca a los personajes que vivieron algo con {{user}} en ellos (hablaron, actuaron o reaccionaron). NO incluyas a {{user}}, ni a quienes solo se mencionan de pasada, ni objetos o lugares.
2) Los personajes del DIARIO ACTUAL que NO aparecen en los mensajes nuevos NO van en tu respuesta: se conservan tal cual. Nunca los borres ni los resumas.
3) Para cada personaje que ya está en el diario y aparece en los mensajes nuevos: escribe su "nombre" EXACTAMENTE como figura en el DIARIO ACTUAL, "nuevo": false, y solo las partes que cambian. Cada parte que incluyas debe ser la versión COMPLETA y actualizada de esa parte: conserva lo que sigue siendo cierto del texto actual y añade o ajusta lo que cambió, como una evolución, no como un reemplazo. Si una parte sigue igual, no la incluyas.
4) Para cada personaje NUEVO que de verdad interactuó con {{user}} en los mensajes nuevos: "nuevo": true, "rol" y las cuatro partes completas.
5) Para cada personaje que incluyas, escribe "novedad": de 1 a 3 frases en primera persona, como una entrada reciente de su diario, sobre lo que acaba de vivir con {{user}}.
6) Escribe en PRIMERA PERSONA, con la voz de cada personaje, entre 2 y 6 frases por parte, en el mismo idioma de la conversación, y menciona a {{user}} escribiendo exactamente "{{user}}".
7) Básate SOLO en lo que ocurre en la historia. No contradigas los hechos ni inventes sucesos nuevos.
8) Si en los mensajes nuevos ningún personaje vivió nada relevante con {{user}}, responde exactamente {"personajes":[]}.

FORMATO DE RESPUESTA: responde ÚNICAMENTE con un JSON válido, sin texto antes ni después, con esta forma:
` + DIARIO_ESQUEMA_CAMBIOS;
function detectarEtiquetaDiario(linea) {
  const limpia = String(linea || "").replace(/^[-•*\s]+/, "").replace(/\*\*/g, "").trim();
  const coincidencia = limpia.match(/^([^:：]{2,70})\s*[:：]\s*(.*)$/);
  if (!coincidencia) return null;
  const etiqueta = coincidencia[1].toLowerCase();
  const resto = coincidencia[2].trim();
  if (/c[oó]mo (?:se siente|me siento|te sientes|se sienten)|se siente con|qu[eé] siente con/.test(etiqueta)) return { clave: "como_se_siente", resto };
  if (/gustar[ií]a (?:saber|conocer|preguntar)|quiere saber|le da curiosidad|curiosidad|dudas|qu[eé] le preguntar/.test(etiqueta)) return { clave: "gustaria_saber", resto };
  if (/opina|opini[oó]n|piensa|impresi[oó]n|le parece|qu[eé] le parece/.test(etiqueta)) return { clave: "opina", resto };
  if (/siente|sentimientos|sentir/.test(etiqueta)) return { clave: "siente", resto };
  return null;
}
function limpiarCampoDiario(valor, maximo = DIARIO_MAX_SECCION) {
  return String(valor == null ? "" : valor).replace(/\s+\n/g, "\n").trim().slice(0, maximo);
}
function normalizarDiario(valor) {
  let data = valor;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  const lista = Array.isArray(data.personajes) ? data.personajes : Array.isArray(data.entradas) ? data.entradas : Array.isArray(data.characters) ? data.characters : null;
  if (!lista) return null;
  const personajes = lista.map((item) => {
    if (!item || typeof item !== "object") return null;
    const nombre = limpiarCampoDiario(item.nombre || item.personaje || item.name, 80);
    const p = {
      nombre,
      rol: limpiarCampoDiario(item.rol || item.rol_en_la_historia || item.tipo, 140),
      opina: limpiarCampoDiario(item.opina || item.que_opina || item.opinion),
      gustaria_saber: limpiarCampoDiario(item.gustaria_saber || item.le_gustaria_saber || item.quiere_saber || item.curiosidad),
      siente: limpiarCampoDiario(item.siente || item.que_siente || item.sentimientos),
      como_se_siente: limpiarCampoDiario(item.como_se_siente || item.se_siente || item.como_se_siente_con_el_usuario || item.con_el_usuario)
    };
    if (!p.nombre || !(p.opina || p.gustaria_saber || p.siente || p.como_se_siente)) return null;
    const novedad = limpiarCampoDiario(item.novedad || item.ultima_entrada, 900);
    if (novedad) p.novedad = novedad;
    const ronda = Math.max(0, Math.floor(Number(item.ronda) || 0));
    if (ronda) p.ronda = ronda;
    const desde = Math.max(0, Math.floor(Number(item.desde_ronda) || 0));
    if (desde) p.desde_ronda = desde;
    const actualizado = limpiarCampoDiario(item.actualizado_en, 40);
    if (actualizado) p.actualizado_en = actualizado;
    return p;
  }).filter(Boolean).slice(0, DIARIO_MAX_PERSONAJES);
  if (!personajes.length) return null;
  const diario = {
    version: Number(data.version) || DIARIO_VERSION,
    generado_en: limpiarCampoDiario(data.generado_en || data.fecha, 40) || (/* @__PURE__ */ new Date()).toISOString(),
    modelo: limpiarCampoDiario(data.modelo, 60),
    ronda: Math.max(1, Math.floor(Number(data.ronda) || 1)),
    personajes
  };
  const actualizado = limpiarCampoDiario(data.actualizado_en, 40);
  if (actualizado) diario.actualizado_en = actualizado;
  const marca = data.leido_hasta;
  if (marca && typeof marca === "object" && (marca.id || marca.creado_en)) {
    diario.leido_hasta = { id: limpiarCampoDiario(marca.id, 80) || null, creado_en: limpiarCampoDiario(marca.creado_en, 40) || null };
  }
  return diario;
}
function claveNombreDiario(nombre) {
  return normalizarParaBuscar(nombre).replace(/[^a-z0-9]+/g, " ").trim();
}
function buscarPersonajeDiario(lista, nombre) {
  const clave = claveNombreDiario(nombre);
  if (!clave) return -1;
  const exacto = lista.findIndex((p) => claveNombreDiario(p.nombre) === clave);
  if (exacto >= 0) return exacto;
  const palabras = clave.split(" ").filter((w) => w.length >= 3);
  if (!palabras.length) return -1;
  return lista.findIndex((p) => {
    const otras = claveNombreDiario(p.nombre).split(" ").filter((w) => w.length >= 3);
    if (!otras.length) return false;
    const [corta, larga] = otras.length <= palabras.length ? [otras, palabras] : [palabras, otras];
    return corta.every((w) => larga.includes(w));
  });
}
function normalizarCambiosDiario(valor) {
  const lista = Array.isArray(valor?.personajes) ? valor.personajes : Array.isArray(valor?.entradas) ? valor.entradas : Array.isArray(valor?.characters) ? valor.characters : Array.isArray(valor) ? valor : null;
  if (!lista) return null;
  return lista.map((item) => {
    if (!item || typeof item !== "object") return null;
    const c = {
      nombre: limpiarCampoDiario(item.nombre || item.personaje || item.name, 80),
      nuevo: item.nuevo === true || item.nuevo === "true",
      rol: limpiarCampoDiario(item.rol || item.rol_en_la_historia || item.tipo, 140),
      opina: limpiarCampoDiario(item.opina || item.que_opina || item.opinion),
      gustaria_saber: limpiarCampoDiario(item.gustaria_saber || item.le_gustaria_saber || item.quiere_saber || item.curiosidad),
      siente: limpiarCampoDiario(item.siente || item.que_siente || item.sentimientos),
      como_se_siente: limpiarCampoDiario(item.como_se_siente || item.se_siente || item.como_se_siente_con_el_usuario || item.con_el_usuario),
      novedad: limpiarCampoDiario(item.novedad || item.ultima_entrada, 900)
    };
    return c.nombre && (c.novedad || c.rol || DIARIO_PARTES.some((k) => c[k])) ? c : null;
  }).filter(Boolean);
}
function fusionarDiario(actual, cambios) {
  const ronda = (actual.ronda || 1) + 1;
  const ahora = (/* @__PURE__ */ new Date()).toISOString();
  const personajes = actual.personajes.map((p) => ({ ...p }));
  let actualizados = 0, nuevos = 0, sinCupo = 0;
  for (const c of cambios) {
    const indice = buscarPersonajeDiario(personajes, c.nombre);
    if (indice >= 0) {
      const p = personajes[indice];
      let cambio = false;
      for (const clave of ["rol", ...DIARIO_PARTES, "novedad"]) {
        if (c[clave] && c[clave] !== p[clave]) {
          p[clave] = c[clave];
          cambio = true;
        }
      }
      if (cambio) {
        p.ronda = ronda;
        p.actualizado_en = ahora;
        actualizados++;
      }
      continue;
    }
    if (!DIARIO_PARTES.some((k) => c[k])) continue;
    if (personajes.length >= DIARIO_MAX_PERSONAJES) {
      sinCupo++;
      continue;
    }
    const nuevo = { nombre: c.nombre, rol: c.rol };
    for (const clave of DIARIO_PARTES) nuevo[clave] = c[clave];
    if (c.novedad) nuevo.novedad = c.novedad;
    nuevo.ronda = ronda;
    nuevo.desde_ronda = ronda;
    nuevo.actualizado_en = ahora;
    personajes.push(nuevo);
    nuevos++;
  }
  return { diario: { ...actual, version: DIARIO_VERSION, ronda, actualizado_en: ahora, personajes }, actualizados, nuevos, sinCupo };
}
function marcaLecturaDiario(utiles) {
  const ultimo = utiles[utiles.length - 1];
  return ultimo ? { id: ultimo.id ? String(ultimo.id) : null, creado_en: ultimo.creado_en || null } : null;
}
function mensajesNuevosDiario(diario, utiles) {
  const marca = diario?.leido_hasta;
  if (!marca) return null;
  if (marca.id) {
    const indice = utiles.findIndex((m) => String(m.id) === marca.id);
    if (indice >= 0) return utiles.slice(indice + 1);
  }
  const limite = Date.parse(marca.creado_en || "");
  if (!isNaN(limite) && utiles.some((m) => !isNaN(Date.parse(m.creado_en || "")))) {
    return utiles.filter((m) => Date.parse(m.creado_en || "") > limite);
  }
  return null;
}
function diarioParaPrompt(diario) {
  const recorte = (t) => String(t || "").slice(0, 1400);
  return JSON.stringify({ personajes: diario.personajes.map((p) => ({ nombre: p.nombre, rol: p.rol || "", opina: recorte(p.opina), gustaria_saber: recorte(p.gustaria_saber), siente: recorte(p.siente), como_se_siente: recorte(p.como_se_siente) })) });
}
function leerDiarioLocal(chatId) {
  try {
    const raw = localStorage.getItem(DIARIO_PREFIX + chatId);
    return raw ? normalizarDiario(raw) : null;
  } catch {
    return null;
  }
}
function guardarDiarioLocal(chatId, diario) {
  try {
    if (diario) localStorage.setItem(DIARIO_PREFIX + chatId, JSON.stringify(diario));
    else localStorage.removeItem(DIARIO_PREFIX + chatId);
  } catch {
  }
}
function borrarDiarioLocal(chatId) {
  try {
    localStorage.removeItem(DIARIO_PREFIX + chatId);
  } catch {
  }
}
function obtenerDiarioActual() {
  if (!currentChatId) return null;
  if (diarioCache.chatId === currentChatId && diarioCache.diario) return diarioCache.diario;
  const local = leerDiarioLocal(currentChatId);
  if (local) diarioCache = { chatId: currentChatId, diario: local };
  return local;
}
function actualizarIndicadorDiario() {
  const btn = document.getElementById("chat-diario-btn");
  if (!btn) return;
  const activo = diarioCache.chatId === currentChatId && !!diarioCache.diario;
  btn.classList.toggle("diario-activo", activo);
  btn.title = activo ? "Diario de Personajes: ya escrito para este chat" : "Diario de Personajes: mira qué piensan de ti";
}
function prepararDiarioLocal(chatId) {
  if (!chatId) {
    diarioCache = { chatId: null, diario: null };
    actualizarIndicadorDiario();
    return;
  }
  diarioCache = { chatId, diario: leerDiarioLocal(chatId) };
  actualizarIndicadorDiario();
}
async function cargarDiario(chatId) {
  if (!chatId) {
    diarioCache = { chatId: null, diario: null };
    actualizarIndicadorDiario();
    return null;
  }
  const local = leerDiarioLocal(chatId);
  diarioCache = { chatId, diario: local };
  actualizarIndicadorDiario();
  try {
    const { data, error } = await sbClient.from("chats").select("diario_personajes").eq("id", chatId).eq("user_id", currentUser.id).single();
    if (error) throw new Error(error.message);
    diarioEnNube = true;
    const nube = normalizarDiario(data?.diario_personajes);
    if (nube) {
      diarioCache = { chatId, diario: nube };
      guardarDiarioLocal(chatId, nube);
    } else if (local) {
      const { error: uploadError } = await sbClient.from("chats").update({ diario_personajes: local }).eq("id", chatId).eq("user_id", currentUser.id);
      if (uploadError) throw new Error(uploadError.message);
    }
  } catch (err) {
    diarioEnNube = false;
    console.warn("📖 Diario de Personajes sin sincronización en la nube:", err.message);
    diarioCache = { chatId, diario: local };
  }
  actualizarIndicadorDiario();
  return diarioCache.diario;
}
async function guardarDiario(chatId, diario) {
  if (!chatId) return false;
  const limpio = normalizarDiario(diario);
  if (!limpio) return false;
  guardarDiarioLocal(chatId, limpio);
  diarioCache = { chatId, diario: limpio };
  actualizarIndicadorDiario();
  try {
    const { error } = await sbClient.from("chats").update({ diario_personajes: limpio }).eq("id", chatId).eq("user_id", currentUser.id);
    if (error) throw new Error(error.message);
    diarioEnNube = true;
    return true;
  } catch (err) {
    diarioEnNube = false;
    console.warn("📖 Diario guardado solo en este dispositivo:", err.message);
    return false;
  }
}
function nombreMostradoUsuario() {
  return userRoleName || "ti";
}
function textoDiario(valor) {
  const limpio = reemplazarUserEnTexto(String(valor || "")).trim();
  return limpio.replace(/\{\{\s*user\s*\}\}/gi, nombreMostradoUsuario());
}
function construirCabeceraDiario(resumen) {
  const nombreUsuario = userRoleName || "{{user}}";
  const nombrePersonaje = currentCharacter?.nombre || "Personaje";
  const cabecera = ["DATOS DE LA HISTORIA"];
  if (currentCharacter) {
    cabecera.push(`- Personaje principal del chat: ${currentCharacter.nombre}`);
    const parsed = parsearSystemPrompt(currentCharacter.system_prompt || "");
    if (parsed.personalidad) cabecera.push(`- Personalidad de ${currentCharacter.nombre}: ${parsed.personalidad.slice(0, 1200)}`);
    if (parsed.escenario) cabecera.push(`- Escenario: ${parsed.escenario.slice(0, 900)}`);
  }
  cabecera.push(`- El usuario interpreta a: ${nombreUsuario}`);
  cabecera.push(`- En la conversación, los turnos del rol "model" son de ${nombrePersonaje} y los del rol "user" son de ${nombreUsuario}.`);
  const notas = obtenerNotasRolActual();
  if (notas) cabecera.push(`- Notas canónicas del usuario sobre la historia: ${notas.slice(0, 2500)}`);
  if (resumen) cabecera.push(`- Resumen de la historia anterior: ${String(resumen).slice(0, 6e3)}`);
  return cabecera.join("\n");
}
function extraerJsonDeTexto(texto) {
  const limpio = String(texto || "").replace(/```json/gi, "```").trim();
  const candidatos = [];
  const bloque = limpio.match(/```([\s\S]*?)```/);
  if (bloque) candidatos.push(bloque[1].trim());
  candidatos.push(limpio);
  const inicio = limpio.indexOf("{"), fin = limpio.lastIndexOf("}");
  if (inicio >= 0 && fin > inicio) candidatos.push(limpio.slice(inicio, fin + 1));
  for (const candidato of candidatos) {
    try {
      const data = JSON.parse(candidato);
      if (data && typeof data === "object") return data;
    } catch {
    }
  }
  return null;
}
function pareceEncabezadoPersonaje(linea) {
  const l = linea.trim();
  if (!l || l.length > 70) return false;
  if (/^#{1,4}\s+\S/.test(l)) return true;
  if (/^\*\*[^*]{2,60}\*\*:?$/.test(l)) return true;
  if (/^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9][^:]{1,58}:$/.test(l)) return true;
  return false;
}
function parsearDiarioEnTexto(texto) {
  const lineas = String(texto || "").replace(/\r/g, "").split("\n");
  const personajes = [];
  let actual = null, seccion = null, parrafo = "";
  const volcar = () => {
    if (actual && seccion && parrafo.trim()) actual[seccion] = actual[seccion] ? `${actual[seccion]}
${parrafo.trim()}` : parrafo.trim();
    parrafo = "";
  };
  const cerrar = () => {
    volcar();
    if (actual) personajes.push(actual);
    actual = null;
    seccion = null;
  };
  for (const linea of lineas) {
    const limpia = linea.trim();
    if (!limpia) {
      volcar();
      continue;
    }
    const etiqueta = detectarEtiquetaDiario(limpia);
    if (etiqueta) {
      volcar();
      seccion = etiqueta.clave;
      parrafo = etiqueta.resto;
      continue;
    }
    if (pareceEncabezadoPersonaje(limpia)) {
      cerrar();
      actual = { nombre: limpia.replace(/^#{1,4}\s+/, "").replace(/\*\*/g, "").replace(/:$/, "").trim(), rol: "", opina: "", gustaria_saber: "", siente: "", como_se_siente: "" };
      continue;
    }
    if (actual && seccion) parrafo = parrafo ? `${parrafo} ${limpia}` : limpia;
  }
  cerrar();
  return personajes.filter((p) => p.nombre && (p.opina || p.gustaria_saber || p.siente || p.como_se_siente));
}
function parsearDiarioGemini(texto) {
  const json = extraerJsonDeTexto(texto);
  if (json) {
    const diario2 = normalizarDiario(json);
    if (diario2) return diario2;
  }
  const heuristica = parsearDiarioEnTexto(texto);
  const diario = normalizarDiario({ personajes: heuristica, generado_en: (/* @__PURE__ */ new Date()).toISOString() });
  if (diario) return diario;
  throw new Error("La IA no devolvió el diario en un formato legible. Pulsa “🔄 Actualizar diario” para intentarlo de nuevo.");
}
function diarioContenido() {
  return document.getElementById("diario-content");
}
function detenerMensajesDiario() {
  if (diarioMensajesTimer) {
    clearInterval(diarioMensajesTimer);
    diarioMensajesTimer = null;
  }
  diarioProgresoTexto = "";
}
async function generarDiarioDesdeDigesto({ cabecera, utiles, nivelBase, onProgreso, prompt = DIARIO_PROMPT, instruccion = DIARIO_INSTRUCCION, instruccionNeutra = DIARIO_INSTRUCCION_NEUTRA }) {
  const { partes, omitidos, total } = await digestoTramos(utiles, { nivelInicial: "bloqueo_minimo", onProgreso, maxIntentosPorTramo: 3 });
  if (!partes.length) throw crearErrorBloqueo("Los filtros de seguridad de Gemini bloquearon toda la conversación.", null, { tipo: "bloqueo" });
  const { texto, modelo, parcial, intentos } = await generarConGeminiResiliente({
    systemPrompt: `${prompt}

${cabecera}`,
    sistemaNeutro: SISTEMA_NEUTRO,
    contenido: `NOTAS DE LA HISTORIA (resumen por tramos, en orden cronológico):

${unirDigestoTramos(partes)}`,
    instruccion,
    instruccionNeutra,
    maxOutputTokens: 8192,
    temperature: 0.85,
    nivelInicial: "bloqueo_minimo"
  });
  return { texto, modelo, parcial, omitidos, total, intentos };
}
let diarioProgresoTexto = "";
function actualizarProgresoDiario(texto) {
  diarioProgresoTexto = String(texto || "");
  const el = document.getElementById("diario-loading-sub");
  if (el && diarioProgresoTexto) el.textContent = diarioProgresoTexto;
}
function mostrarDiarioCargando(actualizando = false) {
  diarioProgresoTexto = "";
  const contenedor = diarioContenido();
  if (!contenedor) return;
  const usuario = nombreMostradoUsuario();
  contenedor.innerHTML = actualizando ? htmlCargaHerramienta({ tema: "diario", titulo: "Los personajes están abriendo sus diarios…", sub: "Leyendo lo que pasó desde la última vez", idSub: "diario-loading-sub", pasos: ["Leyendo los mensajes nuevos", "Buscando quién vivió algo contigo", "Anotando lo que cambió"] }) : htmlCargaHerramienta({ tema: "diario", titulo: "La IA está escribiendo los diarios…", sub: "Buscando a los personajes que han interactuado contigo", idSub: "diario-loading-sub", pasos: ["Buscando a los personajes", `Leyendo lo que vivieron con ${usuario}`, "Escribiendo sus diarios"] });
  iniciarCargaHerramienta(contenedor, 7e3);
  const mensajes = actualizando ? [
    "Leyendo lo que pasó desde la última vez",
    `Buscando quién vivió algo nuevo con ${usuario}`,
    "Pasando a la página siguiente del diario",
    "Anotando lo que cambió, sin borrar lo que ya estaba",
    "Casi listo: guardando las páginas nuevas"
  ] : [
    "Buscando a los personajes que han interactuado contigo",
    `Leyendo lo que cada personaje ha vivido con ${usuario}`,
    "Anotando qué opinan de ti en secreto",
    "Escribiendo lo que sienten y lo que no se atreven a decirte",
    "Casi listo: cerrando los diarios con llave"
  ];
  let indice = 0;
  detenerMensajesDiario();
  diarioMensajesTimer = setInterval(() => {
    if (diarioProgresoTexto) return;
    indice = (indice + 1) % mensajes.length;
    const el = document.getElementById("diario-loading-sub");
    if (el) el.textContent = mensajes[indice];
  }, 2600);
}
function mostrarDiarioError(mensaje, conDiario = false) {
  detenerMensajesDiario();
  const contenedor = diarioContenido();
  if (!contenedor) return;
  const volver = conDiario && obtenerDiarioActual() ? '<button type="button" class="btn btn-ghost" data-diario-accion="ver">📖 Ver mi diario</button>' : "";
  contenedor.innerHTML = `
    <div class="recap-confirm" style="padding:1.8rem 1rem;">
      <div class="recap-icon-wrapper" style="background:linear-gradient(135deg,rgba(239,68,68,.2),rgba(239,68,68,.1));margin-bottom:1rem;">
        <svg viewBox="0 0 24 24" style="stroke:#fca5a5;width:42px;height:42px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </div>
      <div class="recap-title" style="background:linear-gradient(135deg,#ef4444,#f59e0b);-webkit-background-clip:text;background-clip:text;font-size:1.25rem;">${conDiario ? "No se pudo actualizar el diario" : "No se pudo escribir el diario"}</div>
      <div class="recap-subtitle" style="color:#fca5a5;font-size:.88rem;">${escapeHtml(mensaje || "Error desconocido")}${conDiario ? "<br>Tu diario sigue tal como estaba." : ""}</div>
      <div class="diario-acciones" style="justify-content:center;">
        ${volver || '<button type="button" class="btn btn-ghost" data-diario-accion="cerrar">Cerrar</button>'}
        <button type="button" class="btn btn-primary" data-diario-accion="generar">🔄 Reintentar</button>
      </div>
    </div>`;
}
function mostrarDiarioVacio() {
  detenerMensajesDiario();
  const contenedor = diarioContenido();
  if (!contenedor) return;
  contenedor.innerHTML = `
    <div class="recap-confirm" style="padding:1.8rem 1rem;">
      <div class="recap-icon-wrapper" style="margin-bottom:1rem;">
        <svg viewBox="0 0 24 24" style="stroke:url(#recapGradient);width:42px;height:42px;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      </div>
      <div class="recap-title" style="font-size:1.25rem;">Aún no hay historia que contar</div>
      <div class="recap-subtitle" style="font-size:.88rem;">Habla un poco más con ${escapeHtml(currentCharacter?.nombre || "el personaje")} y vuelve a abrir el diario: necesito algo de conversación para saber qué piensan de ti.</div>
      <div class="diario-acciones" style="justify-content:center;">
        <button type="button" class="btn btn-ghost" data-diario-accion="cerrar">Cerrar</button>
      </div>
    </div>`;
}
function avatarDiario(personaje, indice) {
  const nombreNormalizado = String(personaje.nombre || "").toLowerCase().trim();
  const principal = String(currentCharacter?.nombre || "").toLowerCase().trim();
  const url = nombreNormalizado && principal && (nombreNormalizado === principal || nombreNormalizado.includes(principal) || principal.includes(nombreNormalizado)) ? sanitizeImageUrl(currentCharacter?.avatar_url) : "";
  if (url) return `<div class="diario-avatar"><img src="${url.replace(/"/g, "&quot;")}" alt=""></div>`;
  const inicial = escapeHtml((personaje.nombre || "?").charAt(0).toUpperCase());
  const color = DIARIO_COLORES[indice % DIARIO_COLORES.length];
  return `<div class="diario-avatar" style="background:linear-gradient(135deg,${color}55,${color}22);color:${color}">${inicial}</div>`;
}
function fechaDiario(valor) {
  const fecha = valor ? new Date(valor) : /* @__PURE__ */ new Date();
  if (isNaN(fecha.getTime())) return "hace un momento";
  try {
    return fecha.toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return fecha.toLocaleString();
  }
}
function etiquetaRondaDiario(personaje, diario) {
  if (!(diario.ronda > 1) || personaje.ronda !== diario.ronda) return "";
  return personaje.desde_ronda === diario.ronda ? '<span class="diario-badge nuevo">Nuevo</span>' : '<span class="diario-badge actualizado">Actualizado</span>';
}
function renderizarDiario(diario, fechaTexto) {
  detenerMensajesDiario();
  const contenedor = diarioContenido();
  if (!contenedor || !diario) return;
  const usuario = escapeHtml(nombreMostradoUsuario());
  const puedeQuitar = diario.personajes.length > 1;
  const tarjetas = diario.personajes.map((personaje, indice) => {
    const seccion = (icono, titulo, valor, clase) => valor ? `<section class="diario-seccion ${clase}"><div class="diario-seccion-titulo"><span aria-hidden="true">${icono}</span> ${titulo}</div><div class="diario-seccion-cuerpo">${prosaHtml(textoDiario(valor))}</div></section>` : "";
    const fechaNovedad = personaje.actualizado_en ? ` · ${escapeHtml(fechaDiario(personaje.actualizado_en))}` : "";
    return `<article class="diario-card${personaje.ronda === diario.ronda && diario.ronda > 1 ? " diario-card-reciente" : ""}" style="animation-delay:${Math.min(indice, 8) * 60}ms">
      <div class="diario-card-head">
        ${avatarDiario(personaje, indice)}
        <div class="diario-card-titulos"><div class="diario-nombre">${escapeHtml(personaje.nombre)}${etiquetaRondaDiario(personaje, diario)}</div>${personaje.rol ? `<div class="diario-rol">${escapeHtml(textoDiario(personaje.rol))}</div>` : ""}</div>
        ${puedeQuitar ? `<button type="button" class="diario-quitar" data-diario-accion="quitar" data-indice="${indice}" title="Quitar del diario" aria-label="Quitar a ${escapeHtml(personaje.nombre)} del diario">✕</button>` : ""}
      </div>
      ${personaje.novedad ? `<section class="diario-seccion novedad"><div class="diario-seccion-titulo"><span aria-hidden="true">✍️</span> Lo último que escribió${fechaNovedad}</div><div class="diario-seccion-cuerpo">${prosaHtml(textoDiario(personaje.novedad))}</div></section>` : ""}
      ${seccion("💭", `Lo que opina de ${usuario}`, personaje.opina, "opina")}
      ${seccion("❓", `Lo que le gustaría saber de ${usuario}`, personaje.gustaria_saber, "saber")}
      ${seccion("💗", "Lo que siente", personaje.siente, "siente")}
      ${seccion("🫧", `Cómo se siente con ${usuario}`, personaje.como_se_siente, "con-usuario")}
    </article>`;
  }).join("");
  contenedor.innerHTML = `
    <p class="diario-meta">${diario.personajes.length} personaje${diario.personajes.length !== 1 ? "s" : ""} escribieron sobre ${usuario} · ${diario.ronda > 1 ? "actualizado" : "escrito"} ${escapeHtml(fechaTexto || fechaDiario(diario.actualizado_en || diario.generado_en))}${diarioEnNube ? "" : ' · <span style="color:#fcd34d">guardado solo en este dispositivo</span>'}</p>
    <div class="diario-grid">${tarjetas}</div>
    <footer class="herr-barra diario-acciones">
      <button type="button" class="btn btn-ghost btn-danger" data-diario-accion="borrar" title="Borrar" aria-label="Borrar">🗑️<span class="herr-btn-txt"> Borrar</span></button>
      <button type="button" class="btn btn-ghost" data-diario-accion="descargar" title="Descargar" aria-label="Descargar">⬇️<span class="herr-btn-txt"> Descargar</span></button>
      <button type="button" class="btn btn-ghost" data-diario-accion="copiar" title="Copiar" aria-label="Copiar">📋<span class="herr-btn-txt"> Copiar</span></button>
      <button type="button" class="btn btn-primary" data-diario-accion="generar">🔄 Actualizar${usaCR() ? ` · ${CR_COSTOS.diario} CR` : ""}</button>
    </footer>`;
}
function diarioATextoPlano(diario) {
  const usuario = nombreMostradoUsuario();
  const lineas = [`📖 DIARIO DE PERSONAJES — ${currentCharacter?.nombre || "Chat"}`, fechaDiario(diario.generado_en), ""];
  diario.personajes.forEach((personaje) => {
    lineas.push(`── ${personaje.nombre}${personaje.rol ? ` (${textoDiario(personaje.rol)})` : ""} ──`);
    if (personaje.novedad) lineas.push(`✍️ Lo último que escribió: ${textoDiario(personaje.novedad)}`);
    if (personaje.opina) lineas.push(`💭 Lo que opina de ${usuario}: ${textoDiario(personaje.opina)}`);
    if (personaje.gustaria_saber) lineas.push(`❓ Lo que le gustaría saber de ${usuario}: ${textoDiario(personaje.gustaria_saber)}`);
    if (personaje.siente) lineas.push(`💗 Lo que siente: ${textoDiario(personaje.siente)}`);
    if (personaje.como_se_siente) lineas.push(`🫧 Cómo se siente con ${usuario}: ${textoDiario(personaje.como_se_siente)}`);
    lineas.push("");
  });
  return lineas.join("\n");
}
async function generarDiarioPersonajes() {
  if (diarioGenerando) return;
  if (!currentChatId) {
    showToast("⚠️ Selecciona un chat primero", "error");
    return;
  }
  if (!exigirIA(mostrarDiarioError)) return;
  const existente = diarioCache.chatId === currentChatId ? diarioCache.diario : obtenerDiarioActual();
  if (existente) return actualizarDiarioPersonajes(existente);
  diarioGenerando = true;
  mostrarDiarioCargando();
  try {
    const { mensajes } = await cargarHistorialCompleto(currentChatId);
    const utiles = mensajes.filter((m) => m.rol === "user" || m.rol === "assistant");
    const tuyos = utiles.filter((m) => m.rol === "user").length;
    if (!utiles.length || !tuyos) {
      mostrarDiarioVacio();
      return;
    }
    const resumen = mensajes.find((m) => m.rol === "summary")?.contenido || "";
    const cabecera = construirCabeceraDiario(resumen);
    const mensajesLimitados = limitarMensajesPorLongitud(utiles, Math.max(8e3, DIARIO_MAX_TEXTO - cabecera.length), true);
    const parsedDiario = parsearSystemPrompt(currentCharacter?.system_prompt);
    const nivelDiario = normalizarIntensidad(currentCharacter?.intensidad || parsedDiario.intensidad || "suave");
    let texto = "", modelo = "", parcial = false, omitidosDiario = 0;
    try {
      const respuesta = await generarConGeminiResiliente({
        systemPrompt: `${DIARIO_PROMPT}

${cabecera}`,
        sistemaNeutro: SISTEMA_NEUTRO,
        mensajes: mensajesLimitados,
        instruccion: DIARIO_INSTRUCCION,
        instruccionNeutra: DIARIO_INSTRUCCION_NEUTRA,
        maxOutputTokens: 8192,
        temperature: 0.85,
        nivelInicial: nivelDiario,
        accionCR: "diario"
      });
      texto = respuesta.texto;
      modelo = respuesta.modelo;
      parcial = respuesta.parcial;
    } catch (err) {
      if (!esErrorDeBloqueo(err)) throw err;
      console.warn("🛡️ Diario: la petición completa fue bloqueada; leyendo la historia por tramos…");
      const respuesta = await generarDiarioDesdeDigesto({
        cabecera,
        utiles: mensajesLimitados,
        nivelBase: nivelDiario,
        onProgreso: (i, n) => actualizarProgresoDiario(`Leyendo la historia por partes… (${i}/${n})`)
      });
      texto = respuesta.texto;
      modelo = respuesta.modelo;
      parcial = respuesta.parcial;
      omitidosDiario = respuesta.omitidos;
    }
    const diario = parsearDiarioGemini(texto);
    diario.modelo = diario.modelo || modelo || "";
    diario.generado_en = (/* @__PURE__ */ new Date()).toISOString();
    diario.version = DIARIO_VERSION;
    diario.ronda = 1;
    diario.leido_hasta = marcaLecturaDiario(utiles);
    diario.personajes.forEach((p) => {
      p.ronda = 1;
      p.desde_ronda = 1;
    });
    const sincronizado = await guardarDiario(currentChatId, diario);
    renderizarDiario(diario);
    if (omitidosDiario > 0) showToast(`📖 Diario escrito (no se pudieron leer ${omitidosDiario} fragmento${omitidosDiario !== 1 ? "s" : ""} por los filtros)`, "success");
    else if (parcial) showToast("📖 Diario escrito (puede haber quedado algo corto por los filtros)", "success");
    else if (sincronizado) showToast("📖 Diario de Personajes actualizado", "success");
    else showToast("📖 Diario guardado solo en este dispositivo", "success");
  } catch (err) {
    console.error("Error generando el Diario de Personajes:", err);
    mostrarDiarioError(esErrorDeBloqueo(err) ? mensajeBloqueoConAyuda(err) : err.message || "Error desconocido");
  } finally {
    diarioGenerando = false;
  }
}
function parsearCambiosDiario(texto) {
  const json = extraerJsonDeTexto(texto);
  const cambios = json ? normalizarCambiosDiario(json) : null;
  if (cambios) return cambios;
  const heuristica = parsearDiarioEnTexto(texto);
  if (heuristica.length) return heuristica;
  throw new Error("La IA no devolvió los cambios del diario en un formato legible. Pulsa “🔄 Reintentar” para intentarlo de nuevo.");
}
async function actualizarDiarioPersonajes(actual) {
  if (diarioGenerando) return;
  const chatId = currentChatId;
  diarioGenerando = true;
  try {
    const { mensajes } = await cargarHistorialCompleto(chatId);
    const utiles = mensajes.filter((m) => m.rol === "user" || m.rol === "assistant");
    let nuevos = mensajesNuevosDiario(actual, utiles);
    const sinMarca = nuevos === null;
    if (sinMarca) nuevos = limitarMensajesPorLongitud(utiles, DIARIO_MAX_LECTURA_SIN_MARCA, true);
    if (!nuevos.some((m) => m.rol === "user")) {
      renderizarDiario(actual);
      showToast(`📖 No hay mensajes nuevos desde la última actualización${usaCR() ? " (no se gastaron CR)" : ""}`);
      return;
    }
    mostrarDiarioCargando(true);
    const resumen = mensajes.find((m) => m.rol === "summary")?.contenido || "";
    const diarioPrompt = diarioParaPrompt(actual);
    const cabecera = `${construirCabeceraDiario(resumen)}

DIARIO ACTUAL (lo que cada personaje ya escribió; consérvalo y solo anota lo que cambia):
${diarioPrompt}`;
    const nuevosLimitados = limitarMensajesPorLongitud(nuevos, Math.max(8e3, DIARIO_MAX_TEXTO - cabecera.length), true);
    const parsedDiario = parsearSystemPrompt(currentCharacter?.system_prompt);
    const nivelDiario = normalizarIntensidad(currentCharacter?.intensidad || parsedDiario.intensidad || "suave");
    let texto = "", modelo = "", omitidos = 0;
    try {
      const respuesta = await generarConGeminiResiliente({
        systemPrompt: `${DIARIO_PROMPT_ACTUALIZAR}

${cabecera}`,
        sistemaNeutro: SISTEMA_NEUTRO,
        mensajes: nuevosLimitados,
        instruccion: DIARIO_INSTRUCCION_ACTUALIZAR,
        instruccionNeutra: DIARIO_INSTRUCCION_ACTUALIZAR_NEUTRA,
        maxOutputTokens: 8192,
        temperature: 0.75,
        nivelInicial: nivelDiario,
        accionCR: "diario"
      });
      texto = respuesta.texto;
      modelo = respuesta.modelo;
    } catch (err) {
      if (!esErrorDeBloqueo(err)) throw err;
      console.warn("🛡️ Diario: la actualización fue bloqueada; leyendo los mensajes nuevos por tramos…");
      const respuesta = await generarDiarioDesdeDigesto({
        cabecera,
        utiles: nuevosLimitados,
        nivelBase: nivelDiario,
        prompt: DIARIO_PROMPT_ACTUALIZAR,
        instruccion: DIARIO_INSTRUCCION_ACTUALIZAR,
        instruccionNeutra: DIARIO_INSTRUCCION_ACTUALIZAR_NEUTRA,
        onProgreso: (i, n) => actualizarProgresoDiario(`Leyendo los mensajes nuevos por partes… (${i}/${n})`)
      });
      texto = respuesta.texto;
      modelo = respuesta.modelo;
      omitidos = respuesta.omitidos;
    }
    const cambios = parsearCambiosDiario(texto);
    const { diario, actualizados, nuevos: agregados, sinCupo } = fusionarDiario(actual, cambios);
    diario.modelo = modelo || diario.modelo || "";
    diario.leido_hasta = marcaLecturaDiario(utiles);
    if (currentChatId !== chatId) {
      await guardarDiario(chatId, diario);
      return;
    }
    const sincronizado = await guardarDiario(chatId, diario);
    renderizarDiario(diarioCache.diario || diario);
    const partes = [];
    if (actualizados) partes.push(`${actualizados} actualizado${actualizados !== 1 ? "s" : ""}`);
    if (agregados) partes.push(`${agregados} nuevo${agregados !== 1 ? "s" : ""}`);
    let aviso = partes.length ? `📖 Diario actualizado: ${partes.join(" y ")}` : "📖 Nada nuevo que anotar: nadie vivió algo importante en los mensajes nuevos";
    if (sinCupo) aviso += ` · no cupieron ${sinCupo} personaje${sinCupo !== 1 ? "s" : ""} más (máximo ${DIARIO_MAX_PERSONAJES})`;
    if (omitidos > 0) aviso += ` · ${omitidos} fragmento${omitidos !== 1 ? "s" : ""} no se pudieron leer por los filtros`;
    if (!sincronizado) aviso += " · guardado solo en este dispositivo";
    showToast(aviso, "success");
  } catch (err) {
    console.error("Error actualizando el Diario de Personajes:", err);
    mostrarDiarioError(esErrorDeBloqueo(err) ? mensajeBloqueoConAyuda(err) : err.message || "Error desconocido", true);
  } finally {
    diarioGenerando = false;
  }
}
async function quitarPersonajeDiario(indice) {
  const diario = obtenerDiarioActual();
  const personaje = diario?.personajes?.[indice];
  if (!personaje || diario.personajes.length <= 1) return;
  if (!await confirmarSAIR(`¿Quitar a ${personaje.nombre} del diario?`, "Su página se borra de este diario. Si vuelve a aparecer en la historia, una próxima actualización puede escribirla de nuevo.", { aceptar: "Quitar", peligro: true })) return;
  const copia = { ...diario, personajes: diario.personajes.filter((_, i) => i !== indice) };
  await guardarDiario(currentChatId, copia);
  renderizarDiario(diarioCache.diario || copia);
  showToast(`🗑️ ${personaje.nombre} ya no está en el diario`);
}
async function abrirDiario() {
  if (!currentChatId) {
    showToast("⚠️ Selecciona un chat primero", "error");
    return;
  }
  detenerMensajesDiario();
  const guardado = obtenerDiarioActual();
  if (guardado) {
    openModal("diario-modal");
    const contenedor = diarioContenido();
    if (contenedor) contenedor.innerHTML = '<div class="recap-loading"><div class="recap-spinner"><div class="recap-spinner-core"></div></div><div class="recap-loading-text">Abriendo el diario…</div></div>';
    const enNube2 = await cargarDiario(currentChatId);
    renderizarDiario(enNube2 || guardado);
    return;
  }
  openModal("diario-modal");
  mostrarDiarioCargando();
  const enNube = await cargarDiario(currentChatId);
  if (enNube) {
    renderizarDiario(enNube);
    return;
  }
  if (usaCR()) {
    mostrarDiarioConfirmCR();
    return;
  }
  await generarDiarioPersonajes();
}
function mostrarDiarioConfirmCR() {
  detenerMensajesDiario();
  const contenedor = diarioContenido();
  if (!contenedor) return;
  contenedor.innerHTML = `
    <div class="recap-confirm" style="padding:1.8rem 1rem;">
      <div class="recap-icon-wrapper" style="margin-bottom:1rem;">
        <svg viewBox="0 0 24 24" style="stroke:url(#recapGradient);width:42px;height:42px;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      </div>
      <div class="recap-title" style="font-size:1.25rem;">El diario de los personajes</div>
      <div class="recap-subtitle" style="font-size:.88rem;">Leeré la conversación y escribiré lo que cada personaje piensa de ti. Usa <strong>${CR_COSTOS.diario} Créditos de Rol</strong> (${escapeHtml(CR_MODELOS[modeloCR()])}).</div>
      <div class="diario-acciones" style="justify-content:center;">
        <button type="button" class="btn btn-ghost" data-diario-accion="cerrar">Cerrar</button>
        <button type="button" class="btn btn-primary" data-diario-accion="generar">✍️ Escribir diario · ${CR_COSTOS.diario} CR</button>
      </div>
    </div>`;
}
async function copiarDiario() {
  const diario = obtenerDiarioActual();
  if (!diario) return;
  const texto = diarioATextoPlano(diario);
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(texto);
    else {
      const area = document.createElement("textarea");
      area.value = texto;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }
    showToast("📋 Diario copiado");
  } catch (err) {
    console.error("No se pudo copiar el diario:", err);
    showToast("No se pudo copiar el diario", "error");
  }
}
function descargarDiario() {
  const diario = obtenerDiarioActual();
  if (!diario) return;
  const nombre = `diario_${(currentCharacter?.nombre || "chat").replace(/[^\w\-]+/g, "_")}_${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.md`;
  const blob = new Blob([diarioATextoPlano(diario)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
  showToast("⬇️ Diario descargado");
}
async function borrarDiarioActual() {
  if (!currentChatId || !obtenerDiarioActual()) return;
  if (!await confirmarSAIR("¿Borrar el Diario de Personajes?", "Se borra el diario de este chat. Podrás generar otro después.", { aceptar: "Borrar", peligro: true })) return;
  borrarDiarioLocal(currentChatId);
  diarioCache = { chatId: currentChatId, diario: null };
  actualizarIndicadorDiario();
  try {
    const { error } = await sbClient.from("chats").update({ diario_personajes: null }).eq("id", currentChatId).eq("user_id", currentUser.id);
    if (error) throw new Error(error.message);
    diarioEnNube = true;
  } catch (err) {
    diarioEnNube = false;
    console.warn("📖 No se pudo borrar el diario en la nube:", err.message);
  }
  const contenedor = diarioContenido();
  if (contenedor) contenedor.innerHTML = `
    <div class="recap-confirm" style="padding:1.8rem 1rem;">
      <div class="recap-icon-wrapper" style="margin-bottom:1rem;"><svg viewBox="0 0 24 24" style="stroke:url(#recapGradient);width:42px;height:42px;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>
      <div class="recap-title" style="font-size:1.25rem;">Diario borrado</div>
      <div class="recap-subtitle" style="font-size:.88rem;">Puedes volver a escribirlo cuando quieras.</div>
      <div class="diario-acciones" style="justify-content:center;">
        <button type="button" class="btn btn-ghost" data-diario-accion="cerrar">Cerrar</button>
        <button type="button" class="btn btn-primary" data-diario-accion="generar">✍️ Escribir de nuevo</button>
      </div>
    </div>`;
  showToast("🗑️ Diario borrado");
}
document.getElementById("chat-diario-btn")?.addEventListener("click", abrirDiario);
document.getElementById("chat-diario-btn")?.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  abrirDiario();
});
document.getElementById("diario-modal")?.addEventListener("click", (e) => {
  const boton = e.target.closest("[data-diario-accion]");
  if (!boton) return;
  const accion = boton.dataset.diarioAccion;
  if (accion === "generar") generarDiarioPersonajes();
  else if (accion === "copiar") copiarDiario();
  else if (accion === "descargar") descargarDiario();
  else if (accion === "borrar") borrarDiarioActual();
  else if (accion === "quitar") quitarPersonajeDiario(Number(boton.dataset.indice));
  else if (accion === "ver") {
    const diario = obtenerDiarioActual();
    if (diario) renderizarDiario(diario);
  }
  else if (accion === "cerrar") closeModal("diario-modal");
});
document.getElementById("diario-modal")?.addEventListener("click", (e) => {
  if (e.target === document.getElementById("diario-modal")) closeModal("diario-modal");
});
