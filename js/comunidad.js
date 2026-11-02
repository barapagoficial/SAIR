/* SAIR · Comunidad y reportes, chats y lista de personajes.
   Se carga en orden desde index.html: los archivos comparten el ámbito global. */
/* ── Comunidad: búsqueda, orden, etiquetas, favoritos y "Cargar más" ──
   Se piden de 24 en 24. "Más populares", las etiquetas y los favoritos
   solo aparecen si la base de datos tiene las columnas de la 4.2. */
const COMUNIDAD_POR_PAGINA=24;
const ORDENES_COMUNIDAD={recientes:[['creado_en',false]],antiguos:[['creado_en',true]],nombre:[['nombre',true]],populares:[['likes_count',false],['creado_en',false]]};
const comunidad={q:'',orden:'recientes',etiqueta:'',favoritos:false,lista:[],hayMas:false,peticion:0};
const MOTIVOS_REPORTE={contenido_sexual_menores:'Contenido sexual con menores',odio_acoso:'Odio o acoso',violencia_extrema:'Violencia extrema',spam:'Spam o publicidad',suplantacion:'Suplanta a una persona real',otro:'Otro motivo'};
// Quita los caracteres con significado especial en los filtros de PostgREST.
function limpiarBusquedaComunidad(q){return String(q||'').replace(/[%_,()*\\:."'`]/g,' ').replace(/\s+/g,' ').trim().slice(0,60)}
async function listarPersonajesComunidad({q='',orden='recientes',etiqueta='',favoritos=false,desde=0}={}){
  if(!currentUser)return{filas:[],hayMas:false};
  if(favoritos&&!misLikes.size)return{filas:[],hayMas:false};
  return ejecutarConRefresh(async()=>{
    const construir=cols=>{
      const extras=cols.includes('likes_count');
      let consulta=sbClient.from('personajes').select(cols).eq('publico',true);
      const texto=limpiarBusquedaComunidad(q);
      if(texto)consulta=consulta.or(`nombre.ilike.*${texto}*,descripcion_corta.ilike.*${texto}*`);
      if(etiqueta&&extras&&ETIQUETAS_PERSONAJE[etiqueta])consulta=consulta.contains('tags',[etiqueta]);
      if(favoritos)consulta=consulta.in('id',[...misLikes].slice(0,300));
      const criterios=(orden==='populares'&&!extras)?ORDENES_COMUNIDAD.recientes:(ORDENES_COMUNIDAD[orden]||ORDENES_COMUNIDAD.recientes);
      for(const[col,asc]of criterios)consulta=consulta.order(col,{ascending:asc});
      // Se pide uno de más para saber si queda otra página.
      return consulta.order('id',{ascending:true}).range(desde,desde+COMUNIDAD_POR_PAGINA);
    };
    const{data,error}=await consultarConExtras(construir);
    if(error)throw new Error(error.message);
    const filas=data||[];
    return{filas:filas.slice(0,COMUNIDAD_POR_PAGINA),hayMas:filas.length>COMUNIDAD_POR_PAGINA};
  });
}
function renderComunidad(){
  const container=document.getElementById('characters-container');
  container.innerHTML=`<div class="comunidad-toolbar">
<input id="comunidad-q" class="form-input comunidad-busqueda" type="search" placeholder="Buscar por nombre o descripción…" maxlength="60" autocomplete="off" aria-label="Buscar personajes de la comunidad">
<select id="comunidad-orden" class="form-input comunidad-orden" aria-label="Ordenar personajes"><option value="recientes">Más recientes</option><option value="populares">❤️ Más populares</option><option value="antiguos">Más antiguos</option><option value="nombre">Nombre (A-Z)</option></select>
<button type="button" class="btn btn-ghost btn-small" id="btn-comunidad-favoritos" aria-pressed="false">❤️ Mis favoritos</button>
${isOwner()?'<button type="button" class="btn btn-ghost btn-small" id="btn-ver-reportes">🚩 Reportes</button>':''}
</div>
<div class="comunidad-etiquetas" id="comunidad-etiquetas" role="group" aria-label="Filtrar por etiqueta"><button type="button" class="etiqueta-chip" data-tag="" aria-pressed="true">Todas</button>${Object.entries(ETIQUETAS_PERSONAJE).map(([k,v])=>`<button type="button" class="etiqueta-chip" data-tag="${k}" aria-pressed="false">${v}</button>`).join('')}</div>
<div id="comunidad-resultados" aria-live="polite"></div><div class="comunidad-mas"><button type="button" class="btn btn-ghost" id="btn-comunidad-mas" hidden>Cargar más</button></div>`;
  const input=document.getElementById('comunidad-q'),orden=document.getElementById('comunidad-orden'),fav=document.getElementById('btn-comunidad-favoritos'),chips=document.getElementById('comunidad-etiquetas');
  input.value=comunidad.q;orden.value=comunidad.orden;
  fav.setAttribute('aria-pressed',String(comunidad.favoritos));
  chips.querySelectorAll('.etiqueta-chip').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tag===comunidad.etiqueta)));
  actualizarToolbarComunidad();
  let timer=null;
  input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{const q=input.value.trim();if(q===comunidad.q)return;comunidad.q=q;cargarComunidad(true)},350)});
  orden.addEventListener('change',()=>{comunidad.orden=orden.value;cargarComunidad(true)});
  fav.addEventListener('click',()=>{comunidad.favoritos=!comunidad.favoritos;fav.setAttribute('aria-pressed',String(comunidad.favoritos));cargarComunidad(true)});
  chips.addEventListener('click',e=>{
    const b=e.target.closest('.etiqueta-chip');if(!b)return;
    comunidad.etiqueta=b.dataset.tag;
    chips.querySelectorAll('.etiqueta-chip').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
    cargarComunidad(true);
  });
  document.getElementById('btn-comunidad-mas').addEventListener('click',()=>cargarComunidad(false));
  document.getElementById('btn-ver-reportes')?.addEventListener('click',abrirReportes);
  cargarComunidad(true);
}
// Oculta los controles que dependen de columnas o tablas que no existen.
function actualizarToolbarComunidad(){
  const extras=extrasPersonajeEnNube,likes=likesEnNube&&extras;
  const chips=document.getElementById('comunidad-etiquetas');if(chips)chips.hidden=!extras;
  const fav=document.getElementById('btn-comunidad-favoritos');if(fav)fav.hidden=!likes;
  const pop=document.querySelector('#comunidad-orden option[value="populares"]');if(pop){pop.hidden=!extras;pop.disabled=!extras}
  if(!extras){comunidad.etiqueta='';if(comunidad.orden==='populares'){comunidad.orden='recientes';const o=document.getElementById('comunidad-orden');if(o)o.value='recientes'}}
  if(!likes)comunidad.favoritos=false;
}
async function cargarComunidad(reiniciar){
  const res=document.getElementById('comunidad-resultados');if(!res)return;
  const btn=document.getElementById('btn-comunidad-mas');
  const id=++comunidad.peticion;
  if(reiniciar){
    comunidad.lista=[];comunidad.hayMas=false;
    res.innerHTML=`<div class="characters-grid">${Array(6).fill(0).map(()=>`<div class="skeleton-card"><div class="skeleton-avatar"></div><div class="skeleton-line medium"></div><div class="skeleton-line short"></div><div class="skeleton-line"></div></div>`).join('')}</div>`;
    if(btn)btn.hidden=true;
  }
  if(btn){btn.disabled=true;btn.textContent='Cargando…'}
  try{
    await cargarMisLikes();
    const{filas,hayMas}=await fetchWithRetry(()=>listarPersonajesComunidad({q:comunidad.q,orden:comunidad.orden,etiqueta:comunidad.etiqueta,favoritos:comunidad.favoritos,desde:comunidad.lista.length}));
    if(id!==comunidad.peticion)return; // llegó una respuesta más nueva
    actualizarToolbarComunidad();
    const vistos=new Set(comunidad.lista.map(p=>p.id));
    comunidad.lista.push(...filas.filter(p=>!vistos.has(p.id)));
    comunidad.hayMas=hayMas;
    renderCharactersGrid(comunidad.lista,true,res);
    if(btn){btn.hidden=!hayMas;btn.disabled=false;btn.textContent='Cargar más'}
  }catch(err){
    if(id!==comunidad.peticion)return;
    console.error('Error cargando la Comunidad:',err);
    if(btn){btn.disabled=false;btn.textContent='Cargar más'}
    if(reiniciar)res.innerHTML=`<div class="empty-state"><div class="empty-state-icon">⚠️</div><h3>Error al cargar</h3><p>${escapeHtml(err.message)}</p><button type="button" class="btn btn-primary" onclick="cargarComunidad(true)">🔄 Reintentar</button></div>`;
    else showToast(`❌ ${err.message}`,'error');
  }
}
// Botones de las tarjetas que no dependen de qué lista se pintó.
document.getElementById('characters-container')?.addEventListener('click',e=>{
  const like=e.target.closest('.btn-like');
  if(like){e.stopPropagation();if(!like.disabled)alternarLike(like);return}
  const share=e.target.closest('.btn-share');
  if(share){e.stopPropagation();compartirPersonaje(share.dataset.id,share.dataset.nombre||'este personaje')}
});
function esErrorTablaInexistente(error){
  const t=`${error?.code||''} ${error?.message||''}`;
  return /42P01|PGRST20[0-5]|does not exist|schema cache|Could not find/i.test(t);
}
let reportePersonajeId=null;
function abrirReporte(id,nombre){
  reportePersonajeId=id;
  document.getElementById('report-personaje').textContent=`Vas a reportar «${nombre}». El equipo de SAIR revisará el reporte y, si incumple las normas, lo retirará de la Comunidad.`;
  document.getElementById('form-report').reset();
  openModal('report-modal');
}
document.getElementById('form-report')?.addEventListener('submit',async e=>{
  e.preventDefault();
  if(!reportePersonajeId||!currentUser)return;
  const btn=e.target.querySelector('button[type="submit"]');
  const motivo=document.getElementById('report-motivo').value;
  const detalle=document.getElementById('report-detalle').value.trim().slice(0,500)||null;
  btn.disabled=true;
  try{
    const{error}=await sbClient.from('reportes_personajes').insert({personaje_id:reportePersonajeId,reportado_por:currentUser.id,motivo,detalle});
    if(error){
      if(error.code==='23505'){closeModal('report-modal');showToast('Ya habías reportado este personaje. Gracias');return}
      if(esErrorTablaInexistente(error))throw new Error('Los reportes todavía no están activados en el servidor');
      throw new Error(error.message);
    }
    closeModal('report-modal');
    showToast('✅ Reporte enviado. Gracias por ayudar a cuidar la Comunidad');
  }catch(err){showToast(`❌ ${err.message}`,'error')}
  finally{btn.disabled=false}
});
async function abrirReportes(){
  if(!isOwner())return;
  const lista=document.getElementById('reportes-lista');
  lista.innerHTML='<p class="reportes-vacio">Cargando reportes…</p>';
  openModal('reportes-modal');
  try{
    const{data,error}=await sbClient.from('reportes_personajes').select('id,motivo,detalle,creado_en,personaje_id,personajes(nombre)').order('creado_en',{ascending:false}).limit(200);
    if(error){if(esErrorTablaInexistente(error))throw new Error('Ejecuta supabase_comunidad_reportes.sql en Supabase para activar los reportes');throw new Error(error.message)}
    const grupos=new Map();
    for(const r of data||[]){
      if(!grupos.has(r.personaje_id))grupos.set(r.personaje_id,{nombre:r.personajes?.nombre||'(personaje eliminado)',reportes:[]});
      grupos.get(r.personaje_id).reportes.push(r);
    }
    if(!grupos.size){lista.innerHTML='<p class="reportes-vacio">🎉 No hay reportes pendientes</p>';return}
    lista.innerHTML=[...grupos.entries()].sort((a,b)=>b[1].reportes.length-a[1].reportes.length).map(([pid,g])=>`<div class="reporte-item" data-personaje-id="${escapeHtml(pid)}">
<div class="reporte-cabecera"><strong>${escapeHtml(g.nombre)}</strong><span class="reporte-contador">${g.reportes.length} ${g.reportes.length===1?'reporte':'reportes'}</span></div>
<ul class="reporte-motivos">${g.reportes.slice(0,5).map(r=>`<li>${escapeHtml(MOTIVOS_REPORTE[r.motivo]||r.motivo)}${r.detalle?` — <em>${escapeHtml(r.detalle)}</em>`:''}</li>`).join('')}${g.reportes.length>5?`<li>…y ${g.reportes.length-5} más</li>`:''}</ul>
<div class="reporte-acciones"><button type="button" class="btn btn-danger btn-small" data-accion="retirar">Retirar de la Comunidad</button><button type="button" class="btn btn-ghost btn-small" data-accion="descartar">Descartar</button></div>
</div>`).join('');
  }catch(err){lista.innerHTML=`<p class="reportes-vacio">⚠️ ${escapeHtml(err.message)}</p>`}
}
document.getElementById('reportes-lista')?.addEventListener('click',async e=>{
  const btn=e.target.closest('button[data-accion]');if(!btn)return;
  const item=btn.closest('.reporte-item'),pid=item?.dataset.personajeId;if(!pid)return;
  const retirar=btn.dataset.accion==='retirar';
  if(retirar&&!confirm('¿Retirar este personaje de la Comunidad? Pasará a ser privado para su autor.'))return;
  item.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{
    const{error}=retirar
      ?await sbClient.rpc('retirar_personaje_reportado',{p_personaje_id:pid})
      :await sbClient.from('reportes_personajes').delete().eq('personaje_id',pid);
    if(error)throw new Error(error.message);
    showToast(retirar?'✅ Personaje retirado de la Comunidad':'Reportes descartados');
    if(retirar&&currentView==='community')cargarComunidad(true);
    abrirReportes();
  }catch(err){showToast(`❌ ${err.message}`,'error');item.querySelectorAll('button').forEach(b=>b.disabled=false)}
});
async function renderAnuncios(){const container=document.getElementById('characters-container');if(LOADING.anuncios)return;if(isCacheValid('anuncios')&&CACHE.anuncios){renderAnunciosContent(CACHE.anuncios);return}LOADING.anuncios=!0;container.innerHTML='<p style="color:var(--text-3);text-align:center;padding:2rem">Cargando anuncios...</p>';try{const anuncios=await fetchWithRetry(()=>listarAnuncios());CACHE.anuncios=anuncios;CACHE.cacheTime.anuncios=Date.now();renderAnunciosContent(anuncios)}catch(err){console.error('Error en renderAnuncios:',err);container.innerHTML=`<div class="empty-state"><div class="empty-state-icon">⚠️</div><h3 style="font-family:var(--font-display);color:var(--text-1);margin-bottom:.5rem">Error al cargar anuncios</h3><p style="color:var(--text-3);margin-bottom:1.5rem">${escapeHtml(err.message)}</p><button type="button" class="btn btn-primary" onclick="renderAnuncios()">🔄 Reintentar</button></div>`}finally{LOADING.anuncios=!1}}
function renderAnunciosContent(anuncios){const container=document.getElementById('characters-container');let html='';if(isOwner()){html+=`<div class="announcement-form"><div class="announcement-form-title"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--pink)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>Publicar nuevo anuncio</div><form id="form-anuncio"><div class="form-group"><input type="text" id="anuncio-titulo" class="form-input" placeholder="Título del anuncio" required maxlength="100"></div><div class="form-group"><textarea id="anuncio-contenido" class="form-textarea" placeholder="Escribe el contenido del anuncio..." required maxlength="2000"></textarea></div><div class="announcement-form-actions"><button type="submit" class="btn btn-primary"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>Publicar anuncio</button></div></form></div>`}if(anuncios.length===0){html+=`<div class="no-announcements"><div class="empty-state-icon">📢</div><h3 style="font-family:var(--font-display);color:var(--text-1);margin-bottom:.5rem">No hay anuncios aún</h3><p style="color:var(--text-3)">Los anuncios del Owner aparecerán aquí</p></div>`}else{html+=`<div class="announcements-container">`;html+=anuncios.map(a=>`<div class="announcement-card" data-id="${a.id}">${isOwner()?`<button type="button" class="announcement-delete" data-id="${a.id}" title="Eliminar anuncio"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg></button>`:''}<div class="announcement-header"><span class="announcement-badge"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>Owner</span><span class="announcement-author" data-user-id="${a.user_id}"><span class="announcement-author-avatar">?</span>por @cargando...</span><span class="announcement-date">${formatDate(a.creado_en)}</span></div><div class="announcement-title">${escapeHtml(a.titulo)}</div><div class="announcement-content">${escapeHtml(a.contenido)}</div></div>`).join('');html+=`</div>`}container.innerHTML=html;const authorUserIds=[...new Set(anuncios.map(a=>a.user_id))];obtenerUsernamesBatch(authorUserIds).then(usernamesMap=>{anuncios.forEach(a=>{const authorEl=container.querySelector(`.announcement-card[data-id="${a.id}"] [data-user-id="${a.user_id}"]`);if(authorEl){const username=usernamesMap[a.user_id]||'anónimo';authorEl.innerHTML=`<span class="announcement-author-avatar">${username.charAt(0).toUpperCase()}</span>por @${escapeHtml(username)}`}})});container.querySelectorAll('.announcement-delete').forEach(btn=>{btn.addEventListener('click',async e=>{e.stopPropagation();if(confirm('¿Eliminar este anuncio?')){try{await fetchWithRetry(()=>eliminarAnuncio(btn.dataset.id));showToast('Anuncio eliminado');CACHE.anuncios=null;CACHE.cacheTime.anuncios=0;renderAnuncios()}catch(err){showToast(err.message,'error')}}})});const formAnuncio=document.getElementById('form-anuncio');if(formAnuncio){formAnuncio.addEventListener('submit',async e=>{e.preventDefault();const titulo=document.getElementById('anuncio-titulo').value.trim(),contenido=document.getElementById('anuncio-contenido').value.trim();if(!titulo||!contenido)return;try{await fetchWithRetry(()=>crearAnuncio(titulo,contenido));showToast('✅ Anuncio publicado');CACHE.anuncios=null;CACHE.cacheTime.anuncios=0;renderAnuncios()}catch(err){showToast(`❌ ${err.message}`,'error')}})}}
async function abrirEditorPersonaje(id=null){
  const form=document.getElementById('form-personaje');
  form.reset();
  irAPasoCharacter(1,false);
  document.getElementById('avatar-remove').click();
  document.getElementById('char-id').value='';
  marcarEtiquetasEditor([]);
  actualizarDisponibilidadEtiquetas();
  if(id){
    document.getElementById('character-modal-title').textContent='✏️ Editar Personaje';
    document.getElementById('btn-crear-personaje').textContent='Guardar cambios';
    try{
      const p=await obtenerPersonaje(id);
      document.getElementById('char-id').value=p.id;
      document.getElementById('char-nombre').value=p.nombre;
      document.getElementById('char-desc').value=p.descripcion_corta||'';
      document.getElementById('char-publico').checked=!!p.publico;
      marcarEtiquetasEditor(p.tags);
      const parsed=parsearSystemPrompt(p.system_prompt);
      document.getElementById('char-personalidad').value=parsed.personalidad;
      document.getElementById('char-escenario').value=parsed.escenario;
      document.getElementById('char-ejemplos').value=parsed.ejemplos;
      document.getElementById('char-saludo').value=p.saludo||'';
      document.getElementById('char-max-tokens').value=p.max_tokens||4096;
      const intensidadVal = normalizarIntensidad(p.intensidad||parsed.intensidad||'suave');
      document.getElementById('char-intensidad').value=intensidadVal;
      document.querySelectorAll('#intensity-picker .intensity-card').forEach(card=>{
        card.classList.toggle('active',card.dataset.value===intensidadVal);
      });
      setAvatarForEdit(p.avatar_url);
      
      const themeColor = parsed.themeColor || '#ff4d8f';
      document.getElementById('char-color').value = themeColor;
      document.querySelectorAll('.aura-color-option').forEach(opt => {
        if (opt.dataset.color === themeColor) {
          opt.classList.add('active');
          opt.style.borderColor = '#fff';
          opt.style.boxShadow = `0 0 12px ${hexToRgba(themeColor, 0.6)}`;
        } else {
          opt.classList.remove('active');
          opt.style.borderColor = 'transparent';
          opt.style.boxShadow = 'none';
        }
      });
    }catch(err){
      showToast(err.message,'error');
      return;
    }
  }else{
    document.getElementById('character-modal-title').textContent='✨ Crear Personaje';
    document.getElementById('btn-crear-personaje').textContent='Crear personaje';
    document.getElementById('char-color').value = '#ff4d8f';
    document.getElementById('char-intensidad').value = 'suave';
    document.querySelectorAll('#intensity-picker .intensity-card').forEach(card=>{
      card.classList.toggle('active',card.dataset.value==='suave');
    });
    document.querySelectorAll('.aura-color-option').forEach(opt => {
      if (opt.dataset.color === '#ff4d8f') {
        opt.classList.add('active');
        opt.style.borderColor = '#fff';
        opt.style.boxShadow = `0 0 12px ${hexToRgba('#ff4d8f', 0.6)}`;
      } else {
        opt.classList.remove('active');
        opt.style.borderColor = 'transparent';
        opt.style.boxShadow = 'none';
      }
    });
  }
  openModal('character-modal');
}
function parsearSystemPrompt(sp){const result={personalidad:'',escenario:'',ejemplos:'',themeColor:'#ff4d8f',intensidad:'suave'};if(!sp)return result;const secciones=sp.split(/\n\[(?=[^\]]+\])/);for(const sec of secciones){if(sec.startsWith('Personalidad de'))result.personalidad=sec.replace(/^Personalidad de[^]]*\]\n?/,'').trim();else if(sec.startsWith('Escenario]'))result.escenario=sec.replace(/^Escenario\]\n?/,'').trim();else if(sec.startsWith('Ejemplos de diálogo'))result.ejemplos=sec.replace(/^Ejemplos de diálogo[^]]*\]\n?/,'').trim();else if(sec.startsWith('ConfiguracionTema]'))result.themeColor=sec.replace(/^ConfiguracionTema\]\n?/,'').trim();else if(sec.startsWith('ConfiguracionIntensidad]'))result.intensidad=sec.replace(/^ConfiguracionIntensidad\]\n?/,'').trim()}return result}
document.getElementById('btn-nuevo-personaje').addEventListener('click',()=>{abrirEditorPersonaje(null)});

// Selector de intensidad de personajes
document.querySelectorAll('#intensity-picker .intensity-card').forEach(card=>{
  card.addEventListener('click',()=>{
    document.querySelectorAll('#intensity-picker .intensity-card').forEach(c=>c.classList.remove('active'));
    card.classList.add('active');
    document.getElementById('char-intensidad').value=card.dataset.value;
  });
});

// Selector de colores de aura para personajes
document.querySelectorAll('.aura-color-option').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.aura-color-option').forEach(o => {
      o.classList.remove('active');
      o.style.borderColor = 'transparent';
      o.style.boxShadow = 'none';
    });
    opt.classList.add('active');
    opt.style.borderColor = '#fff';
    opt.style.boxShadow = `0 0 12px ${hexToRgba(opt.dataset.color, 0.6)}`;
    document.getElementById('char-color').value = opt.dataset.color;
  });
});
document.getElementById('form-personaje').addEventListener('submit',async e=>{e.preventDefault();const invalido=document.querySelector('#form-personaje [required]:invalid');if(invalido){const paso=invalido.closest('.char-step');if(paso)irAPasoCharacter(parseInt(paso.dataset.step),false);showToast('Completá los campos obligatorios antes de guardar','error');setTimeout(()=>invalido.reportValidity(),80);return}const btn=document.getElementById('btn-crear-personaje'),originalText=btn.textContent;btn.disabled=!0;btn.textContent='Guardando...';try{const fd = new FormData(e.target);
const datos = {
  nombre: fd.get('nombre'),
  descripcion_corta: fd.get('descripcion_corta'),
  personalidad: fd.get('personalidad'),
  escenario: fd.get('escenario'),
  ejemplos: fd.get('ejemplos'),
  saludo: fd.get('saludo'),
  publico: document.getElementById('char-publico').checked,
  max_tokens: Math.min(16384, Math.max(256, parseInt(document.getElementById('char-max-tokens').value) || 4096)),
  themeColor: sanitizeThemeColor(document.getElementById('char-color').value || '#ff4d8f'),
  tags: etiquetasSeleccionadas(),
  intensidad: normalizarIntensidad(document.getElementById('char-intensidad').value)
};
const id = document.getElementById('char-id').value;if(id){const updated=await actualizarPersonaje(id,datos);actualizarAvatarEnUI(updated);showToast('✅ Personaje actualizado')}else{const created=await crearPersonaje(datos);showToast('✅ Personaje creado')}closeModal('character-modal');CACHE.personajes=null;CACHE.cacheTime.personajes=0;CACHE.personajesComunidad=null;CACHE.cacheTime.personajesComunidad=0;renderCharacters()}catch(err){showToast(`❌ ${err.message}`,'error')}finally{btn.disabled=!1;btn.textContent=originalText}});
let currentCharStep=1;
function irAPasoCharacter(n,validar=true){
  if(n===currentCharStep)return;
  if(validar&&n>currentCharStep){
    for(let s=currentCharStep;s<n;s++){
      const paso=document.querySelector(`.char-step[data-step="${s}"]`);
      const invalido=paso&&paso.querySelector('[required]:invalid');
      if(invalido){invalido.reportValidity();return}
    }
  }
  currentCharStep=n;
  document.querySelectorAll('#form-personaje .char-step').forEach(p=>p.classList.toggle('hidden',parseInt(p.dataset.step)!==n));
  document.querySelectorAll('.stepper-step').forEach(s=>{
    const step=parseInt(s.dataset.step);
    s.classList.toggle('active',step===n);
    s.classList.toggle('done',step<n);
  });
  document.getElementById('btn-step-back').textContent=n===1?'Cancelar':'← Atrás';
  document.getElementById('btn-step-next').classList.toggle('hidden',n===3);
  document.getElementById('btn-crear-personaje').classList.toggle('hidden',n!==3);
  const modal=document.querySelector('#character-modal .modal');
  if(modal)modal.scrollTop=0;
}
document.querySelectorAll('.stepper-step').forEach(s=>s.addEventListener('click',()=>irAPasoCharacter(parseInt(s.dataset.step))));
document.getElementById('btn-step-next').addEventListener('click',()=>irAPasoCharacter(currentCharStep+1));
document.getElementById('btn-step-back').addEventListener('click',()=>{
  if(currentCharStep===1){closeModal('character-modal');return}
  irAPasoCharacter(currentCharStep-1,false);
});
function extraerJSONDeTexto(texto){
  const limpiado=String(texto||'').trim().replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
  try{return JSON.parse(limpiado)}catch{}
  const m=limpiado.match(/\{[\s\S]*\}/);
  if(!m)throw new Error('Gemini no devolvió un JSON válido. Probá de nuevo.');
  return JSON.parse(m[0]);
}
function setAuraColorUI(color){
  const validos=['#ff4d8f','#4d79ff','#a855f7','#10b981','#f97316','#eab308'];
  if(!validos.includes(color))return;
  document.getElementById('char-color').value=color;
  document.querySelectorAll('.aura-color-option').forEach(o=>{
    const activo=o.dataset.color===color;
    o.classList.toggle('active',activo);
    o.style.borderColor=activo?'#fff':'transparent';
    o.style.boxShadow=activo?`0 0 12px ${hexToRgba(color,0.6)}`:'none';
  });
}
async function generarPersonajeConIA(){
  const idea=document.getElementById('ai-idea').value.trim();
  const statusEl=document.getElementById('ai-status');
  if(!idea){showToast('Escribe una idea para tu personaje','error');return}
  const apiKey=getGeminiKey();
  if(!apiKey){showToast('⚠️ Configura tu API Key en Ajustes de Rol (🎭)','error');return}
  const genBtn=document.getElementById('btn-ai-generar');
  genBtn.disabled=true;genBtn.textContent='Generando...';
  statusEl.textContent='⏳ Pensando tu personaje...';
  try{
    const systemPrompt=`Eres un diseñador experto de personajes para una app de roleplay narrativo con IA. A partir de la idea del usuario, crea un personaje completo, coherente e inmersivo.
Devuelve EXCLUSIVAMENTE un objeto JSON válido, sin markdown, sin explicaciones ni texto adicional, con EXACTAMENTE estas claves:
{"nombre":"Nombre corto y atractivo (máx 60 caracteres)","descripcion_corta":"Descripción en 1 frase para una tarjeta (máx 200 caracteres)","personalidad":"Rasgos de personalidad detallados y forma de hablar (2-4 párrafos breves)","saludo":"*acción entre asteriscos* + diálogo de presentación del personaje (1-2 frases)","escenario":"Descripción del lugar y la situación donde empieza la historia (1-2 párrafos)","ejemplos":"2 ejemplos de diálogo en este formato exacto con salto de línea: {{user}}: ...\n{{char}}: ...","color":"uno de estos hex exactos: #ff4d8f, #4d79ff, #a855f7, #10b981, #f97316, #eab308"}
El tono debe ser consistente con la idea del usuario.`;
    const body={system_instruction:{parts:[{text:systemPrompt}]},contents:[{role:'user',parts:[{text:`Idea: ${idea}`}]}],safetySettings:getSafetySettings('mediana'),generationConfig:{temperature:1,topP:.95,topK:40,maxOutputTokens:2048}};
    const response=await fetch(geminiUrl(getSummaryModel(),false),{method:'POST',headers:geminiHeaders(apiKey),body:JSON.stringify(body)});
    if(!response.ok){const errText=await response.text();let msg=`Error al generar (${response.status})`;try{const errJson=JSON.parse(errText);if(errJson.error?.message)msg=errJson.error.message}catch{}throw new Error(msg)}
    const data=await response.json();anotarUsoUnico(data.usageMetadata);
    const texto=data.candidates?.[0]?.content?.parts?.[0]?.text;
    if(!texto){
      if(data.promptFeedback&&data.promptFeedback.blockReason)throw new Error(`Generación bloqueada (${data.promptFeedback.blockReason}). Probá con otra idea.`);
      throw new Error('No se pudo generar el personaje');
    }
    const res=extraerJSONDeTexto(texto);
    const nombre=(res.nombre||'').trim().slice(0,60);
    if(!nombre)throw new Error('Gemini no generó un nombre válido. Probá de nuevo.');
    document.getElementById('char-nombre').value=nombre;
    document.getElementById('char-desc').value=(res.descripcion_corta||'').trim().slice(0,200);
    document.getElementById('char-personalidad').value=(res.personalidad||'').trim();
    document.getElementById('char-escenario').value=(res.escenario||'').trim();
    document.getElementById('char-saludo').value=(res.saludo||'').trim().slice(0,2000);
    document.getElementById('char-ejemplos').value=(res.ejemplos||'').trim();
    setAuraColorUI(String(res.color||'').toLowerCase());
    statusEl.textContent='✅ Personaje generado. Revisá los campos y ajustá lo que quieras.';
    showToast('✅ Personaje generado con IA');
    irAPasoCharacter(1,false);
  }catch(err){
    statusEl.textContent='';
    showToast(`❌ ${err.message}`,'error');
  }finally{
    genBtn.disabled=false;genBtn.textContent='⚡ Generar';
  }
}
document.getElementById('btn-ai-crear').addEventListener('click',()=>{
  const panel=document.getElementById('ai-assistant');
  panel.classList.toggle('hidden');
  if(!panel.classList.contains('hidden'))document.getElementById('ai-idea').focus();
});
document.getElementById('btn-ai-generar').addEventListener('click',generarPersonajeConIA);
document.getElementById('btn-ai-cancel').addEventListener('click',()=>{
  document.getElementById('ai-assistant').classList.add('hidden');
  document.getElementById('ai-status').textContent='';
  document.getElementById('ai-idea').value='';
});
let friendsSearchTimer=null;
function mostrarPerfilPublico(user){const cover=document.getElementById('public-profile-cover'),avatar=document.getElementById('public-profile-avatar'),name=document.getElementById('public-profile-name'),role=document.getElementById('public-profile-role'),description=document.getElementById('public-profile-description'),safeAvatar=sanitizeImageUrl(user.avatar_url),safeCover=sanitizeImageUrl(user.fondo_url),initial=(user.username||'U').charAt(0).toUpperCase();name.textContent=user.username||'Usuario';role.textContent=(user.rol||'user').toUpperCase();description.textContent=user.descripcion||'Este usuario aún no ha añadido una descripción.';description.className=`public-profile-description${user.descripcion?'':' public-profile-empty'}`;avatar.innerHTML=safeAvatar?`<img src="${safeAvatar.replace(/"/g,'&quot;')}" alt="">`:initial;avatar.style.transform='none';if(safeAvatar)avatar.querySelector('img').style.objectPosition=`${Number(user.avatar_pos_x)||50}% ${Number(user.avatar_pos_y)||50}%`;cover.style.backgroundImage=safeCover?`url("${safeCover.replace(/"/g,'%22')}")`:'';cover.style.backgroundPosition=`${Number(user.fondo_pos_x)||50}% ${Number(user.fondo_pos_y)||50}%`;openModal('public-profile-modal')}
async function abrirPerfilBuscado(username){try{const{data,error}=await sbClient.rpc('buscar_usuarios',{p_busqueda:username});if(error)throw error;const user=(data||[]).find(item=>item.username===username)||data?.[0];if(user)mostrarPerfilPublico(user)}catch(err){const{data,error}=await sbClient.from('perfiles').select('user_id,username,descripcion,avatar_url,fondo_url,avatar_pos_x,avatar_pos_y,fondo_pos_x,fondo_pos_y').eq('username',username).maybeSingle();if(!error&&data)mostrarPerfilPublico({...data,rol:'user'})}}
document.getElementById('friends-results').addEventListener('click',e=>{const card=e.target.closest('.friend-card');if(!card)return;const username=card.querySelector('.friend-name')?.textContent?.trim();if(username)abrirPerfilBuscado(username)});
document.getElementById('user-badge').addEventListener('click',()=>{const description=document.getElementById('profile-description');if(description)description.value=userDescription||''});
function crearFloresBuscador(){document.querySelectorAll('#friends-modal .friends-petals span').forEach((petal,i)=>{petal.style.setProperty('--left',`${5+(i*17)%92}%`);petal.style.setProperty('--size',`${.8+(i%4)*.18}rem`);petal.style.setProperty('--color',i%2?'#c4a7ff':'#ff9fca');petal.style.setProperty('--duration',`${9+(i%5)}s`);petal.style.setProperty('--delay',`${-(i%8)}s`);petal.style.setProperty('--sway',`${i%2?'-':'+'}${25+(i%4)*12}px`);petal.style.setProperty('--rotation',`${i*35}deg`)})}
function renderFriendResults(users){const out=document.getElementById('friends-results');if(!out)return;if(!users?.length){out.innerHTML='<div class="friends-empty"><strong>No encontramos usuarios</strong>Prueba con otro nombre.</div>';return}out.innerHTML=users.map((u,i)=>{const name=escapeHtml(u.username||'Usuario'),initial=escapeHtml((u.username||'U').charAt(0).toUpperCase()),avatar=sanitizeImageUrl(u.avatar_url),cover=sanitizeImageUrl(u.fondo_url),role=escapeHtml(u.rol||'user');return`<article class="friend-card" style="--friend-cover:${cover?`url("${cover.replace(/"/g,'%22')}")`:'rgba(168,85,247,.18)'};animation-delay:${Math.min(i,8)*35}ms"><div class="friend-card-top"><div class="friend-avatar">${avatar?`<img src="${avatar.replace(/"/g,'&quot;')}" alt="">`:initial}</div><div class="friend-info"><div class="friend-name">${name}</div><div class="friend-id">Miembro de SAIR</div><span class="friend-role">${role}</span></div></div></article>`}).join('')}
async function buscarAmigos(){const input=document.getElementById('friends-search-input'),term=input?.value.trim()||'',out=document.getElementById('friends-results');if(term.length<1){out.innerHTML='<div class="friends-empty"><strong>Busca un usuario</strong>Escribe al menos una letra para comenzar.</div>';return}out.innerHTML='<div class="friends-empty">Buscando perfiles...</div>';try{const{data,error}=await sbClient.rpc('buscar_usuarios',{p_busqueda:term});if(error)throw error;renderFriendResults(data||[])}catch(err){console.warn('RPC de búsqueda no disponible, usando perfiles básicos:',err);try{const{data,error}=await sbClient.from('perfiles').select('user_id,username,avatar_url,fondo_url').neq('user_id',currentUser.id).ilike('username',`%${term}%`).limit(30);if(error)throw error;renderFriendResults((data||[]).map(user=>({...user,rol:'user'})))}catch(fallbackErr){console.error('Error buscando usuarios:',fallbackErr);out.innerHTML='<div class="friends-empty"><strong>No se pudo completar la búsqueda</strong>Intenta de nuevo en un momento.</div>'}}}
document.getElementById('btn-buscar-amigos').addEventListener('click',()=>{crearFloresBuscador();openModal('friends-modal');setTimeout(()=>document.getElementById('friends-search-input')?.focus(),180)});
document.getElementById('friends-search-input').addEventListener('input',()=>{clearTimeout(friendsSearchTimer);friendsSearchTimer=setTimeout(buscarAmigos,280)});
document.getElementById('friends-modal').addEventListener('click',e=>{if(e.target===document.getElementById('friends-modal'))closeModal('friends-modal')});
document.querySelectorAll('.dashboard-tab').forEach(tab=>{tab.addEventListener('click',()=>{if(!tab.dataset.view)return;document.querySelectorAll('.dashboard-tab').forEach(t=>t.classList.remove('active'));tab.classList.add('active');currentView=tab.dataset.view;const title=document.getElementById('dashboard-title'),subtitle=document.getElementById('dashboard-subtitle'),btnNuevo=document.getElementById('btn-nuevo-personaje');if(currentView==='my-characters'){title.textContent='Tus personajes';subtitle.textContent='Crea, edita y chatea con tus personajes de IA';btnNuevo.style.display='inline-flex';renderCharacters()}else if(currentView==='community'){title.textContent='Comunidad';subtitle.textContent='Descubre personajes creados por otros usuarios';btnNuevo.style.display='none';renderCharacters()}else if(currentView==='announcements'){title.textContent='Anuncios';subtitle.textContent=isOwner()?'Publica anuncios para toda la comunidad':'Anuncios oficiales del Owner';btnNuevo.style.display='none';renderAnuncios()}})});
async function abrirChatConPersonaje(personajeId){guardarBorradorAhora();try{currentCharacter=await obtenerPersonaje(personajeId);cargarLorebook(currentCharacter.id).catch(err=>console.warn('⚠️ Lorebook:',err));currentChatId=null;await verificarYMostrarModalRol();const avatarEl=document.getElementById('chat-char-avatar');const safeAvatar=sanitizeImageUrl(currentCharacter.avatar_url);if(safeAvatar)avatarEl.innerHTML=`<img src="${safeAvatar.replace(/"/g,'&quot;')}" alt="">`;else avatarEl.textContent=currentCharacter.nombre.charAt(0).toUpperCase();document.getElementById('chat-char-name').textContent=currentCharacter.nombre;document.getElementById('chat-char-sub').textContent='Chats';document.getElementById('chat-view').classList.add('visible');document.getElementById('dashboard').style.display='none';document.body.style.overflow='hidden';

// Aplicar tema dinámico de aura
const parsed = parsearSystemPrompt(currentCharacter.system_prompt);
const themeColor = currentCharacter.theme_color || parsed.themeColor || '#ff4d8f';
const glowColor = hexToRgba(themeColor, 0.35);
const hoverColor = lightenColor(themeColor, 15);
const chatViewEl = document.getElementById('chat-view');
chatViewEl.style.setProperty('--pink', themeColor);
chatViewEl.style.setProperty('--pink-glow', glowColor);
chatViewEl.style.setProperty('--grad-main', `linear-gradient(135deg, ${themeColor} 0%, var(--purple) 50%, var(--blue) 100%)`);
chatViewEl.style.setProperty('--grad-main-hover', `linear-gradient(135deg, ${hoverColor} 0%, var(--purple) 50%, var(--blue) 100%)`);

aplicarFondoChat();await renderChatList();mostrarChatVacio()}catch(err){showToast(err.message,'error')}}
function pintarListaChats(){
  const list=document.getElementById('chat-list');
  if(!list)return;
  const buscador=document.getElementById('chat-list-search');
  const chats=chatsCache.filter(c=>!filtroChats||tituloChat(c).toLowerCase().includes(filtroChats)||vistaPreviaChat(c).toLowerCase().includes(filtroChats));
  if(buscador)buscador.hidden=chatsCache.length<2;
  if(!chats.length){
    list.innerHTML=chatsCache.length
      ? '<p class="chat-list-empty">Ningún chat coincide con la búsqueda</p>'
      : '<p class="chat-list-empty">Sin chats aún</p>';
    return;
  }
  list.innerHTML=chats.map(c=>`<div class="chat-list-item ${c.id===currentChatId?'active':''}" data-id="${c.id}"><button type="button" class="chat-list-open" data-id="${c.id}"><span class="chat-list-title">${escapeHtml(tituloChat(c))}</span><span class="chat-list-preview">${escapeHtml(vistaPreviaChat(c))}</span></button><span class="chat-list-date">${formatDate(c.creado_en)}</span><button type="button" class="chat-list-delete" data-id="${c.id}" title="Eliminar chat" aria-label="Eliminar este chat"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg></button></div>`).join('');
  list.querySelectorAll('.chat-list-item').forEach(item=>{
    const chat=chats.find(c=>c.id===item.dataset.id);
    item.querySelector('.chat-list-open')?.addEventListener('click',()=>{if(item.querySelector('.chat-list-rename'))return;seleccionarChat(item.dataset.id)});
    item.querySelector('.chat-list-title')?.addEventListener('dblclick',e=>{e.stopPropagation();editarTituloChat(item,chat)});
  });
  list.querySelectorAll('.chat-list-delete').forEach(btn=>{btn.addEventListener('click',async e=>{e.stopPropagation();if(confirm('¿Eliminar este chat?')){try{await eliminarChat(btn.dataset.id);borrarNotasRolLocal(btn.dataset.id);borrarDiarioLocal(btn.dataset.id);if(currentChatId===btn.dataset.id){currentChatId=null;notasRolCache={chatId:null,texto:''};diarioCache={chatId:null,diario:null};actualizarIndicadorNotasRol();actualizarIndicadorDiario();mostrarChatVacio()}renderChatList();showToast('Chat eliminado')}catch(err){showToast(err.message,'error')}}})});
}
async function renderChatList(){const list=document.getElementById('chat-list');try{const chats=await listarChats(currentCharacter.id);chatsCache=chats;document.getElementById('chat-char-sub').textContent=`${chats.length} chat${chats.length!==1?'s':''}`;pintarListaChats()}catch(err){console.error('Error en renderChatList:',err);list.innerHTML=`<p style="color:#fca5a5;padding:1rem;font-size:.85rem">Error al cargar chats</p>`}}
function mostrarChatVacio(){const messages=document.getElementById('chat-messages');messages.innerHTML=`<div class="chat-empty" id="chat-empty"><div class="chat-empty-icon">💬</div><h3 style="font-family:var(--font-display);color:var(--text-1);margin-bottom:.5rem">Comienza una conversación</h3><p>Selecciona un chat o crea uno nuevo</p></div>`}
async function seleccionarChat(chatId){
guardarBorradorAhora();
currentChatId=chatId;
restaurarBorrador(chatId);
actualizarIndicadorUso();
cargarNotasRol(chatId);
prepararDiarioLocal(chatId);
document.querySelectorAll('.chat-list-item').forEach(i=>{i.classList.toggle('active',i.dataset.id===chatId)});
const messages=document.getElementById('chat-messages');
messages.innerHTML='<div style="text-align:center;color:var(--text-3);padding:2rem">Cargando mensajes...</div>';
try{
const resultadoInicial=await cargarHistorialChat(chatId,{paginado:true});
let{mensajes}=resultadoInicial;
// Si el chat está vacío y el personaje tiene saludo, lo insertamos
if(mensajes.filter(m=>m.rol==='user'||m.rol==='assistant').length===0 && currentCharacter.saludo){
const saludoMsg={id:crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).substr(2,5),rol:'assistant',contenido:currentCharacter.saludo};
mensajes.push(saludoMsg);
await actualizarHistorialChat(chatId, mensajes);
  resultadoInicial.totalMensajes=1;
  resultadoInicial.hasMore=false;
}
historialCompleto=mensajes;
historialTotalMensajes=resultadoInicial.totalMensajes;
historialTieneMas=resultadoInicial.hasMore;
historialEsLegacy=resultadoInicial.usandoLegacy;
chatOffset=historialCompleto.filter(m=>m.rol==='user'||m.rol==='assistant').length;
renderizarChatPaginado();
}catch(err){
console.error('Error en seleccionarChat:',err);
messages.innerHTML=`<p style="color:#fca5a5;text-align:center;padding:2rem">Error al cargar mensajes</p>`
}
}
document.getElementById('chat-new-btn').addEventListener('click',async()=>{
try{
let historialInicial=[];
if(currentCharacter.saludo){
historialInicial=[{id:crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).substr(2,5),rol:'assistant',contenido:currentCharacter.saludo}];
}
const chat=await crearNuevoChat(currentCharacter.id, historialInicial);
const notasHeredadas=await heredarNotasRol(currentCharacter.id, chat.id);
await renderChatList();
await seleccionarChat(chat.id);
showToast(notasHeredadas?'Nuevo chat creado · 📝 Notas para Rol heredadas del chat anterior':'Nuevo chat creado')
}catch(err){
showToast(err.message,'error')
}
});
document.getElementById('chat-back-btn').addEventListener('click',()=>{guardarBorradorAhora();detenerLectura();detenerDictado();
  const chatViewEl = document.getElementById('chat-view');
  chatViewEl.style.removeProperty('--pink');
  chatViewEl.style.removeProperty('--pink-glow');
  chatViewEl.style.removeProperty('--grad-main');
  chatViewEl.style.removeProperty('--grad-main-hover');
  document.getElementById('chat-view').classList.remove('visible');
  document.getElementById('dashboard').style.display='block';
  document.body.style.overflow='';
  currentCharacter=null;
  currentChatId=null;
  renderCharacters()
});
document.getElementById('btn-immersive').addEventListener('click',()=>{const chatView=document.getElementById('chat-view'),btn=document.getElementById('btn-immersive');chatView.classList.toggle('immersive');if(chatView.classList.contains('immersive')){btn.innerHTML=`<svg viewBox="0 0 24 24"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>`;btn.title='Salir del modo inmersivo';showToast('🎯 Modo inmersivo activado')}else{btn.innerHTML=`<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;btn.title='Modo inmersivo'}});
document.addEventListener('keydown',e=>{if(e.key==='F11'&&document.getElementById('chat-view').classList.contains('visible')){e.preventDefault();document.getElementById('btn-immersive').click()}});
document.getElementById('chat-export-btn').addEventListener('click',async()=>{if(!currentChatId){showToast('Selecciona un chat primero','error');return}try{const{mensajes}=await cargarHistorialCompleto(currentChatId),fecha=new Date().toISOString().split('T')[0],nombreChar=currentCharacter?.nombre||'chat',nombreArchivo=`${nombreChar}_${currentChatId.substring(0,8)}_${fecha}`;const data={format_version:3,character:{id:currentCharacter.id,name:currentCharacter.nombre,system_prompt:currentCharacter.system_prompt},export_date:new Date().toISOString(),notes:obtenerNotasRolActual(),diary:obtenerDiarioActual(),messages:mensajes.map(m=>({id:m.id||null,role:m.rol,content:m.contenido,timestamp:m.creado_en||null,summary_version:m.summary_version||null}))};const contenido=JSON.stringify(data,null,2),blob=new Blob([contenido],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${nombreArchivo}.json`;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);showToast('✅ Chat exportado como JSON')}catch(err){console.error('Error al exportar:',err);showToast('❌ Error al exportar','error')}});
const chatSearchInput=document.getElementById('chat-search-input');
if(chatSearchInput){chatSearchInput.addEventListener('input',()=>{filtroChats=chatSearchInput.value.trim().toLowerCase();pintarListaChats()})}
const chatInput=document.getElementById('chat-input'),chatSendBtn=document.getElementById('chat-send-btn');
chatInput.addEventListener('input',()=>{chatInput.style.height='auto';chatInput.style.height=Math.min(chatInput.scrollHeight,150)+'px';chatSendBtn.disabled=!chatInput.value.trim()||isStreaming||!currentChatId});
chatInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(!chatSendBtn.disabled)enviarMensaje()}});
chatSendBtn.addEventListener('click',()=>enviarMensaje());
document.getElementById('chat-import-btn').addEventListener('click',()=>{document.getElementById('chat-import-file').click()});
document.getElementById('chat-import-file').addEventListener('change',async(e)=>{const file=e.target.files[0];if(!file)return;if(!file.name.endsWith('.json')){showToast('❌ Solo se permiten archivos JSON','error');e.target.value='';return}if(file.size>5*1024*1024){showToast('❌ Archivo demasiado grande (máx. 5MB)','error');e.target.value='';return}const reader=new FileReader();reader.onload=async(ev)=>{try{const data=JSON.parse(ev.target.result);if(!data.character||!data.messages||!Array.isArray(data.messages)){throw new Error('Estructura JSON inválida');}if(data.messages.length>5000){throw new Error('Demasiados mensajes (máx. 5000)');}if(!currentCharacter){showToast('❌ Selecciona un personaje primero','error');return}if(data.character.id!==currentCharacter.id){if(!confirm(`Este chat es de "${data.character.name}" pero estás en "${currentCharacter.nombre}". ¿Importar de todos modos?`)){return}}const rolesPermitidos=['user','assistant','summary'];const historial=data.messages.filter(m=>m&&typeof m.content==='string'&&rolesPermitidos.includes(m.role)).slice(0,5000).map(m=>({id:(typeof m.id==='string'&&m.id)?m.id:(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).substr(2,5)),rol:m.role,contenido:String(m.content).slice(0,m.role==='summary'?20000:8000),creado_en:m.timestamp||null,summary_version:m.role==='summary'?(Number(m.summary_version)||1):undefined}));if(!historial.some(m=>m.rol==='user'||m.rol==='assistant')){throw new Error('No hay mensajes válidos para importar');}const nuevoChat=await crearNuevoChat(currentCharacter.id);await actualizarHistorialChat(nuevoChat.id,historial);if(typeof data.notes==='string'&&data.notes.trim())await guardarNotasRol(nuevoChat.id,data.notes.slice(0,8000));const diarioImportado=normalizarDiario(data.diary);if(diarioImportado)await guardarDiario(nuevoChat.id,diarioImportado);await renderChatList();await seleccionarChat(nuevoChat.id);showToast(`✅ Chat importado (${historial.filter(m=>m.rol!=='summary').length} mensajes${historial.some(m=>m.rol==='summary')?' + resumen':''})`)}catch(err){console.error('Error al importar:',err);showToast(`❌ Error al importar: ${err.message}`,'error')}};reader.readAsText(file);e.target.value=''});
async function cargarMensajesAnteriores() {
  if (!currentChatId || historialCargandoMas || !historialTieneMas) return;
  historialCargandoMas = true; renderizarChatPaginado({ scrollToBottom: false });
  try {
    const actuales = historialCompleto.filter(m => m.rol === 'user' || m.rol === 'assistant');
    const resultado = await cargarHistorialChat(currentChatId, { paginado: true, offset: actuales.length, limit: CHAT_LIMITE });
    const anteriores = resultado.mensajes.filter(m => m.rol === 'user' || m.rol === 'assistant');
    const resumen = historialCompleto.find(m => m.rol === 'summary') || resultado.mensajes.find(m => m.rol === 'summary');
    const idsActuales = new Set(actuales.filter(m => m.id).map(m => m.id));
    const anterioresUnicos = anteriores.filter(m => !m.id || !idsActuales.has(m.id));
    historialCompleto = [...(resumen ? [resumen] : []), ...anterioresUnicos, ...actuales];
    historialTotalMensajes = resultado.totalMensajes; historialTieneMas = resultado.hasMore && anterioresUnicos.length > 0; historialEsLegacy = resultado.usandoLegacy;
    chatOffset = historialCompleto.filter(m => m.rol === 'user' || m.rol === 'assistant').length;
  } catch (err) { console.error('Error cargando mensajes anteriores:', err); showToast(`❌ ${err.message}`, 'error'); }
  finally { historialCargandoMas = false; renderizarChatPaginado({ scrollToBottom: false, preserveScroll: true }); }
}
function renderizarChatPaginado(opciones = {}) {
  const { scrollToBottom = true, preserveScroll = false } = opciones, messages = document.getElementById('chat-messages');
  let prevScrollHeight = 0, prevScrollTop = 0;
  if (preserveScroll) { prevScrollHeight = messages.scrollHeight; prevScrollTop = messages.scrollTop; }
  messages.innerHTML = ''; const mensajesAMostrar = historialCompleto.filter(m => m.rol === 'user' || m.rol === 'assistant'); const fragment = document.createDocumentFragment();
  if (historialTieneMas || historialCargandoMas) {
    const restantes = Math.max(historialTotalMensajes - mensajesAMostrar.length, 0), loadMore = document.createElement('button');
    loadMore.className = 'load-more-btn'; loadMore.type = 'button'; loadMore.disabled = historialCargandoMas; loadMore.setAttribute('aria-label', 'Cargar mensajes anteriores');
    loadMore.innerHTML = historialCargandoMas ? '<span>⏳ Cargando mensajes anteriores…</span>' : `<svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"></polyline></svg>Cargar ${Math.min(CHAT_LIMITE, restantes || CHAT_LIMITE)} mensajes anteriores`;
    if (!historialCargandoMas) loadMore.addEventListener('click', cargarMensajesAnteriores); fragment.appendChild(loadMore);
  }
  mensajesAMostrar.forEach(m => agregarBubble(contenidoVariante(m), m.rol, false, m.id, false, fragment, m)); messages.appendChild(fragment);
  if (preserveScroll) requestAnimationFrame(() => requestAnimationFrame(() => { messages.scrollTop = prevScrollTop + (messages.scrollHeight - prevScrollHeight); }));
  else if (scrollToBottom) scrollChatToBottom(true);
}
function agregarBubble(texto,rol,conTyping=!1,mensajeId=null,autoScroll=!0,parent=null,mensaje=null){const container=parent||document.getElementById('chat-messages'),div=document.createElement('div');div.className=`message-bubble ${rol}`;if(mensajeId)div.dataset.mensajeId=mensajeId;if(conTyping)div.innerHTML=`<div class="typing-indicator"><span></span><span></span><span></span></div>`;else{div.innerHTML=rol==='assistant'?renderMarkdown(texto):escapeHtml(texto);div.dataset.originalText=texto;agregarBotones(div,rol);aplicarAvisoRespuestaIncompleta(div);if(mensaje)aplicarVariantesUI(div,mensaje)}container.appendChild(div);if(autoScroll&&!parent)scrollChatToBottom();return div}
function agregarBotones(bubble,rol){const oldActions=bubble.querySelector('.message-actions');if(oldActions)oldActions.remove();const actionsDiv=document.createElement('div');actionsDiv.className='message-actions';let buttonsHTML='';buttonsHTML+=`<button type="button" class="btn-message btn-copy" title="Copiar mensaje"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>Copiar</button>`;buttonsHTML+=`<button type="button" class="btn-message btn-delete-msg" title="Eliminar mensaje" aria-label="Eliminar este mensaje"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>Eliminar</button>`;if(rol==='user'){buttonsHTML+=`<button type="button" class="btn-message btn-edit-msg" title="Editar mensaje"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>Editar</button>`}else if(rol==='assistant'){if(vozDisponible)buttonsHTML+=`<button type="button" class="btn-message btn-leer" title="Leer en voz alta" aria-pressed="false">${ICONO_ALTAVOZ}Leer</button>`;buttonsHTML+=`<button type="button" class="btn-message btn-regenerate" data-mensaje-id="${bubble.dataset.mensajeId||''}" title="Regenerar respuesta"><svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.63 4.36a9 9 0 0 0 14.85-3.36L23 14"></path></svg>Regenerar</button>`}actionsDiv.innerHTML=buttonsHTML;bubble.appendChild(actionsDiv)}
function mostrarErrorRateLimit(bubble,errorMessage,actionType,actionData){if(rateLimitTimer){clearInterval(rateLimitTimer);rateLimitTimer=null}let segundos=60;const match=errorMessage.match(/(\d+)\s*seconds?/i);if(match)segundos=parseInt(match[1])||60;rateLimitCountdown=segundos;pendingAction=actionType;pendingData=actionData;const messages=document.getElementById('chat-messages');const div=document.createElement('div');div.className='message-bubble error';div.style.maxWidth='90%';const updateContent=()=>{div.innerHTML=`<div style="display:flex;flex-direction:column;gap:.5rem;"><span style="color:#fca5a5;">⏳ Límite de peticiones excedido. Espera <strong>${rateLimitCountdown}s</strong> para reintentar.</span><div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:.3rem;"><button type="button" class="btn-message btn-retry" style="${rateLimitCountdown>0?'opacity:.5;pointer-events:none;':''}"><svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.63 4.36a9 9 0 0 0 14.85-3.36L23 14"></path></svg>Reintentar</button></div></div>`};updateContent();if(bubble){bubble.innerHTML=div.innerHTML;bubble.className='message-bubble error';bubble._rateLimitDiv=div}else{messages.appendChild(div);window._rateLimitBubble=div}rateLimitTimer=setInterval(()=>{rateLimitCountdown--;if(rateLimitCountdown<=0){clearInterval(rateLimitTimer);rateLimitTimer=null;const targetBubble=bubble||window._rateLimitBubble;if(targetBubble){const btn=targetBubble.querySelector('.btn-retry');if(btn){btn.style.opacity='1';btn.style.pointerEvents='auto'}const span=targetBubble.querySelector('span');if(span)span.innerHTML='⏳ Límite de peticiones excedido. <strong>¡Ya puedes reintentar!</strong>'}}else{const targetBubble=bubble||window._rateLimitBubble;if(targetBubble){const span=targetBubble.querySelector('span');if(span)span.innerHTML=`⏳ Límite de peticiones excedido. Espera <strong>${rateLimitCountdown}s</strong> para reintentar.`}}},1e3);if(rateLimitRetryHandler)document.removeEventListener('click',rateLimitRetryHandler);
  const retryHandler=e=>{const btn=e.target.closest('.btn-retry');if(!btn)return;if(rateLimitCountdown>0)return;if(rateLimitTimer){clearInterval(rateLimitTimer);rateLimitTimer=null}const targetBubble=bubble||window._rateLimitBubble;if(targetBubble)targetBubble.remove();if(window._rateLimitBubble)delete window._rateLimitBubble;if(pendingAction==='send')reintentarRespuestaAsistente(pendingData.bubbleIA,pendingData.text);else if(pendingAction==='regenerate'){const{mensajeId,bubbleElement}=pendingData;regenerarRespuesta(mensajeId,bubbleElement)}pendingAction=null;pendingData=null;if(rateLimitRetryHandler){document.removeEventListener('click',rateLimitRetryHandler);rateLimitRetryHandler=null}};rateLimitRetryHandler=retryHandler;document.addEventListener('click',retryHandler)}
let ultimoMensajeEnviado='';

