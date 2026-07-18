
let me=null, users=[], resellers=[], servers=[];

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const api=async(url,opts={})=>{
  const r=await fetch(url,{headers:{"Content-Type":"application/json",...(opts.headers||{})},...opts});
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error||"Error");
  return data;
};
const toast=m=>{const t=$("#toast");t.textContent=m;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2200)};
const statusLabel={active:"Activo",expiring:"Por vencer",suspended:"Suspendido",expired:"Caducado"};
const statusClass={active:"green",expiring:"orange",suspended:"red",expired:"red"};
const serviceLabel={emby:"Emby",jellyfin:"Jellyfin",both:"Emby + Jellyfin"};

async function boot(){
  try{
    me=await api("/api/me");
    showApp();
  }catch{}
}
function showApp(){
  $("#login").classList.add("hidden");$("#app").classList.remove("hidden");
  $("#meName").textContent=me.display_name;$("#meRole").textContent=me.role==="admin"?"Superadministrador":`Reseller · ${me.credits} créditos`;
  if(me.role!=="admin") $$(".admin-only").forEach(x=>x.classList.add("hidden"));
  loadDashboard();
}
$("#loginForm").onsubmit=async e=>{
  e.preventDefault();$("#loginError").textContent="";
  const f=new FormData(e.target);
  try{me=await api("/api/login",{method:"POST",body:JSON.stringify(Object.fromEntries(f))});showApp()}
  catch(err){$("#loginError").textContent=err.message}
};
$("#logout").onclick=async()=>{await api("/api/logout",{method:"POST"});location.reload()};

$$("nav button[data-page]").forEach(b=>b.onclick=()=>go(b.dataset.page));
$$("[data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go));
function go(page){
  $$("nav button").forEach(x=>x.classList.toggle("active",x.dataset.page===page));
  $$(".page").forEach(x=>x.classList.remove("active"));
  $("#"+page+"Page").classList.add("active");
  if(page==="dashboard")loadDashboard();
  if(page==="users")loadUsers();
  if(page==="resellers")loadResellers();
  if(page==="servers")loadServers();
  if(page==="logs")loadLogs();
}

async function loadDashboard(){
  const d=await api("/api/dashboard");
  const t=d.totals;
  $("#stats").innerHTML=[
    ["Usuarios totales",t.total||0,"Gestionados"],
    ["Activos",t.active||0,"Acceso permitido"],
    ["Por vencer",t.expiring||0,"Requieren revisión"],
    ["Suspendidos",t.suspended||0,"Acceso bloqueado"]
  ].map(x=>`<article class="stat"><small>${x[0]}</small><strong>${x[1]}</strong><em>${x[2]}</em></article>`).join("");
  $("#recentUsers").innerHTML=d.recent.map(card).join("")||"<p>No hay usuarios.</p>";
}
function card(u){
 return `<article class="user-card"><h3>${u.name}</h3><p>${u.email||u.username}</p><div class="chips"><span class="chip ${statusClass[u.status]}">${statusLabel[u.status]}</span><span class="chip">${u.plan}</span></div><dl><div><dt>Servicio</dt><dd>${serviceLabel[u.server_type]}</dd></div><div><dt>Caduca</dt><dd>${u.expires_at||"Sin fecha"}</dd></div></dl></article>`;
}

async function loadUsers(){
 users=await api("/api/users"); renderUsers();
}
function renderUsers(){
 const q=$("#searchUsers").value.toLowerCase(), st=$("#filterStatus").value, sv=$("#filterServer").value;
 const rows=users.filter(u=>(!q||`${u.name} ${u.email} ${u.username}`.toLowerCase().includes(q))&&(!st||u.status===st)&&(!sv||u.server_type===sv));
 $("#usersTable").innerHTML=`<table><thead><tr><th>Usuario</th><th>Servicio</th><th>Plan</th><th>Estado</th><th>Caducidad</th><th>Dispositivos</th><th>Streams</th><th>Reseller</th><th>Acciones</th></tr></thead><tbody>${rows.map(u=>`<tr><td><b>${u.name}</b><br><small>${u.email||u.username}</small></td><td>${serviceLabel[u.server_type]}</td><td>${u.plan}</td><td><span class="chip ${statusClass[u.status]}">${statusLabel[u.status]}</span></td><td>${u.expires_at||"—"}</td><td>${u.max_devices}</td><td>${u.max_streams}</td><td>${u.reseller_name||"Directo"}</td><td class="actions"><button onclick="editUser(${u.id})">Editar</button><button onclick="toggleUser(${u.id},'${u.status}')">${u.status==="suspended"?"Activar":"Suspender"}</button><button class="danger" onclick="deleteUser(${u.id})">Eliminar</button></td></tr>`).join("")}</tbody></table>`;
}
["searchUsers","filterStatus","filterServer"].forEach(id=>$("#"+id).oninput=renderUsers);

function openUserModal(u=null){
 $("#modalTitle").textContent=u?"Editar usuario":"Nuevo usuario";
 const f=$("#userForm");f.reset();
 f.id.value=u?.id||"";f.name.value=u?.name||"";f.email.value=u?.email||"";f.username.value=u?.username||"";
 f.server_type.value=u?.server_type||"jellyfin";f.server_name.value=u?.server_name||"Principal";f.plan.value=u?.plan||"Premium";
 f.status.value=u?.status||"active";f.expires_at.value=u?.expires_at||"";f.max_devices.value=u?.max_devices||2;f.max_streams.value=u?.max_streams||1;
 f.libraries.value=(u?.libraries||[]).join(", ");f.notes.value=u?.notes||"";
 $("#modal").classList.remove("hidden");
}
window.editUser=id=>openUserModal(users.find(x=>x.id===id));
window.toggleUser=async(id,current)=>{
 const u=users.find(x=>x.id===id);await api("/api/users/"+id,{method:"PUT",body:JSON.stringify({status:current==="suspended"?"active":"suspended",libraries:u.libraries})});
 toast("Estado actualizado");loadUsers();loadDashboard();
};
window.deleteUser=async id=>{
 if(!confirm("¿Eliminar este usuario?"))return;
 await api("/api/users/"+id,{method:"DELETE"});toast("Usuario eliminado");loadUsers();loadDashboard();
};
$("#newUser").onclick=()=>openUserModal();$("#quickNew").onclick=()=>openUserModal();
$("#closeModal").onclick=$("#cancelModal").onclick=()=>$("#modal").classList.add("hidden");
$("#userForm").onsubmit=async e=>{
 e.preventDefault();const f=new FormData(e.target);const obj=Object.fromEntries(f);
 obj.libraries=obj.libraries.split(",").map(x=>x.trim()).filter(Boolean);
 const id=obj.id;delete obj.id;
 try{
   if(id)await api("/api/users/"+id,{method:"PUT",body:JSON.stringify(obj)});
   else await api("/api/users",{method:"POST",body:JSON.stringify(obj)});
   $("#modal").classList.add("hidden");toast(id?"Usuario actualizado":"Usuario creado");loadUsers();loadDashboard();
 }catch(err){alert(err.message)}
};

async function loadResellers(){
 resellers=await api("/api/resellers");
 $("#resellersTable").innerHTML=`<table><thead><tr><th>Reseller</th><th>Usuario</th><th>Créditos</th><th>Clientes</th><th>Estado</th></tr></thead><tbody>${resellers.map(r=>`<tr><td><b>${r.display_name}</b></td><td>${r.username}</td><td>${r.credits}</td><td>${r.users_count}</td><td>${r.active?"Activo":"Suspendido"}</td></tr>`).join("")}</tbody></table>`;
}
$("#newReseller").onclick=()=>$("#resellerModal").classList.remove("hidden");
$("#closeResellerModal").onclick=$("#cancelResellerModal").onclick=()=>$("#resellerModal").classList.add("hidden");
$("#resellerForm").onsubmit=async e=>{
 e.preventDefault();const obj=Object.fromEntries(new FormData(e.target));
 try{await api("/api/resellers",{method:"POST",body:JSON.stringify(obj)});$("#resellerModal").classList.add("hidden");e.target.reset();toast("Reseller creado");loadResellers()}
 catch(err){alert(err.message)}
};

async function loadServers(){
 servers=await api("/api/servers");
 $("#serversCards").innerHTML=servers.map(s=>`<article class="server-card"><h3>${s.type==="emby"?"◆":"△"} ${s.name}</h3><p>${s.base_url}</p><div class="system-row"><span>API configurada</span><b class="${s.configured?"online":""}">${s.configured?"Sí":"Pendiente"}</b></div><div class="system-row"><span>Estado</span><b class="online">${s.active?"Activo":"Desactivado"}</b></div></article>`).join("");
}
async function loadLogs(){
 const rows=await api("/api/logs");
 $("#logsTable").innerHTML=`<table><thead><tr><th>Fecha</th><th>Cuenta</th><th>Acción</th><th>Detalle</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.created_at}</td><td>${r.display_name||"Sistema"}</td><td>${r.action}</td><td>${r.detail}</td></tr>`).join("")}</tbody></table>`;
}
$("#globalSearch").onkeydown=e=>{if(e.key==="Enter"){go("users");$("#searchUsers").value=e.target.value;renderUsers()}};
boot();
