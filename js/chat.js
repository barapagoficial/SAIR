/* SAIR · Generación de respuestas: streaming, variantes, enviar, reintentar, regenerar y editar.
   Se carga en orden desde index.html: los archivos comparten el ámbito global. */
/* ── Generación en curso: detenerla, timeouts reales y pintado eficiente ──
   · abortarGeneracion permite que la interfaz cancele el stream en curso.
   · generacionCancelada distingue "lo detuvo el usuario" de un error real.
   · pintarStreaming limita los repintados del markdown a ~16 por segundo. */
let abortarGeneracion=null;
let generacionCancelada=false;
let rateLimitRetryHandler=null;
let streamTextoActual='';
let streamUltimoPintado=0;
const STREAM_PINTADO_MS=60;
const chatStopBtn=document.getElementById('chat-stop-btn');
function empezarGeneracion(){
  detenerLectura();
  isStreaming=true;
  generacionCancelada=false;
  streamTextoActual='';
  streamUltimoPintado=0;
  if(chatStopBtn)chatStopBtn.hidden=false;
}
function terminarGeneracion(){
  isStreaming=false;
  abortarGeneracion=null;
  if(chatStopBtn)chatStopBtn.hidden=true;
}
function detenerGeneracion(){
  if(abortarGeneracion&&!abortarGeneracion.signal.aborted)abortarGeneracion.abort('usuario');
}
function pintarStreaming(bubble,texto){
  streamTextoActual=texto;
  const ahora=performance.now();
  if(ahora-streamUltimoPintado<STREAM_PINTADO_MS)return;
  streamUltimoPintado=ahora;
  bubble.innerHTML=renderMarkdown(texto)+'<span class="streaming-cursor"></span>';
  scrollChatToBottom();
}
/* Al detener una respuesta conservamos lo ya generado: perder una escena
   entera a medias es mucho peor que guardarla incompleta (y sigue teniendo
   el botón "Continuar respuesta"). */
async function guardarRespuestaParcial(bubble){
  const parcial=String(streamTextoActual||'').trim();
  if(!parcial){
    if(bubble)bubble.remove();
    showToast('⏹️ Generación detenida');
    return;
  }
  try{
    const mensaje=await guardarMensaje(currentChatId,'assistant',parcial);
    if(bubble){
      bubble.dataset.mensajeId=mensaje.id;
      bubble.dataset.originalText=parcial;
      bubble.innerHTML=renderMarkdown(parcial);
      agregarBotones(bubble,'assistant');
    }
    if(!historialCompleto.some(m=>m.id===mensaje.id))historialCompleto.push(mensaje);
    motivoIncompletaUltimaGeneracion='DETENIDA'; // ofrece «✂️ Continuar respuesta»
    marcarRespuestaIncompleta(mensaje.id);
    historialTotalMensajes=Math.max(historialTotalMensajes+1,historialCompleto.filter(m=>m.rol==='user'||m.rol==='assistant').length);
    chatOffset=historialCompleto.filter(m=>m.rol==='user'||m.rol==='assistant').length;
    renderizarChatPaginado();
    showToast('⏹️ Generación detenida. Se guardó lo que se alcanzó a escribir.');
  }catch(err){
    if(bubble)bubble.innerHTML=renderMarkdown(parcial);
    showToast('⏹️ Generación detenida');
  }
}
if(chatStopBtn)chatStopBtn.addEventListener('click',detenerGeneracion);

/* ============================================================
   VARIANTES DE RESPUESTA · estilo Character.AI
   Regenerar ya no borra la respuesta anterior: se añade como una versión
   más y se recorre con ‹ ›. Al enviar un mensaje nuevo se fija la versión
   elegida y se descartan las demás. contenido siempre refleja la elegida,
   así que resúmenes, diario, exportación y el propio prompt de Gemini
   siguen funcionando igual.
   ============================================================ */
function nuevoIdMensaje(){
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}
function variantesDe(mensaje){
  if(!mensaje)return [];
  const lista=Array.isArray(mensaje.variantes)?mensaje.variantes.filter(v=>typeof v==='string'&&v.length):[];
  if(lista.length)return lista;
  return typeof mensaje.contenido==='string'&&mensaje.contenido.length?[mensaje.contenido]:[];
}
function indiceVariante(mensaje){
  const lista=variantesDe(mensaje);
  if(!lista.length)return 0;
  const i=Number(mensaje&&mensaje.variante_activa);
  return Number.isFinite(i)?Math.min(Math.max(i,0),lista.length-1):0;
}
function contenidoVariante(mensaje){
  const lista=variantesDe(mensaje);
  return lista.length?lista[indiceVariante(mensaje)]:String((mensaje&&mensaje.contenido)||'');
}
/* Copia profunda de las variantes: sin esto, modificar un mensaje alteraría
   también la copia de seguridad usada para deshacer un error. */
function copiarHistorial(lista){
  return (Array.isArray(lista)?lista:[]).map(m=>({...m,variantes:Array.isArray(m.variantes)?m.variantes.slice():m.variantes}));
}
function aplicarVariantesUI(bubble,mensaje){
  if(!bubble)return;
  const previo=bubble.querySelector('.msg-variantes');
  if(previo)previo.remove();
  const lista=variantesDe(mensaje);
  if(lista.length<2)return;
  const i=indiceVariante(mensaje);
  const cont=document.createElement('div');
  cont.className='msg-variantes';
  cont.setAttribute('role','group');
  cont.setAttribute('aria-label','Versiones de esta respuesta');
  cont.innerHTML=`<button type="button" class="btn-variante" data-dir="-1" title="Versión anterior" aria-label="Ver la versión anterior de la respuesta"${i===0?' disabled':''}>\u2039</button>`
    +`<span class="variante-contador" aria-live="polite">${i+1}/${lista.length}</span>`
    +`<button type="button" class="btn-variante" data-dir="1" title="Versión siguiente" aria-label="Ver la versión siguiente de la respuesta"${i===lista.length-1?' disabled':''}>\u203a</button>`;
  bubble.appendChild(cont);
}
function actualizarBubbleVariante(bubble,mensaje){
  const texto=contenidoVariante(mensaje);
  bubble.dataset.originalText=texto;
  bubble.innerHTML=renderMarkdown(texto);
  agregarBotones(bubble,'assistant');
  aplicarAvisoRespuestaIncompleta(bubble);
  aplicarVariantesUI(bubble,mensaje);
}
async function persistirVariantes(mensaje){
  if(!variantesEnNube||!mensaje||!mensaje.id)return;
  const variantes=variantesDe(mensaje),activa=indiceVariante(mensaje);
  if(!variantes.length)return;
  try{
    const{error}=await sbClient.rpc('guardar_variantes_mensaje',{p_mensaje_id:mensaje.id,p_variantes:variantes,p_variante_activa:activa});
    if(!error)return;
    if(error.code==='PGRST202'||error.code==='42883'){
      // La función no existe todavía: se intenta un update directo antes de
      // darse por vencido y dejar las variantes solo en memoria.
      const{error:directo}=await sbClient.from('mensajes')
        .update({variantes:variantes,variante_activa:activa,contenido:variantes[activa]}).eq('id',mensaje.id);
      if(!directo)return;
      if(directo.code==='42703'){variantesEnNube=false;return}
      throw new Error(directo.message);
    }
    if(error.code==='42703'){variantesEnNube=false;return}
    throw new Error(error.message);
  }catch(err){
    console.warn('⚠️ No se pudieron guardar las variantes:',err&&err.message);
  }
}
async function cambiarVariante(bubble,dir){
  const mensajeId=bubble&&bubble.dataset?bubble.dataset.mensajeId:'';
  if(!mensajeId||isStreaming||!dir)return;
  const mensaje=historialCompleto.find(m=>String(m.id)===String(mensajeId));
  if(!mensaje)return;
  const lista=variantesDe(mensaje);
  if(lista.length<2)return;
  const nuevo=Math.min(Math.max(indiceVariante(mensaje)+dir,0),lista.length-1);
  if(nuevo===indiceVariante(mensaje))return;
  mensaje.variante_activa=nuevo;
  mensaje.contenido=lista[nuevo];
  actualizarBubbleVariante(bubble,mensaje);
  anunciarEstado(`Versión ${nuevo+1} de ${lista.length}`);
  await persistirVariantes(mensaje);
}
/* Al enviar un mensaje nuevo se fija la versión elegida en todas las
   respuestas anteriores y se descartan las demás. */
async function fijarVariantesElegidas(){
  const pendientes=historialCompleto.filter(m=>m&&m.rol==='assistant'&&variantesDe(m).length>1);
  if(!pendientes.length)return 0;
  for(const mensaje of pendientes){
    const elegida=contenidoVariante(mensaje);
    mensaje.variantes=[elegida];
    mensaje.variante_activa=0;
    mensaje.contenido=elegida;
    await persistirVariantes(mensaje);
    const bubble=document.querySelector(`.message-bubble[data-mensaje-id="${mensaje.id}"]`);
    if(bubble)aplicarVariantesUI(bubble,mensaje);
  }
  return pendientes.length;
}
/* Recorre el stream pintando la respuesta y devuelve el texto completo.
   Único sitio para los flujos que generan texto (antes era el mismo bucle
   copiado en cuatro funciones con pequeñas diferencias entre copias). */
async function transmitirStream(bubble,generator,prefijo=''){
  let texto='';
  for await(const chunk of generator){
    texto+=chunk;
    if(!bubble)continue;
    const typing=bubble.querySelector('.typing-indicator');
    if(typing)typing.remove();
    pintarStreaming(bubble,prefijo+texto);
  }
  if(bubble)bubble.innerHTML=renderMarkdown(prefijo+texto);
  anunciarEstado('Respuesta lista');
  return texto;
}
/* ── Flujo común de generación ──
   enviarMensaje, reintentarRespuestaAsistente, regenerarRespuesta y
   guardarEdicionMensaje repetían el mismo bloque (generar → streaming →
   guardar → pintar) y su manejo de errores. Ahora comparten estas funciones,
   así que un arreglo aquí se aplica a los cuatro. */
function esErrorRateLimit(err){
  const msg=err?.message||'';
  return msg.includes('429')||/rate limit|quota|too many requests|resource_exhausted/i.test(msg);
}
function contarMensajesVisibles(){
  return historialCompleto.filter(m=>m.rol==='user'||m.rol==='assistant').length;
}
function actualizarEstadoBotonEnviar(){
  chatSendBtn.disabled=!chatInput.value.trim()||!currentChatId||isStreaming;
}
function finalizarGeneracionUI(){
  terminarGeneracion();
  actualizarEstadoBotonEnviar();
}
const ICONO_REINTENTAR='<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.63 4.36a9 9 0 0 0 14.85-3.36L23 14"></path></svg>';
/* Error dentro de la burbuja de la IA, con botón "Reintentar" o, si es un
   límite de peticiones, con la cuenta atrás de mostrarErrorRateLimit. */
function mostrarErrorEnBurbuja(bubbleIA,err,textoUsuario){
  bubbleIA.querySelector('.typing-indicator')?.remove();
  ultimoMensajeEnviado=textoUsuario;
  if(esErrorRateLimit(err)){mostrarErrorRateLimit(bubbleIA,err.message,'send',{text:textoUsuario,bubbleIA});return}
  bubbleIA.className='message-bubble error';
  bubbleIA.innerHTML=`⚠️ ${escapeHtml(err.message)}`;
  const actionsDiv=document.createElement('div');
  actionsDiv.className='message-actions';
  actionsDiv.innerHTML=`<button type="button" class="btn-message btn-retry-send" style="background:rgba(255,77,143,.15);border-color:var(--pink);color:var(--pink);">${ICONO_REINTENTAR}Reintentar</button>`;
  bubbleIA.appendChild(actionsDiv);
}
/* Pide la respuesta a Gemini sobre un historial ya preparado y la muestra en
   bubbleIA mientras llega. Devuelve el texto completo. */
async function generarEnBurbuja(bubbleIA,historialProcesado,textoUsuario){
  const generator=enviarAGeminiStream(currentCharacter.system_prompt,historialProcesado,textoUsuario,currentCharacter.max_tokens||4096);
  return transmitirStream(bubbleIA,generator);
}
/* Núcleo de enviar y reintentar: carga el historial del chat (resumiéndolo
   si hace falta), genera la respuesta, la guarda y la deja pintada. */
async function responderAlUltimoMensaje(bubbleIA,textoUsuario){
  const{mensajes}=await cargarHistorialCompleto(currentChatId);
  const{historialProcesado,necesitaActualizacion}=await procesarHistorialSiEsNecesario(mensajes);
  if(necesitaActualizacion)await actualizarHistorialChat(currentChatId,historialProcesado);
  const textoCompleto=await generarEnBurbuja(bubbleIA,historialProcesado,textoUsuario);
  if(!textoCompleto.trim())bubbleIA.innerHTML='<em style="color:var(--text-3)">Respuesta vacía</em>';
  const mensajeAssistant=await guardarMensaje(currentChatId,'assistant',textoCompleto);
  bubbleIA.dataset.mensajeId=mensajeAssistant.id;
  bubbleIA.dataset.originalText=textoCompleto;
  bubbleIA.innerHTML=renderMarkdown(textoCompleto);
  agregarBotones(bubbleIA,'assistant');
  return mensajeAssistant;
}
function cerrarRespuestaEnChat(mensajeAssistant,bubbleIA){
  historialTotalMensajes=Math.max(historialTotalMensajes+1,contarMensajesVisibles());
  chatOffset=contarMensajesVisibles();
  renderizarChatPaginado();
  marcarRespuestaIncompleta(mensajeAssistant?.id||bubbleIA.dataset.mensajeId);
  leerRespuestaNueva(mensajeAssistant?.id,mensajeAssistant?.contenido);
}
/* Para regenerar y editar: si se detiene o falla, el chat vuelve a quedar
   exactamente como estaba antes de empezar. Devuelve true si se canceló. */
async function restaurarTrasFallo(err,historialOriginal,contexto){
  if(historialOriginal){
    await actualizarHistorialChat(currentChatId,historialOriginal).catch(()=>{});
    establecerHistorialChat(historialOriginal);
  }
  if(generacionCancelada){
    generacionCancelada=false;
    showToast('⏹️ Generación detenida. La conversación quedó como estaba');
    return true;
  }
  console.error(`Error al ${contexto}:`,err);
  return false;
}

async function reintentarRespuestaAsistente(bubbleIA,textoUsuario){
  if(!currentChatId||isStreaming||!textoUsuario)return;
  if(!getGeminiKey()){showToast('⚠️ Configura tu API Key en Ajustes de Rol (🎭)','error');return}
  empezarGeneracion();
  bubbleIA.className='message-bubble assistant';
  bubbleIA.innerHTML='<div class="typing-indicator"><span></span><span></span><span></span></div>';
  try{
    const mensajeAssistant=await responderAlUltimoMensaje(bubbleIA,textoUsuario);
    const idxUser=historialCompleto.findIndex(m=>m.contenido===textoUsuario&&m.rol==='user');
    if(idxUser!==-1&&historialCompleto[idxUser+1])historialCompleto[idxUser+1]=mensajeAssistant;
    else{
      if(!historialCompleto.some(m=>m.rol==='user'&&m.contenido===textoUsuario))historialCompleto.push({rol:'user',contenido:textoUsuario});
      historialCompleto.push(mensajeAssistant);
    }
    cerrarRespuestaEnChat(mensajeAssistant,bubbleIA);
  }catch(err){
    if(generacionCancelada){generacionCancelada=false;await guardarRespuestaParcial(bubbleIA);return}
    mostrarErrorEnBurbuja(bubbleIA,err,textoUsuario);
  }finally{
    finalizarGeneracionUI();
  }
}
async function enviarMensaje(){
  if(!currentChatId||isStreaming)return;
  const texto=chatInput.value.trim();
  if(!texto)return;
  ultimoMensajeEnviado=texto;
  const MAX_MSG_LENGTH=8000;
  if(texto.length>MAX_MSG_LENGTH){showToast(`Mensaje demasiado largo (máx. ${MAX_MSG_LENGTH} caracteres)`,'error');return}
  if(!getGeminiKey()){showToast('⚠️ Configura tu API Key en Ajustes de Rol (🎭)','error');return}
  detenerDictado();
  document.getElementById('chat-empty')?.remove();
  const userBubble=agregarBubble(texto,'user');
  chatInput.value='';
  chatInput.style.height='auto';
  chatSendBtn.disabled=true;
  try{
    const mensajeUser=await guardarMensaje(currentChatId,'user',texto);
    userBubble.dataset.mensajeId=mensajeUser.id;
    borrarBorrador(currentChatId);
    if(!historialCompleto.some(m=>m.id===mensajeUser.id))historialCompleto.push(mensajeUser);
    historialTotalMensajes=Math.max(historialTotalMensajes+1,contarMensajesVisibles());
  }catch(err){
    showToast('Error al guardar mensaje: '+err.message,'error');
    userBubble.remove();
    isStreaming=false;
    chatInput.value=texto;
    chatInput.style.height='auto';
    chatInput.style.height=Math.min(chatInput.scrollHeight,150)+'px';
    actualizarEstadoBotonEnviar();
    return;
  }
  await fijarVariantesElegidas();
  empezarGeneracion();
  const bubbleIA=agregarBubble('','assistant',true);
  try{
    const mensajeAssistant=await responderAlUltimoMensaje(bubbleIA,texto);
    if(!historialCompleto.some(m=>m.id===mensajeAssistant.id))historialCompleto.push(mensajeAssistant);
    cerrarRespuestaEnChat(mensajeAssistant,bubbleIA);
  }catch(err){
    if(generacionCancelada){generacionCancelada=false;await guardarRespuestaParcial(bubbleIA);return}
    mostrarErrorEnBurbuja(bubbleIA,err,texto);
  }finally{
    finalizarGeneracionUI();
  }
}
function iniciarEdicionMensaje(bubble){if(isStreaming){showToast('Espera a que termine la respuesta actual','error');return}const textoOriginal=bubble.dataset.originalText||'',mensajeId=bubble.dataset.mensajeId;bubble.dataset.backupHTML=bubble.innerHTML;bubble.classList.add('editing');bubble.innerHTML=`<textarea class="edit-textarea">${escapeHtml(textoOriginal)}</textarea><div class="edit-actions"><button type="button" class="edit-cancel">Cancelar</button><button type="button" class="edit-save">Guardar y regenerar</button></div>`;const textarea=bubble.querySelector('.edit-textarea');textarea.focus();textarea.setSelectionRange(textarea.value.length,textarea.value.length);textarea.style.height='auto';textarea.style.height=Math.min(textarea.scrollHeight,200)+'px';textarea.addEventListener('input',()=>{textarea.style.height='auto';textarea.style.height=Math.min(textarea.scrollHeight,200)+'px'})}
function cancelarEdicionMensaje(bubble){bubble.classList.remove('editing');bubble.innerHTML=bubble.dataset.backupHTML||'';delete bubble.dataset.backupHTML}
document.getElementById('chat-messages').addEventListener('click',async e=>{const btnDelMensaje=e.target.closest('.btn-delete-msg');
if(btnDelMensaje){const bubble=btnDelMensaje.closest('.message-bubble'),id=bubble&&bubble.dataset?bubble.dataset.mensajeId:'';if(id&&!isStreaming&&confirm('¿Eliminar este mensaje?')){try{await eliminarMensajeDeChat(currentChatId,id);showToast('🗑️ Mensaje eliminado');const{mensajes}=await cargarHistorialCompleto(currentChatId);establecerHistorialChat(mensajes)}catch(err){showToast(`❌ ${err.message}`,'error')}}return}
const btnVariante=e.target.closest('.btn-variante');if(btnVariante){const b=btnVariante.closest('.message-bubble');if(b&&!btnVariante.disabled)cambiarVariante(b,parseInt(btnVariante.dataset.dir,10)||0);return}const btnContinuar=e.target.closest('.btn-continuar-respuesta');if(btnContinuar){const b=btnContinuar.closest('.message-bubble');if(b)continuarRespuesta(b);return}const btnRetrySend=e.target.closest('.btn-retry-send');if(btnRetrySend){const bubble=btnRetrySend.closest('.message-bubble');if(bubble)reintentarRespuestaAsistente(bubble,ultimoMensajeEnviado);return}const btnRegen=e.target.closest('.btn-regenerate');if(btnRegen){const mensajeId=btnRegen.dataset.mensajeId,bubble=btnRegen.closest('.message-bubble');if(mensajeId&&bubble)regenerarRespuesta(mensajeId,bubble);return}const btnCopy=e.target.closest('.btn-copy');if(btnCopy){const bubble=btnCopy.closest('.message-bubble'),texto=bubble.dataset.originalText||bubble.innerText.replace(/Copiar|Editar|Regenerar|Eliminar|Leer|Detener/g,'').trim();try{await navigator.clipboard.writeText(texto);showToast('📋 Mensaje copiado')}catch(err){showToast('❌ No se pudo copiar','error')}return}const btnEdit=e.target.closest('.btn-edit-msg');if(btnEdit){const bubble=btnEdit.closest('.message-bubble');iniciarEdicionMensaje(bubble);return}const btnSave=e.target.closest('.edit-save');if(btnSave){const bubble=btnSave.closest('.message-bubble');await guardarEdicionMensaje(bubble);return}const btnCancel=e.target.closest('.edit-cancel');if(btnCancel){const bubble=btnCancel.closest('.message-bubble');cancelarEdicionMensaje(bubble)}});
/* Mantiene una única fuente de verdad después de operaciones que reemplazan una
   rama del chat. Las burbujas existentes no deben usarse para reconstruir el
   historial porque la paginación puede haber ocultado parte de la conversación. */
function establecerHistorialChat(historial, opciones = {}) {
  historialCompleto = Array.isArray(historial) ? historial.slice() : [];
  historialTotalMensajes = historialCompleto.filter(m => m.rol === 'user' || m.rol === 'assistant').length;
  historialTieneMas = false;
  historialEsLegacy = false;
  chatOffset = historialTotalMensajes;
  renderizarChatPaginado({ scrollToBottom: opciones.scrollToBottom !== false });
}

/* Versiones atómicas: generan usando una copia y persisten el historial final
   completo una sola vez. Esto evita duplicados y carreras entre el DOM y Supabase. */
/* Regenerar. Si es la última respuesta del chat se añade una VARIANTE nueva
   (estilo Character.AI) y se puede recorrer con ‹ ›; si es una respuesta
   antigua se recorta la rama posterior, como antes. */
async function regenerarRespuesta(mensajeId, bubbleElement) {
  if (isStreaming) { showToast('Espera a que termine la respuesta actual', 'error'); return; }
  if (!getGeminiKey()) { showToast('⚠️ Configura tu API Key en Ajustes de Rol (🎭)', 'error'); return; }
  empezarGeneracion();
  let historialOriginal = null;
  let modoVariante = false;
  try {
    const { mensajes } = await cargarHistorialCompleto(currentChatId);
    const idx = mensajes.findIndex(m => m.id === mensajeId);
    if (idx < 0 || mensajes[idx].rol !== 'assistant') throw new Error('Mensaje no encontrado o inválido');
    const objetivo = mensajes[idx];
    const historialBase = mensajes.slice(0, idx);
    const ultimoUser = historialBase[historialBase.length - 1];
    if (!ultimoUser || ultimoUser.rol !== 'user') throw new Error('No se encontró el mensaje del usuario correspondiente');

    // Solo la última respuesta acumula versiones: en una respuesta antigua no
    // habría forma de saber cuál queda fijada al seguir la conversación.
    modoVariante = idx === mensajes.length - 1;
    if (modoVariante && variantesDe(objetivo).length >= MAX_VARIANTES) {
      showToast(`Esta respuesta ya tiene ${MAX_VARIANTES} versiones. Elige una o edita tu mensaje`, 'error');
      return;
    }
    historialOriginal = copiarHistorial(mensajes);

    if (!modoVariante) {
      // Rama antigua: se descarta esta respuesta y todo lo posterior.
      establecerHistorialChat(historialBase);
      await actualizarHistorialChat(currentChatId, historialBase);
    }

    const { historialProcesado, necesitaActualizacion } = await procesarHistorialSiEsNecesario(historialBase);
    if (necesitaActualizacion && !modoVariante) {
      await actualizarHistorialChat(currentChatId, historialProcesado);
      establecerHistorialChat(historialProcesado);
    }

    const bubbleIA = modoVariante
      ? (bubbleElement || document.querySelector(`.message-bubble[data-mensaje-id="${mensajeId}"]`))
      : agregarBubble('', 'assistant', true);
    if (!bubbleIA) throw new Error('No se encontró la respuesta en pantalla');
    bubbleIA.className = 'message-bubble assistant';

    const textoCompleto = await generarEnBurbuja(bubbleIA, historialProcesado, ultimoUser.contenido);
    if (!textoCompleto.trim()) throw new Error('Gemini no generó ninguna respuesta');

    if (modoVariante) {
      // La respuesta ya existe: se le añade la versión nueva y pasa a ser la
      // activa. No se reescribe el historial para no perder las anteriores.
      const enMemoria = historialCompleto.find(m => String(m.id) === String(mensajeId)) || objetivo;
      const lista = variantesDe(enMemoria).slice();
      lista.push(textoCompleto);
      enMemoria.variantes = lista;
      enMemoria.variante_activa = lista.length - 1;
      enMemoria.contenido = textoCompleto;
      await persistirVariantes(enMemoria);
      actualizarBubbleVariante(bubbleIA, enMemoria);
      marcarRespuestaIncompleta(mensajeId);
      leerRespuestaNueva(mensajeId, textoCompleto);
      showToast(`✅ Versión ${lista.length} generada · usa ‹ › para comparar`);
    } else {
      const nuevoMensaje = { id: nuevoIdMensaje(), rol: 'assistant', contenido: textoCompleto };
      const historialFinal = [...historialProcesado, nuevoMensaje];
      await actualizarHistorialChat(currentChatId, historialFinal);
      establecerHistorialChat(historialFinal);
      marcarRespuestaIncompleta(nuevoMensaje.id);
      leerRespuestaNueva(nuevoMensaje.id, textoCompleto);
      showToast('✅ Respuesta regenerada');
    }
  } catch (err) {
    if (await restaurarTrasFallo(err, historialOriginal, 'regenerar')) return;
    if (esErrorRateLimit(err)) mostrarErrorRateLimit(null, err.message, 'regenerate', { mensajeId, bubbleElement: document.querySelector(`[data-mensaje-id="${mensajeId}"]`) });
    else showToast(`❌ ${err.message}`, 'error');
  } finally {
    finalizarGeneracionUI();
  }
}

async function guardarEdicionMensaje(bubble) {
  if (isStreaming) return;
  const textarea = bubble.querySelector('.edit-textarea');
  const nuevoTexto = textarea?.value.trim();
  const mensajeId = bubble.dataset.mensajeId;
  if (!nuevoTexto) { showToast('El mensaje no puede estar vacío', 'error'); return; }
  if (!getGeminiKey()) { showToast('⚠️ Configura tu API Key en Ajustes de Rol (🎭)', 'error'); return; }
  empezarGeneracion();
  let historialOriginal = null;
  try {
    const { mensajes } = await cargarHistorialCompleto(currentChatId);
    const idx = mensajes.findIndex(m => m.id === mensajeId);
    if (idx < 0 || mensajes[idx].rol !== 'user') throw new Error('Mensaje no encontrado o inválido');
    historialOriginal = copiarHistorial(mensajes);
    const nuevoMsg = { id: nuevoIdMensaje(), rol: 'user', contenido: nuevoTexto };
    const historialBase = [...mensajes.slice(0, idx), nuevoMsg];
    // Confirma visualmente la edición y elimina la respuesta anterior antes
    // de empezar el streaming.
    establecerHistorialChat(historialBase);
    await actualizarHistorialChat(currentChatId, historialBase);
    const { historialProcesado, necesitaActualizacion } = await procesarHistorialSiEsNecesario(historialBase);
    if (necesitaActualizacion) {
      await actualizarHistorialChat(currentChatId, historialProcesado);
      establecerHistorialChat(historialProcesado);
    }
    const bubbleIA = agregarBubble('', 'assistant', true);
    const textoCompleto = await generarEnBurbuja(bubbleIA, historialProcesado, nuevoTexto);
    if (!textoCompleto.trim()) throw new Error('Gemini no generó ninguna respuesta');
    const mensajeAssistant = { id: nuevoIdMensaje(), rol: 'assistant', contenido: textoCompleto };
    const historialFinal = [...historialProcesado, mensajeAssistant];
    await actualizarHistorialChat(currentChatId, historialFinal);
    establecerHistorialChat(historialFinal);
    marcarRespuestaIncompleta(mensajeAssistant.id);
    leerRespuestaNueva(mensajeAssistant.id, textoCompleto);
    showToast('✅ Mensaje editado y respuesta regenerada');
  } catch (err) {
    if (await restaurarTrasFallo(err, historialOriginal, 'editar')) return;
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    finalizarGeneracionUI();
  }
}

const authScreen=document.getElementById('auth-screen'),dashboard=document.getElementById('dashboard');

// Iniciar comprobación de sesión inmediatamente
window.addEventListener('DOMContentLoaded', () => {
  initApp();
});

