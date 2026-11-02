/* SAIR · Animación de entrada, Lorebook, contador de uso, borradores y voz.
   Se carga en orden desde index.html: los archivos comparten el ámbito global. */
// ===== Animación de entrada (reemplaza a la antigua pantalla de carga) =====
// Un velo con la marca SAIR4 entra, brilla y se desliza hacia arriba
// revelando la app, cuyas vistas aparecen con animaciones escalonadas.
const INTRO_LIMPIEZA_MS=2600;
/* Fuerza a Chrome a repintar toda la página. En algunos Android la app quedaba
   en negro hasta que algo obligaba a repintar (p. ej. cambiar el modo visual). */
function forzarRepintado(){
  try{requestAnimationFrame(()=>{document.body.style.opacity='0.999';requestAnimationFrame(()=>{document.body.style.opacity=''})})}catch(e){}
}
(function iniciarEntrada(){
  try{
    const veil=document.getElementById('intro-veil');
    // En modo ligero las animaciones están desactivadas: el velo no se movería
    // y solo dejaría la pantalla en negro 2,6 s. Se quita al momento.
    if(document.body.classList.contains('performance-light')){veil?.remove();forzarRepintado();return}
    document.body.classList.add('intro-anim');
    if(veil){
      let retirado=false;
      const retirar=()=>{if(!retirado){retirado=true;veil.remove();forzarRepintado()}};
      veil.addEventListener('animationend',e=>{if(e.target===veil&&e.animationName==='veilExit')retirar()});
      setTimeout(retirar,INTRO_LIMPIEZA_MS);
    }
    setTimeout(()=>document.body.classList.remove('intro-anim'),INTRO_LIMPIEZA_MS);
  }catch(err){console.warn('⚠️ No se pudo iniciar la animación de entrada:',err)}
})();

/* ── Lorebook: memoria del mundo ──
   Fichas de cada usuario para un personaje (lugares, personajes
   secundarios, reglas, objetos...). Una ficha entra en el prompt solo
   cuando alguna de sus palabras clave aparece en los últimos mensajes, o
   siempre si está marcada así. Así la IA recuerda el mundo sin gastar
   tokens en lo que no viene a cuento. */
const LOREBOOK_LOCAL_PREFIX='sair1_lorebook_';
const LOREBOOK_MAX_ENTRADAS=60;
const LOREBOOK_MAX_CARACTERES_PROMPT=4000;
const LOREBOOK_MENSAJES_ESCANEADOS=6;
const lore={personajeId:null,entradas:[],enNube:true,editandoId:null};
function normalizarParaBuscar(t){return String(t||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')}
function clavesDeTexto(t){return[...new Set(String(t||'').split(',').map(c=>c.trim()).filter(c=>c.length>=2))].slice(0,20)}
function leerLorebookLocal(personajeId){try{const d=JSON.parse(localStorage.getItem(LOREBOOK_LOCAL_PREFIX+personajeId)||'[]');return Array.isArray(d)?d:[]}catch{return[]}}
function guardarLorebookLocal(personajeId,entradas){try{localStorage.setItem(LOREBOOK_LOCAL_PREFIX+personajeId,JSON.stringify(entradas))}catch{throw new Error('No hay espacio en el navegador para guardar el Lorebook')}}
async function cargarLorebook(personajeId){
  lore.personajeId=personajeId;lore.entradas=[];
  if(!personajeId||!currentUser)return;
  if(lore.enNube){
    const{data,error}=await sbClient.from('lorebook_entradas').select('id,nombre,claves,contenido,siempre,activa,creado_en').eq('user_id',currentUser.id).eq('personaje_id',personajeId).order('creado_en',{ascending:true});
    if(lore.personajeId!==personajeId)return;
    if(!error){lore.entradas=data||[];return}
    if(esErrorTablaInexistente(error))lore.enNube=false;
    else console.warn('⚠️ No se pudo cargar el Lorebook:',error.message);
  }
  lore.entradas=leerLorebookLocal(personajeId);
}
// Entradas que tocan ahora: las "siempre" y las mencionadas recientemente.
function entradasLorebookActivas(mensajes,nuevoMensaje){
  const activas=lore.entradas.filter(e=>e.activa!==false);
  if(!activas.length)return[];
  const reciente=normalizarParaBuscar([...(mensajes||[]).slice(-LOREBOOK_MENSAJES_ESCANEADOS).map(m=>m.contenido),nuevoMensaje].join('\n'));
  const menciona=clave=>{
    const c=normalizarParaBuscar(clave).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return c&&new RegExp(`(^|[^a-z0-9ñ])${c}($|[^a-z0-9ñ])`).test(reciente);
  };
  const siempre=activas.filter(e=>e.siempre);
  const mencionadas=activas.filter(e=>!e.siempre&&(e.claves||[]).some(menciona));
  const elegidas=[];let total=0;
  for(const e of[...siempre,...mencionadas]){
    const largo=e.nombre.length+e.contenido.length+4;
    if(total+largo>LOREBOOK_MAX_CARACTERES_PROMPT)continue;
    elegidas.push(e);total+=largo;
  }
  return elegidas;
}
function anexarLorebookAlPrompt(mensajes,nuevoMensaje,systemPrompt){
  const entradas=entradasLorebookActivas(mensajes,nuevoMensaje);
  if(!entradas.length)return systemPrompt;
  const fichas=entradas.map(e=>`• ${e.nombre}: ${e.contenido}`).join('\n');
  return `${systemPrompt}\n\n[LOREBOOK · MEMORIA DEL MUNDO]\nDatos canónicos del mundo que vienen a cuento en este momento de la historia. Son verdad dentro del rol: respétalos y úsalos con naturalidad, sin mencionar que existe un lorebook:\n${fichas}\n[FIN DEL LOREBOOK]`;
}
async function guardarEntradaLorebook(datos){
  const personajeId=lore.personajeId;if(!personajeId)throw new Error('Abre un chat primero');
  const fila={nombre:datos.nombre.trim().slice(0,80),claves:clavesDeTexto(datos.claves),contenido:datos.contenido.trim().slice(0,1500),siempre:!!datos.siempre,activa:datos.activa!==false};
  if(!fila.nombre||!fila.contenido)throw new Error('La ficha necesita nombre y contenido');
  if(!fila.siempre&&!fila.claves.length)throw new Error('Añade al menos una palabra clave o marca "Siempre activa"');
  if(!datos.id&&lore.entradas.length>=LOREBOOK_MAX_ENTRADAS)throw new Error(`Máximo ${LOREBOOK_MAX_ENTRADAS} fichas por personaje`);
  if(lore.enNube){
    const r=datos.id
      ?await sbClient.from('lorebook_entradas').update({...fila,actualizado_en:new Date().toISOString()}).eq('id',datos.id).eq('user_id',currentUser.id).select('id,nombre,claves,contenido,siempre,activa,creado_en').single()
      :await sbClient.from('lorebook_entradas').insert({...fila,user_id:currentUser.id,personaje_id:personajeId}).select('id,nombre,claves,contenido,siempre,activa,creado_en').single();
    if(!r.error){
      if(datos.id)lore.entradas=lore.entradas.map(e=>e.id===datos.id?r.data:e);else lore.entradas.push(r.data);
      return;
    }
    if(!esErrorTablaInexistente(r.error))throw new Error(r.error.message);
    lore.enNube=false;lore.entradas=leerLorebookLocal(personajeId);
  }
  if(datos.id)lore.entradas=lore.entradas.map(e=>e.id===datos.id?{...e,...fila}:e);
  else lore.entradas.push({...fila,id:'local-'+Date.now().toString(36),creado_en:new Date().toISOString()});
  guardarLorebookLocal(personajeId,lore.entradas);
}
async function borrarEntradaLorebook(id){
  if(lore.enNube&&!String(id).startsWith('local-')){
    const{error}=await sbClient.from('lorebook_entradas').delete().eq('id',id).eq('user_id',currentUser.id);
    if(error)throw new Error(error.message);
  }
  lore.entradas=lore.entradas.filter(e=>e.id!==id);
  if(!lore.enNube)guardarLorebookLocal(lore.personajeId,lore.entradas);
}
/* Interfaz */
function pintarLorebook(){
  const lista=document.getElementById('lorebook-lista');if(!lista)return;
  document.getElementById('lorebook-estado').textContent=lore.enNube?'☁️ Se guarda en tu cuenta.':'💾 Se guarda solo en este navegador (falta ejecutar supabase_comunidad_v2.sql).';
  document.getElementById('lorebook-contador').textContent=`${lore.entradas.length}/${LOREBOOK_MAX_ENTRADAS}`;
  if(!lore.entradas.length){lista.innerHTML='<p class="lorebook-vacio">Aún no hay fichas. Crea una para lugares, personajes secundarios, reglas del mundo u objetos importantes.</p>';return}
  lista.innerHTML=lore.entradas.map(e=>`<div class="lorebook-item${e.activa===false?' inactiva':''}" data-id="${escapeHtml(e.id)}">
<div class="lorebook-item-cabecera"><strong>${escapeHtml(e.nombre)}</strong>${e.siempre?'<span class="lorebook-siempre">Siempre activa</span>':''}</div>
${(e.claves||[]).length?`<div class="lorebook-claves">${e.claves.map(c=>`<span>${escapeHtml(c)}</span>`).join('')}</div>`:''}
<p class="lorebook-contenido">${escapeHtml(e.contenido)}</p>
<div class="lorebook-acciones"><button type="button" class="btn btn-ghost btn-small" data-accion="alternar">${e.activa===false?'▶️ Activar':'⏸️ Pausar'}</button><button type="button" class="btn btn-ghost btn-small" data-accion="editar">✏️ Editar</button><button type="button" class="btn btn-danger btn-small" data-accion="borrar">🗑️</button></div>
</div>`).join('');
}
function mostrarFormularioLorebook(entrada=null){
  lore.editandoId=entrada?.id||null;
  const f=document.getElementById('lorebook-form');
  f.hidden=false;document.getElementById('lorebook-nueva').hidden=true;
  document.getElementById('lorebook-form-titulo').textContent=entrada?'Editar ficha':'Nueva ficha';
  document.getElementById('lorebook-nombre').value=entrada?.nombre||'';
  document.getElementById('lorebook-claves').value=(entrada?.claves||[]).join(', ');
  document.getElementById('lorebook-texto').value=entrada?.contenido||'';
  document.getElementById('lorebook-siempre').checked=!!entrada?.siempre;
  document.getElementById('lorebook-nombre').focus();
}
function ocultarFormularioLorebook(){lore.editandoId=null;document.getElementById('lorebook-form').hidden=true;document.getElementById('lorebook-nueva').hidden=false}
async function abrirLorebook(){
  if(!currentCharacter){showToast('Abre un chat primero','error');return}
  document.getElementById('lorebook-personaje').textContent=currentCharacter.nombre;
  ocultarFormularioLorebook();
  if(lore.personajeId!==currentCharacter.id)await cargarLorebook(currentCharacter.id);
  pintarLorebook();
  openModal('lorebook-modal');
}
document.getElementById('chat-lorebook-btn')?.addEventListener('click',abrirLorebook);
document.getElementById('lorebook-nueva')?.addEventListener('click',()=>mostrarFormularioLorebook());
document.getElementById('lorebook-cancelar')?.addEventListener('click',ocultarFormularioLorebook);
document.getElementById('lorebook-form')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const btn=e.target.querySelector('button[type="submit"]');btn.disabled=true;
  try{
    const previa=lore.entradas.find(x=>x.id===lore.editandoId);
    await guardarEntradaLorebook({id:lore.editandoId,nombre:document.getElementById('lorebook-nombre').value,claves:document.getElementById('lorebook-claves').value,contenido:document.getElementById('lorebook-texto').value,siempre:document.getElementById('lorebook-siempre').checked,activa:previa?previa.activa!==false:true});
    ocultarFormularioLorebook();pintarLorebook();showToast('📚 Ficha guardada');
  }catch(err){showToast(`❌ ${err.message}`,'error')}
  finally{btn.disabled=false}
});
document.getElementById('lorebook-lista')?.addEventListener('click',async e=>{
  const b=e.target.closest('button[data-accion]');if(!b)return;
  const id=b.closest('.lorebook-item')?.dataset.id;const entrada=lore.entradas.find(x=>String(x.id)===id);if(!entrada)return;
  try{
    if(b.dataset.accion==='editar'){mostrarFormularioLorebook(entrada);return}
    if(b.dataset.accion==='borrar'){if(!confirm(`¿Borrar la ficha «${entrada.nombre}»?`))return;await borrarEntradaLorebook(entrada.id)}
    if(b.dataset.accion==='alternar')await guardarEntradaLorebook({...entrada,claves:(entrada.claves||[]).join(','),activa:entrada.activa===false});
    pintarLorebook();
  }catch(err){showToast(`❌ ${err.message}`,'error')}
});

/* ── Contador de uso de la API de Gemini ──
   Cada respuesta de Gemini trae usageMetadata (tokens de entrada y de
   salida). Se suman por chat y por día, solo en este navegador, para que
   sepas cuánto gastas de tu cuota. En streaming los totales llegan
   acumulados, así que se suma solo la diferencia con el último aviso. */
const USO_CHAT_PREFIX='sair1_uso_chat_';
const USO_DIA_KEY='sair1_uso_dia';
let usoSiguienteId=0;
const usoPeticiones=new Map();
function fechaLocalHoy(){const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function leerUso(clave){try{const u=JSON.parse(localStorage.getItem(clave)||'null');return u&&typeof u==='object'?u:null}catch{return null}}
function usoVacio(extra={}){return{entrada:0,salida:0,peticiones:0,...extra}}
function leerUsoDia(){const u=leerUso(USO_DIA_KEY);return u&&u.fecha===fechaLocalHoy()?u:usoVacio({fecha:fechaLocalHoy()})}
function leerUsoChat(chatId){return(chatId&&leerUso(USO_CHAT_PREFIX+chatId))||usoVacio()}
function sumarUso(chatId,entrada,salida,peticion){
  const sumar=u=>{u.entrada+=entrada;u.salida+=salida;if(peticion)u.peticiones+=1;return u};
  try{
    localStorage.setItem(USO_DIA_KEY,JSON.stringify(sumar(leerUsoDia())));
    if(chatId)localStorage.setItem(USO_CHAT_PREFIX+chatId,JSON.stringify(sumar(leerUsoChat(chatId))));
  }catch{}
  actualizarIndicadorUso();
}
function iniciarPeticionUso(){const id=++usoSiguienteId;usoPeticiones.set(id,{chatId:currentChatId,entrada:0,salida:0,contada:false});return id}
function anotarUso(id,meta){
  const p=usoPeticiones.get(id);if(!p||!meta)return;
  const entrada=Number(meta.promptTokenCount)||0;
  const salida=(Number(meta.candidatesTokenCount)||0)+(Number(meta.thoughtsTokenCount)||0);
  const dE=Math.max(0,entrada-p.entrada),dS=Math.max(0,salida-p.salida);
  if(!dE&&!dS&&p.contada)return;
  sumarUso(p.chatId,dE,dS,!p.contada);
  p.entrada=Math.max(p.entrada,entrada);p.salida=Math.max(p.salida,salida);p.contada=true;
  if(usoPeticiones.size>50)usoPeticiones.delete(usoPeticiones.keys().next().value);
}
// Peticiones sin streaming (resúmenes, generar personaje…).
function anotarUsoUnico(meta){if(meta)anotarUso(iniciarPeticionUso(),meta)}
function formatoTokens(n){try{return new Intl.NumberFormat('es',{notation:'compact',maximumFractionDigits:1}).format(n)}catch{return String(n)}}
function actualizarIndicadorUso(){
  const el=document.getElementById('chat-uso-indicator');if(!el)return;
  const u=leerUsoChat(currentChatId),total=u.entrada+u.salida;
  el.textContent=total?`🔢 ${formatoTokens(total)} tokens`:'🔢 Uso';
  el.title=total?`Este chat: ${u.peticiones} respuestas · ${total.toLocaleString('es')} tokens. Pulsa para ver el detalle.`:'Uso de tu API Key en este chat';
}
function abrirUso(){
  const c=leerUsoChat(currentChatId),d=leerUsoDia();
  const fila=(t,v)=>`<div class="uso-fila"><span>${t}</span><strong>${v}</strong></div>`;
  document.getElementById('uso-detalle').innerHTML=`
<h3 class="uso-titulo">Este chat</h3>${fila('Respuestas y peticiones',c.peticiones.toLocaleString('es'))}${fila('Tokens enviados (contexto)',c.entrada.toLocaleString('es'))}${fila('Tokens generados',c.salida.toLocaleString('es'))}
<h3 class="uso-titulo">Hoy, en todos tus chats</h3>${fila('Peticiones',d.peticiones.toLocaleString('es'))}${fila('Tokens enviados',d.entrada.toLocaleString('es'))}${fila('Tokens generados',d.salida.toLocaleString('es'))}
<p class="uso-nota">Modelo actual: <strong>${escapeHtml(getGeminiModel())}</strong>. El nivel gratuito de Gemini limita las peticiones por minuto y por día según el modelo; consulta tus límites en Google AI Studio. Los datos son aproximados y se guardan solo en este navegador.</p>`;
  openModal('uso-modal');
}
document.getElementById('chat-uso-indicator')?.addEventListener('click',abrirUso);
document.getElementById('chat-uso-indicator')?.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();abrirUso()}});
document.getElementById('uso-reiniciar')?.addEventListener('click',()=>{
  if(!confirm('¿Poner a cero los contadores de este chat y de hoy?'))return;
  try{if(currentChatId)localStorage.removeItem(USO_CHAT_PREFIX+currentChatId);localStorage.removeItem(USO_DIA_KEY)}catch{}
  actualizarIndicadorUso();abrirUso();
});

/* ── Borradores ──
   Lo que escribes en un chat se guarda en este navegador mientras escribes
   y vuelve a aparecer al abrir ese chat. Se borra al enviar el mensaje. */
const BORRADOR_PREFIX='sair1_borrador_';
let borradorTimer=null;
function guardarBorradorAhora(){
  clearTimeout(borradorTimer);borradorTimer=null;
  if(!currentChatId)return;
  try{
    const t=chatInput.value;
    if(t.trim())localStorage.setItem(BORRADOR_PREFIX+currentChatId,JSON.stringify({t:t.slice(0,8000),f:Date.now()}));
    else localStorage.removeItem(BORRADOR_PREFIX+currentChatId);
  }catch{}
}
function borrarBorrador(chatId){
  clearTimeout(borradorTimer);borradorTimer=null;
  try{localStorage.removeItem(BORRADOR_PREFIX+chatId)}catch{}
}
function restaurarBorrador(chatId){
  let t='';
  try{const raw=localStorage.getItem(BORRADOR_PREFIX+chatId);if(raw)t=JSON.parse(raw).t||''}catch{}
  chatInput.value=t;
  chatInput.style.height='auto';
  if(t)chatInput.style.height=Math.min(chatInput.scrollHeight,150)+'px';
  actualizarEstadoBotonEnviar();
  if(t)showToast('📝 Recuperado lo que dejaste escrito');
}
chatInput.addEventListener('input',()=>{clearTimeout(borradorTimer);borradorTimer=setTimeout(guardarBorradorAhora,400)});
window.addEventListener('pagehide',guardarBorradorAhora);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')guardarBorradorAhora()});

/* ── Voz: lectura en voz alta y dictado ──
   Usa las voces del propio navegador (speechSynthesis) y su reconocimiento
   de voz (SpeechRecognition). No se envía nada a servidores de SAIR y no
   cuesta nada. Si el navegador no lo soporta, los botones no aparecen. */
const VOZ_LS={AUTO:'sair1_voz_auto',VOZ:'sair1_voz_nombre',VEL:'sair1_voz_velocidad'};
const vozDisponible='speechSynthesis' in window&&'SpeechSynthesisUtterance' in window;
const Reconocimiento=window.SpeechRecognition||window.webkitSpeechRecognition||null;
const ICONO_ALTAVOZ='<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>';
const ICONO_DETENER_VOZ='<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>';
const voz={burbuja:null,sesion:0};
function vozConfig(){
  return{auto:localStorage.getItem(VOZ_LS.AUTO)==='true',nombre:localStorage.getItem(VOZ_LS.VOZ)||'',velocidad:Math.min(1.6,Math.max(0.6,parseFloat(localStorage.getItem(VOZ_LS.VEL))||1))};
}
function vocesEspanol(){
  if(!vozDisponible)return[];
  const todas=speechSynthesis.getVoices();
  const es=todas.filter(v=>/^es([-_]|$)/i.test(v.lang));
  return es.length?es:todas;
}
function elegirVoz(){
  const{nombre}=vozConfig(),vs=vocesEspanol();
  return vs.find(v=>v.name===nombre)||vs.find(v=>/^es[-_](MX|US|419)/i.test(v.lang))||vs.find(v=>/^es/i.test(v.lang))||vs[0]||null;
}
// Quita el formato Markdown para que no se lean asteriscos ni almohadillas.
function textoParaVoz(texto){
  return reemplazarUserEnTexto(String(texto||''))
    .replace(/```[\s\S]*?```/g,' ')
    .replace(/\{\{\s*(user|char)\s*\}\}/gi,'')
    .replace(/\[([^\]]+)\]\([^)]+\)/g,'$1')
    .replace(/[*_~`#>|]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}
// Trozos cortos: Chrome corta las frases largas a los ~15 s.
function trocearParaVoz(texto,max=220){
  const frases=texto.match(/[^.!?…]+[.!?…]+["»”)]*|[^.!?…]+$/g)||[];
  const trozos=[];
  for(let f of frases){
    f=f.trim();
    while(f.length>max){
      let corte=f.lastIndexOf(',',max);
      if(corte<max*0.4)corte=f.lastIndexOf(' ',max);
      if(corte<=0)corte=max;
      trozos.push(f.slice(0,corte+1).trim());
      f=f.slice(corte+1).trim();
    }
    if(f)trozos.push(f);
  }
  return trozos;
}
function actualizarBotonLeer(bubble,activo){
  const btn=bubble?.querySelector('.btn-leer');if(!btn)return;
  btn.innerHTML=activo?`${ICONO_DETENER_VOZ}Detener`:`${ICONO_ALTAVOZ}Leer`;
  btn.setAttribute('aria-pressed',activo?'true':'false');
  btn.classList.toggle('leyendo',activo);
}
function detenerLectura(){
  voz.sesion++;
  if(vozDisponible){try{speechSynthesis.cancel()}catch{}}
  if(voz.burbuja){actualizarBotonLeer(voz.burbuja,false);voz.burbuja=null}
}
function leerEnVozAlta(texto,bubble=null){
  if(!vozDisponible)return;
  detenerLectura();
  const partes=trocearParaVoz(textoParaVoz(texto));
  if(!partes.length)return;
  const sesion=voz.sesion,{velocidad}=vozConfig(),v=elegirVoz();
  voz.burbuja=bubble;
  actualizarBotonLeer(bubble,true);
  const siguiente=i=>{
    if(sesion!==voz.sesion)return;
    if(i>=partes.length){actualizarBotonLeer(voz.burbuja,false);voz.burbuja=null;return}
    const u=new SpeechSynthesisUtterance(partes[i]);
    if(v){u.voice=v;u.lang=v.lang}else u.lang='es-ES';
    u.rate=velocidad;
    u.onend=()=>siguiente(i+1);
    u.onerror=e=>{if(!['interrupted','canceled'].includes(e.error))console.warn('⚠️ Voz:',e.error);siguiente(i+1)};
    speechSynthesis.speak(u);
  };
  siguiente(0);
}
// Lectura automática de las respuestas nuevas (opción de Ajustes).
function leerRespuestaNueva(mensajeId,texto){
  if(!vozDisponible||!vozConfig().auto||!texto?.trim())return;
  const bubble=document.querySelector(`.message-bubble[data-mensaje-id="${CSS.escape(String(mensajeId||''))}"]`);
  leerEnVozAlta(texto,bubble);
}
document.getElementById('chat-messages')?.addEventListener('click',e=>{
  const btn=e.target.closest('.btn-leer');if(!btn)return;
  e.stopPropagation();
  const bubble=btn.closest('.message-bubble');
  if(voz.burbuja===bubble){detenerLectura();return}
  leerEnVozAlta(bubble.dataset.originalText||'',bubble);
});
window.addEventListener('pagehide',detenerLectura);

/* Ajustes de voz */
function rellenarVoces(){
  const sel=document.getElementById('voz-voz');if(!sel)return;
  const vs=vocesEspanol(),actual=elegirVoz();
  sel.innerHTML=vs.length?vs.map(v=>`<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)} (${escapeHtml(v.lang)})</option>`).join(''):'<option value="">Voz predeterminada</option>';
  if(actual)sel.value=actual.name;
}
(function iniciarAjustesVoz(){
  const seccion=document.getElementById('voz-section');if(!seccion)return;
  if(!vozDisponible){
    seccion.querySelector('.voz-controles').hidden=true;
    document.getElementById('voz-nota').textContent='Tu navegador no permite leer en voz alta.';
  }else{
    const cfg=vozConfig(),auto=document.getElementById('voz-auto'),vel=document.getElementById('voz-velocidad'),valor=document.getElementById('voz-velocidad-valor');
    auto.checked=cfg.auto;vel.value=String(cfg.velocidad);valor.textContent=cfg.velocidad.toFixed(1)+'×';
    auto.addEventListener('change',()=>{localStorage.setItem(VOZ_LS.AUTO,auto.checked?'true':'false');if(!auto.checked)detenerLectura()});
    vel.addEventListener('input',()=>{valor.textContent=parseFloat(vel.value).toFixed(1)+'×';localStorage.setItem(VOZ_LS.VEL,vel.value)});
    document.getElementById('voz-voz').addEventListener('change',e=>localStorage.setItem(VOZ_LS.VOZ,e.target.value));
    document.getElementById('voz-probar').addEventListener('click',()=>leerEnVozAlta('Hola, soy la voz que leerá las respuestas de tus personajes.'));
    rellenarVoces();
    speechSynthesis.addEventListener?.('voiceschanged',rellenarVoces);
  }
  if(!Reconocimiento)document.getElementById('voz-nota').textContent+=' El dictado por voz no está disponible en este navegador (prueba Chrome o Edge).';
})();

/* Dictado: el micrófono escribe en el cuadro de texto. En Android el modo
   continuo repite frases, así que allí se dicta frase a frase. */
let dictado=null;
const micBtn=document.getElementById('chat-mic-btn');
if(Reconocimiento&&micBtn)micBtn.hidden=false;
function actualizarBotonMic(activo){
  if(!micBtn)return;
  micBtn.classList.toggle('escuchando',activo);
  micBtn.setAttribute('aria-pressed',activo?'true':'false');
  micBtn.title=activo?'Dejar de dictar':'Dictar por voz';
  micBtn.setAttribute('aria-label',micBtn.title);
}
function detenerDictado(){if(dictado){try{dictado.abort()}catch{}dictado=null;actualizarBotonMic(false)}}
function alternarDictado(){
  if(dictado){dictado.stop();return}
  if(!Reconocimiento)return;
  detenerLectura();
  const rec=new Reconocimiento();
  rec.lang=/^es/i.test(navigator.language||'')?navigator.language:'es-ES';
  rec.interimResults=true;
  rec.continuous=!/Android/i.test(navigator.userAgent);
  const base=chatInput.value,sep=base&&!/\s$/.test(base)?' ':'';
  rec.onresult=e=>{
    let dicho='';
    for(let i=0;i<e.results.length;i++)dicho+=e.results[i][0].transcript;
    chatInput.value=(base+sep+dicho.replace(/\s+/g,' ').trim()).slice(0,8000);
    chatInput.dispatchEvent(new Event('input',{bubbles:true}));
  };
  rec.onerror=e=>{
    const avisos={'not-allowed':'Permite el acceso al micrófono para dictar','service-not-allowed':'Permite el acceso al micrófono para dictar','network':'El dictado necesita conexión y un navegador compatible (Chrome o Edge)','no-speech':'No se oyó nada. Inténtalo de nuevo','audio-capture':'No se encontró ningún micrófono'};
    if(avisos[e.error])showToast('🎤 '+avisos[e.error],'error');
  };
  rec.onend=()=>{if(dictado===rec){dictado=null;actualizarBotonMic(false)}chatInput.focus()};
  try{rec.start();dictado=rec;actualizarBotonMic(true)}
  catch(err){console.warn('⚠️ Dictado:',err);showToast('🎤 No se pudo iniciar el dictado','error')}
}
micBtn?.addEventListener('click',alternarDictado);

