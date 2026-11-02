/* SAIR · Arranque de la app, sesión, autenticación y escritorio.
   Se carga en orden desde index.html: los archivos comparten el ámbito global. */
/* ── Arranque a prueba de cuelgues ──
   La PWA se quedaba en negro tras unos días sin abrirla: el token de sesión
   había caducado, getSession() intentaba refrescarlo por red y, si la red
   estaba lenta o colgada, la promesa no terminaba nunca. Como #auth-screen y
   #dashboard están ocultos por defecto, solo se veía el fondo negro.
   Ahora cada espera tiene tiempo límite y siempre se muestra una pantalla. */
const ARRANQUE_TIMEOUT_MS=8000;
function conTimeout(promesa,ms,etiqueta){
  let timer;
  const limite=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Tiempo agotado: ${etiqueta}`)),ms)});
  return Promise.race([promesa,limite]).finally(()=>clearTimeout(timer));
}
function hayPantallaVisible(){
  return ['auth-screen','dashboard','chat-view'].some(id=>document.getElementById(id)?.classList.contains('visible'));
}
function mostrarPantallaDeRespaldo(){
  if(hayPantallaVisible())return;
  if(currentUser&&cargarInfoUsuarioLocal()){actualizarUIPerfil();showDashboard()}
  else showAuth();
}
async function initApp(){
  // Red de seguridad: pase lo que pase, a los pocos segundos hay algo en pantalla.
  setTimeout(()=>{if(!hayPantallaVisible()){console.warn('⚠️ Arranque lento: mostrando pantalla de respaldo');mostrarPantallaDeRespaldo()}},ARRANQUE_TIMEOUT_MS+2000);
  try{
    // Si el client no se creó al inicio (ej: Supabase CDN cargó tardío), crearlo ahora
    if(!sbClient){
      if(!window.supabase?.createClient){console.error('❌ Supabase no cargó');showAuth();return}
      sbClient=window.supabase.createClient(CONFIG.SUPABASE_URL,CONFIG.SUPABASE_ANON_KEY,{
        auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage}
      });
      console.log('✅ Supabase client creado en initApp (fallback)');
    }
    // Escuchar cambios de autenticación antes de pedir la sesión, para no
    // perder el TOKEN_REFRESHED si el refresco termina después del tiempo límite.
    sbClient.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_OUT'){
 currentUser=null;userRole=null;userUsername=null;userDescription='';userAvatarUrl=null;userBackgroundUrl=null;userAvatarPos={x:50,y:50};userBackgroundPos={x:50,y:50};userRoleName=null;
        limpiarCacheUsuario();
        try { localStorage.removeItem('sair_cached_user_info'); } catch(e){}
        showAuth();
      }else if(event==='SIGNED_IN'||event==='TOKEN_REFRESHED'){
        if(session) {
          currentUser=session.user;
          if(document.getElementById('auth-screen').classList.contains('visible')){
            cargarPerfilYRol().then(() => cargarNombreRol()).then(() => showDashboard());
          }
        }
      }
    });
    let session=null;
    try{
      const{data,error:sessionError}=await conTimeout(sbClient.auth.getSession(),ARRANQUE_TIMEOUT_MS,'getSession');
      if(sessionError){console.warn('⚠️ Error obteniendo sesión:',sessionError.message)}
      session=data?.session||null;
    }catch(err){
      console.warn('⚠️ No se pudo comprobar la sesión a tiempo:',err.message);
    }
    if(session){
      currentUser=session.user;
      
      // Cargar la info de perfil/rol desde localStorage al instante
      const tieneCache = cargarInfoUsuarioLocal();
      if(tieneCache){
        actualizarUIPerfil();
        showDashboard();
      }
      
      // Actualizar en segundo plano sin retrasar el renderizado del dashboard
      conTimeout(Promise.all([cargarPerfilYRol(), cargarNombreRol()]),ARRANQUE_TIMEOUT_MS,'perfil')
        .catch(err=>console.warn('⚠️ Perfil no cargado a tiempo:',err.message))
        .finally(() => {
          if(!tieneCache) {
            actualizarUIPerfil();
            showDashboard();
          }
        });
    }else{
      console.log('👤 No session');
      showAuth();
    }
    iniciarNotificaciones();
  }catch(err){
    console.error('❌',err);
    mostrarPantallaDeRespaldo();
  }
}
const settingsBtn=document.getElementById('settings-btn');
function showAuth(){
  document.querySelectorAll('.modal-overlay.visible').forEach(m=>m.classList.remove('visible'));
  const politicasEl=document.getElementById('politicas-modal');
  if(politicasEl){politicasEl.classList.remove('visible');politicasEl._preventClose=false}
  document.querySelectorAll('.modal-overlay').forEach(m=>{if(m.id!=='politicas-modal'){m.style.pointerEvents='';m.style.opacity=''}});
  authScreen.classList.add('visible');
  authScreen.classList.add('guest-welcome');
  dashboard.classList.remove('visible');
  document.getElementById('chat-view').classList.remove('visible');
  settingsBtn.classList.add('hidden');
  currentCharacter=null;
  currentChatId=null;
  const loginBtn=document.querySelector('#login-form button[type="submit"]');
  if(loginBtn){loginBtn.disabled=!1;loginBtn.textContent='Iniciar Sesión';}
  void authScreen.offsetWidth;
  forzarRepintado();
}
function showDashboard(){authScreen.classList.remove('visible','guest-welcome');dashboard.classList.add('visible');settingsBtn.classList.remove('hidden');limpiarCacheUsuario();verificarPoliticas();renderCharacters();forzarRepintado();abrirPersonajeCompartidoPendiente()}
document.getElementById('auth-start-btn')?.addEventListener('click',()=>{authScreen.classList.remove('guest-welcome');requestAnimationFrame(()=>document.getElementById('login-email')?.focus())});
document.querySelectorAll('.auth-tab').forEach(tab=>{tab.addEventListener('click',()=>{document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active'));tab.classList.add('active');document.querySelectorAll('.auth-form').forEach(f=>f.classList.remove('active'));document.getElementById(`${tab.dataset.tab}-form`).classList.add('active');document.querySelectorAll('.form-message').forEach(m=>{m.className='form-message';m.textContent=''})})});
document.getElementById('login-form').addEventListener('submit',async e=>{
e.preventDefault();
const email=document.getElementById('login-email').value,
password=document.getElementById('login-password').value,
msgEl=document.getElementById('login-message'),
btn=e.target.querySelector('button');
btn.disabled=!0;
btn.textContent='Iniciando...';
msgEl.className='form-message';
try{
const{data,error}=await sbClient.auth.signInWithPassword({email,password});
if(error){
playErrorSound();
shakeElement(document.getElementById('login-email'));
shakeElement(document.getElementById('login-password'));
msgEl.className='form-message error';
msgEl.textContent=error.message.includes('Invalid')?'Credenciales inválidas':error.message;
btn.disabled=!1;
btn.textContent='Iniciar Sesión';
}else{
currentUser=data.user;
const perfilPromise=cargarPerfilYRol();
const rolePromise=cargarNombreRol();
const timeoutPromise=new Promise((_,reject)=>setTimeout(()=>reject(new Error('Timeout cargando perfil')),3000));
try{await Promise.race([Promise.all([perfilPromise,rolePromise]),timeoutPromise]);}catch(perfilErr){console.warn('⚠️ Error cargando perfil:',perfilErr);userRole='user';userUsername=email.split('@')[0];}
msgEl.className='form-message success';
msgEl.textContent=`¡Bienvenido, ${userUsername||'usuario'}!`;
document.querySelectorAll('.modal-overlay.visible').forEach(m=>m.classList.remove('visible'));
document.getElementById('chat-view').classList.remove('visible');
limpiarCacheUsuario();setTimeout(showDashboard,800);
}
}catch(err){
console.error('Error login:',err);
playErrorSound();
shakeElement(document.getElementById('login-email'));
shakeElement(document.getElementById('login-password'));
msgEl.className='form-message error';
msgEl.textContent='Error de conexión. Intenta de nuevo.';
btn.disabled=!1;
btn.textContent='Iniciar Sesión';
}
});
document.getElementById('register-form').addEventListener('submit',async e=>{e.preventDefault();const email=document.getElementById('register-email').value,password=document.getElementById('register-password').value,confirm=document.getElementById('register-confirm').value,msgEl=document.getElementById('register-message'),btn=e.target.querySelector('button');if(password!==confirm){playErrorSound();shakeElement(document.getElementById('register-password'));shakeElement(document.getElementById('register-confirm'));msgEl.className='form-message error';msgEl.textContent='Las contraseñas no coinciden';return}btn.disabled=!0;btn.textContent='Creando...';msgEl.className='form-message';try{const{error}=await sbClient.auth.signUp({email,password});if(error){playErrorSound();shakeElement(document.getElementById('register-email'));shakeElement(document.getElementById('register-password'));msgEl.className='form-message error';msgEl.textContent=error.message;btn.disabled=!1;btn.textContent='Crear Cuenta'}else{msgEl.className='form-message success';msgEl.textContent='¡Cuenta creada! Revisa tu correo si es necesario.';btn.disabled=!1;btn.textContent='Crear Cuenta';setTimeout(()=>document.querySelector('[data-tab="login"]').click(),2e3)}}catch(err){playErrorSound();shakeElement(document.getElementById('register-email'));shakeElement(document.getElementById('register-password'));msgEl.className='form-message error';msgEl.textContent='Error de conexión';btn.disabled=!1;btn.textContent='Crear Cuenta'}});
document.getElementById('logout-btn').addEventListener('click',()=>{document.getElementById('settings-modal').classList.remove('visible');document.getElementById('logout-modal').classList.add('visible')});
document.getElementById('cancel-logout').addEventListener('click',()=>{document.getElementById('logout-modal').classList.remove('visible')});
document.getElementById('confirm-logout').addEventListener('click',async()=>{
  const btn=document.getElementById('confirm-logout');
  const originalText=btn.textContent;
  btn.disabled=!0;
  btn.textContent='Cerrando...';
  try{
    await sbClient.auth.signOut();
currentUser=null;userRole=null;userUsername=null;userAvatarUrl=null;userRoleName=null;
limpiarCacheUsuario();
    document.querySelectorAll('.modal-overlay.visible').forEach(m=>m.classList.remove('visible'));
    document.getElementById('chat-view').classList.remove('visible');
    document.getElementById('dashboard').classList.remove('visible');
    document.getElementById('auth-screen').classList.remove('visible');
    settingsBtn.classList.add('hidden');
    await new Promise(r=>setTimeout(r,100));
    showAuth();
    showToast('👋 Sesión cerrada correctamente','success');
    document.querySelectorAll('.auth-form').forEach(f=>f.classList.remove('active'));
    document.querySelector('[data-tab="login"]').classList.add('active');
    document.getElementById('login-form').classList.add('active');
    document.querySelectorAll('.form-message').forEach(m=>{m.className='form-message';m.textContent=''});
    document.getElementById('login-email').value='';
    document.getElementById('login-password').value='';
  }catch(err){
    showToast('❌ Error al cerrar sesión','error');
  }finally{
    btn.disabled=!1;
    btn.textContent=originalText;
  }
});
document.getElementById('logout-modal').addEventListener('click',e=>{if(e.target===document.getElementById('logout-modal'))document.getElementById('logout-modal').classList.remove('visible')});
let perfilAvatarPendiente=null,perfilFondoPendiente=null,perfilAvatarPosPendiente={x:50,y:50},perfilFondoPosPendiente={x:50,y:50};
function actualizarPreviewAvatarPerfil(url){const preview=document.getElementById('profile-avatar-preview'),displayName=userUsername||currentUser?.email?.split('@')[0]||'Usuario';if(!preview)return;const safe=sanitizeImageUrl(url);preview.innerHTML=safe?`<img src="${safe.replace(/"/g,'&quot;')}" alt="Foto de perfil">`:displayName.charAt(0).toUpperCase()}
function actualizarPreviewFondoPerfil(url,pos=perfilFondoPosPendiente){const preview=document.getElementById('profile-cover-preview');if(!preview)return;const safe=sanitizeImageUrl(url);preview.style.backgroundImage=safe?`url("${safe.replace(/"/g,'%22')}")`:'';preview.style.backgroundPosition=`${pos.x}% ${pos.y}%`}
function actualizarPosicionesPerfil(){const avatar=document.getElementById('profile-avatar-preview'),cover=document.getElementById('profile-cover-preview');const avatarImg=avatar?.querySelector('img');if(avatarImg)avatarImg.style.objectPosition=`${perfilAvatarPosPendiente.x}% ${perfilAvatarPosPendiente.y}%`;if(cover)cover.style.backgroundPosition=`${perfilFondoPosPendiente.x}% ${perfilFondoPosPendiente.y}%`}
function prepararAvatarPerfil(file){return new Promise((resolve,reject)=>{if(!file){resolve(null);return}if(!file.type.startsWith('image/')){reject(new Error('Solo se permiten imágenes'));return}if(file.size>5*1024*1024){reject(new Error('La imagen debe pesar máximo 5 MB'));return}const reader=new FileReader();reader.onerror=()=>reject(new Error('No se pudo leer la imagen'));reader.onload=ev=>{const img=new Image();img.onerror=()=>reject(new Error('Imagen inválida'));img.onload=()=>{const size=256,canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;const ctx=canvas.getContext('2d'),ratio=Math.max(size/img.width,size/img.height),w=img.width*ratio,h=img.height*ratio;ctx.drawImage(img,(size-w)/2,(size-h)/2,w,h);resolve(canvas.toDataURL('image/jpeg',.82))};img.src=ev.target.result};reader.readAsDataURL(file)})}
function prepararFondoPerfil(file){return new Promise((resolve,reject)=>{if(!file){resolve(null);return}if(!file.type.startsWith('image/')){reject(new Error('Solo se permiten imágenes'));return}if(file.size>5*1024*1024){reject(new Error('La imagen debe pesar máximo 5 MB'));return}const reader=new FileReader();reader.onerror=()=>reject(new Error('No se pudo leer la imagen'));reader.onload=ev=>{const img=new Image();img.onerror=()=>reject(new Error('Imagen inválida'));img.onload=()=>{const maxWidth=1200,ratio=Math.min(1,maxWidth/img.width),w=Math.max(1,Math.round(img.width*ratio)),h=Math.max(1,Math.round(img.height*ratio)),canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,w,h);resolve(canvas.toDataURL('image/jpeg',.78))};img.src=ev.target.result};reader.readAsDataURL(file)})}
document.getElementById('user-badge').addEventListener('click',()=>{actualizarUIPerfil();perfilAvatarPendiente=userAvatarUrl;perfilFondoPendiente=userBackgroundUrl;perfilAvatarPosPendiente={...userAvatarPos};perfilFondoPosPendiente={...userBackgroundPos};document.getElementById('profile-avatar-pos-x').value=perfilAvatarPosPendiente.x;document.getElementById('profile-avatar-pos-y').value=perfilAvatarPosPendiente.y;document.getElementById('profile-background-pos-x').value=perfilFondoPosPendiente.x;document.getElementById('profile-background-pos-y').value=perfilFondoPosPendiente.y;actualizarPreviewFondoPerfil(perfilFondoPendiente);actualizarPosicionesPerfil();openModal('profile-modal')});
document.getElementById('user-badge').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();document.getElementById('user-badge').click()}});
document.getElementById('profile-avatar-change').addEventListener('click',()=>document.getElementById('profile-avatar-file').click());
document.getElementById('profile-avatar-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{perfilAvatarPendiente=await prepararAvatarPerfil(file);actualizarPreviewAvatarPerfil(perfilAvatarPendiente)}catch(err){showToast(`❌ ${err.message}`,'error')}finally{e.target.value=''}});
document.getElementById('profile-avatar-remove').addEventListener('click',()=>{perfilAvatarPendiente=null;actualizarPreviewAvatarPerfil(null)});
document.getElementById('profile-background-change').addEventListener('click',()=>document.getElementById('profile-background-file').click());
document.getElementById('profile-background-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{perfilFondoPendiente=await prepararFondoPerfil(file);actualizarPreviewFondoPerfil(perfilFondoPendiente)}catch(err){showToast(`❌ ${err.message}`,'error')}finally{e.target.value=''}});
document.getElementById('profile-background-remove').addEventListener('click',()=>{perfilFondoPendiente=null;actualizarPreviewFondoPerfil(null)});
[['profile-avatar-pos-x',perfilAvatarPosPendiente,'x'],['profile-avatar-pos-y',perfilAvatarPosPendiente,'y'],['profile-background-pos-x',perfilFondoPosPendiente,'x'],['profile-background-pos-y',perfilFondoPosPendiente,'y']].forEach(([id,target,axis])=>document.getElementById(id).addEventListener('input',e=>{target[axis]=Number(e.target.value);actualizarPosicionesPerfil()}));
const formProfile=document.getElementById('form-profile');
formProfile.addEventListener('submit',async e=>{
  e.preventDefault();
  const input=document.getElementById('profile-username'),description=document.getElementById('profile-description'),hint=document.getElementById('profile-username-hint'),btn=e.target.querySelector('button[type="submit"]'),nuevoUsername=input.value.trim(),nuevoDescription=description?.value.trim().slice(0,280)||'',regex=/^[a-zA-Z0-9_]{3,20}$/;
  if(!regex.test(nuevoUsername)){hint.textContent='❌ Usa 3-20 caracteres: letras, números y _.';hint.className='username-hint error';shakeElement(input);return}
  const originalText=btn.textContent;btn.disabled=true;btn.textContent='Guardando...';
  try{
    const{error}=await sbClient.from('perfiles').update({username:nuevoUsername,descripcion:nuevoDescription||null,avatar_url:sanitizeImageUrl(perfilAvatarPendiente)||null,fondo_url:sanitizeImageUrl(perfilFondoPendiente)||null,avatar_pos_x:perfilAvatarPosPendiente.x,avatar_pos_y:perfilAvatarPosPendiente.y,fondo_pos_x:perfilFondoPosPendiente.x,fondo_pos_y:perfilFondoPosPendiente.y}).eq('user_id',currentUser.id);
    if(error)throw new Error(error.message);
    userUsername=nuevoUsername;userDescription=nuevoDescription;userAvatarUrl=sanitizeImageUrl(perfilAvatarPendiente)||null;userBackgroundUrl=sanitizeImageUrl(perfilFondoPendiente)||null;userAvatarPos={...perfilAvatarPosPendiente};userBackgroundPos={...perfilFondoPosPendiente};guardarInfoUsuarioLocal();actualizarUIPerfil();closeModal('profile-modal');showToast('✅ Perfil actualizado');
  }catch(err){playErrorSound();showToast(`❌ ${err.message}`,'error')}finally{btn.disabled=false;btn.textContent=originalText}
});
document.getElementById('settings-btn').addEventListener('click',()=>{actualizarUIPerfil()});
const formRole=document.getElementById('form-role');
if(formRole){
const inputRole=document.getElementById('role-name'),hintRole=document.getElementById('role-hint');
inputRole.addEventListener('input',()=>{
const val=inputRole.value,regex=/^[a-zA-Z0-9_]{3,30}$/;
if(val.length===0){hintRole.textContent='3-30 caracteres. Solo letras, números y guion bajo (_).';hintRole.className='username-hint'}
else if(!regex.test(val)){let msg='❌ ';if(val.length<3)msg+='Mínimo 3 caracteres';else if(val.length>30)msg+='Máximo 30 caracteres';else msg+='Solo letras, números y _';hintRole.textContent=msg;hintRole.className='username-hint error'}
else{hintRole.textContent='✅ Nombre válido';hintRole.className='username-hint success'}
});
formRole.addEventListener('submit',async e=>{
e.preventDefault();
const nuevoRole=inputRole.value.trim(),btn=e.target.querySelector('button[type="submit"]'),originalText=btn.textContent;
if(!nuevoRole)return;
const keyInput=document.getElementById('gemini-api-key'),rawKey=(keyInput?.value||'').trim(),modelSel=document.getElementById('gemini-model');
btn.disabled=!0;btn.textContent='Guardando...';
try{
setGeminiModel(modelSel?.value||getGeminiModel());
setSummaryModel(document.getElementById('gemini-summary-model')?.value||getSummaryModel());
if(rawKey){
  saveGeminiKey(rawKey);
}
updateApiKeyUI();
actualizarIndicadoresChat();
await guardarNombreRol(nuevoRole);
showToast(`✅ Nombre de rol configurado: ${nuevoRole}`);
inputRole.value='';hintRole.textContent='3-30 caracteres. Solo letras, números y guion bajo (_).';hintRole.className='username-hint';
closeModal('role-modal')
}catch(err){
playErrorSound();shakeElement(inputRole);showToast(`❌ ${err.message}`,'error');hintRole.textContent='❌ '+err.message;hintRole.className='username-hint error'
}finally{
btn.disabled=!1;btn.textContent=originalText
}
})
}

document.getElementById('chat-role-btn').addEventListener('click',()=>{
const inputRole=document.getElementById('role-name');
if(userRoleName)inputRole.value=userRoleName;
updateApiKeyUI();
openModal('role-modal')
});
const hamburgerBtn=document.getElementById('btn-hamburger'),sidebar=document.getElementById('chat-sidebar');
hamburgerBtn.addEventListener('click',(e)=>{e.stopPropagation();sidebar.classList.toggle('open')});
document.addEventListener('click',e=>{if(window.innerWidth<=768&&sidebar.classList.contains('open')){if(!sidebar.contains(e.target)&&!hamburgerBtn.contains(e.target))sidebar.classList.remove('open')}});
document.getElementById('chat-list').addEventListener('click',()=>{if(window.innerWidth<=768)setTimeout(()=>sidebar.classList.remove('open'),300)});
const scrollBtn = document.getElementById('scroll-to-bottom-btn');
const messagesContainer = document.getElementById('chat-messages');

let scrollTimeout = null;
function toggleScrollButton() {
  if (!messagesContainer || !scrollBtn) return;
  if (scrollTimeout) return;
  scrollTimeout = requestAnimationFrame(() => {
    const scrollTop = messagesContainer.scrollTop;
    const scrollHeight = messagesContainer.scrollHeight;
    const clientHeight = messagesContainer.clientHeight;
    const awayFromBottom = scrollHeight - clientHeight - scrollTop > 100;
    const targetDisplay = awayFromBottom ? 'grid' : 'none';
    if (scrollBtn.style.display !== targetDisplay) {
      scrollBtn.style.display = targetDisplay;
    }
    const hasNew = scrollBtn.classList.contains('has-new');
    if (awayFromBottom !== hasNew) {
      scrollBtn.classList.toggle('has-new', awayFromBottom);
    }
    scrollTimeout = null;
  });
}

if (messagesContainer) {
  messagesContainer.addEventListener('scroll', toggleScrollButton);
  const observer = new MutationObserver(toggleScrollButton);
  observer.observe(messagesContainer, { childList: true, subtree: true, attributes: false });
  setTimeout(toggleScrollButton, 100);
}

if (scrollBtn) {
  scrollBtn.addEventListener('click', () => {
    messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
  });
}
console.log('✅ SAIR cargado correctamente');
