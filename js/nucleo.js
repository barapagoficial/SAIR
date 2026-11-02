/* SAIR · Configuración, cliente de Supabase, utilidades y peticiones a Gemini.
   Se carga en orden desde index.html: los archivos comparten el ámbito global. */
const CONFIG={SUPABASE_URL:'https://tcnzimhqjyivlrvqzwpb.supabase.co',SUPABASE_ANON_KEY:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjbnppbWhxanlpdmxydnF6d3BiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MTU3OTMsImV4cCI6MjA5ODA5MTc5M30.W9xY20IiIrkQHOsZYJNxrcE6tJ7WK-uE0cRiJNpMGqk',LS:{THEME:'sair1_theme',GEMINI_KEY:'sair1_gemini_key',GEMINI_MODEL:'sair1_gemini_model',DISPLAY_MODE:'sair1_display_mode'}};
let sbClient=null,currentUser=null,userRole=null,userUsername=null,userDescription='',userAvatarUrl=null,userRoleName=null,userAvatarPos={x:50,y:50},userBackgroundUrl=null,userBackgroundPos={x:50,y:50},currentView='my-characters',currentCharacter=null,currentChatId=null,isStreaming=!1,rateLimitTimer=null,rateLimitCountdown=0,pendingAction=null,pendingData=null,lastGeminiFinishReason='';

// Crear el cliente Supabase inmediatamente al cargar el script
// para que los tokens de sesión en localStorage estén disponibles desde el inicio
if(window.supabase?.createClient){
  sbClient=window.supabase.createClient(CONFIG.SUPABASE_URL,CONFIG.SUPABASE_ANON_KEY,{
    auth:{
      persistSession:true,
      autoRefreshToken:true,
      detectSessionInUrl:true,
      storage:window.localStorage
    }
  });
  console.log('✅ Supabase client creado al inicio');
}
let historialCompleto=[];
let chatOffset=0;
let historialTotalMensajes=0,historialTieneMas=false,historialCargandoMas=false,historialEsLegacy=false;
const CHAT_LIMITE=30;
/* ── Variantes de respuesta (estilo Character.AI) ──
   Columnas que se piden a la tabla mensajes y tope de versiones por
   respuesta. variantesEnNube pasa a false si la migración SQL todavía no se
   ha ejecutado: entonces las variantes viven solo en memoria. */
const COLS_MENSAJE_BASE='id,rol,contenido,creado_en,orden';
const COLS_MENSAJE_VARIANTES=COLS_MENSAJE_BASE+',variantes,variante_activa';
const MAX_VARIANTES=20;
let variantesEnNube=true;
let titulosEnNube=true;
let chatsCache=[];
let filtroChats='';
/* ── Respuestas incompletas: continuación automática del stream ── */
const MAX_CONTINUACIONES_AUTO=3;
const LIMITE_CARACTERES_AUTO=40000;
const PREFIJO_BUFFER_CONTINUACION=400;
const INSTRUCCION_CONTINUACION='[SISTEMA · CONTINUACIÓN OBLIGATORIA] Tu mensaje anterior quedó cortado a la mitad. Continúa EXACTAMENTE desde el punto donde se interrumpió: no repitas nada de lo ya escrito, no saludes, no resumas, no añadas preámbulos ni aclaraciones y no cierres la escena si todavía queda desarrollo. Mantén el mismo estilo, formato y narración.';
let motivoIncompletaUltimaGeneracion=null;
const respuestasIncompletas=new Map();

const AURA_COLORS=['#ff4d8f','#4d79ff','#a855f7','#10b981','#f97316','#eab308'];
let scrollChatPending=false;
function sanitizeThemeColor(color){return AURA_COLORS.includes(color)?color:'#ff4d8f'}
function scrollChatToBottom(force=false){const messages=document.getElementById('chat-messages');if(!messages)return;if(force){messages.scrollTop=messages.scrollHeight;return}if(scrollChatPending)return;scrollChatPending=true;requestAnimationFrame(()=>{messages.scrollTop=messages.scrollHeight;scrollChatPending=false})}
function registrarServiceWorker(){if(!('serviceWorker' in navigator))return;const register=()=>navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>{console.log('✅ Service Worker registrado:',reg.scope);reg.addEventListener('updatefound',()=>{const nuevo=reg.installing;if(!nuevo)return;nuevo.addEventListener('statechange',()=>{if(nuevo.state==='installed'&&navigator.serviceWorker.controller){navigator.serviceWorker.addEventListener('controllerchange',()=>{aplicarActualizacionNueva()},{once:true})}})})}).catch(err=>console.error('❌ Falló el registro del Service Worker:',err));if(document.readyState==='complete')register();else window.addEventListener('load',register,{once:true})}
let actualizacionPendiente=false;
function aplicarActualizacionNueva(){
  const ocupado=isStreaming||currentChatId&&(chatInput?.value.trim())||!!document.querySelector('.modal-overlay.visible');
  if(ocupado){
    actualizacionPendiente=true;
    showToast('🔄 Nueva versión disponible. Se actualizará al terminar.');
    return;
  }
  showToast('🔄 Actualizando a la nueva versión...');
  setTimeout(()=>window.location.reload(),900);
}
document.addEventListener('visibilitychange',()=>{if(actualizacionPendiente&&document.visibilityState==='visible'){actualizacionPendiente=false;aplicarActualizacionNueva()}});
registrarServiceWorker();
const CACHE={personajes:null,personajesComunidad:null,anuncios:null,usernames:{},cacheTime:{personajes:0,personajesComunidad:0,anuncios:0},TTL:30000},LOADING={personajes:!1,personajesComunidad:!1,anuncios:!1};
function limpiarCacheUsuario(){CACHE.personajes=null;CACHE.personajesComunidad=null;CACHE.anuncios=null;CACHE.cacheTime.personajes=0;CACHE.cacheTime.personajesComunidad=0;CACHE.cacheTime.anuncios=0}
function isCacheValid(k){return CACHE[k]&&Date.now()-CACHE.cacheTime[k]<CACHE.TTL}
async function ejecutarConRefresh(fn,maxRetries=1){for(let intent=0;intent<=maxRetries;intent++){try{return await fn()}catch(err){if(err.message&&(err.message.includes('JWT expired')||err.message.includes('jwt expired')||err.message.includes('invalid token')||err.message.includes('token expired'))){if(intent<maxRetries){try{const{data,error}=await sbClient.auth.refreshSession();if(error){console.error('❌ Error al refrescar sesión:',error);await sbClient.auth.signOut();currentUser=null;userRole=null;userUsername=null;showAuth();throw new Error('Sesión expirada. Inicia sesión de nuevo.')}if(data.session){currentUser=data.session.user;await cargarPerfilYRol();console.log('✅ Sesión refrescada correctamente');continue}}catch(refreshErr){console.error('❌ Falló el refresco de sesión:',refreshErr);await sbClient.auth.signOut();currentUser=null;userRole=null;userUsername=null;showAuth();throw new Error('Sesión expirada. Inicia sesión de nuevo.')}}}throw err}}}
let toastTimer=null,toastTouchStartX=0,toastTouchCurrentX=0;
function ocultarToast(){const toast=document.getElementById('toast');if(!toast)return;clearTimeout(toastTimer);toast.classList.remove('visible','swiping');toast.style.transform='';}
function prepararToastGestos(){const toast=document.getElementById('toast');if(!toast||toast.dataset.gestureReady)return;toast.dataset.gestureReady='true';toast.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')return;toastTouchStartX=e.clientX;toastTouchCurrentX=e.clientX;toast.classList.add('swiping');toast.setPointerCapture?.(e.pointerId)});toast.addEventListener('pointermove',e=>{if(!toast.classList.contains('swiping'))return;toastTouchCurrentX=e.clientX;const dx=toastTouchCurrentX-toastTouchStartX;if(Math.abs(dx)>4)toast.style.transform=`translateX(${dx}px)`});toast.addEventListener('pointerup',e=>{if(!toast.classList.contains('swiping'))return;const dx=toastTouchCurrentX-toastTouchStartX;toast.classList.remove('swiping');if(Math.abs(dx)>55){ocultarToast();return}toast.style.transform='';});toast.addEventListener('pointercancel',()=>{toast.classList.remove('swiping');toast.style.transform=''})}
function anunciarEstado(texto){
  const region=document.getElementById('aria-live-chat');
  if(region)region.textContent=String(texto||'');
}
function showToast(message,type='success'){const toast=document.getElementById('toast');if(!toast)return;let safeMessage=String(message||'');if(safeMessage.includes('violates row-level security')||safeMessage.includes('permission denied')||safeMessage.includes('relation')||safeMessage.includes('column')||safeMessage.includes('table'))safeMessage='Error de permisos. Contacta al administrador.';clearTimeout(toastTimer);toast.innerHTML='';const content=document.createElement('div');content.className='toast-content';content.textContent=safeMessage;const close=document.createElement('button');close.className='toast-close';close.type='button';close.setAttribute('aria-label','Cerrar notificación');close.textContent='×';close.addEventListener('click',ocultarToast);toast.append(content,close);toast.className=`toast ${type}`;toast.style.transform='';prepararToastGestos();requestAnimationFrame(()=>toast.classList.add('visible'));toastTimer=setTimeout(ocultarToast,3500)}
function escapeHtml(str){if(!str)return '';const div=document.createElement('div');div.textContent=str;return div.innerHTML}
function hexToRgba(hex, alpha) {
  if (!hex) return 'rgba(255,77,143,0.35)';
  hex = hex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function lightenColor(hex, percent) {
  if (!hex) return '#ff6ba0';
  hex = hex.replace('#', '');
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);
  r = Math.min(255, Math.floor(r + (255 - r) * (percent / 100)));
  g = Math.min(255, Math.floor(g + (255 - g) * (percent / 100)));
  b = Math.min(255, Math.floor(b + (255 - b) * (percent / 100)));
  const rHex = r.toString(16).padStart(2, '0');
  const gHex = g.toString(16).padStart(2, '0');
  const bHex = b.toString(16).padStart(2, '0');
  return `#${rHex}${gHex}${bHex}`;
}
function sanitizeImageUrl(url){if(!url||typeof url!=='string')return '';const trimmed=url.trim(),cleanData=trimmed.replace(/[\r\n\s]+/g,'');if(cleanData.startsWith('data:image/'))return /^data:image\/[a-z0-9\+\-\.]+;(?:base64|utf8),/i.test(cleanData)?cleanData:'';try{const u=new URL(trimmed);if(u.protocol==='https:'||u.protocol==='http:')return trimmed}catch{}return ''}
function renderMarkdown(texto){if(!texto)return '';let textoProcesado=reemplazarUserEnTexto(texto);const escaped=textoProcesado.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');return escaped.replace(/\*([^*\n]+)\*/g,(m,p1)=>`<em class="accion">*${p1}*</em>`).replace(/\n/g,'<br>')}function formatDate(dateStr){const d=new Date(dateStr),now=new Date(),diff=now-d;if(diff<6e4)return'ahora';if(diff<36e5)return`hace ${Math.floor(diff/6e4)}m`;if(diff<864e5)return`hace ${Math.floor(diff/36e5)}h`;if(diff<6048e5)return`hace ${Math.floor(diff/864e5)}d`;return d.toLocaleDateString()}
// La API Key se guarda en localStorage para que persista entre sesiones
// (antes vivía en sessionStorage y se perdía al cerrar la pestaña)
const GEMINI_KEY_STORAGE=window.localStorage;
const _obf_k=(str)=>{if(!str)return '';return btoa(str.split('').map((c,i)=>String.fromCharCode(c.charCodeAt(0)^(i%10+3))).join(''))},_deobf_k=(str)=>{if(!str)return '';try{const decoded=atob(str);return decoded.split('').map((c,i)=>String.fromCharCode(c.charCodeAt(0)^(i%10+3))).join('')}catch{return''}};
function isGeminiApiKey(key){if(!key||typeof key!=='string')return false;const k=key.trim().replace(/\s+/g,'');return /^AIza[0-9A-Za-z_-]{20,}$/.test(k)||/^AQ\.[0-9A-Za-z_.-]{20,}$/.test(k)||/^[0-9A-Za-z_-]{32,}$/.test(k)}
function getGeminiKey(){let stored=(GEMINI_KEY_STORAGE.getItem(CONFIG.LS.GEMINI_KEY)||'').trim();if(!stored){const legacy=(window.sessionStorage.getItem(CONFIG.LS.GEMINI_KEY)||'').trim();if(legacy){stored=legacy;try{GEMINI_KEY_STORAGE.setItem(CONFIG.LS.GEMINI_KEY,legacy)}catch{}}}try{window.sessionStorage.removeItem(CONFIG.LS.GEMINI_KEY)}catch{}if(!stored)return '';let candidate=stored,best=null;for(let i=0;i<5;i++){const dec=(_deobf_k(candidate)||'').trim().replace(/\s+/g,'');if(!dec||dec===candidate)break;if(isGeminiApiKey(dec))best=dec;candidate=dec}const raw=stored.replace(/\s+/g,'');if(best){try{GEMINI_KEY_STORAGE.setItem(CONFIG.LS.GEMINI_KEY,_obf_k(best))}catch{}return best}if(isGeminiApiKey(raw)){try{GEMINI_KEY_STORAGE.setItem(CONFIG.LS.GEMINI_KEY,_obf_k(raw))}catch{}return raw}return ''}
function mensajeErrorGemini(msg){const m=String(msg||'');if(/invalid authentication credentials|API key not valid|API_KEY_INVALID/.test(m))return 'Tu API Key de Gemini es inválida o fue revocada. Reconfigúrala en Ajustes de Rol (🎭)';return m}
function saveGeminiKey(raw){const key=(raw||'').trim().replace(/\s+/g,'');if(!isGeminiApiKey(key))throw new Error('API Key inválida. Pega una clave válida de Google AI Studio.');GEMINI_KEY_STORAGE.setItem(CONFIG.LS.GEMINI_KEY,_obf_k(key));try{window.sessionStorage.removeItem(CONFIG.LS.GEMINI_KEY)}catch{};return key}
function geminiHeaders(apiKey){return{'Content-Type':'application/json','x-goog-api-key':apiKey}}
function geminiUrl(model,stream=false){const action=stream?'streamGenerateContent':'generateContent';const qs=stream?'?alt=sse':'';return`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${action}${qs}`}
const GEMINI_MODELS=['gemini-3.5-flash','gemini-3.5-flash-lite','gemini-3.6-flash','gemini-3.7-flash'];
function getGeminiModel(){const saved=localStorage.getItem(CONFIG.LS.GEMINI_MODEL);return GEMINI_MODELS.includes(saved)?saved:'gemini-3.5-flash'}
function setGeminiModel(model){const safe=GEMINI_MODELS.includes(model)?model:'gemini-3.5-flash';localStorage.setItem(CONFIG.LS.GEMINI_MODEL,safe);return safe}
function etiquetaModelo(model){const m=String(model||'gemini-3.5-flash').replace(/^gemini-/,'');return 'Gemini '+m.split('-').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ')}
const DEFAULT_SUMMARY_MODEL='gemini-3.7-flash';
function getSummaryModel(){const saved=localStorage.getItem(CONFIG.LS.GEMINI_SUMMARY_MODEL);return GEMINI_MODELS.includes(saved)?saved:DEFAULT_SUMMARY_MODEL}
function setSummaryModel(model){const safe=GEMINI_MODELS.includes(model)?model:DEFAULT_SUMMARY_MODEL;localStorage.setItem(CONFIG.LS.GEMINI_SUMMARY_MODEL,safe);return safe}
function normalizarIntensidad(value){const clean=String(value||'').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'');return ['suave','mediana','maxima'].includes(clean)?clean:'suave'}
function obtenerIntensidadPersonaje(personaje=currentCharacter){if(!personaje)return'suave';const parsed=parsearSystemPrompt(personaje.system_prompt||'');return normalizarIntensidad(personaje.intensidad||parsed.intensidad||'suave')}
function etiquetaIntensidad(value){return{suave:'🟢 Suave',mediana:'🟡 Mediana',maxima:'🔥 Máxima'}[normalizarIntensidad(value)]}
function estimarTokens(texto){return Math.ceil((texto||'').length/3.5)}
function contarTokensHistorial(historial){return historial.reduce((t,m)=>t+estimarTokens(m.contenido||''),0)}

function getSafetySettings(intensidad='suave'){
  let threshold='BLOCK_MEDIUM_AND_ABOVE';
  const clean=normalizarIntensidad(intensidad);
  if(clean==='mediana')threshold='BLOCK_ONLY_HIGH';
  if(clean==='maxima')threshold='BLOCK_NONE';
  return[
    {category:"HARM_CATEGORY_HARASSMENT",threshold:threshold},
    {category:"HARM_CATEGORY_HATE_SPEECH",threshold:threshold},
    {category:"HARM_CATEGORY_SEXUALLY_EXPLICIT",threshold:threshold},
    {category:"HARM_CATEGORY_DANGEROUS_CONTENT",threshold:threshold}
  ];
}

/* ── Peticiones resilientes a Gemini ────────────────────────────────
   Gemini bloquea a veces peticiones totalmente normales (romance, drama)
   con PROHIBITED_CONTENT, y ese bloqueo llega como
   `promptFeedback.blockReason`: es un filtro NO configurable, así que
   ningún umbral de safetySettings lo desactiva (por eso la escalera de
   umbrales y modelos de respaldo se quedaba corta). Este motor añade,
   además de esa escalera:

     · reintento con el texto "discretizado": las palabras más explícitas
       se sustituyen por una marca neutra ANTES de enviarlas a Gemini
       (no se toca el chat del usuario, solo lo que lee el motor),
     · reintento con un prompt de sistema mínimo y neutral,
     · y, si el bloqueo persiste, resumen por tramos: la conversación se
       parte en fragmentos pequeños que sí se pueden leer, y con ellos se
       construyen la recapitulación y el Diario de Personajes.

   El chat normal no cambia: la escalera solo se activa cuando algo se
   bloquea. Diagnóstico: ejecuta sairDiagnostico() en la consola. */

const GEMINI_MODELOS_RESPALDO=['gemini-3.7-flash','gemini-3.6-flash','gemini-3.5-flash','gemini-3.5-flash-lite'];
const CATEGORIAS_SEGURIDAD=['HARM_CATEGORY_HARASSMENT','HARM_CATEGORY_HATE_SPEECH','HARM_CATEGORY_SEXUALLY_EXPLICIT','HARM_CATEGORY_DANGEROUS_CONTENT'];
const SISTEMA_NEUTRO='Eres un asistente que analiza y redacta textos con precisión, siguiendo exactamente las instrucciones del usuario.';

let diagnosticoGemini=[];
function registrarDiagnostico(entrada){
  try{
    diagnosticoGemini.push(Object.assign({hora:new Date().toISOString()},entrada));
    if(diagnosticoGemini.length>80)diagnosticoGemini=diagnosticoGemini.slice(-80);
  }catch{}
}
window.sairDiagnostico=function(){console.log('🛡️ Diagnóstico de bloqueos de Gemini:',diagnosticoGemini);return diagnosticoGemini.slice()};

function getSafetySettingsNivel(nivel){
  let threshold='BLOCK_MEDIUM_AND_ABOVE';
  if(nivel==='off')threshold='OFF';
  else if(nivel==='bloqueo_minimo')threshold='BLOCK_NONE';
  else threshold=getSafetySettings(nivel)[0].threshold;
  return CATEGORIAS_SEGURIDAD.map(category=>({category,threshold}));
}
function normalizarNivelSeguridad(valor){
  const limpio=String(valor||'').toLowerCase().trim();
  if(limpio==='bloqueo_minimo'||limpio==='off')return limpio;
  return normalizarIntensidad(limpio);
}
function crearErrorBloqueo(mensaje,textoParcial,extra){
  const err=new Error(mensaje);
  err.esBloqueoDeSeguridad=true;
  if(textoParcial)err.textoParcial=textoParcial;
  if(extra)Object.assign(err,extra);
  return err;
}
function esErrorDeBloqueo(err){return !!(err&&err.esBloqueoDeSeguridad)}
function mensajeBloqueoConAyuda(err,intentos){
  const base=String((err&&err.message)||'');
  const razon=(base.match(/\(([^)]+)\)/)||[])[1]||'';
  const cabecera=razon?`Gemini bloqueó esta conversación con su filtro no configurable (${razon}).`:'Gemini bloqueó esta conversación con un filtro no configurable.';
  const n=intentos||(err&&err.intentos)||0;
  return `${cabecera} La app ya probó ${n||'varias'} estrategias (umbrales permisivos, modelos de respaldo, texto discretizado y resumen por tramos) sin conseguirlo. Suele ocurrir en chats muy explícitos o muy largos: recorta la conversación, cambia el modelo de resumen en Ajustes de Rol (🎭) e inténtalo otra vez.`;
}

/* ── Discreción: el texto que se envía al motor puede llevar las
   palabras más explícitas sustituidas por una marca neutra. Es solo una
   versión de lectura para resumir/analizar: el chat del usuario y sus
   mensajes guardados no se tocan. */
const MASCARA_INTIMA='[escena íntima]';
const PATRONES_EXPLICITOS=[
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
function discretizar(texto){
  let t=String(texto||'');
  if(!t)return t;
  for(const patron of PATRONES_EXPLICITOS)t=t.replace(patron,MASCARA_INTIMA);
  return t.replace(/(\[escena íntima\]\s*){2,}/g,MASCARA_INTIMA);
}

/* Construye los "contents" de Gemini a partir de los mensajes del chat,
   igual que hace el chat normal: cada mensaje conserva su rol (user/model)
   y los turnos seguidos del mismo rol se fusionan para que la conversación
   quede alternada. Enviar la conversación completa dentro de un único
   mensaje de usuario hace que los filtros evalúen ese bloque como una
   instrucción del usuario y bloqueen la petición completa. */
function construirContenidoGemini(mensajes,discreto){
  const turns=[];
  for(const m of (Array.isArray(mensajes)?mensajes:[])){
    if(!m)continue;
    const rol=m.rol==='assistant'?'model':'user';
    let texto=String(m.contenido||'');
    if(!texto.trim())continue;
    if(discreto)texto=discretizar(texto);
    const ultimo=turns[turns.length-1];
    if(ultimo&&ultimo.role===rol)ultimo.parts[0].text+='\n\n'+texto;
    else turns.push({role:rol,parts:[{text:texto}]});
  }
  return turns;
}
function agregarTurnoUsuario(contents,texto){
  if(!texto||!String(texto).trim())return contents;
  const limpio=String(texto).trim();
  const ultimo=contents[contents.length-1];
  if(ultimo&&ultimo.role==='user')ultimo.parts[0].text+='\n\n'+limpio;
  else contents.push({role:'user',parts:[{text:limpio}]});
  return contents;
}

/* Limita una lista de mensajes a un máximo de caracteres. Con
   desdeElFinal=true descarta los mensajes más antiguos (conserva el
   contexto reciente); si no, descarta los más recientes. El mensaje que
   no cabe se incluye truncado. */
function limitarMensajesPorLongitud(mensajes,maximo,desdeElFinal=false){
  if(!Array.isArray(mensajes)||!mensajes.length||!(maximo>0))return[];
  const lista=desdeElFinal?mensajes.slice().reverse():mensajes.slice();
  const resultado=[];
  let total=0;
  for(const m of lista){
    const texto=String(m.contenido||'');
    if(total>=maximo)break;
    if(total+texto.length>maximo){
      const corte=texto.slice(0,Math.max(0,maximo-total));
      resultado.push({...m,contenido:(desdeElFinal?'[...parte inicial del chat omitida por longitud...]\n\n':'')+corte+(desdeElFinal?'':'... (truncado)')});
      total=maximo;
      break;
    }
    resultado.push(m);
    total+=texto.length;
  }
  return desdeElFinal?resultado.reverse():resultado;
}

/* Una sola petición sin streaming. Marca el tipo de error para que la
   escalera sepa si merece la pena reintentar con otra estrategia. */
async function peticionGeminiTexto({systemPrompt,contenido,mensajes,instruccion,modelo,nivelSeguridad='suave',maxOutputTokens=4096,temperature=.3,discreto=false}){
  const apiKey=getGeminiKey();
  if(!apiKey){const err=new Error('No hay API Key configurada');err.tipo='clave';throw err}
  let contents;
  if(Array.isArray(mensajes)&&mensajes.length){
    contents=construirContenidoGemini(mensajes,discreto);
    agregarTurnoUsuario(contents,discreto?discretizar(instruccion):instruccion);
    if(!contents.length)throw new Error('No hay mensajes para enviar a Gemini');
  }else{
    const cuerpo=discreto?discretizar(contenido):contenido;
    if(!String(cuerpo||'').trim())throw new Error('No hay texto para enviar a Gemini');
    contents=[{role:'user',parts:[{text:cuerpo}]}];
    agregarTurnoUsuario(contents,discreto?discretizar(instruccion):instruccion);
  }
  const body={
    contents,
    safetySettings:getSafetySettingsNivel(nivelSeguridad),
    generationConfig:{temperature,topP:.9,topK:40,maxOutputTokens}
  };
  if(systemPrompt)body.system_instruction={parts:[{text:systemPrompt}]};
  let response;
  try{response=await fetch(geminiUrl(modelo,false),{method:'POST',headers:geminiHeaders(apiKey),body:JSON.stringify(body)})}
  catch(err){const e=new Error('No se pudo conectar con Gemini. Revisa tu conexión e intenta de nuevo.');e.tipo='red';throw e}
  if(!response.ok){
    const errText=await response.text();
    let msg='';
    try{const errJson=JSON.parse(errText);msg=errJson.error?.message||''}catch{}
    if(/API key not valid|invalid authentication|API_KEY_INVALID/i.test(msg)){const e=new Error('Tu API Key de Gemini es inválida o fue revocada. Reconfígurala en Ajustes de Rol (🎭)');e.tipo='clave';throw e}
    if(response.status===429||/quota|rate limit|too many requests|resource_exhausted/i.test(msg)){const e=new Error('Límite de peticiones alcanzado. Espera unos segundos y reintenta.');e.tipo='cuota';throw e}
    if(response.status===400&&/safety|block|threshold|harm|prohibited/i.test(msg))throw crearErrorBloqueo('La petición fue rechazada por los filtros de seguridad de Gemini.',null,{tipo:'bloqueo',detalle:String(msg).slice(0,300)});
    const e=new Error(msg||`Error de Gemini (${response.status})`);
    e.tipo=response.status>=500?'servidor':'modelo';
    throw e;
  }
  const data=await response.json();anotarUsoUnico(data.usageMetadata);
  const candidato=data.candidates?.[0];
  const finish=String(candidato?.finishReason||'').toUpperCase();
  const texto=(candidato?.content?.parts||[]).map(p=>p.text||'').join('').trim();
  if(texto&&(!finish||finish==='STOP'||finish==='MAX_TOKENS'))return texto;
  if(finish&&finish!=='STOP'&&finish!=='MAX_TOKENS')throw crearErrorBloqueo(`Gemini bloqueó la respuesta (${finish}).`,texto,{tipo:'bloqueo'});
  if(data.promptFeedback?.blockReason){
    console.warn('🛡️ Gemini bloqueó la petición. promptFeedback:',JSON.stringify(data.promptFeedback));
    throw crearErrorBloqueo(`Gemini bloqueó la petición (${data.promptFeedback.blockReason}).`,texto,{tipo:'bloqueo',detalle:JSON.stringify(data.promptFeedback).slice(0,400)});
  }
  if(texto)return texto;
  const e=new Error('Gemini no devolvió ninguna respuesta. Intenta de nuevo.');
  e.tipo='generico';
  throw e;
}

/* Escalera: intensidad elegida → umbral más permisivo → modelos de
   respaldo → texto discretizado → prompt neutro mínimo. */
function construirPlanesEscalada(nivelBase,modeloBase){
  const modelos=[...new Set([modeloBase,getGeminiModel(),...GEMINI_MODELOS_RESPALDO].filter(Boolean))].slice(0,4);
  const base=modelos[0],alterno=modelos[1]||modelos[0];
  const planes=[
    {modelo:base,nivel:nivelBase,forma:'normal'},
    {modelo:base,nivel:'bloqueo_minimo',forma:'normal'},
    {modelo:alterno,nivel:'bloqueo_minimo',forma:'normal'},
    {modelo:base,nivel:'bloqueo_minimo',forma:'discreta'},
    {modelo:alterno,nivel:'bloqueo_minimo',forma:'discreta'},
    {modelo:base,nivel:'off',forma:'discreta'},
    {modelo:alterno,nivel:'off',forma:'discreta'},
    {modelo:base,nivel:'off',forma:'neutra'},
    {modelo:alterno,nivel:'off',forma:'neutra'}
  ];
  const vistos=new Set(),finales=[];
  for(const plan of planes){
    const clave=`${plan.modelo}|${plan.nivel}|${plan.forma}`;
    if(vistos.has(clave))continue;
    vistos.add(clave);
    finales.push(plan);
  }
  return finales;
}

async function generarConGeminiResiliente({systemPrompt,sistemaNeutro=null,contenido,mensajes,instruccion,instruccionNeutra=null,maxOutputTokens=4096,temperature=.3,nivelInicial=null,modelo=null,maxIntentos=null}){
  const parsed=parsearSystemPrompt(currentCharacter?.system_prompt);
  const nivelBase=normalizarNivelSeguridad(nivelInicial||currentCharacter?.intensidad||parsed.intensidad||'suave');
  const planes=construirPlanesEscalada(nivelBase,modelo||getSummaryModel());
  const limite=Math.max(1,Math.min(maxIntentos||planes.length,planes.length));
  let mejorParcial='',ultimoError=null,intentos=0,seguidos=0,ultimoTipo='';
  for(let i=0;i<limite;i++){
    const plan=planes[i];
    intentos++;
    const discreto=plan.forma!=='normal';
    const neutro=plan.forma==='neutra';
    try{
      const texto=await peticionGeminiTexto({
        systemPrompt:neutro?(sistemaNeutro||SISTEMA_NEUTRO):systemPrompt,
        contenido,
        mensajes,
        instruccion:neutro?(instruccionNeutra||instruccion):instruccion,
        modelo:plan.modelo,
        nivelSeguridad:plan.nivel,
        maxOutputTokens,
        temperature,
        discreto
      });
      registrarDiagnostico({accion:'ok',modelo:plan.modelo,nivel:plan.nivel,forma:plan.forma,intento:intentos});
      if(intentos>1)console.log(`🛡️ Gemini respondió tras ${intentos} intentos (${plan.modelo} · ${plan.nivel} · ${plan.forma})`);
      return {texto,modelo:plan.modelo,nivel:plan.nivel,forma:plan.forma,intentos,parcial:false};
    }catch(err){
      if(err.textoParcial&&err.textoParcial.length>mejorParcial.length)mejorParcial=err.textoParcial;
      const tipo=err.tipo||(esErrorDeBloqueo(err)?'bloqueo':'generico');
      registrarDiagnostico({accion:'fallo',modelo:plan.modelo,nivel:plan.nivel,forma:plan.forma,intento:intentos,tipo,mensaje:String(err.message||'').slice(0,220)});
      if(tipo==='clave')throw err;
      if(tipo===ultimoTipo)seguidos++;else{seguidos=1;ultimoTipo=tipo}
      if(esErrorDeBloqueo(err))console.warn(`🛡️ Intento ${intentos} bloqueado (${plan.modelo} · ${plan.nivel} · ${plan.forma}). Probando otra estrategia…`);
      else console.warn(`⚠️ Intento ${intentos} con ${plan.modelo} falló (${tipo}): ${err.message}`);
      if(esErrorDeBloqueo(err))ultimoError=err;
      else if(!ultimoError)ultimoError=err;
      if(seguidos>=3&&tipo!=='bloqueo')throw err;
    }
  }
  if(mejorParcial.trim().length>=400)return {texto:mejorParcial.trim(),modelo:planes[0].modelo,nivel:'parcial',forma:'parcial',intentos,parcial:true};
  if(ultimoError){ultimoError.intentos=intentos;throw ultimoError}
  const err=new Error('No se pudo obtener respuesta de Gemini. Intenta de nuevo.');
  err.tipo='generico';
  err.intentos=intentos;
  throw err;
}

/* Divide el texto en tramos por párrafos para poder resumir por partes. */
function dividirTextoEnTramos(texto,maximo){
  const parrafos=String(texto||'').split(/\n{2,}/);
  const tramos=[];
  let actual='';
  for(const parrafo of parrafos){
    if(parrafo.length>maximo){
      let resto=parrafo;
      while(resto.length>maximo){tramos.push(resto.slice(0,maximo));resto=resto.slice(maximo)}
      if(resto)actual=actual?`${actual}\n\n${resto}`:resto;
      continue;
    }
    if(actual&&(actual.length+parrafo.length+2)>maximo){tramos.push(actual);actual=parrafo}
    else actual=actual?`${actual}\n\n${parrafo}`:parrafo;
  }
  if(actual.trim())tramos.push(actual);
  return tramos.filter(t=>t.trim());
}

const RESUMEN_TRAMO_CARACTERES=14000;
const DIGESTO_TRAMO_CARACTERES=9000;
const MAX_TRAMOS=40;

function textoDeMensajes(mensajes){
  const nombreUsuario=userRoleName||'el usuario';
  const nombrePersonaje=currentCharacter?.nombre||'el personaje principal';
  return (Array.isArray(mensajes)?mensajes:[])
    .filter(m=>m&&(m.rol==='user'||m.rol==='assistant'))
    .map(m=>`${m.rol==='assistant'?nombrePersonaje:nombreUsuario}: ${String(m.contenido||'')}`)
    .join('\n\n');
}
function contextoDigesto(){
  return `Ficha: en los turnos "user" habla ${userRoleName||'el usuario'}; en los turnos "model" habla ${currentCharacter?.nombre||'el personaje principal'}.`;
}
function unirDigestoTramos(partes){
  return partes.map((p,i)=>`• Tramo ${i+1}: ${p}`).join('\n\n');
}

const DIGESTO_PROMPT=`Vas a leer un fragmento de una conversación de ficción (turnos "user" y "model") y describir lo que ocurre.
Reglas:
- Escribe en tercera persona, de forma objetiva y neutral.
- Incluye hechos, decisiones, promesas, emociones y cómo cambia la relación entre los personajes.
- Menciona los nombres de los personajes que aparecen.
- No copies diálogos largos ni inventes nada que no aparezca en el fragmento.
- Responde solo con la descripción, en un máximo de 200 palabras.`;

/* Lee la conversación por tramos pequeños (que sí pasan los filtros
   cuando el chat completo se bloquea) y devuelve las notas de cada uno. */
async function digestoTramos(mensajes,{nivelInicial='bloqueo_minimo',onProgreso=null,maxIntentosPorTramo=3}={}){
  const texto=textoDeMensajes(mensajes);
  const tramos=dividirTextoEnTramos(texto,DIGESTO_TRAMO_CARACTERES).slice(0,MAX_TRAMOS);
  if(!tramos.length)return {partes:[],omitidos:0,total:0,texto};
  const partes=[];
  let omitidos=0;
  for(let i=0;i<tramos.length;i++){
    if(onProgreso){try{onProgreso(i+1,tramos.length)}catch{}}
    try{
      const{texto:parte}=await generarConGeminiResiliente({
        systemPrompt:DIGESTO_PROMPT,
        contenido:`${contextoDigesto()}\n\nFragmento ${i+1} de ${tramos.length}:\n\n${tramos[i]}`,
        maxOutputTokens:1200,
        temperature:.25,
        nivelInicial,
        maxIntentos:maxIntentosPorTramo
      });
      if(String(parte||'').trim())partes.push(parte.trim());else omitidos++;
    }catch(err){
      if(!esErrorDeBloqueo(err))throw err;
      omitidos++;
      console.warn(`🛡️ Tramo ${i+1}/${tramos.length} bloqueado; se omite y se continúa con el resto.`);
    }
  }
  return {partes,omitidos,total:tramos.length,texto};
}

const RESUMEN_PROMPT_SISTEMA=`Eres un asistente experto en resumir conversaciones de ficción (turnos "user" y "model").
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

const RESUMEN_PROMPT_TRAMO=`${RESUMEN_PROMPT_SISTEMA}

IMPORTANTE: este texto es solo un tramo de una conversación más larga. Resume lo que ocurre en este tramo manteniendo nombres, decisiones y emociones, con lenguaje descriptivo y neutro.`;

const RESUMEN_PROMPT_UNIR=`Eres un asistente experto en resumir conversaciones de ficción. Recibirás resúmenes parciales, en orden cronológico, de una misma historia. Únelos en UN ÚNICO resumen coherente y cronológico: elimina repeticiones, conserva todos los hechos, nombres, decisiones, promesas y relaciones importantes, y no añadas nada que no aparezca en los parciales. Responde solo con el resumen final.`;

/* Último recurso del resumidor automático: resumir tramo a tramo los
   chats largos que Gemini bloquea de golpe y unir después los resúmenes. */
async function resumirPorTramos(texto,nivel,avisoOmitidos=''){
  const tramos=dividirTextoEnTramos(texto,RESUMEN_TRAMO_CARACTERES).slice(0,MAX_TRAMOS);
  if(tramos.length<=1)throw crearErrorBloqueo('Los filtros de seguridad de Gemini bloquearon el resumen de esta conversación.',null,{tipo:'bloqueo'});
  console.warn(`🛡️ Resumiendo por tramos: ${tramos.length} partes.`);
  const partes=[];
  let omitidos=0;
  for(let i=0;i<tramos.length;i++){
    try{
      const{texto:parte}=await generarConGeminiResiliente({
        systemPrompt:RESUMEN_PROMPT_TRAMO,
        contenido:`Tramo ${i+1} de ${tramos.length} de una conversación de ficción:\n\n${tramos[i]}`,
        maxOutputTokens:2048,
        temperature:.25,
        // Ya sabemos que el filtro estándar bloquea este chat: arrancamos
        // con el umbral permisivo para no repetir intentos inútiles.
        nivelInicial:'bloqueo_minimo',
        maxIntentos:3
      });
      if(String(parte||'').trim())partes.push(parte.trim());else omitidos++;
    }catch(err){
      if(!esErrorDeBloqueo(err))throw err;
      omitidos++;
      console.warn(`🛡️ Tramo ${i+1}/${tramos.length} bloqueado; se omite y se continúa con el resto.`);
    }
  }
  const utiles=partes.filter(Boolean);
  if(!utiles.length)throw crearErrorBloqueo('Los filtros de seguridad de Gemini bloquearon toda la conversación.',null,{tipo:'bloqueo'});
  let resumen=utiles.length===1?utiles[0]:unirDigestoTramos(utiles);
  if(utiles.length>1){
    try{
      const{texto:unido}=await generarConGeminiResiliente({systemPrompt:RESUMEN_PROMPT_UNIR,contenido:resumen,maxOutputTokens:4096,temperature:.25,nivelInicial:'bloqueo_minimo',maxIntentos:3});
      if(String(unido||'').trim())resumen=unido.trim();
    }catch(err){
      if(!esErrorDeBloqueo(err))throw err;
      console.warn('🛡️ No se pudieron unir los tramos; se conservan por separado.');
    }
  }
  if(omitidos>0)resumen+=`\n\n(Nota: ${omitidos} tramo${omitidos!==1?'s':''} de la conversación no se pudo resumir por los filtros del modelo.)${avisoOmitidos}`;
  return resumen;
}

async function resumirHistorialConGemini({mensajes,contenido,resumenPrevio='',intensidad=null}={}){
  const lista=Array.isArray(mensajes)?mensajes.filter(m=>m&&(m.rol==='user'||m.rol==='assistant')):[];
  const limpio=String(contenido||'').trim()||lista.map(m=>String(m.contenido||'')).join('\n\n').trim();
  if(!limpio)throw new Error('No hay texto para resumir');
  const parsed=parsearSystemPrompt(currentCharacter?.system_prompt);
  const nivelBase=normalizarIntensidad(intensidad||currentCharacter?.intensidad||parsed.intensidad||'suave');
  const contextoPrevio=String(resumenPrevio||'').trim()?`CONTEXTO · Resumen anterior de la misma conversación (incorpóralo sin repetirlo textualmente):\n${String(resumenPrevio).trim().slice(0,6000)}\n\n`:'';
  try{
    const{texto:resumen}=await generarConGeminiResiliente({
      systemPrompt:contextoPrevio+RESUMEN_PROMPT_SISTEMA,
      sistemaNeutro:SISTEMA_NEUTRO,
      // La conversación se envía como turnos user/model, igual que en el chat.
      mensajes:lista.length?lista:undefined,
      contenido:lista.length?undefined:`Conversación de ficción a resumir:\n\n${limpio}`,
      instruccion:lista.length?'Resume la conversación completa de forma objetiva: hechos, decisiones, promesas y relaciones, sin inventar nada.':undefined,
      instruccionNeutra:lista.length?'Resume de forma objetiva la conversación anterior: hechos, decisiones, promesas y relaciones.':undefined,
      maxOutputTokens:4096,
      temperature:.3,
      nivelInicial:nivelBase
    });
    return resumen.trim();
  }catch(err){
    if(!esErrorDeBloqueo(err))throw err;
    return await resumirPorTramos(limpio,nivelBase);
  }
}

/* ── Recapitulación a prueba de bloqueos ───────────────────────────
   Si la recapitulación normal se bloquea, se lee la historia por tramos
   y con esas notas se redacta el informe final. */
const RECAP_PROMPT_SISTEMA=`Analiza una conversación de ficción (turnos "user" y "model") y entrega un informe estructurado en EXACTAMENTE DOS PARTES, separadas por el marcador "===ACTUALMENTE===" (escríbelo tal cual, en mayúsculas y con tres guiones a cada lado).

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
const RECAP_INSTRUCCION='Entrega el informe completo: la historia y, tras el marcador ===ACTUALMENTE===, el estado actual.';

async function recapitularPorTramos(mensajes,{nivelInicial='bloqueo_minimo',onProgreso=null}={}){
  const{partes,omitidos,total}=await digestoTramos(mensajes,{nivelInicial,onProgreso,maxIntentosPorTramo:3});
  if(!partes.length)throw crearErrorBloqueo('Los filtros de seguridad de Gemini bloquearon toda la conversación.',null,{tipo:'bloqueo'});
  const digest=unirDigestoTramos(partes);
  let textoFinal='';
  try{
    const{texto}=await generarConGeminiResiliente({
      systemPrompt:RECAP_PROMPT_SISTEMA,
      sistemaNeutro:SISTEMA_NEUTRO,
      contenido:`NOTAS CRONOLÓGICAS DE LA HISTORIA (resumen por tramos, en orden):\n\n${digest}`,
      instruccion:RECAP_INSTRUCCION,
      instruccionNeutra:RECAP_INSTRUCCION,
      maxOutputTokens:6048,
      temperature:.4,
      nivelInicial:'bloqueo_minimo'
    });
    textoFinal=String(texto||'').trim();
  }catch(err){
    if(!esErrorDeBloqueo(err))throw err;
    // Último recurso: entregar las notas de los tramos tal cual, con el
    // último tramo como estado actual.
    console.warn('🛡️ No se pudo redactar el informe final; se entregan las notas por tramos.');
    textoFinal=`${partes.join('\n\n')}\n\n===ACTUALMENTE===\n\n${partes[partes.length-1]}`;
  }
  if(omitidos>0)textoFinal+=`\n\n(Nota: ${omitidos} de ${total} fragmentos de la conversación no se pudieron leer por los filtros de Gemini.)`;
  return {texto:textoFinal,omitidos,total};
}

async function procesarHistorialSiEsNecesario(historial){
  const LIMITE_TOKENS=80000,TOKENS_RESERVA=20000;
  const tokensTotal=contarTokensHistorial(historial);
  if(tokensTotal<=LIMITE_TOKENS)return{historialProcesado:historial,necesitaActualizacion:!1};
  
  const modal = document.getElementById('summary-modal');
  const content = document.getElementById('summary-content');
  
  function setSummaryUI(estado, mensaje, mostrarReintentar = false) {
    if (estado === 'loading') {
      content.innerHTML = `
        <div class="recap-loading" style="padding:2rem 1.5rem;">
          <div class="recap-spinner"><div class="recap-spinner-core"></div></div>
          <div class="recap-loading-text">Resumiendo conversación...</div>
          <div class="recap-loading-sub">Esto puede tardar unos segundos según la longitud del chat</div>
          <div class="recap-progress"><div class="recap-progress-bar"></div></div>
        </div>
      `;
    } else if (estado === 'error') {
      content.innerHTML = `
        <div class="recap-confirm" style="padding:2rem 1.5rem;">
          <div class="recap-icon-wrapper" style="background:linear-gradient(135deg,rgba(239,68,68,.2),rgba(239,68,68,.1));margin-bottom:1rem;">
            <svg viewBox="0 0 24 24" style="stroke:#fca5a5;width:42px;height:42px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div class="recap-title" style="background:linear-gradient(135deg,#ef4444,#f59e0b);-webkit-background-clip:text;background-clip:text;font-size:1.3rem;">Error al resumir</div>
          <div class="recap-subtitle" style="color:#fca5a5;font-size:.9rem;">${escapeHtml(mensaje)}</div>
          ${mostrarReintentar ? `<button type="button" class="btn btn-primary" id="btn-retry-summary" style="margin-top:1.5rem;width:100%;">🔄 Reintentar</button>` : ''}
        </div>
      `;
    }
  }
  
  modal.classList.add('visible');
  setSummaryUI('loading');
  
  const ejecutarResumen = async () => {
    try {
      let tokensAcumulados=0, indiceCorte=0;
      for(let i=historial.length-1;i>=0;i--){
        if(historial[i].rol==='summary') continue;
        tokensAcumulados += estimarTokens(historial[i].contenido||'');
        if(tokensAcumulados >= TOKENS_RESERVA){ indiceCorte = i; break; }
      }
      const mensajesRecientes = historial.slice(indiceCorte);
      let mensajesAntiguos = historial.slice(0, indiceCorte);
      let resumenPrevio = '';
      if(mensajesAntiguos.length>0 && mensajesAntiguos[0].rol==='summary'){
        resumenPrevio = mensajesAntiguos[0].contenido;
        mensajesAntiguos = mensajesAntiguos.slice(1);
      }
      if(mensajesAntiguos.length===0) {
        modal.classList.remove('visible');
        return { historialProcesado: historial, necesitaActualizacion: false };
      }
      // La conversación se envía como turnos user/model (igual que en el
      // chat): enviarla en un único mensaje de usuario hace que los filtros
      // de Gemini bloqueen la petición completa (PROHIBITED_CONTENT).
      const nuevoResumen = await resumirHistorialConGemini({mensajes:mensajesAntiguos,resumenPrevio});
      
      const mensajeResumen = {
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).substr(2,5),
        rol: 'summary',
        contenido: nuevoResumen
      };
      const nuevoHistorial = [mensajeResumen, ...mensajesRecientes];
      
      modal.classList.remove('visible');
      return { historialProcesado: nuevoHistorial, necesitaActualizacion: true };
    } catch (err) {
      const errorMsg = esErrorRateLimit(err) ? 'Límite de peticiones excedido. Espera unos segundos y reintenta.' : err.message;
      setSummaryUI('error', errorMsg, true);
      
      return new Promise((resolve, reject) => {
        const btn = document.getElementById('btn-retry-summary');
        if (btn) {
          btn.addEventListener('click', async () => {
            setSummaryUI('loading');
            try {
              const resultado = await ejecutarResumen();
              resolve(resultado);
            } catch (e) {
              reject(e);
            }
          }, { once: true });
        } else {
          reject(new Error('No se pudo reintentar'));
        }
      });
    }
  };
  
  try {
    const resultado = await ejecutarResumen();
    return resultado;
  } catch (err) {
    modal.classList.remove('visible');
    throw new Error('No se pudo completar el resumen: ' + err.message);
  }
}

function cargarInfoUsuarioLocal(){
  try {
    const cached = localStorage.getItem('sair_cached_user_info');
    if (cached) {
      const data = JSON.parse(cached);
      if (!currentUser || data.userId !== currentUser.id) return false;
      userRole = data.role || 'user';
      userUsername = data.username || null;
      userDescription = data.description || '';
      userAvatarUrl = sanitizeImageUrl(data.avatarUrl || '');
      userBackgroundUrl = sanitizeImageUrl(data.backgroundUrl || '');
      userAvatarPos = {x:Number(data.avatarPosX)||50,y:Number(data.avatarPosY)||50};
      userBackgroundPos = {x:Number(data.backgroundPosX)||50,y:Number(data.backgroundPosY)||50};
      userRoleName = data.roleName || null;
      return true;
    }
  } catch (e) {
    console.warn('⚠️ Error leyendo info de usuario cacheada:', e);
  }
  return false;
}

function guardarInfoUsuarioLocal(){
  try {
    localStorage.setItem('sair_cached_user_info', JSON.stringify({
      userId: currentUser?.id || null,
      role: userRole,
      username: userUsername,
      description: userDescription || '',
      avatarUrl: userAvatarUrl || null,
      backgroundUrl: userBackgroundUrl || null,
      avatarPosX: userAvatarPos.x,
      avatarPosY: userAvatarPos.y,
      backgroundPosX: userBackgroundPos.x,
      backgroundPosY: userBackgroundPos.y,
      roleName: userRoleName
    }));
  } catch (e) {
    console.warn('⚠️ Error guardando info de usuario cacheada:', e);
  }
}

async function cargarPerfilYRol(){
if(!currentUser){userRole=null;userUsername=null;return}
try{
const[rolResult,perfilResultInicial]=await Promise.all([
sbClient.from('roles').select('rol').eq('user_id',currentUser.id).single(),
sbClient.rpc('obtener_mi_perfil')
]);
let perfilResult=perfilResultInicial;
if(Array.isArray(perfilResult.data))perfilResult={...perfilResult,data:perfilResult.data[0]||null};
userRole=rolResult.data?.rol||'user';
userUsername=perfilResult.data?.username||null;
userDescription=perfilResult.data?.descripcion||'';
userAvatarUrl=sanitizeImageUrl(perfilResult.data?.avatar_url||'');
userBackgroundUrl=sanitizeImageUrl(perfilResult.data?.fondo_url||'');
userAvatarPos={x:Number(perfilResult.data?.avatar_pos_x)||50,y:Number(perfilResult.data?.avatar_pos_y)||50};
userBackgroundPos={x:Number(perfilResult.data?.fondo_pos_x)||50,y:Number(perfilResult.data?.fondo_pos_y)||50};
console.log('👤 Perfil:',userUsername,'| Rol:',userRole)
guardarInfoUsuarioLocal();
}catch(err){
console.error('Error cargando perfil:',err);
userRole='user';
userUsername=currentUser.email?.split('@')[0]||'usuario'
}
actualizarUIPerfil()
}
async function cargarNombreRol(){
if(!currentUser){userRoleName=null;return}
try{
const{data,error}=await sbClient.from('roles_usuario').select('nombre_rol').eq('user_id',currentUser.id).single();
if(error&&error.code==='PGRST116'){userRoleName=null;return}
if(error)throw new Error(error.message);
userRoleName=data?.nombre_rol||null;
console.log('🎭 Nombre de rol:',userRoleName)
guardarInfoUsuarioLocal();
}catch(err){
console.error('Error cargando nombre de rol:',err);
userRoleName=null
}
}

async function guardarNombreRol(nombre){
if(!currentUser)throw new Error('No hay sesión');
const regex=/^[a-zA-Z0-9_]{3,30}$/;
if(!regex.test(nombre))throw new Error('Nombre de rol inválido. Usa 3-30 caracteres: letras, números o _');
try{
const{data,error}=await sbClient.from('roles_usuario').upsert({user_id:currentUser.id,nombre_rol:nombre},{onConflict:'user_id'}).select().single();
if(error)throw new Error(error.message);
userRoleName=nombre;
return data
}catch(err){
console.error('Error guardando nombre de rol:',err);
throw err
}
}

function reemplazarUserEnTexto(texto){
if(!userRoleName)return texto;
return texto.replace(/\{\{user\}\}/gi,userRoleName)
}

async function verificarYMostrarModalRol(){
if(!userRoleName){
openModal('role-modal');
showToast('🎭 Configura tu nombre de rol para continuar','success')
}
}
function actualizarUIPerfil(){const displayName=userUsername||currentUser?.email?.split('@')[0]||'Usuario',initial=displayName.charAt(0).toUpperCase(),safeAvatar=sanitizeImageUrl(userAvatarUrl),safeBackground=sanitizeImageUrl(userBackgroundUrl);const badgeName=document.getElementById('user-badge-name'),badgeAvatar=document.getElementById('user-badge-avatar'),badgeRole=document.getElementById('user-badge-role'),profilePreview=document.getElementById('profile-avatar-preview'),cover=document.getElementById('profile-cover-preview'),profileUsername=document.getElementById('profile-username');if(badgeName)badgeName.textContent=displayName;if(badgeAvatar)badgeAvatar.innerHTML=safeAvatar?`<img src="${safeAvatar.replace(/"/g,'&quot;')}" alt="">`:initial;if(badgeRole){badgeRole.textContent=userRole;badgeRole.className=`role-tag ${userRole}`}if(profilePreview)profilePreview.innerHTML=safeAvatar?`<img src="${safeAvatar.replace(/"/g,'&quot;')}" alt="Foto de perfil">`:initial;if(profileUsername)profileUsername.value=userUsername||'';if(cover){cover.style.backgroundImage=safeBackground?`url("${safeBackground.replace(/"/g,'%22')}")`:'';cover.style.backgroundPosition=`${userBackgroundPos.x}% ${userBackgroundPos.y}%`;const avatarImg=profilePreview?.querySelector('img');if(avatarImg)avatarImg.style.objectPosition=`${userAvatarPos.x}% ${userAvatarPos.y}%`}actualizarPreviewFondoPerfil(safeBackground);document.querySelectorAll('#user-badge-avatar img,#profile-avatar-preview img').forEach(img=>img.addEventListener('error',()=>{img.remove();if(img.parentElement)img.parentElement.textContent=initial},{once:true}))}
function playErrorSound(){try{document.getElementById('error-sound').play().catch(()=>{})}catch(e){}}
function shakeElement(el){if(!el)return;el.classList.remove('shake');void el.offsetWidth;el.classList.add('shake');setTimeout(()=>el.classList.remove('shake'),500)}
function isOwner(){return userRole==='owner'}
async function obtenerUsernamesBatch(userIds){if(!userIds||userIds.length===0)return{};const map={},idsSinCaché=userIds.filter(id=>!CACHE.usernames[id]);if(idsSinCaché.length===0){userIds.forEach(id=>{map[id]=CACHE.usernames[id]});return map}try{const{data,error}=await sbClient.rpc('obtener_usernames',{p_user_ids:idsSinCaché});if(data&&!error){data.forEach(p=>{CACHE.usernames[p.user_id]=p.username;map[p.user_id]=p.username})}}catch(err){console.error('Error obteniendo usernames batch:',err)}userIds.forEach(id=>{if(!map[id])map[id]=CACHE.usernames[id]||id.substring(0,8)+'...'});return map}
function applyTheme(theme){document.documentElement.classList.add('no-transitions');document.body.setAttribute('data-theme',theme);localStorage.setItem(CONFIG.LS.THEME,theme);document.querySelectorAll('.theme-option').forEach(opt=>{opt.classList.toggle('active',opt.dataset.themeValue===theme)});const x=document.body.offsetHeight;requestAnimationFrame(()=>{document.documentElement.classList.remove('no-transitions')})}
applyTheme(localStorage.getItem(CONFIG.LS.THEME)||'dark');
function aplicarModoVisual(mode){const valid=['auto','light','full'].includes(mode)?mode:'auto';const light=valid==='light'||(valid==='auto'&&window.matchMedia&&window.matchMedia('(max-width: 700px)').matches);document.body.classList.toggle('performance-light',light);document.documentElement.dataset.displayMode=valid;localStorage.setItem(CONFIG.LS.DISPLAY_MODE,valid);document.querySelectorAll('.display-mode-option').forEach(btn=>{btn.classList.toggle('active',btn.dataset.displayMode===valid)});}
aplicarModoVisual(localStorage.getItem(CONFIG.LS.DISPLAY_MODE)||'auto');
document.querySelectorAll('.display-mode-option').forEach(btn=>btn.addEventListener('click',()=>{aplicarModoVisual(btn.dataset.displayMode);showToast(`Modo ${btn.dataset.displayMode==='auto'?'automático':btn.dataset.displayMode==='light'?'ligero':'completo'} activado`)}));
if(window.matchMedia){window.matchMedia('(max-width: 700px)').addEventListener?.('change',()=>{if((localStorage.getItem(CONFIG.LS.DISPLAY_MODE)||'auto')==='auto')aplicarModoVisual('auto')});}
function openModal(id){
  const el=document.getElementById(id);
  if(!el)return;
  el._focoPrevio=document.activeElement;
  el.classList.add('visible');
  // Se enfoca el propio diálogo (no el primer campo) para no abrir el teclado
  // en móvil, pero dejando el foco dentro para lectores de pantalla.
  const dialogo=el.querySelector('.modal');
  if(dialogo)setTimeout(()=>{try{dialogo.focus({preventScroll:true})}catch{}},40);
}
function closeModal(id){
  if(id==='politicas-modal'){const modal=document.getElementById('politicas-modal');if(modal&&modal._preventClose)return}
  const el=document.getElementById(id);
  if(!el)return;
  el.classList.remove('visible');
  const previo=el._focoPrevio;
  el._focoPrevio=null;
  if(previo&&typeof previo.focus==='function'){try{previo.focus({preventScroll:true})}catch{}}
}
document.getElementById('settings-btn').addEventListener('click',()=>{updateApiKeyUI();aplicarFondoChat();openModal('settings-modal')});
document.querySelectorAll('[data-close-modal]').forEach(btn=>{btn.addEventListener('click',()=>closeModal(btn.dataset.closeModal))});
document.querySelectorAll('.modal-overlay').forEach(overlay=>{
  overlay.addEventListener('click', function(e) {
    // Si es el modal de políticas y está bloqueado, NO cerrar bajo NINGUNA circunstancia
    if (this.id === 'politicas-modal' && this._preventClose) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Permitir cierre para otros modales (excepto summary-modal)
    if (e.target === this && this.id !== 'summary-modal') {
      this.classList.remove('visible');
    }
  });
});
document.addEventListener('keydown', function(e) {
  if (e.key === 'Tab') {
    const abierto = document.querySelector('.modal-overlay.visible .modal');
    if (abierto) {
      const focos = Array.from(abierto.querySelectorAll('button:not([hidden]):not([disabled]),[href],input:not([type="hidden"]):not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])'))
        .filter(el => el.offsetParent !== null);
      if (focos.length) {
        const primero = focos[0], ultimo = focos[focos.length - 1];
        if (e.shiftKey && (document.activeElement === primero || document.activeElement === abierto)) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
      }
    }
  }
  if (e.key === 'Escape') {
    // Verificar si el modal de políticas está visible y bloqueado
    const politicas = document.getElementById('politicas-modal');
    if (politicas.classList.contains('visible') && politicas._preventClose) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Cerrar los demás modales (excepto summary-modal)
    document.querySelectorAll('.modal-overlay.visible').forEach(m => {
      if (m.id !== 'summary-modal' && m.id !== 'politicas-modal') {
        m.classList.remove('visible');
      }
    });
  }
});
document.querySelectorAll('.theme-option').forEach(opt=>{opt.addEventListener('click',()=>{applyTheme(opt.dataset.themeValue);showToast(`Tema ${opt.dataset.themeValue==='dark'?'oscuro':'claro'} activado`)})});
document.getElementById('toggle-api-key').addEventListener('click',()=>{const input=document.getElementById('gemini-api-key');input.type=input.type==='password'?'text':'password'});
document.getElementById('save-api-key').addEventListener('click',()=>{
  const input=document.getElementById('gemini-api-key');
  const raw=(input?.value||'').trim();
  const model=modelSelector?.value||getGeminiModel();
  const summaryModel=summaryModelSelector?.value||getSummaryModel();
  if(raw){
    if(!isGeminiApiKey(raw)){showToast('API Key inválida. Verificá que pegaste la clave completa.','error');if(input)shakeElement(input);return}
    try{saveGeminiKey(raw)}catch(err){showToast('❌ '+err.message,'error');if(input)shakeElement(input);return}
  }else if(!getGeminiKey()){
    showToast('Pega tu API Key de Google AI Studio','error');
    if(input)input.focus();
    return;
  }
  setGeminiModel(model);
  setSummaryModel(summaryModel);
  updateApiKeyUI();
  actualizarIndicadoresChat();
  showToast(raw?'✅ API Key y modelos guardados':'✅ Modelos guardados');
});
document.getElementById('clear-api-key').addEventListener('click',()=>{if(getGeminiKey()&&confirm('¿Eliminar tu API Key y modelos?')){GEMINI_KEY_STORAGE.removeItem(CONFIG.LS.GEMINI_KEY);try{window.sessionStorage.removeItem(CONFIG.LS.GEMINI_KEY)}catch{};localStorage.removeItem(CONFIG.LS.GEMINI_MODEL);localStorage.removeItem(CONFIG.LS.GEMINI_SUMMARY_MODEL);updateApiKeyUI();showToast('API Key y modelos eliminados')}});
const BG_STORAGE_KEY='sair1_chat_bg';
function actualizarIndicadoresChat(){const sub=document.getElementById('chat-char-sub');if(!sub)return;const intensidad=obtenerIntensidadPersonaje(currentCharacter),modelo=getGeminiModel(),count=document.getElementById('chat-count-label')?.textContent||'Chats';sub.innerHTML=`<span id="chat-count-label">${escapeHtml(count)}</span><span id="chat-intensity-indicator" class="chat-status-badge intensity-${intensidad}">${etiquetaIntensidad(intensidad)}</span><span id="chat-model-indicator" class="chat-status-badge">🤖 ${escapeHtml(etiquetaModelo(modelo))}</span>`}
const chatSubObserver=new MutationObserver(()=>{if(!document.getElementById('chat-intensity-indicator'))actualizarIndicadoresChat()});
chatSubObserver.observe(document.getElementById('chat-char-sub'),{childList:true});
const modelSelector=document.getElementById('gemini-model');
if(modelSelector){modelSelector.value=getGeminiModel();modelSelector.addEventListener('change',()=>{setGeminiModel(modelSelector.value);actualizarIndicadoresChat();showToast(`✅ Modelo seleccionado: ${modelSelector.options[modelSelector.selectedIndex].text}`)})}
const summaryModelSelector=document.getElementById('gemini-summary-model');
if(summaryModelSelector){summaryModelSelector.value=getSummaryModel();summaryModelSelector.addEventListener('change',()=>{const safe=setSummaryModel(summaryModelSelector.value);showToast(`✅ Modelo de resúmenes: ${etiquetaModelo(safe)}`)})}
function updateApiKeyUI(){const key=getGeminiKey(),model=getGeminiModel(),sumModel=getSummaryModel(),statusEl=document.getElementById('api-key-status'),input=document.getElementById('gemini-api-key'),modelInput=document.getElementById('gemini-model'),sumModelInput=document.getElementById('gemini-summary-model');if(modelInput)modelInput.value=model;if(sumModelInput)sumModelInput.value=sumModel;if(key){statusEl.className='api-key-status saved';statusEl.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><span>API Key configurada (${key.substring(0,8)}...${key.substring(key.length-4)}) · Rol: ${etiquetaModelo(model)} · Recap: ${etiquetaModelo(sumModel)}</span>`;input.value=key}else{statusEl.className='api-key-status empty';statusEl.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span>No hay API Key configurada</span>`;input.value=''}}
function aplicarFondoChat(){const raw=localStorage.getItem(BG_STORAGE_KEY),bg=sanitizeImageUrl(raw),chatMain=document.querySelector('.chat-main'),bgImg=document.getElementById('chat-bg-img'),btnPreview=document.getElementById('btn-bg-preview');if(bg&&chatMain){chatMain.classList.add('has-background');if(bgImg){bgImg.src=bg;bgImg.alt='Fondo del chat'}if(btnPreview)btnPreview.style.display='inline-flex'}else{if(chatMain)chatMain.classList.remove('has-background');if(bgImg){bgImg.removeAttribute('src');bgImg.alt=''}if(btnPreview)btnPreview.style.display='none'}}
const observer=new MutationObserver(()=>{if(document.getElementById('chat-view').classList.contains('visible'))aplicarFondoChat()});observer.observe(document.getElementById('chat-view'),{attributes:!0,attributeFilter:['class']});
document.getElementById('btn-bg-none').addEventListener('click',()=>{localStorage.removeItem(BG_STORAGE_KEY);aplicarFondoChat();showToast('Fondo eliminado')});
document.getElementById('btn-bg-upload').addEventListener('click',()=>{document.getElementById('chat-bg-file').click()});
document.getElementById('chat-bg-file').addEventListener('change',e=>{const file=e.target.files[0];if(!file)return;if(!file.type.startsWith('image/')){showToast('❌ Solo se permiten imágenes','error');e.target.value='';return}if(file.size>5*1024*1024){showToast('❌ Imagen muy grande (máx 5MB)','error');e.target.value='';return}const reader=new FileReader();reader.onload=ev=>{const img=new Image();img.onerror=()=>{showToast('❌ Imagen inválida','error');e.target.value=''};img.onload=()=>{const maxDim=1280,ratio=Math.min(1,maxDim/Math.max(img.width,img.height)),w=Math.max(1,Math.round(img.width*ratio)),h=Math.max(1,Math.round(img.height*ratio)),canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');ctx.fillStyle='#0c0c12';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);const dataUrl=canvas.toDataURL('image/jpeg',.8);const bytes=new Blob([dataUrl]).size;if(bytes>2*1024*1024){showToast('❌ La imagen sigue pesando más de 2MB tras comprimir. Prueba con otra.','error');e.target.value='';return}try{localStorage.setItem(BG_STORAGE_KEY,dataUrl);aplicarFondoChat();showToast('✅ Fondo aplicado y comprimido')}catch(err){showToast('❌ No se pudo guardar: almacenamiento local lleno. Elimina el fondo actual o usa una imagen más pequeña.','error')}};img.src=ev.target.result};reader.readAsDataURL(file);e.target.value=''});
document.getElementById('btn-bg-preview')?.addEventListener('click',()=>{const bg=sanitizeImageUrl(localStorage.getItem(BG_STORAGE_KEY));if(bg){const win=window.open('','_blank','noopener,noreferrer');if(win){win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Vista previa</title></head><body style="margin:0;background:#111;display:flex;justify-content:center;align-items:center;min-height:100vh"><img src="'+bg.replace(/"/g,'&quot;')+'" style="max-width:100%;height:auto" alt="Fondo"></body></html>');win.document.close()}}});
/* La imagen de fondo vive en la capa #chat-bg-img, visible con
   .chat-main.has-background (CSS la muestra y difumina los mensajes). */
const bgImgEl=document.getElementById('chat-bg-img');
if(bgImgEl)bgImgEl.addEventListener('error',()=>{if(localStorage.getItem(BG_STORAGE_KEY)){localStorage.removeItem(BG_STORAGE_KEY);aplicarFondoChat();showToast('❌ El fondo guardado no se pudo cargar y fue eliminado','error')}});
let avatarData={original:null,final:null,zoom:100,x:0,y:0,sourceIsRaw:false};let avatarModificado=false;
const avatarContainer=document.getElementById('avatar-preview-container'),avatarPreview=document.getElementById('avatar-preview'),avatarPlaceholder=document.getElementById('avatar-placeholder'),avatarControls=document.getElementById('avatar-controls'),avatarFile=document.getElementById('avatar-file');
function resetAvatarSliders(){avatarData.zoom=100;avatarData.x=0;avatarData.y=0;document.getElementById('avatar-zoom').value=100;document.getElementById('avatar-x').value=0;document.getElementById('avatar-y').value=0}
function setAvatarControlsMode(mode){avatarControls.querySelectorAll('.slider-group').forEach(s=>{s.style.display=mode==='crop'?'flex':'none'})}
function drawAvatarCrop(ctx,img,size,zoom,panX,panY){ctx.save();ctx.beginPath();ctx.rect(0,0,size,size);ctx.clip();const ratio=img.width/img.height;let w,h;if(ratio>=1){h=size;w=size*ratio}else{w=size;h=size/ratio}const z=zoom/100;ctx.translate(size/2,size/2);ctx.scale(z,z);ctx.translate((panX/100)*size,(panY/100)*size);ctx.translate(-size/2,-size/2);ctx.drawImage(img,(size-w)/2,(size-h)/2,w,h);ctx.restore()}
function updateAvatarPreview(){if(!avatarData.original)return;avatarPreview.src=avatarData.original;avatarPreview.style.display='block';avatarPlaceholder.style.display='none';if(avatarData.sourceIsRaw){avatarPreview.style.transform=`scale(${avatarData.zoom/100}) translate(${avatarData.x}%, ${avatarData.y}%)`}else{avatarPreview.style.transform='none'}document.getElementById('zoom-value').textContent=avatarData.zoom+'%';document.getElementById('x-value').textContent=avatarData.x;document.getElementById('y-value').textContent=avatarData.y}
function marcarAvatarModificado(){if(!avatarData.original)return;avatarModificado=true}
avatarContainer.addEventListener('click',()=>{if(!avatarData.original){avatarFile.value='';avatarFile.click()}});
avatarFile.addEventListener('change',e=>{const file=e.target.files[0];if(!file)return;if(!file.type.startsWith('image/')){showToast('❌ Solo se permiten imágenes','error');avatarFile.value='';return}if(file.size>5*1024*1024){showToast('❌ Imagen muy grande (máx. 5MB)','error');avatarFile.value='';return}const reader=new FileReader();reader.onload=ev=>{avatarData.original=ev.target.result;avatarData.sourceIsRaw=true;avatarModificado=true;resetAvatarSliders();updateAvatarPreview();setAvatarControlsMode('crop');avatarControls.classList.add('visible');avatarContainer.classList.add('has-image')};reader.readAsDataURL(file)});
document.getElementById('avatar-zoom').addEventListener('input',e=>{if(!avatarData.sourceIsRaw)return;avatarData.zoom=parseInt(e.target.value);marcarAvatarModificado();updateAvatarPreview()});
document.getElementById('avatar-x').addEventListener('input',e=>{if(!avatarData.sourceIsRaw)return;avatarData.x=parseInt(e.target.value);marcarAvatarModificado();updateAvatarPreview()});
document.getElementById('avatar-y').addEventListener('input',e=>{if(!avatarData.sourceIsRaw)return;avatarData.y=parseInt(e.target.value);marcarAvatarModificado();updateAvatarPreview()});
document.getElementById('avatar-change').addEventListener('click',()=>{avatarFile.value='';avatarFile.click()});
document.getElementById('avatar-remove').addEventListener('click',()=>{avatarModificado=true;avatarData={original:null,final:null,zoom:100,x:0,y:0,sourceIsRaw:false};avatarPreview.style.display='none';avatarPreview.style.transform='none';avatarPlaceholder.style.display='block';avatarContainer.classList.remove('has-image');avatarControls.classList.remove('visible');setAvatarControlsMode('crop');avatarFile.value='';resetAvatarSliders()});
function procesarAvatar(){return new Promise(resolve=>{if(!avatarModificado){resolve(undefined);return}if(!avatarData.original){resolve(null);return}if(!avatarData.sourceIsRaw){resolve(avatarData.original);return}const img=new Image();img.onerror=()=>resolve(null);img.onload=()=>{const size=400,canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;const ctx=canvas.getContext('2d');drawAvatarCrop(ctx,img,size,avatarData.zoom,avatarData.x,avatarData.y);resolve(canvas.toDataURL('image/jpeg',.85))};img.src=avatarData.original})}
function setAvatarForEdit(avatarUrl){avatarModificado=false;const safeUrl=sanitizeImageUrl(avatarUrl);if(safeUrl){avatarData.original=safeUrl;avatarData.final=safeUrl;avatarData.sourceIsRaw=false;resetAvatarSliders();updateAvatarPreview();setAvatarControlsMode('view');avatarControls.classList.add('visible');avatarContainer.classList.add('has-image')}else{document.getElementById('avatar-remove').click()}}
function actualizarAvatarEnUI(personaje){if(!personaje)return;const safeAvatar=sanitizeImageUrl(personaje.avatar_url);if(currentCharacter&&currentCharacter.id===personaje.id){currentCharacter={...currentCharacter,...personaje};const avatarEl=document.getElementById('chat-char-avatar');if(avatarEl){if(safeAvatar)avatarEl.innerHTML=`<img src="${safeAvatar.replace(/"/g,'&quot;')}" alt="">`;else avatarEl.textContent=personaje.nombre.charAt(0).toUpperCase()}}}
function construirSystemPrompt({nombre,personalidad,escenario,ejemplos,themeColor,intensidad}){const LIMITS={nombre:60,personalidad:3000,escenario:2000,ejemplos:4000};if(nombre&&nombre.length>LIMITS.nombre)throw new Error(`Nombre demasiado largo (máx. ${LIMITS.nombre})`);if(personalidad&&personalidad.length>LIMITS.personalidad)throw new Error(`Personalidad demasiado larga (máx. ${LIMITS.personalidad})`);if(escenario&&escenario.length>LIMITS.escenario)throw new Error(`Escenario demasiado largo (máx. ${LIMITS.escenario})`);if(ejemplos&&ejemplos.length>LIMITS.ejemplos)throw new Error(`Ejemplos demasiado largos (máx. ${LIMITS.ejemplos})`);const partes=[];partes.push(`[Sistema de Roleplay]`);partes.push(`Interpretarás al personaje "${nombre}" de forma inmersiva y consistente.`);partes.push(``);partes.push(`REGLAS ESTRICTAS DE FORMATO:`);partes.push(`- Usa *asteriscos* para acciones, pensamientos, expresiones y entorno.`);partes.push(`- Escribe el diálogo normal sin comillas.`);partes.push(`- NUNCA rompas el personaje. NUNCA hables como IA.`);partes.push(`- Responde siempre en primera persona como ${nombre}.`);partes.push(`- Sé descriptivo con las acciones.`);partes.push(``);if(personalidad?.trim()){partes.push(`[Personalidad de ${nombre}]`);partes.push(personalidad.trim());partes.push(``)}if(escenario?.trim()){partes.push(`[Escenario]`);partes.push(escenario.trim());partes.push(``)}if(ejemplos?.trim()){partes.push(`[Ejemplos de diálogo - imita este estilo]`);partes.push(ejemplos.trim());partes.push(``)}if(themeColor){partes.push(`[ConfiguracionTema]`);partes.push(sanitizeThemeColor(themeColor));partes.push(``)}if(intensidad){partes.push(`[ConfiguracionIntensidad]`);partes.push(intensidad);partes.push(``)}partes.push(`[Final] Mantén siempre el rol de ${nombre}.`);return partes.join('\n')}
