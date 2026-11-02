/* SAIR · Personajes: guardado, tarjetas, etiquetas, me gusta y compartir.
   Se carga en orden desde index.html: los archivos comparten el ámbito global. */
/* ── Personajes: columnas opcionales, aura y etiquetas ──
   color_aura, tags y likes_count solo existen si se ejecutaron los SQL de
   4.0 y 4.2. Si faltan, la app pide las columnas de siempre y oculta lo
   que dependa de ellas. */
const COLS_PERSONAJE_BASE='id,nombre,descripcion_corta,avatar_url,publico,user_id,creado_en';
const COLS_PERSONAJE_EXTRA='color_aura,tags,likes_count';
let extrasPersonajeEnNube=true;
const ETIQUETAS_PERSONAJE={fantasia:'🐉 Fantasía',romance:'💕 Romance',aventura:'🗺️ Aventura',accion:'⚔️ Acción',terror:'👻 Terror',misterio:'🔍 Misterio',scifi:'🚀 Ciencia ficción',comedia:'😂 Comedia',drama:'🎭 Drama',anime:'🌸 Anime',historico:'🏛️ Histórico',cotidiano:'☕ Vida cotidiana'};
const MAX_ETIQUETAS=5;
function normalizarEtiquetas(lista){return[...new Set((Array.isArray(lista)?lista:[]).filter(t=>ETIQUETAS_PERSONAJE[t]))].slice(0,MAX_ETIQUETAS)}
function esErrorColumnaInexistente(error){
  const t=`${error?.code||''} ${error?.message||''}`;
  return /42703|PGRST204|column .* does not exist|Could not find the '.*' column/i.test(t);
}
// Pide las columnas extra y, si no existen, repite la consulta sin ellas.
async function consultarConExtras(construir,colsRepliegue=COLS_PERSONAJE_BASE){
  if(extrasPersonajeEnNube){
    const r=await construir(`${COLS_PERSONAJE_BASE},${COLS_PERSONAJE_EXTRA}`);
    if(!r.error||!esErrorColumnaInexistente(r.error))return r;
    extrasPersonajeEnNube=false;
    console.warn('ℹ️ Faltan columnas de personajes (ejecuta supabase_comunidad_v2.sql). Se usa el modo compatible.');
    actualizarDisponibilidadEtiquetas();
  }
  return construir(colsRepliegue);
}
// Guarda y, si alguna columna nueva no existe, reintenta sin ella.
async function guardarPersonajeConRepliegue(ejecutar,payload){
  let r=await ejecutar(payload);
  if(r.error&&esErrorColumnaInexistente(r.error)){
    const sinExtras={...payload};delete sinExtras.color_aura;delete sinExtras.tags;
    r=await ejecutar(sinExtras);
    if(r.error&&esErrorColumnaInexistente(r.error)){delete sinExtras.intensidad;r=await ejecutar(sinExtras)}
  }
  if(r.error)throw new Error(r.error.message);
  return r.data;
}
function colorAuraDe(p){
  if(/^#[0-9a-f]{6}$/i.test(p?.color_aura||''))return sanitizeThemeColor(p.color_aura.toLowerCase());
  return parsearSystemPrompt(p?.system_prompt).themeColor||'#ff4d8f';
}
async function crearPersonaje(datos){
  if(!currentUser)throw new Error('No hay sesión');
  if(!datos.nombre?.trim())throw new Error('El nombre es obligatorio');
  const system_prompt=construirSystemPrompt(datos);
  let avatar_url=await procesarAvatar();if(avatar_url===undefined)avatar_url=null;
  const payload={user_id:currentUser.id,nombre:datos.nombre.trim(),descripcion_corta:(datos.descripcion_corta||'').slice(0,200),system_prompt,avatar_url,publico:!!datos.publico,saludo:datos.saludo||null,max_tokens:parseInt(datos.max_tokens)||4096,intensidad:datos.intensidad||'suave',color_aura:sanitizeThemeColor(datos.themeColor),tags:normalizarEtiquetas(datos.tags)};
  return ejecutarConRefresh(()=>guardarPersonajeConRepliegue(p=>sbClient.from('personajes').insert(p).select().single(),payload));
}
async function actualizarPersonaje(id,datos){
  if(!currentUser)throw new Error('No hay sesión');
  const system_prompt=construirSystemPrompt(datos);
  const avatar_url=await procesarAvatar();
  const updates={nombre:datos.nombre.trim(),descripcion_corta:(datos.descripcion_corta||'').slice(0,200),system_prompt,publico:!!datos.publico,saludo:datos.saludo||null,max_tokens:parseInt(datos.max_tokens)||4096,intensidad:datos.intensidad||'suave',color_aura:sanitizeThemeColor(datos.themeColor),tags:normalizarEtiquetas(datos.tags)};
  if(avatar_url!==undefined)updates.avatar_url=avatar_url;
  return ejecutarConRefresh(()=>guardarPersonajeConRepliegue(u=>sbClient.from('personajes').update(u).eq('id',id).eq('user_id',currentUser.id).select().single(),updates));
}
// Mis personajes: solo lo que necesita la tarjeta (antes se pedía select('*'),
// prompts completos incluidos). Sin las columnas nuevas se pide el prompt
// para poder sacar el color del aura, como antes.
async function listarPersonajes(){
  if(!currentUser)return[];
  return ejecutarConRefresh(async()=>{
    const{data,error}=await consultarConExtras(cols=>sbClient.from('personajes').select(cols).eq('user_id',currentUser.id).order('creado_en',{ascending:false}),`${COLS_PERSONAJE_BASE},system_prompt`);
    if(error)throw new Error(error.message);
    return data||[];
  });
}

/* Selector de etiquetas del editor */
function etiquetasSeleccionadas(){return[...document.querySelectorAll('#char-etiquetas .etiqueta-chip[aria-pressed="true"]')].map(b=>b.dataset.tag)}
function marcarEtiquetasEditor(lista){
  const sel=new Set(normalizarEtiquetas(lista));
  document.querySelectorAll('#char-etiquetas .etiqueta-chip').forEach(b=>b.setAttribute('aria-pressed',sel.has(b.dataset.tag)?'true':'false'));
}
function actualizarDisponibilidadEtiquetas(){
  const grupo=document.getElementById('char-etiquetas-grupo');
  if(grupo)grupo.hidden=!extrasPersonajeEnNube;
}
(function iniciarSelectorEtiquetas(){
  const cont=document.getElementById('char-etiquetas');if(!cont)return;
  cont.innerHTML=Object.entries(ETIQUETAS_PERSONAJE).map(([k,v])=>`<button type="button" class="etiqueta-chip" data-tag="${k}" aria-pressed="false">${v}</button>`).join('');
  cont.addEventListener('click',e=>{
    const b=e.target.closest('.etiqueta-chip');if(!b)return;
    const activa=b.getAttribute('aria-pressed')==='true';
    if(!activa&&etiquetasSeleccionadas().length>=MAX_ETIQUETAS){showToast(`Máximo ${MAX_ETIQUETAS} etiquetas`,'error');return}
    b.setAttribute('aria-pressed',activa?'false':'true');
  });
})();

/* Tarjeta de personaje (Mis personajes y Comunidad) */
function htmlTarjetaPersonaje(p,esComunidad){
  const safeAvatar=sanitizeImageUrl(p.avatar_url);
  const avatarContent=safeAvatar?`<img src="${safeAvatar.replace(/"/g,'&quot;')}" alt="${escapeHtml(p.nombre)}" loading="lazy">`:escapeHtml(p.nombre.charAt(0).toUpperCase());
  const badge=esComunidad?'':(p.publico?'<span class="badge-public">Público</span>':'<span class="badge-private">Privado</span>');
  const authorLine=esComunidad?`<div class="character-author" data-user-id="${escapeHtml(p.user_id)}">Cargando...</div>`:'';
  const etiquetas=normalizarEtiquetas(p.tags);
  const tagsHtml=etiquetas.length?`<div class="character-tags">${etiquetas.slice(0,3).map(t=>`<span class="character-tag">${ETIQUETAS_PERSONAJE[t]}</span>`).join('')}</div>`:'';
  const id=escapeHtml(p.id),propio=p.user_id===currentUser?.id;
  const chat=`<button type="button" class="btn btn-primary btn-small btn-chat" data-id="${id}">💬 Chatear</button>`;
  const compartir=p.publico?`<button type="button" class="btn btn-ghost btn-small btn-share" data-id="${id}" data-nombre="${escapeHtml(p.nombre)}" title="Compartir" aria-label="Compartir ${escapeHtml(p.nombre)}">🔗</button>`:'';
  let acciones;
  if(esComunidad){
    const meGusta=likesEnNube&&extrasPersonajeEnNube?(()=>{const dado=misLikes.has(String(p.id));return`<button type="button" class="btn btn-ghost btn-small btn-like${dado?' activo':''}" data-id="${id}" aria-pressed="${dado}" title="${dado?'Quitar me gusta':'Me gusta'}" aria-label="Me gusta ${escapeHtml(p.nombre)}">${dado?'❤️':'🤍'} <span class="like-count">${Number(p.likes_count)||0}</span></button>`})():'';
    const reportar=!propio?`<button type="button" class="btn btn-ghost btn-small btn-report" data-id="${id}" title="Reportar" aria-label="Reportar ${escapeHtml(p.nombre)}">🚩</button>`:'';
    acciones=chat+meGusta+compartir+reportar;
  }else{
    acciones=chat+compartir+`<button type="button" class="btn btn-ghost btn-small btn-edit" data-id="${id}" title="Editar">✏️</button><button type="button" class="btn btn-danger btn-small btn-delete" data-id="${id}" title="Eliminar">🗑️</button>`;
  }
  const themeColor=colorAuraDe(p),glowColor=hexToRgba(themeColor,0.35);
  return`<div class="character-card" data-id="${id}" style="--char-color: ${themeColor}; --char-glow: ${glowColor};"><div class="character-avatar">${avatarContent}</div><div class="character-name">${escapeHtml(p.nombre)}${badge}</div>${authorLine}<div class="character-desc">${escapeHtml(p.descripcion_corta||'Sin descripción')}</div>${tagsHtml}<div class="character-actions">${acciones}</div></div>`;
}

/* "Me gusta": también hacen de favoritos */
let likesEnNube=true;
let misLikes=new Set();
let misLikesCargados=false;
async function cargarMisLikes(){
  if(misLikesCargados||!likesEnNube||!currentUser)return;
  const{data,error}=await sbClient.from('personajes_likes').select('personaje_id').eq('user_id',currentUser.id).order('creado_en',{ascending:false}).limit(1000);
  if(error){if(esErrorTablaInexistente(error)||esErrorColumnaInexistente(error)){likesEnNube=false;return}console.warn('⚠️ No se pudieron cargar tus me gusta:',error.message);return}
  misLikes=new Set((data||[]).map(r=>String(r.personaje_id)));
  misLikesCargados=true;
}
async function alternarLike(btn){
  const id=btn.dataset.id,dado=misLikes.has(id);
  const contador=btn.querySelector('.like-count');
  const pintar=(activo,delta)=>{
    btn.classList.toggle('activo',activo);btn.setAttribute('aria-pressed',String(activo));
    btn.title=activo?'Quitar me gusta':'Me gusta';
    btn.firstChild.textContent=activo?'❤️ ':'🤍 ';
    const n=Math.max(0,(parseInt(contador.textContent,10)||0)+delta);contador.textContent=n;
    const p=comunidad.lista.find(x=>String(x.id)===id);if(p)p.likes_count=n;
  };
  btn.disabled=true;
  if(dado){misLikes.delete(id);pintar(false,-1)}else{misLikes.add(id);pintar(true,1)}
  try{
    const{error}=dado
      ?await sbClient.from('personajes_likes').delete().eq('personaje_id',id).eq('user_id',currentUser.id)
      :await sbClient.from('personajes_likes').insert({personaje_id:id,user_id:currentUser.id});
    if(error&&error.code!=='23505')throw new Error(error.message);
  }catch(err){
    if(dado){misLikes.add(id);pintar(true,1)}else{misLikes.delete(id);pintar(false,-1)}
    showToast(`❌ ${err.message}`,'error');
  }finally{btn.disabled=false}
}

/* Compartir un personaje con un enlace */
function enlacePersonaje(id){return`${location.origin}${location.pathname}?personaje=${encodeURIComponent(id)}`}
async function compartirPersonaje(id,nombre){
  const url=enlacePersonaje(id);
  const datos={title:`${nombre} · SAIR`,text:`Chatea con ${nombre} en SAIR`,url};
  if(navigator.share){
    try{await navigator.share(datos);return}
    catch(err){if(err?.name==='AbortError')return}
  }
  try{await navigator.clipboard.writeText(url);showToast('🔗 Enlace copiado. Pégalo donde quieras compartirlo')}
  catch{window.prompt('Copia este enlace:',url)}
}
// Si se abrió la app con ?personaje=…, se guarda para abrir ese chat en
// cuanto haya sesión (también después de iniciar sesión).
const PERSONAJE_COMPARTIDO_KEY='sair1_personaje_compartido';
(function capturarPersonajeCompartido(){
  try{
    const params=new URLSearchParams(location.search),id=params.get('personaje');
    if(id&&/^[0-9a-f-]{36}$/i.test(id))sessionStorage.setItem(PERSONAJE_COMPARTIDO_KEY,id);
    if(params.has('personaje')){params.delete('personaje');const q=params.toString();history.replaceState(null,'',location.pathname+(q?'?'+q:'')+location.hash)}
  }catch{}
})();
async function abrirPersonajeCompartidoPendiente(){
  let id=null;
  try{id=sessionStorage.getItem(PERSONAJE_COMPARTIDO_KEY);sessionStorage.removeItem(PERSONAJE_COMPARTIDO_KEY)}catch{}
  if(!id||!currentUser)return;
  try{await abrirChatConPersonaje(id)}
  catch{showToast('Ese personaje ya no existe o dejó de ser público','error')}
}
async function obtenerPersonaje(id){return ejecutarConRefresh(async()=>{const{data,error}=await sbClient.from('personajes').select('*').or(`publico.eq.true,user_id.eq.${currentUser.id}`).eq('id',id).single();if(error)throw new Error('Personaje no encontrado');return data})}
async function eliminarPersonaje(id){return ejecutarConRefresh(async()=>{const{error}=await sbClient.from('personajes').delete().eq('id',id).eq('user_id',currentUser.id);if(error)throw new Error(error.message);return!0})}
async function listarAnuncios(){return ejecutarConRefresh(async()=>{const{data,error}=await sbClient.from('anuncios').select('*').order('creado_en',{ascending:!1}).limit(50);if(error)throw new Error(error.message);return data||[]})}
async function crearAnuncio(titulo,contenido){if(!isOwner())throw new Error('Solo el Owner puede publicar anuncios');return ejecutarConRefresh(async()=>{const{data,error}=await sbClient.from('anuncios').insert({user_id:currentUser.id,titulo:titulo.trim(),contenido:contenido.trim()}).select().single();if(error)throw new Error(error.message);return data})}
async function eliminarAnuncio(id){if(!isOwner())throw new Error('No autorizado');return ejecutarConRefresh(async()=>{const{error}=await sbClient.from('anuncios').delete().eq('id',id);if(error)throw new Error(error.message);return!0})}
async function crearNuevoChat(personajeId, historialInicial = []){if(!currentUser)throw new Error('No hay sesión');return ejecutarConRefresh(async()=>{const{data:personaje,error:pError}=await sbClient.from('personajes').select('id').or(`publico.eq.true,user_id.eq.${currentUser.id}`).eq('id',personajeId).single();if(pError||!personaje)throw new Error('No tienes permiso para chatear con este personaje');const{data,error}=await sbClient.from('chats').insert({user_id:currentUser.id,personaje_id:personajeId,historial:[]}).select().single();if(error)throw new Error(error.message);if(historialInicial.length){await reemplazarHistorialNormalizado(data.id,historialInicial)}return data})}
async function listarChats(personajeId){
  return ejecutarConRefresh(async()=>{
    const conTitulo='id,creado_en,actualizado_en,resumen,resumen_version,formato_version,personaje_id,titulo';
    const sinTitulo='id,creado_en,actualizado_en,resumen,resumen_version,formato_version,personaje_id';
    const consulta=columnas=>sbClient.from('chats').select(columnas)
      .eq('user_id',currentUser.id).eq('personaje_id',personajeId)
      .order('actualizado_en',{ascending:!1});
    let{data,error}=await consulta(titulosEnNube?conTitulo:sinTitulo);
    if(error&&error.code==='42703'&&titulosEnNube){
      // Falta supabase_chat_titulos_y_aura.sql: se sigue sin títulos.
      titulosEnNube=false;
      ({data,error}=await consulta(sinTitulo));
    }
    if(error)throw new Error(error.message);
    return data||[];
  });
}
function tituloChat(chat){return (chat&&chat.titulo&&chat.titulo.trim())||`Chat ${String((chat&&chat.id)||'').substring(0,6)}`}
function vistaPreviaChat(chat){
  const resumen=String((chat&&chat.resumen)||'').replace(/\s+/g,' ').trim();
  return resumen?resumen.slice(0,90):'Sin mensajes todavía';
}
async function guardarTituloChat(chatId,titulo){
  const limpio=String(titulo||'').trim().slice(0,80);
  try{
    const{error}=await sbClient.rpc('renombrar_chat',{p_chat_id:chatId,p_titulo:limpio});
    if(error&&!(error.code==='PGRST202'||error.code==='42883'||error.code==='42703'))throw new Error(error.message);
    if(error){
      const{error:directo}=await sbClient.from('chats').update({titulo:limpio||null}).eq('id',chatId).eq('user_id',currentUser.id);
      if(directo)throw new Error('Falta ejecutar supabase_chat_titulos_y_aura.sql para guardar el título');
      titulosEnNube=true;
    }
    const chat=chatsCache.find(c=>c.id===chatId);
    if(chat)chat.titulo=limpio||null;
    showToast(limpio?'✅ Chat renombrado':'✅ Título restablecido');
    return true;
  }catch(err){
    showToast(`⚠️ ${err.message}`,'error');
    return false;
  }
}
function editarTituloChat(item,chat){
  const titulo=item.querySelector('.chat-list-title');
  if(!titulo)return;
  const input=document.createElement('input');
  input.type='text';
  input.className='chat-list-rename';
  input.value=tituloChat(chat);
  input.maxLength=80;
  input.setAttribute('aria-label','Nombre del chat');
  titulo.replaceWith(input);
  input.focus();
  input.select();
  let terminado=false;
  const cerrar=async guardar=>{
    if(terminado)return;
    terminado=true;
    const valor=input.value.trim();
    if(guardar&&valor&&valor!==tituloChat(chat))await guardarTituloChat(chat.id,valor);
    pintarListaChats();
  };
  input.addEventListener('click',e=>e.stopPropagation());
  input.addEventListener('blur',()=>cerrar(true));
  input.addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();input.blur()}
    else if(e.key==='Escape'){e.preventDefault();terminado=true;pintarListaChats()}
  });
}
async function eliminarChat(chatId){return ejecutarConRefresh(async()=>{const{error}=await sbClient.from('chats').delete().eq('id',chatId).eq('user_id',currentUser.id);if(error)throw new Error(error.message);return!0})}
async function cargarHistorialChat(chatId, opciones = {}) {
  const paginado = opciones.paginado === true;
  const limite = Math.max(1, Math.min(Number(opciones.limit) || CHAT_LIMITE, 100));
  const offset = Math.max(0, Number(opciones.offset) || 0);
  return ejecutarConRefresh(async () => {
    const { data: chat, error: chatError } = await sbClient.from('chats')
      .select('resumen,resumen_version,formato_version').eq('id', chatId).eq('user_id', currentUser.id).single();
    if (chatError) throw new Error(chatError.message);
    let rows = [], totalMensajes = 0, usandoLegacy = false;
    // El JSONB legacy sólo se descarga en chats que todavía no usan el formato
    // normalizado: era lo que más pesaba en cada carga de historial.
    let historialLegacy = null;
    const versionFormato = Number(chat?.formato_version || 0);
    if (versionFormato < 2) {
      const { data: legacyRow } = await sbClient.from('chats')
        .select('historial').eq('id', chatId).eq('user_id', currentUser.id).single();
      historialLegacy = Array.isArray(legacyRow?.historial) ? legacyRow.historial : null;
    }
    const columnasMensajes = () => variantesEnNube ? COLS_MENSAJE_VARIANTES : COLS_MENSAJE_BASE;
    const consultaMensajes = (columnas, extra) => {
      const q = sbClient.from('mensajes').select(columnas, extra).eq('chat_id', chatId);
      return paginado
        ? q.order('orden', { ascending: false, nullsFirst: false }).order('creado_en', { ascending: false, nullsFirst: false })
           .order('id', { ascending: false }).range(offset, offset + limite - 1)
        : q.order('orden', { ascending: true, nullsFirst: false }).order('creado_en', { ascending: true }).order('id', { ascending: true });
    };
    const extraSelect = paginado ? { count: 'exact' } : {};
    let { data: filas, count, error: messagesError } = await consultaMensajes(columnasMensajes(), extraSelect);
    if (messagesError && messagesError.code === '42703' && variantesEnNube) {
      // La migración de variantes aún no está aplicada: se sigue funcionando
      // sin ellas en lugar de romper la carga del chat.
      variantesEnNube = false;
      ({ data: filas, count, error: messagesError } = await consultaMensajes(COLS_MENSAJE_BASE, extraSelect));
    }
    if (messagesError) throw new Error(messagesError.message);
    rows = filas || [];
    if (paginado) { rows = rows.reverse(); totalMensajes = Number.isFinite(count) ? count : offset + rows.length; }
    else { totalMensajes = rows.length; }
    if (rows.length === 0 && Array.isArray(historialLegacy) && versionFormato < 2) {
      const legacyMessages = historialLegacy.filter(m => m && ['user', 'assistant'].includes(m.rol));
      totalMensajes = legacyMessages.length; usandoLegacy = true;
      if (paginado) { const fin = Math.max(totalMensajes - offset, 0); rows = legacyMessages.slice(Math.max(fin - limite, 0), fin); }
      else rows = legacyMessages;
    }
    let mensajes = rows.map(m => {
      const item = { id: m.id, rol: m.rol, contenido: m.contenido, creado_en: m.creado_en, orden: m.orden };
      if (Array.isArray(m.variantes) && m.variantes.length) {
        item.variantes = m.variantes;
        item.variante_activa = Number(m.variante_activa) || 0;
      }
      return item;
    });
    const resumenLegacy = Array.isArray(historialLegacy) ? historialLegacy.find(m => m?.rol === 'summary') : null;
    const resumen = chat?.resumen || resumenLegacy?.contenido;
    if (resumen) mensajes = [{ id: `summary-${chat.resumen_version || resumenLegacy?.summary_version || 1}`, rol: 'summary', contenido: resumen, summary_version: chat.resumen_version || resumenLegacy?.summary_version || 1, orden: 0 }, ...mensajes];
    const historialGemini = mensajes.filter(m => m.rol === 'user' || m.rol === 'assistant').map(m => ({ role: m.rol === 'assistant' ? 'model' : 'user', parts: [{ text: m.contenido }] }));
    const hasMore = paginado && rows.length > 0 && offset + rows.length < totalMensajes;
    return { mensajes, historialGemini, totalMensajes, hasMore, offset, limit: limite, paginado, usandoLegacy };
  });
}
async function cargarHistorialCompleto(chatId) {
  return cargarHistorialChat(chatId, { paginado: false });
}

async function reemplazarHistorialNormalizado(chatId,historial){const resumenItem=(historial||[]).find(m=>m?.rol==='summary');const mensajes=(historial||[]).filter(m=>m&&['user','assistant'].includes(m.rol)).map(m=>{const item={id:m.id||null,rol:m.rol,contenido:String(m.contenido||''),creado_en:m.creado_en||null};const variantes=Array.isArray(m.variantes)?m.variantes.filter(v=>typeof v==='string'):[];if(variantes.length){item.variantes=variantes;item.variante_activa=Math.max(0,Number(m.variante_activa)||0)}return item});const{error}=await sbClient.rpc('reemplazar_historial_chat',{p_chat_id:chatId,p_resumen:resumenItem?.contenido||null,p_resumen_version:resumenItem?.summary_version||1,p_mensajes:mensajes});if(error)throw new Error(error.message);return!0}
async function guardarMensaje(chatId,rol,contenido){return ejecutarConRefresh(async()=>{const{data,error}=await sbClient.rpc('guardar_mensaje_chat',{p_chat_id:chatId,p_rol:rol,p_contenido:contenido});if(error)throw new Error(error.message);const nuevoMsg=Array.isArray(data)?data[0]:data;if(!nuevoMsg)throw new Error('No se pudo guardar el mensaje');return nuevoMsg})}
async function eliminarMensajeDeChat(chatId,mensajeId){return ejecutarConRefresh(async()=>{const{mensajes}=await cargarHistorialCompleto(chatId),nuevoHistorial=mensajes.filter(m=>m.id!==mensajeId);if(nuevoHistorial.length===mensajes.length)throw new Error('Mensaje no encontrado');await reemplazarHistorialNormalizado(chatId,nuevoHistorial);return!0})}
async function actualizarHistorialChat(chatId,nuevoHistorial){return ejecutarConRefresh(async()=>reemplazarHistorialNormalizado(chatId,nuevoHistorial))}
async function* enviarAGeminiStream(systemPrompt,mensajes,nuevoMensaje,maxTokens=4096){const idUso=iniciarPeticionUso();const apiKey=getGeminiKey();if(!apiKey)throw new Error('⚠️ Configura tu API Key de Gemini en los Ajustes de Rol (🎭)');let resumen='',mensajesSinResumen=mensajes.filter(m=>m.rol==='user'||m.rol==='assistant');const summaries=mensajes.filter(m=>m.rol==='summary');if(summaries.length>0){resumen=summaries.map(s=>s.contenido).join('\n\n');mensajesSinResumen=mensajes.filter(m=>m.rol==='user'||m.rol==='assistant')}const systemPromptFinal=anexarLorebookAlPrompt(mensajesSinResumen,nuevoMensaje,anexarNotasRolAlPrompt(resumen?`${systemPrompt}\n\n[RESUMEN DE CONVERSACIONES ANTERIORES - CONTEXTO IMPORTANTE]:\n${resumen}\n\n[FIN DEL RESUMEN - Continúa con el roleplay normal manteniendo toda la información del resumen]`:systemPrompt));const model=getGeminiModel();let historialGemini=mensajesSinResumen.map(m=>({role:m.rol==='assistant'?'model':'user',parts:[{text:m.contenido}]}));const ultimo=mensajesSinResumen[mensajesSinResumen.length-1];if(nuevoMensaje&&!(ultimo&&ultimo.rol==='user'&&ultimo.contenido===nuevoMensaje)){historialGemini.push({role:'user',parts:[{text:nuevoMensaje}]})}if(historialGemini.length===0)throw new Error('No hay mensajes para enviar a Gemini');const parsed=parsearSystemPrompt(currentCharacter?.system_prompt);const intensidadVal=currentCharacter?.intensidad||parsed.intensidad||'suave';const body={system_instruction:{parts:[{text:systemPromptFinal}]},contents:historialGemini,safetySettings:getSafetySettings(intensidadVal),generationConfig:{temperature:.9,topP:.95,topK:40,maxOutputTokens:maxTokens}},url=geminiUrl(model,true),controller=new AbortController();
abortarGeneracion=controller;
let timeoutId=setTimeout(()=>controller.abort('timeout'),30e4);
let response;try{response=await fetch(url,{method:'POST',headers:geminiHeaders(apiKey),body:JSON.stringify(body),signal:controller.signal})}catch(err){
  if(abortarGeneracion===controller)abortarGeneracion=null;
  if(err.name==='AbortError'){
    if(controller.signal.reason==='usuario'){generacionCancelada=true;throw new Error('Generación detenida.')}
    throw new Error('Tiempo de espera agotado. Gemini no respondió a tiempo.')
  }
  throw err;
}
finally{clearTimeout(timeoutId)}
clearTimeout(timeoutId);
timeoutId=setTimeout(()=>controller.abort('stall'),90000);if(!response.ok){const errText=await response.text();let msg=`Error de Gemini (${response.status})`;try{const errJson=JSON.parse(errText);if(errJson.error?.message)msg=errJson.error.message}catch{}throw new Error(mensajeErrorGemini(msg))}if(!response.body)throw new Error('Gemini no devolvió una respuesta válida');const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',yieldedText=!1;const parseLine=line=>{const trimmed=line.trim();if(!trimmed)return;let payload=trimmed;if(payload.startsWith('data:'))payload=payload.slice(5).trim();if(!payload||payload==='[DONE]')return;let json;try{json=JSON.parse(payload)}catch{return}if(json.usageMetadata)anotarUso(idUso,json.usageMetadata);if(json.error?.message)throw new Error(mensajeErrorGemini(json.error.message));const candidate=json.candidates?.[0];if(!candidate)return;const finishReason=candidate.finishReason;if(finishReason)lastGeminiFinishReason=finishReason;if(finishReason&&finishReason!=='STOP'&&finishReason!=='MAX_TOKENS'){throw new Error(finishReason==='SAFETY'?'Respuesta bloqueada por filtros de seguridad':`Gemini detuvo la respuesta (${finishReason})`)}const text=candidate.content?.parts?.map(p=>p.text||'').join('')||'';if(text){yieldedText=true;return text}};try{
for(;;){const{done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop()||'';for(const line of lines){const text=parseLine(line);if(text)yield text}}buffer+=decoder.decode();for(const line of buffer.split('\n')){const text=parseLine(line);if(text)yield text}if(!yieldedText)throw new Error('Gemini no generó ninguna respuesta. Intenta de nuevo.')
}catch(err){
  // Abortar el stream hace que reader.read() rechace (con un AbortError o con
  // el propio motivo del abort), así que la cancelación se traduce aquí.
  const abortado=!!controller.signal.aborted||(err&&err.name==='AbortError')||err==='usuario'||(err&&err.message==='usuario');
  if(abortado){
    if(controller.signal.reason==='usuario'){generacionCancelada=true;throw new Error('Generación detenida.')}
    throw new Error('Tiempo de espera agotado. Gemini no respondió a tiempo.')
  }
  throw err;
}finally{
  clearTimeout(timeoutId);
  if(abortarGeneracion===controller)abortarGeneracion=null;
}
}
async function fetchWithRetry(fn,retries=2,delay=1e3){for(let i=0;i<=retries;i++){try{return await fn()}catch(err){if(err.message&&(err.message.includes('JWT expired')||err.message.includes('jwt expired')||err.message.includes('invalid token')||err.message.includes('token expired'))){try{const{data,error}=await sbClient.auth.refreshSession();if(error){console.error('❌ Error al refrescar sesión:',error);await sbClient.auth.signOut();currentUser=null;userRole=null;userUsername=null;showAuth();throw new Error('Sesión expirada. Inicia sesión de nuevo.')}if(data.session){currentUser=data.session.user;await cargarPerfilYRol();console.log('✅ Sesión refrescada correctamente');return await fn()}}catch(refreshErr){console.error('❌ Falló el refresco de sesión:',refreshErr);await sbClient.auth.signOut();currentUser=null;userRole=null;userUsername=null;showAuth();throw new Error('Sesión expirada. Inicia sesión de nuevo.')}}if(i===retries)throw err;await new Promise(r=>setTimeout(r,delay*(i+1)))}}}
async function renderCharacters(){if(currentView==='community'){renderComunidad();return}const container=document.getElementById('characters-container'),cacheKey=currentView==='my-characters'?'personajes':'personajesComunidad';if(LOADING[cacheKey])return;if(isCacheValid(cacheKey)&&CACHE[cacheKey]){renderCharactersGrid(CACHE[cacheKey],currentView!=='my-characters');return}LOADING[cacheKey]=!0;container.innerHTML=`<div style="max-width:1280px;margin:0 auto"><div style="margin-bottom:1.5rem;"><div class="skeleton-line short" style="height:24px;"></div></div><div class="characters-grid">${Array(6).fill(0).map(()=>`<div class="skeleton-card"><div class="skeleton-avatar"></div><div class="skeleton-line medium"></div><div class="skeleton-line short"></div><div class="skeleton-line"></div></div>`).join('')}</div></div>`;try{let personajes,esComunidad=!1;if(currentView==='my-characters')personajes=await fetchWithRetry(()=>listarPersonajes());else{personajes=await fetchWithRetry(()=>listarPersonajesComunidad());esComunidad=!0}CACHE[cacheKey]=personajes;CACHE.cacheTime[cacheKey]=Date.now();renderCharactersGrid(personajes,esComunidad)}catch(err){console.error('Error en renderCharacters:',err);container.innerHTML=`<div class="empty-state"><div class="empty-state-icon">⚠️</div><h3 style="font-family:var(--font-display);color:var(--text-1);margin-bottom:.5rem">Error al cargar</h3><p style="color:var(--text-3);margin-bottom:1.5rem">${escapeHtml(err.message)}</p><button type="button" class="btn btn-primary" onclick="renderCharacters()">🔄 Reintentar</button></div>`}finally{LOADING[cacheKey]=!1}}
function renderCharactersGrid(personajes,esComunidad,container=document.getElementById('characters-container')){if(!personajes||personajes.length===0){if(esComunidad&&comunidad.favoritos&&!comunidad.q&&!comunidad.etiqueta){container.innerHTML=`<div class="empty-state"><div class="empty-state-icon">🤍</div><h3>Aún no tienes favoritos</h3><p>Pulsa el corazón de un personaje para guardarlo aquí</p></div>`}else if(esComunidad&&(comunidad.q||comunidad.etiqueta||comunidad.favoritos)){container.innerHTML=`<div class="empty-state"><div class="empty-state-icon">🔎</div><h3>Sin resultados</h3><p>${comunidad.q?`No hay personajes que coincidan con «${escapeHtml(comunidad.q)}»`:'No hay personajes con esos filtros'}</p></div>`}else if(esComunidad){container.innerHTML=`<div class="empty-state"><div class="empty-state-icon">🌍</div><h3>Aún no hay personajes públicos</h3><p>Sé el primero en compartir un personaje con la comunidad</p></div>`}else{container.innerHTML=`<div class="empty-state"><div class="empty-state-icon">✨</div><h3>Aún no tienes personajes</h3><p>Crea tu primer personaje para empezar a chatear</p><button type="button" class="btn btn-primary" onclick="document.getElementById('btn-nuevo-personaje').click()">Crear mi primer personaje</button></div>`}return}const titulo=esComunidad?`🌍 Personajes de la Comunidad (${personajes.length}${comunidad.hayMas?'+':''})`:`🎭 Mis Personajes (${personajes.length})`;container.innerHTML=`<div style="max-width:1280px;margin:0 auto 1.5rem"><h2 class="section-title">${titulo}</h2></div><div class="characters-grid" id="characters-grid-content"></div>`;const grid=container.querySelector('#characters-grid-content');grid.innerHTML=personajes.map(p=>htmlTarjetaPersonaje(p,esComunidad)).join('');if(esComunidad){const userIds=[...new Set(personajes.map(p=>p.user_id))];obtenerUsernamesBatch(userIds).then(usernamesMap=>{grid.querySelectorAll('.character-author[data-user-id]').forEach(authorEl=>{const uid=authorEl.dataset.userId;authorEl.textContent=uid===currentUser.id?'👤 Tú':`por @${usernamesMap[uid]||'anónimo'}`})})}grid.querySelectorAll('.btn-delete').forEach(btn=>{btn.addEventListener('click',async e=>{e.stopPropagation();if(confirm('¿Eliminar este personaje? Se borrarán también sus chats.')){try{await fetchWithRetry(()=>eliminarPersonaje(btn.dataset.id));showToast('Personaje eliminado');CACHE.personajes=null;CACHE.cacheTime.personajes=0;renderCharacters()}catch(err){showToast(err.message,'error')}}})});grid.querySelectorAll('.btn-edit').forEach(btn=>{btn.addEventListener('click',async e=>{e.stopPropagation();await abrirEditorPersonaje(btn.dataset.id)})});grid.querySelectorAll('.btn-chat').forEach(btn=>{btn.addEventListener('click',async e=>{e.stopPropagation();await abrirChatConPersonaje(btn.dataset.id)})});grid.querySelectorAll('.btn-report').forEach(btn=>{btn.addEventListener('click',e=>{e.stopPropagation();const p=personajes.find(x=>String(x.id)===btn.dataset.id);abrirReporte(btn.dataset.id,p?.nombre||'este personaje')})})}
