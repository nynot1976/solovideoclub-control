
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "control.db"));
db.pragma("journal_mode = WAL");

const SECRET = process.env.JWT_SECRET || "cambia-esta-clave-en-produccion";
const PORT = Number(process.env.PORT || 3000);

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','reseller')),
  display_name TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  owner_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  username TEXT NOT NULL,
  server_type TEXT NOT NULL CHECK(server_type IN ('emby','jellyfin','both')),
  server_name TEXT NOT NULL,
  plan TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','expiring','suspended','expired')),
  expires_at TEXT,
  max_devices INTEGER NOT NULL DEFAULT 2,
  max_streams INTEGER NOT NULL DEFAULT 1,
  libraries TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  reseller_id INTEGER,
  external_emby_id TEXT,
  external_jellyfin_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(reseller_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('emby','jellyfin')),
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const accountCount = db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n;
if (accountCount === 0) {
  const adminHash = bcrypt.hashSync("Admin123!", 10);
  const resellerHash = bcrypt.hashSync("Reseller123!", 10);
  const admin = db.prepare(`
    INSERT INTO accounts(username,password_hash,role,display_name,credits)
    VALUES(?,?,?,?,?)
  `).run("admin", adminHash, "admin", "Antonio", 9999);
  const reseller = db.prepare(`
    INSERT INTO accounts(username,password_hash,role,display_name,credits,owner_id)
    VALUES(?,?,?,?,?,?)
  `).run("reseller1", resellerHash, "reseller", "Reseller Demo", 50, admin.lastInsertRowid);

  const addUser = db.prepare(`
    INSERT INTO media_users(name,email,username,server_type,server_name,plan,status,expires_at,max_devices,max_streams,libraries,reseller_id)
    VALUES(@name,@email,@username,@server_type,@server_name,@plan,@status,@expires_at,@max_devices,@max_streams,@libraries,@reseller_id)
  `);
  const sample = [
    ["Antonio Cliente","antonio@example.com","antonio","jellyfin","Jellyfin 1","Premium","active","2026-08-15",3,2,["Películas","Series"],null],
    ["María García","maria@example.com","maria","emby","Emby 1","Premium","active","2026-09-01",4,2,["Películas","Series","Animación"],reseller.lastInsertRowid],
    ["Pedro López","pedro@example.com","pedro","both","Principal","Básico","expiring","2026-07-20",2,1,["Películas"],reseller.lastInsertRowid]
  ];
  for (const s of sample) addUser.run({
    name:s[0],email:s[1],username:s[2],server_type:s[3],server_name:s[4],plan:s[5],
    status:s[6],expires_at:s[7],max_devices:s[8],max_streams:s[9],
    libraries:JSON.stringify(s[10]),reseller_id:s[11]
  });

  db.prepare("INSERT INTO servers(name,type,base_url,api_key) VALUES(?,?,?,?)")
    .run("Emby 1","emby","http://192.168.1.133:8096","");
  db.prepare("INSERT INTO servers(name,type,base_url,api_key) VALUES(?,?,?,?)")
    .run("Jellyfin 1","jellyfin","http://192.168.1.133:8096","");
}

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(ROOT, "public")));

function auth(req,res,next){
  const token = req.cookies.token;
  if(!token) return res.status(401).json({error:"No autenticado"});
  try{
    req.account = jwt.verify(token, SECRET);
    next();
  }catch{
    return res.status(401).json({error:"Sesión no válida"});
  }
}

function adminOnly(req,res,next){
  if(req.account.role !== "admin") return res.status(403).json({error:"Solo administrador"});
  next();
}

function log(accountId, action, detail=""){
  db.prepare("INSERT INTO audit_logs(account_id,action,detail) VALUES(?,?,?)").run(accountId,action,detail);
}


async function probeServer(server){
  const base = String(server.base_url || "").replace(/\/+$/, "");
  if(!base) return {online:false,error:"URL no configurada"};
  const headers = {};
  if(server.api_key){
    headers["X-Emby-Token"] = server.api_key;
    headers["X-MediaBrowser-Token"] = server.api_key;
  }
  for(const url of [`${base}/System/Info/Public`,`${base}/emby/System/Info/Public`]){
    try{
      const controller = new AbortController();
      const timer = setTimeout(()=>controller.abort(),4500);
      const response = await fetch(url,{headers,signal:controller.signal});
      clearTimeout(timer);
      if(!response.ok) continue;
      const info = await response.json();
      return {
        online:true,
        server_name:info.ServerName || server.name,
        version:info.Version || "desconocida",
        product:info.ProductName || server.type
      };
    }catch(e){}
  }
  return {online:false,error:"No responde"};
}

app.post("/api/login",(req,res)=>{
  const {username,password} = req.body || {};
  const account = db.prepare("SELECT * FROM accounts WHERE username=? AND active=1").get(username);
  if(!account || !bcrypt.compareSync(password, account.password_hash)){
    return res.status(401).json({error:"Usuario o contraseña incorrectos"});
  }
  const payload = {id:account.id, username:account.username, role:account.role, display_name:account.display_name};
  const token = jwt.sign(payload, SECRET, {expiresIn:"12h"});
  res.cookie("token", token, {httpOnly:true, sameSite:"lax", maxAge:12*60*60*1000});
  log(account.id,"login");
  res.json(payload);
});

app.post("/api/logout",(req,res)=>{
  res.clearCookie("token");
  res.json({ok:true});
});

app.get("/api/me",auth,(req,res)=>{
  const account = db.prepare("SELECT id,username,role,display_name,credits,active FROM accounts WHERE id=?").get(req.account.id);
  res.json(account);
});

app.post("/api/change-password",auth,(req,res)=>{
  const {current_password,new_password}=req.body||{};
  const account=db.prepare("SELECT * FROM accounts WHERE id=?").get(req.account.id);
  if(!account || !bcrypt.compareSync(current_password||"",account.password_hash))
    return res.status(400).json({error:"Contraseña actual incorrecta"});
  if(String(new_password||"").length<8)
    return res.status(400).json({error:"La nueva contraseña debe tener 8 caracteres como mínimo"});
  db.prepare("UPDATE accounts SET password_hash=? WHERE id=?").run(bcrypt.hashSync(new_password,10),req.account.id);
  log(req.account.id,"change_password");
  res.json({ok:true});
});

app.get("/api/dashboard",auth,async(req,res)=>{
  const filter = req.account.role === "reseller" ? "WHERE reseller_id = ?" : "";
  const params = req.account.role === "reseller" ? [req.account.id] : [];
  const totals = db.prepare(`
    SELECT
      COUNT(*) total,
      SUM(status='active') active,
      SUM(status='expiring') expiring,
      SUM(status='suspended') suspended,
      SUM(server_type='emby') emby,
      SUM(server_type='jellyfin') jellyfin,
      SUM(server_type='both') both_services
    FROM media_users ${filter}
  `).get(...params);
  const recent = db.prepare(`SELECT * FROM media_users ${filter} ORDER BY id DESC LIMIT 6`).all(...params);
  const server_statuses = [];
  if(req.account.role === "admin"){
    for(const s of db.prepare("SELECT * FROM servers WHERE active=1 ORDER BY id").all()){
      server_statuses.push({id:s.id,name:s.name,type:s.type,...await probeServer(s)});
    }
  }
  res.json({totals,recent,server_statuses});
});

app.get("/api/users",auth,(req,res)=>{
  let rows;
  if(req.account.role === "reseller"){
    rows = db.prepare("SELECT * FROM media_users WHERE reseller_id=? ORDER BY id DESC").all(req.account.id);
  } else {
    rows = db.prepare(`
      SELECT media_users.*, accounts.display_name AS reseller_name
      FROM media_users LEFT JOIN accounts ON accounts.id=media_users.reseller_id
      ORDER BY media_users.id DESC
    `).all();
  }
  rows = rows.map(r=>({...r,libraries:JSON.parse(r.libraries || "[]")}));
  res.json(rows);
});

app.post("/api/users",auth,(req,res)=>{
  const b = req.body || {};
  if(!b.name || !b.username || !b.server_type || !b.plan) return res.status(400).json({error:"Faltan datos obligatorios"});
  const resellerId = req.account.role === "reseller" ? req.account.id : (b.reseller_id || null);

  if(req.account.role === "reseller"){
    const acc = db.prepare("SELECT credits FROM accounts WHERE id=?").get(req.account.id);
    if(acc.credits < 1) return res.status(400).json({error:"Créditos insuficientes"});
    db.prepare("UPDATE accounts SET credits=credits-1 WHERE id=?").run(req.account.id);
  }

  const result = db.prepare(`
    INSERT INTO media_users(name,email,username,server_type,server_name,plan,status,expires_at,max_devices,max_streams,libraries,notes,reseller_id)
    VALUES(@name,@email,@username,@server_type,@server_name,@plan,@status,@expires_at,@max_devices,@max_streams,@libraries,@notes,@reseller_id)
  `).run({
    name:b.name,email:b.email||"",username:b.username,server_type:b.server_type,
    server_name:b.server_name||"Principal",plan:b.plan,status:b.status||"active",
    expires_at:b.expires_at||null,max_devices:Number(b.max_devices||2),
    max_streams:Number(b.max_streams||1),libraries:JSON.stringify(b.libraries||[]),
    notes:b.notes||"",reseller_id:resellerId
  });

  log(req.account.id,"create_user",String(result.lastInsertRowid));
  const row = db.prepare("SELECT * FROM media_users WHERE id=?").get(result.lastInsertRowid);
  res.status(201).json({...row,libraries:JSON.parse(row.libraries)});
});

app.put("/api/users/:id",auth,(req,res)=>{
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM media_users WHERE id=?").get(id);
  if(!existing) return res.status(404).json({error:"Usuario no encontrado"});
  if(req.account.role === "reseller" && existing.reseller_id !== req.account.id) return res.status(403).json({error:"Sin permiso"});

  const b = {...existing,...req.body};
  db.prepare(`
    UPDATE media_users SET name=@name,email=@email,username=@username,server_type=@server_type,
    server_name=@server_name,plan=@plan,status=@status,expires_at=@expires_at,
    max_devices=@max_devices,max_streams=@max_streams,libraries=@libraries,notes=@notes
    WHERE id=@id
  `).run({
    id,name:b.name,email:b.email||"",username:b.username,server_type:b.server_type,
    server_name:b.server_name,plan:b.plan,status:b.status,expires_at:b.expires_at||null,
    max_devices:Number(b.max_devices),max_streams:Number(b.max_streams),
    libraries:JSON.stringify(b.libraries||JSON.parse(existing.libraries||"[]")),notes:b.notes||""
  });
  log(req.account.id,"update_user",String(id));
  res.json({ok:true});
});

app.delete("/api/users/:id",auth,(req,res)=>{
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM media_users WHERE id=?").get(id);
  if(!existing) return res.status(404).json({error:"Usuario no encontrado"});
  if(req.account.role === "reseller" && existing.reseller_id !== req.account.id) return res.status(403).json({error:"Sin permiso"});
  db.prepare("DELETE FROM media_users WHERE id=?").run(id);
  log(req.account.id,"delete_user",String(id));
  res.json({ok:true});
});

app.get("/api/resellers",auth,adminOnly,(req,res)=>{
  const rows = db.prepare(`
    SELECT a.id,a.username,a.display_name,a.credits,a.active,a.created_at,
    COUNT(m.id) AS users_count
    FROM accounts a LEFT JOIN media_users m ON m.reseller_id=a.id
    WHERE a.role='reseller'
    GROUP BY a.id ORDER BY a.id DESC
  `).all();
  res.json(rows);
});

app.post("/api/resellers",auth,adminOnly,(req,res)=>{
  const {username,password,display_name,credits=0} = req.body || {};
  if(!username || !password || !display_name) return res.status(400).json({error:"Faltan datos"});
  try{
    const hash=bcrypt.hashSync(password,10);
    const result=db.prepare(`
      INSERT INTO accounts(username,password_hash,role,display_name,credits,owner_id)
      VALUES(?,?,?,?,?,?)
    `).run(username,hash,"reseller",display_name,Number(credits),req.account.id);
    log(req.account.id,"create_reseller",String(result.lastInsertRowid));
    res.status(201).json({id:result.lastInsertRowid});
  }catch(e){
    res.status(400).json({error:"El usuario ya existe"});
  }
});

app.get("/api/servers",auth,adminOnly,(req,res)=>{
  const rows=db.prepare("SELECT id,name,type,base_url,active,created_at,CASE WHEN api_key<>'' THEN 1 ELSE 0 END AS configured FROM servers ORDER BY id").all();
  res.json(rows);
});
app.get("/api/servers/:id",auth,adminOnly,(req,res)=>{
  const row=db.prepare("SELECT id,name,type,base_url,api_key,active FROM servers WHERE id=?").get(Number(req.params.id));
  if(!row) return res.status(404).json({error:"Servidor no encontrado"});
  res.json(row);
});
app.post("/api/servers/:id/test",auth,adminOnly,async(req,res)=>{
  const row=db.prepare("SELECT * FROM servers WHERE id=?").get(Number(req.params.id));
  if(!row) return res.status(404).json({error:"Servidor no encontrado"});
  res.json(await probeServer(row));
});

app.put("/api/servers/:id",auth,adminOnly,(req,res)=>{
  const id=Number(req.params.id);
  const b=req.body||{};
  db.prepare("UPDATE servers SET name=?,base_url=?,api_key=?,active=? WHERE id=?")
    .run(b.name,b.base_url,b.api_key||"",b.active?1:0,id);
  log(req.account.id,"update_server",String(id));
  res.json({ok:true});
});

app.get("/api/logs",auth,adminOnly,(req,res)=>{
  const rows=db.prepare(`
    SELECT audit_logs.*, accounts.display_name
    FROM audit_logs LEFT JOIN accounts ON accounts.id=audit_logs.account_id
    ORDER BY audit_logs.id DESC LIMIT 100
  `).all();
  res.json(rows);
});

app.get("*",(req,res)=>res.sendFile(path.join(ROOT,"public","index.html")));

app.listen(PORT,()=>console.log(`SoloVideoClub Control: http://localhost:${PORT}`));
