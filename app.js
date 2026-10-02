const cfg = window.FAMILY_BUDGET_CONFIG;
const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey);

const $ = (id) => document.getElementById(id);
const money = (n) => new Intl.NumberFormat("he-IL",{style:"currency",currency:"ILS",maximumFractionDigits:0}).format(Number(n||0));
let viewedMonth = new Date(new Date().getFullYear(),new Date().getMonth(),1);
const monthName = () => new Intl.DateTimeFormat("he-IL",{month:"long",year:"numeric"}).format(viewedMonth);
const monthStart = () => new Date(viewedMonth.getFullYear(),viewedMonth.getMonth(),1).toISOString();
const monthEnd = () => new Date(viewedMonth.getFullYear(),viewedMonth.getMonth()+1,1).toISOString();
let toastTimer=null;
const toast = (msg,undoAction=null) => {
  const el=$("toast");
  clearTimeout(toastTimer);
  el.classList.remove("show","has-action");
  el.replaceChildren();
  const text=document.createElement("span");
  text.textContent=msg;
  el.appendChild(text);
  if(undoAction){
    el.classList.add("has-action");
    const btn=document.createElement("button");
    btn.type="button";
    btn.textContent="בטל";
    btn.onclick=async()=>{
      btn.disabled=true;
      try{
        await undoAction();
        toast("הפעולה בוטלה ✓");
      }catch(err){
        toast(err?.message||"לא ניתן לבטל את הפעולה");
      }
    };
    el.appendChild(btn);
  }
  requestAnimationFrame(()=>el.classList.add("show"));
  toastTimer=setTimeout(()=>el.classList.remove("show"),undoAction?6500:2200);
};
const escapeHtml = (v="") => String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));

let authMode = "login";
let categoryPieChart = null;
let selectedCategoryIndex = null;
const PIE_COLORS=["#6478F3","#8B5CF6","#22B8CF","#34C875","#F2A51A","#EF5B5B","#E85D9E","#8BCF2F","#28B7A5","#F47B35"];
let state = { family:null, me:null, members:[], categories:[], transactions:[], incomes:[], fixed:[], budgets:[], adminInfo:null };

const APP_VERSION="2.0.0";
const LOCAL_DB_NAME="family-budget-local-v2";
const LOCAL_DB_VERSION=1;
const LOCAL_STORES=["transactions","incomes","fixed_expenses","categories","budgets","meta"];
let localDbPromise=null;
let currentUserId=null;
let pendingUsageActions=0;
let usageFlushTimer=null;

function openLocalDb(){
  if(localDbPromise)return localDbPromise;
  localDbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(LOCAL_DB_NAME,LOCAL_DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      for(const name of LOCAL_STORES){
        if(db.objectStoreNames.contains(name))continue;
        const store=db.createObjectStore(name,{keyPath:name==="meta"?"key":"id"});
        if(name!=="meta")store.createIndex("family_id","family_id",{unique:false});
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error("Local database unavailable"));
  });
  return localDbPromise;
}

async function localList(storeName,familyId){
  const db=await openLocalDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(storeName,"readonly");
    const store=tx.objectStore(storeName);
    const req=store.index("family_id").getAll(familyId);
    req.onsuccess=()=>resolve(req.result||[]);
    req.onerror=()=>reject(req.error);
  });
}
async function localGet(storeName,id){
  const db=await openLocalDb();
  return new Promise((resolve,reject)=>{
    const req=db.transaction(storeName,"readonly").objectStore(storeName).get(id);
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error);
  });
}
async function localPut(storeName,row,{track=true}={}){
  const db=await openLocalDb();
  const value={...row,id:row.id||crypto.randomUUID()};
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(storeName,"readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error||new Error("Local write aborted"));
  });
  if(track)queueUsageAction(1);
  return value;
}
async function localBulkPut(storeName,rows,{track=false}={}){
  if(!rows?.length)return;
  const db=await openLocalDb();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(storeName,"readwrite");
    const store=tx.objectStore(storeName);
    rows.forEach(row=>store.put({...row,id:row.id||crypto.randomUUID()}));
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error||new Error("Local bulk write aborted"));
  });
  if(track)queueUsageAction(rows.length);
}
async function localDelete(storeName,id,{track=true}={}){
  const db=await openLocalDb();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(storeName,"readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error||new Error("Local delete aborted"));
  });
  if(track)queueUsageAction(1);
}
async function localPatch(storeName,id,patch,{track=true}={}){
  const current=await localGet(storeName,id);
  if(!current)throw new Error("הפריט לא נמצא במכשיר");
  return localPut(storeName,{...current,...patch,id},{track});
}
async function localMetaGet(key){
  const db=await openLocalDb();
  return new Promise((resolve,reject)=>{
    const req=db.transaction("meta","readonly").objectStore("meta").get(key);
    req.onsuccess=()=>resolve(req.result?.value);
    req.onerror=()=>reject(req.error);
  });
}
async function localMetaSet(key,value){
  const db=await openLocalDb();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction("meta","readwrite");
    tx.objectStore("meta").put({key,value});
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}

async function syncUsage(increment=0){
  try{
    if(!currentUserId){
      const {data:{user}}=await sb.auth.getUser();
      currentUserId=user?.id||null;
    }
    if(!currentUserId)return;
    const {data,error}=await sb.from("usage_stats").select("actions_count").eq("user_id",currentUserId).maybeSingle();
    if(error)throw error;
    const actions=Number(data?.actions_count||0)+Number(increment||0);
    const {error:upsertError}=await sb.from("usage_stats").upsert({
      user_id:currentUserId,
      last_seen:new Date().toISOString(),
      app_version:APP_VERSION,
      actions_count:actions,
      updated_at:new Date().toISOString()
    },{onConflict:"user_id"});
    if(upsertError)throw upsertError;
  }catch(err){
    console.warn("Usage telemetry failed",err);
  }
}
function queueUsageAction(count=1){
  pendingUsageActions+=Number(count||0);
  clearTimeout(usageFlushTimer);
  usageFlushTimer=setTimeout(async()=>{
    const n=pendingUsageActions;
    pendingUsageActions=0;
    await syncUsage(n);
  },1800);
}

async function importLegacyShortcutTransactions(familyId){
  const {data,error}=await sb.from("transactions").select("*").eq("family_id",familyId);
  if(error)throw error;
  const existing=await localList("transactions",familyId);
  const ids=new Set(existing.map(x=>x.id));
  const missing=(data||[]).filter(x=>!ids.has(x.id));
  if(missing.length)await localBulkPut("transactions",missing,{track:false});
}

async function importCaptureFromHash(){
  const raw=location.hash.startsWith("#")?location.hash.slice(1):"";
  if(!raw)return false;
  const params=new URLSearchParams(raw);
  if(params.get("capture")!=="1")return false;

  const amount=Number(params.get("amount")||0);
  if(!Number.isFinite(amount)||amount<=0){
    history.replaceState(null,"",location.pathname+location.search);
    toast("לא התקבל סכום תקין מהקיצור");
    return false;
  }

  const latRaw=params.get("lat");
  const lngRaw=params.get("lng");
  const latitude=latRaw!==null&&latRaw!==""?Number(latRaw):null;
  const longitude=lngRaw!==null&&lngRaw!==""?Number(lngRaw):null;

  await localPut("transactions",{
    id:crypto.randomUUID(),
    family_id:state.family.id,
    member_id:state.me.id,
    category_id:null,
    amount,
    currency:"ILS",
    merchant:(params.get("merchant")||"").trim()||null,
    source:"apple_pay",
    occurred_at:new Date().toISOString(),
    created_at:new Date().toISOString(),
    latitude:Number.isFinite(latitude)?latitude:null,
    longitude:Number.isFinite(longitude)?longitude:null,
    location_name:(params.get("place")||"").trim()||null,
    location_source:Number.isFinite(latitude)&&Number.isFinite(longitude)?"iphone":null
  });

  history.replaceState(null,"",location.pathname+location.search);
  toast("ההוצאה נשמרה במכשיר ✓");
  return true;
}

async function ensureLocalMigration(familyId){
  const key=`legacy-import:${familyId}:v2`;
  if(await localMetaGet(key))return;
  const [cats,txs,incomes,fixed,budgets]=await Promise.all([
    sb.from("categories").select("*").eq("family_id",familyId),
    sb.from("transactions").select("*").eq("family_id",familyId),
    sb.from("incomes").select("*").eq("family_id",familyId),
    sb.from("fixed_expenses").select("*").eq("family_id",familyId),
    sb.from("budgets").select("*").eq("family_id",familyId)
  ]);
  for(const r of [cats,txs,incomes,fixed,budgets]) if(r.error) throw r.error;
  await localBulkPut("categories",cats.data||[],{track:false});
  await localBulkPut("transactions",txs.data||[],{track:false});
  await localBulkPut("incomes",incomes.data||[],{track:false});
  await localBulkPut("fixed_expenses",fixed.data||[],{track:false});
  await localBulkPut("budgets",budgets.data||[],{track:false});
  await localMetaSet(key,{at:new Date().toISOString(),version:APP_VERSION});
  if(navigator.storage?.persist){
    navigator.storage.persist().catch(()=>{});
  }
  try{
    if(!currentUserId){
      const {data:{user}}=await sb.auth.getUser();
      currentUserId=user?.id||null;
    }
    if(currentUserId){
      await sb.from("local_migration_status").upsert({
        user_id:currentUserId,
        family_id:familyId,
        migrated_at:new Date().toISOString(),
        app_version:APP_VERSION
      },{onConflict:"user_id"});
    }
  }catch(err){
    console.warn("Migration status update failed",err);
  }
}

let incomeRevealed=false;
let incomeUnlockBusy=false;

const incomeCredentialStorageKey=()=>`familyBudgetIncomeCredential:${state.me?.id||"default"}`;

function syncIncomePrivacy(){
  const amount=$("incomeAmount");
  const card=$("incomeStatCard");
  const hint=$("incomeLockHint");
  if(!amount||!card)return;
  amount.classList.toggle("income-blurred",!incomeRevealed);
  card.classList.toggle("income-revealed",incomeRevealed);
  card.setAttribute("aria-label",incomeRevealed?"הכנסות מוצגות. לחץ להסתרה":"הכנסות מוסתרות. לחץ להצגה");
  if(hint)hint.textContent=incomeRevealed?"👁":"🔒";
}

function toBase64Url(buffer){
  let binary="";
  new Uint8Array(buffer).forEach(byte=>binary+=String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}

function fromBase64Url(value){
  const base64=String(value||"").replace(/-/g,"+").replace(/_/g,"/");
  const padded=base64+"=".repeat((4-base64.length%4)%4);
  const binary=atob(padded);
  return Uint8Array.from(binary,ch=>ch.charCodeAt(0)).buffer;
}

async function verifyDeviceForIncome(){
  if(!window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials){
    return {supported:false,ok:true};
  }

  let platformAvailable=false;
  try{
    platformAvailable=await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  }catch(_){}
  if(!platformAvailable)return {supported:false,ok:true};

  const key=incomeCredentialStorageKey();
  const saved=localStorage.getItem(key);
  const challenge=crypto.getRandomValues(new Uint8Array(32));

  try{
    if(saved){
      const assertion=await navigator.credentials.get({
        publicKey:{
          challenge,
          allowCredentials:[{type:"public-key",id:fromBase64Url(saved),transports:["internal"]}],
          userVerification:"required",
          timeout:60000
        }
      });
      return {supported:true,ok:Boolean(assertion)};
    }

    const credential=await navigator.credentials.create({
      publicKey:{
        challenge,
        rp:{name:"Family Budget"},
        user:{
          id:crypto.getRandomValues(new Uint8Array(24)),
          name:"family-budget-income",
          displayName:"הצגת הכנסות"
        },
        pubKeyCredParams:[
          {type:"public-key",alg:-7},
          {type:"public-key",alg:-257}
        ],
        authenticatorSelection:{
          authenticatorAttachment:"platform",
          userVerification:"required",
          residentKey:"discouraged",
          requireResidentKey:false
        },
        timeout:60000,
        attestation:"none"
      }
    });
    if(!credential)return {supported:true,ok:false};
    localStorage.setItem(key,toBase64Url(credential.rawId));
    return {supported:true,ok:true};
  }catch(err){
    if(err?.name==="NotFoundError"&&saved)localStorage.removeItem(key);
    return {supported:true,ok:false,cancelled:err?.name==="NotAllowedError"};
  }
}

async function toggleIncomeVisibility(){
  if(incomeUnlockBusy)return;

  if(incomeRevealed){
    incomeRevealed=false;
    syncIncomePrivacy();
    return;
  }

  incomeUnlockBusy=true;
  const card=$("incomeStatCard");
  card?.classList.add("income-unlocking");
  try{
    const result=await verifyDeviceForIncome();
    if(!result.ok){
      if(!result.cancelled)toast("לא ניתן לאמת את המכשיר");
      return;
    }
    incomeRevealed=true;
    syncIncomePrivacy();
    if(!result.supported)toast("אימות ביומטרי לא זמין במכשיר הזה");
  }finally{
    incomeUnlockBusy=false;
    card?.classList.remove("income-unlocking");
  }
}

let purchaseMap=null;
let purchaseMapLayer=null;
let manualTransactionLocation=null;

function roundGeneralLocation(value){
  return Math.round(Number(value)*1000)/1000;
}

function setManualLocationStatus(){
  const status=$("txLocationStatus");
  const clear=$("clearTxLocation");
  if(!status||!clear)return;
  if(manualTransactionLocation){
    status.textContent="מיקום צורף ✓";
    clear.classList.remove("hidden");
  }else{
    status.textContent="ללא מיקום";
    clear.classList.add("hidden");
  }
}

function captureCurrentPhoneLocation(){
  if(!navigator.geolocation){
    toast("שירות מיקום לא זמין במכשיר הזה");
    return;
  }
  const btn=$("captureTxLocation");
  btn.disabled=true;
  btn.textContent="מאתר מיקום…";
  navigator.geolocation.getCurrentPosition(
    (pos)=>{
      manualTransactionLocation={
        latitude:roundGeneralLocation(pos.coords.latitude),
        longitude:roundGeneralLocation(pos.coords.longitude)
      };
      setManualLocationStatus();
      btn.disabled=false;
      btn.textContent="📍 עדכן את מיקום הטלפון";
    },
    (err)=>{
      btn.disabled=false;
      btn.textContent="📍 צרף את מיקום הטלפון";
      toast(err?.code===1?"אין הרשאת מיקום":"לא הצלחתי לקבל מיקום");
    },
    {enableHighAccuracy:false,timeout:10000,maximumAge:30000}
  );
}

let mapRtlTextReady=null;
async function ensureMapRtlTextSupport(){
  if(!window.maplibregl?.setRTLTextPlugin)return;
  const status=window.maplibregl.getRTLTextPluginStatus?.();
  if(status==="loaded")return;
  if(!mapRtlTextReady){
    mapRtlTextReady=window.maplibregl
      .setRTLTextPlugin("https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js",false)
      .catch((err)=>{
        mapRtlTextReady=null;
        console.warn("RTL map text plugin failed to load",err);
      });
  }
  await mapRtlTextReady;
}

async function renderPurchaseMap(){
  const mapEl=$("purchaseMap");
  const analysisPage=$("analysisPage");
  if(!mapEl || !window.maplibregl || !analysisPage?.classList.contains("active"))return;

  await ensureMapRtlTextSupport();
  if(!analysisPage?.classList.contains("active"))return;

  const located=state.transactions.filter(t=>Number.isFinite(Number(t.latitude))&&Number.isFinite(Number(t.longitude)));
  const missing=Math.max(0,state.transactions.length-located.length);
  $("mapLocationCount").textContent=located.length;
  $("mapLocationMeta").textContent=located.length
    ? `${located.length} עסקאות עם מיקום · ${missing} ללא מיקום · ${monthName()}`
    : `אין עסקאות עם מיקום ב${monthName()}`;

  if(purchaseMap){
    purchaseMap.remove();
    purchaseMap=null;
  }

  purchaseMap=new maplibregl.Map({
    container:mapEl,
    style:"https://tiles.openfreemap.org/styles/liberty",
    center:[34.800,31.929],
    zoom:13,
    attributionControl:true
  });
  purchaseMap.addControl(new maplibregl.NavigationControl({showCompass:false}),"top-left");

  if(!located.length)return;

  const categoryTotals={};
  state.transactions.forEach(t=>{
    const name=t.categories?.name||"ללא קטגוריה";
    categoryTotals[name]=(categoryTotals[name]||0)+Number(t.amount||0);
  });
  const categoryColors=Object.fromEntries(
    Object.entries(categoryTotals)
      .sort((a,b)=>b[1]-a[1])
      .map(([name],index)=>[name,PIE_COLORS[index%PIE_COLORS.length]])
  );

  const groups=new Map();
  located.forEach(t=>{
    const lat=Number(t.latitude), lng=Number(t.longitude);
    const key=`${lat.toFixed(3)},${lng.toFixed(3)}`;
    if(!groups.has(key))groups.set(key,{lat,lng,rows:[]});
    groups.get(key).rows.push(t);
  });

  const points=[...groups.values()];
  const features=points.map((group,index)=>{
    const total=group.rows.reduce((sum,t)=>sum+Number(t.amount||0),0);
    const groupCategoryTotals={};
    group.rows.forEach(t=>{
      const name=t.categories?.name||"ללא קטגוריה";
      groupCategoryTotals[name]=(groupCategoryTotals[name]||0)+Number(t.amount||0);
    });
    const dominantCategory=Object.entries(groupCategoryTotals).sort((a,b)=>b[1]-a[1])[0]?.[0]||"ללא קטגוריה";
    const markerColor=categoryColors[dominantCategory]||PIE_COLORS[0];
    const lines=group.rows
      .slice()
      .sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at))
      .map(t=>{
        const category=t.categories?.name||"ללא קטגוריה";
        const color=categoryColors[category]||PIE_COLORS[0];
        return `<div class="map-popup-row"><span class="map-popup-name"><i class="map-popup-color" style="background:${color}"></i><strong>${escapeHtml(t.merchant||"עסקה")}</strong></span><span>${money(t.amount)}</span></div>`;
      })
      .join("");
    const placeNames=[...new Set(group.rows.map(t=>String(t.location_name||"").trim()).filter(Boolean))];
    const placeTitle=placeNames.length===1
      ? placeNames[0]
      : placeNames.length>1
        ? placeNames.slice(0,2).join(" · ")
        : (group.rows.length>1?`${group.rows.length} רכישות באזור`:"רכישה באזור");
    const popupHtml=`<div class="map-popup"><div class="map-popup-title">${escapeHtml(placeTitle)}</div>${lines}<div class="map-popup-total"><span>סה״כ</span><strong>${money(total)}</strong></div></div>`;
    return {
      type:"Feature",
      id:index,
      properties:{color:markerColor,popupHtml},
      geometry:{type:"Point",coordinates:[group.lng,group.lat]}
    };
  });

  purchaseMap.once("load",()=>{
    purchaseMap.addSource("purchases",{
      type:"geojson",
      data:{type:"FeatureCollection",features}
    });
    purchaseMap.addLayer({
      id:"purchase-points",
      type:"circle",
      source:"purchases",
      paint:{
        "circle-radius":9,
        "circle-color":["get","color"],
        "circle-stroke-color":"#FFFFFF",
        "circle-stroke-width":3,
        "circle-opacity":0.96
      }
    });

    purchaseMap.on("mouseenter","purchase-points",()=>{purchaseMap.getCanvas().style.cursor="pointer";});
    purchaseMap.on("mouseleave","purchase-points",()=>{purchaseMap.getCanvas().style.cursor="";});
    purchaseMap.on("click","purchase-points",(e)=>{
      const feature=e.features?.[0];
      if(!feature)return;
      const coordinates=feature.geometry.coordinates.slice();
      new maplibregl.Popup({offset:14,maxWidth:"280px"})
        .setLngLat(coordinates)
        .setHTML(feature.properties.popupHtml)
        .addTo(purchaseMap);
    });

    if(points.length===1){
      purchaseMap.jumpTo({center:[points[0].lng,points[0].lat],zoom:16});
    }else{
      const visibleBounds=new maplibregl.LngLatBounds();
      points.forEach(point=>visibleBounds.extend([point.lng,point.lat]));
      purchaseMap.fitBounds(visibleBounds,{padding:12,maxZoom:17,duration:0});
    }
    purchaseMap.resize();
  });
}
function show(id){
  ["authView","bootstrapView","appView"].forEach(x=>$(x).classList.add("hidden"));
  $(id).classList.remove("hidden");
  $("bottomNav").classList.toggle("hidden", id!=="appView");
}

async function currentMembership(){
  const {data,error}=await sb.from("members").select("id,name,role,family_id,families(id,name)").limit(1).maybeSingle();
  if(error) throw error;
  return data;
}

async function init(){
  updateMonthHeader();
  if(sessionStorage.getItem("showRefreshToast")==="1"){
    sessionStorage.removeItem("showRefreshToast");
    setTimeout(()=>toast("בוצע עדכון ✓"),250);
  }
  const {data:{session}} = await sb.auth.getSession();
  if(!session){ show("authView"); return; }
  try{
    const membership=await currentMembership();
    if(!membership){
      show("bootstrapView");
      const {data:joinStatus,error:joinErr}=await sb.functions.invoke("family-join",{body:{action:"status"}});
      if(!joinErr && joinStatus?.request?.status==="pending"){
        $("familyChoiceBox").classList.add("hidden");
        $("pendingJoinBox").classList.remove("hidden");
        $("pendingJoinText").textContent=`ממתין לאישור של ${joinStatus.request.families?.name || "מנהל המשפחה"}`;
      }else{
        $("familyChoiceBox").classList.remove("hidden");
        $("pendingJoinBox").classList.add("hidden");
      }
      return;
    }
    state.me=membership;
    state.family=membership.families;
    $("familyTitle").textContent=state.family?.name || "תקציב משפחתי";
    show("appView");
    await openLocalDb();
    await syncUsage(0);
    await loadAll();
  }catch(e){ toast(e.message); show("authView"); }
}

$("toggleAuthMode").onclick=()=>{
  authMode=authMode==="login"?"signup":"login";
  $("authForm").querySelector("button").textContent=authMode==="login"?"כניסה":"צור חשבון";
  $("toggleAuthMode").textContent=authMode==="login"?"אין חשבון? צור חשבון":"כבר יש חשבון? כניסה";
};

$("authForm").onsubmit=async(e)=>{
  e.preventDefault();
  const email=$("authEmail").value.trim().toLowerCase(), password=$("authPassword").value;
  const submitBtn=$("authForm").querySelector("button");
  submitBtn.disabled=true;
  try{
    if(authMode==="signup"){
      const {data:check,error:checkError}=await sb.functions.invoke("check-email",{body:{email}});
      if(checkError||check?.error){
        toast(check?.error==="Too many attempts"?"בוצעו יותר מדי בדיקות. נסה שוב בעוד כמה דקות.":"לא ניתן לבדוק כרגע אם האימייל קיים. נסה שוב.");
        return;
      }
      if(check?.exists){
        authMode="login";
        submitBtn.textContent="כניסה";
        $("toggleAuthMode").textContent="אין חשבון? צור חשבון";
        toast("האימייל כבר רשום במערכת. אפשר להיכנס עם החשבון הקיים.");
        return;
      }
    }
    const result=authMode==="login"
      ? await sb.auth.signInWithPassword({email,password})
      : await sb.auth.signUp({email,password,options:{emailRedirectTo:location.href}});
    if(result.error){ toast(result.error.message); return; }
    if(authMode==="signup" && !result.data.session){ toast("נשלח אימייל אימות. פתח אותו ואז חזור לאתר."); return; }
    await init();
  }finally{
    submitBtn.disabled=false;
  }
};

$("bootstrapForm").onsubmit=async(e)=>{
  e.preventDefault();
  const {data,error}=await sb.functions.invoke("bootstrap-family",{body:{familyName:$("familyName").value,displayName:$("displayName").value}});
  if(error || data?.error){ toast(data?.error || error.message); return; }
  toast("המשפחה נוצרה");
  if(data?.familyCode){
    sessionStorage.setItem("familyCode", data.familyCode);
  }
  await init();
};

$("joinFamilyForm").onsubmit=async(e)=>{
  e.preventDefault();
  const {data,error}=await sb.functions.invoke("family-join",{body:{
    action:"request",
    code:$("joinCode").value,
    displayName:$("joinDisplayName").value
  }});
  if(error||data?.error){ toast(data?.error||error.message); return; }
  toast("בקשת ההצטרפות נשלחה למנהל");
  await init();
};

async function logout(){ incomeRevealed=false; await syncUsage(pendingUsageActions); pendingUsageActions=0; currentUserId=null; await sb.auth.signOut(); state={family:null,me:null,members:[],categories:[],transactions:[],incomes:[],fixed:[],budgets:[],adminInfo:null}; show("authView"); }
$("logoutBtn").onclick=logout; $("bootstrapLogout").onclick=logout;
$("appVersion").onclick=()=>{
  sessionStorage.setItem("showRefreshToast","1");
  location.reload();
};

function updateMonthHeader(){
  $("monthTitle").textContent=monthName();
  const now=new Date();
  const atCurrent=viewedMonth.getFullYear()===now.getFullYear() && viewedMonth.getMonth()===now.getMonth();
  if($("nextMonth")) $("nextMonth").disabled=atCurrent;
}
async function moveMonth(delta){
  viewedMonth=new Date(viewedMonth.getFullYear(),viewedMonth.getMonth()+delta,1);
  updateMonthHeader();
  selectedCategoryIndex=null;
  await loadAll();
}
$("prevMonth").onclick=()=>moveMonth(-1);
$("nextMonth").onclick=()=>moveMonth(1);

function openPage(pageId){
  document.querySelectorAll(".bottom-nav button").forEach(b=>b.classList.toggle("active",b.dataset.page===pageId));
  document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id===pageId));
  if(pageId==="analysisPage")setTimeout(renderPurchaseMap,80);
}
document.querySelectorAll(".bottom-nav button").forEach(btn=>btn.onclick=()=>{
  openPage(btn.dataset.page);
});

async function loadAll(){
  const f=state.family.id;
  const [members,cats,txs,incomes,fixed,budgets]=await Promise.all([
    sb.from("members").select("*").eq("family_id",f).order("created_at"),
    sb.from("categories").select("*").eq("family_id",f).order("name"),
    sb.from("transactions").select("*,members(name),categories(name)").eq("family_id",f).gte("occurred_at",monthStart()).lt("occurred_at",monthEnd()).order("created_at",{ascending:false}).order("occurred_at",{ascending:false}),
    sb.from("incomes").select("*").eq("family_id",f).eq("active",true).order("created_at"),
    sb.from("fixed_expenses").select("*,categories(name)").eq("family_id",f).eq("active",true).order("display_order",{ascending:true}).order("created_at",{ascending:true}),
    sb.from("budgets").select("*,categories(name)").eq("family_id",f)
  ]);
  for(const r of [members,cats,txs,incomes,fixed,budgets]) if(r.error) throw r.error;
  state.members=members.data||[];
  state.categories=cats.data||[];
  state.transactions=txs.data||[];
  state.incomes=incomes.data||[];
  state.fixed=fixed.data||[];
  state.budgets=budgets.data||[];

  if(state.me?.role==="admin"){
    const {data,error}=await sb.functions.invoke("manage-family",{body:{action:"info"}});
    if(!error && !data?.error) state.adminInfo=data;
  } else {
    state.adminInfo=null;
  }
  render();
}

function renderCategoryPie(){
  const container=$("categoryPie");
  const legend=$("categoryLegend");
  if(!container||!window.echarts)return;

  const byCat={};
  state.transactions.forEach(t=>{
    const key=t.categories?.name||"ללא קטגוריה";
    byCat[key]=(byCat[key]||0)+Number(t.amount||0);
  });
  const entries=Object.entries(byCat).sort((a,b)=>b[1]-a[1]);

  if(!entries.length){
    selectedCategoryIndex=null;
    if(categoryPieChart){categoryPieChart.dispose();categoryPieChart=null;}
    container.innerHTML='<div class="empty-state chart-empty">אין עדיין עסקאות</div>';
    if(legend)legend.innerHTML="";
    return;
  }

  const total=entries.reduce((s,[,v])=>s+v,0);
  const data=entries.map(([name,value],index)=>({
    name,
    value,
    itemStyle:{
      color:PIE_COLORS[index%PIE_COLORS.length],
      borderColor:"#0d1929",
      borderWidth:2
    }
  }));

  if(legend){
    legend.innerHTML=data.map((item,index)=>{
      const pct=Math.round((Number(item.value)/total)*100);
      return `<div class="home-legend-row"><i class="home-legend-dot" style="background:${PIE_COLORS[index%PIE_COLORS.length]}"></i><span class="home-legend-name">${escapeHtml(item.name)}</span><strong class="home-legend-pct">${pct}%</strong></div>`;
    }).join("");
  }

  if(categoryPieChart)categoryPieChart.dispose();
  container.innerHTML="";
  categoryPieChart=echarts.init(container);

  categoryPieChart.setOption({
    animationDuration:600,
    animationEasing:"cubicOut",
    tooltip:{
      trigger:"item",
      formatter:p=>`${escapeHtml(p.name)}<br>${money(p.value)} · ${Math.round(p.percent)}%`
    },
    series:[{
      type:"pie",
      radius:"73%",
      center:["50%","52%"],
      startAngle:90,
      minAngle:3,
      avoidLabelOverlap:true,
      label:{
        show:true,
        position:"inside",
        formatter:p=>p.percent>=5?`${Math.round(p.percent)}%`:"",
        color:"#fff",
        fontSize:14,
        fontWeight:800
      },
      labelLine:{show:false},
      emphasis:{
        scale:true,
        scaleSize:8,
        itemStyle:{shadowBlur:18,shadowColor:"rgba(0,0,0,.45)"}
      },
      data
    }]
  },true);

  setTimeout(()=>categoryPieChart?.resize(),40);
}

function txCategoryIcon(name=""){
  const n=String(name||"").toLowerCase();
  if(n.includes("מזון")||n.includes("אוכל")||n.includes("סופר"))return "🛒";
  if(n.includes("רכב")||n.includes("תחבורה")||n.includes("דלק"))return "🚗";
  if(n.includes("בריאות")||n.includes("פארם"))return "✚";
  if(n.includes("בילוי"))return "★";
  if(n.includes("קניות"))return "▣";
  return "₪";
}

function render(){
  const income=state.incomes.reduce((s,x)=>s+Number(x.amount),0);
  const spent=state.transactions.reduce((s,x)=>s+Number(x.amount),0);
  const fixed=state.fixed.reduce((s,x)=>s+Number(x.amount),0);
  const now=new Date();
  const d=new Date(viewedMonth.getFullYear(),viewedMonth.getMonth(),1);
  const daysInMonth=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
  const isCurrentMonth=d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth();
  const elapsed=isCurrentMonth?Math.max(1,now.getDate()):daysInMonth;
  const forecast=isCurrentMonth?Math.round((spent/elapsed)*daysInMonth):Math.round(spent);
  const available=income-spent-fixed;
  $("incomeAmount").textContent=money(income); $("spentAmount").textContent=money(spent); $("fixedAmount").textContent=money(fixed); $("forecastAmount").textContent=money(forecast); $("availableAmount").textContent=money(available);
  syncIncomePrivacy();

  renderCategoryPie();

  const txHtml=(arr)=>arr.map(t=>`<div class="transaction-row transaction-editable" data-tx-id="${t.id}"><span class="tx-category-icon">${txCategoryIcon(t.categories?.name)}</span><div class="transaction-main"><strong>${escapeHtml(t.merchant||"עסקה")}</strong><div class="amount-negative amount-under-name">${money(t.amount)}</div><small>${escapeHtml(t.categories?.name||"ללא קטגוריה")} · ${escapeHtml(t.members?.name||"")} · ${new Date(t.occurred_at).toLocaleDateString("he-IL")}${t.latitude!=null&&t.longitude!=null?" · 📍":""}</small></div></div>`).join("")||'<div class="empty-state">אין עדיין עסקאות</div>';
  $("recentTransactions").innerHTML=txHtml(state.transactions.slice(0,5));
  bindTransactionLongPress($("recentTransactions"));
  renderTransactionSearch();

  $("membersList").innerHTML=state.members.map(m=>`<div class="settings-row"><div><strong>${escapeHtml(m.name)}</strong><small>${m.role==="admin"?"מנהל":"בן משפחה"}</small></div><div class="mini-actions">${state.me?.role==="admin"?`<button class="mini-btn" onclick="editMember('${m.id}')">ערוך</button>${m.id!==state.me.id?`<button class="mini-btn danger-btn" onclick="deleteMember('${m.id}')">מחק</button>`:""}<button class="mini-btn" onclick="makeToken('${m.id}')">טוקן לקיצור</button>`:""}</div></div>`).join("");

  $("familyAdminCard").classList.toggle("hidden",state.me?.role!=="admin");
  if(state.me?.role==="admin"){
    const firstChar=state.adminInfo?.codeFirstChar||"";
    const lastChar=state.adminInfo?.codeLastChar||"";
    const codeLength=Number(state.adminInfo?.codeLength||0);
    const maskedCode=(firstChar&&lastChar&&codeLength>=2)?firstChar+"*".repeat(Math.max(0,codeLength-2))+lastChar:"לא הוגדר";
    $("familyCodeHint").textContent=maskedCode;
    if($("familyCodeLabel")) $("familyCodeLabel").textContent="קוד משפחה";
    const pending=state.adminInfo?.pending||[];
    $("pendingRequests").classList.toggle("hidden",!pending.length);
    $("pendingRequests").innerHTML=pending.length
      ? pending.map(r=>`<div class="settings-row"><div><strong>${escapeHtml(r.display_name)}</strong><small>בקשת הצטרפות</small></div><div class="mini-actions"><button class="mini-btn approve" onclick="decideJoin('${r.id}','approve')">אשר</button><button class="mini-btn" onclick="decideJoin('${r.id}','reject')">דחה</button></div></div>`).join("")
      : "";
  }
  $("incomeList").innerHTML=state.incomes.map(x=>`<div class="settings-row"><div><strong>${escapeHtml(x.description)}</strong><small>חודשי · ${money(x.amount)}</small></div><div class="mini-actions"><button class="mini-btn" onclick="editIncome('${x.id}')">ערוך</button><button class="mini-btn danger-btn" onclick="deleteIncome('${x.id}')">מחק</button></div></div>`).join("")||'<div class="empty-state">אין הכנסות</div>';
  renderFixedList();
  $("categoriesList").innerHTML=state.categories.map(c=>{const b=state.budgets.find(x=>x.category_id===c.id);return `<div class="settings-row"><div><strong>${escapeHtml(c.name)}</strong><small>${b?"תקציב "+money(b.monthly_limit):"ללא תקציב"}</small></div><div class="mini-actions"><button class="mini-btn" onclick="setBudget('${c.id}')">תקציב</button></div></div>`}).join("");

  $("txMember").innerHTML=state.members.map(m=>`<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("");
  $("txCategory").innerHTML='<option value="">ללא קטגוריה</option>'+state.categories.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  if($("transactionCategoryFilter")){
    const keep=$("transactionCategoryFilter").value;
    $("transactionCategoryFilter").innerHTML='<option value="">כל הקטגוריות</option><option value="__none__">ללא קטגוריה</option>'+state.categories.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
    const values=[...$("transactionCategoryFilter").options].map(o=>o.value);
    $("transactionCategoryFilter").value=values.includes(keep)?keep:"";
  }

  const byMember={};state.transactions.forEach(t=>{const k=t.members?.name||"לא ידוע";byMember[k]=(byMember[k]||0)+Number(t.amount)});
  $("memberBreakdown").innerHTML='<div class="analysis-block"><div class="bar-label"><strong>הוצאות לפי בן משפחה</strong></div>'+Object.entries(byMember).sort((a,b)=>b[1]-a[1]).map(([n,v])=>`<div class="settings-row"><span>${escapeHtml(n)}</span><strong>${money(v)}</strong></div>`).join("")+'</div>';
  $("budgetBreakdown").innerHTML='<div class="analysis-block"><div class="bar-label"><strong>ניצול תקציבים</strong></div>'+state.budgets.map(b=>{const used=state.transactions.filter(t=>t.category_id===b.category_id).reduce((s,t)=>s+Number(t.amount),0);const pct=Math.min(100,Math.round(used/Number(b.monthly_limit)*100)||0);return `<div style="margin:14px 0"><div class="bar-label"><span>${escapeHtml(b.categories?.name||"קטגוריה")}</span><strong>${money(used)} / ${money(b.monthly_limit)}</strong></div><div class="progress"><i style="width:${pct}%"></i></div></div>`}).join("")+'</div>';
  if($("analysisPage")?.classList.contains("active"))setTimeout(renderPurchaseMap,80);
}

$("incomeForm").onsubmit=async(e)=>{e.preventDefault();const {error}=await sb.from("incomes").insert({family_id:state.family.id,member_id:state.me?.id||null,description:$("incomeDesc").value,amount:Number($("incomeValue").value),frequency:"monthly"});if(error)return toast(error.message);e.target.reset();await loadAll();};

window.editIncome=async(id)=>{
  const item=state.incomes.find(x=>x.id===id); if(!item)return;
  const previous={description:item.description,amount:Number(item.amount)};
  const description=prompt("תיאור ההכנסה",item.description); if(description===null)return;
  const value=prompt("סכום חודשי",String(item.amount)); if(value===null)return;
  const amount=Number(value); if(!description.trim()||!Number.isFinite(amount)||amount<0)return toast("פרטים לא תקינים");
  const {error}=await sb.from("incomes").update({description:description.trim(),amount}).eq("id",id);\n  if(error)return toast(error.message);
  await loadAll();
  toast("ההכנסה עודכנה",async()=>{
    const {error}=await sb.from("incomes").update(previous).eq("id",id);\n    if(error)throw error;
    await loadAll();
  });
};
window.deleteIncome=async(id)=>{
  const item=state.incomes.find(x=>x.id===id); if(!item)return;
  if(!confirm(`למחוק את ההכנסה "${item.description}"?`))return;
  const restore={...item};
  const {error}=await sb.from("incomes").delete().eq("id",id);\n  if(error)return toast(error.message);
  await loadAll();
  toast("ההכנסה נמחקה",async()=>{
    const {error}=await sb.from("incomes").insert(restore);\n    if(error)throw error;
    await loadAll();
  });
};

window.editMember=async(id)=>{
  const member=state.members.find(x=>x.id===id); if(!member)return;
  const currentName=member.name||"";
  const name=prompt("שם בן המשפחה",currentName); if(name===null)return;
  if(!name.trim())return toast("השם לא יכול להיות ריק");
  const {error}=await sb.from("members").update({name:name.trim()}).eq("id",id);
  if(error)return toast(error.message);
  await loadAll();
  toast("שם בן המשפחה עודכן",async()=>{
    const {error}=await sb.from("members").update({name:currentName}).eq("id",id);
    if(error)throw error;
    await loadAll();
  });
};
window.deleteMember=async(id)=>{
  const member=state.members.find(x=>x.id===id); if(!member)return;
  if(!confirm(`למחוק את ${member.name} מהמשפחה?`))return;
  const {error}=await sb.from("members").delete().eq("id",id);
  if(error){
    if(String(error.message||"").toLowerCase().includes("foreign key")) return toast("לא ניתן למחוק בן משפחה שיש לו עסקאות");
    return toast(error.message);
  }
  toast("בן המשפחה נמחק"); await loadAll();
};
function renderFixedList(filterText=""){
  const q=String(filterText||"").trim().toLocaleLowerCase("he");
  let rows=[...state.fixed].sort((a,b)=>{
    const aFilled=Number(a.amount)>0?1:0;
    const bFilled=Number(b.amount)>0?1:0;
    if(aFilled!==bFilled)return bFilled-aFilled;
    const aOrder=Number(a.display_order)||0;
    const bOrder=Number(b.display_order)||0;
    if(aOrder!==bOrder)return aOrder-bOrder;
    return String(a.description||"").localeCompare(String(b.description||""),"he");
  });
  if(q){
    rows=rows.filter(x=>String(x.description||"").toLocaleLowerCase("he").includes(q));
  }
  $("fixedList").innerHTML=rows.map(x=>`<div class="settings-row fixed-edit-row"><div><strong>${escapeHtml(x.description)}</strong><small>חודשי</small></div><div class="fixed-edit"><input id="fixed-${x.id}" type="number" min="0" step="0.01" value="${Number(x.amount)}" inputmode="decimal"><button class="mini-btn" onclick="saveFixed('${x.id}')">שמור</button></div></div>`).join("")||(q?'<div class="empty-state">לא נמצאו סעיפים תואמים</div>':'<div class="empty-state">אין הוצאות קבועות</div>');
}
$("fixedDesc").oninput=()=>renderFixedList($("fixedDesc").value);
$("fixedForm").onsubmit=async(e)=>{e.preventDefault();const nextOrder=Math.min(0,...state.fixed.map(x=>Number(x.display_order)||0))-1;const {error}=await sb.from("fixed_expenses").insert({family_id:state.family.id,description:$("fixedDesc").value.trim(),amount:Number($("fixedValue").value),frequency:"monthly",display_order:nextOrder});if(error)return toast(error.message);e.target.reset();await loadAll();};
window.saveFixed=async(id)=>{const item=state.fixed.find(x=>x.id===id);if(!item)return;const previous=Number(item.amount);const amount=Number($("fixed-"+id).value);if(!Number.isFinite(amount)||amount<0)return toast("סכום לא תקין");const {error}=await sb.from("fixed_expenses").update({amount}).eq("id",id);if(error)return toast(error.message);await loadAll();toast("ההוצאה עודכנה",async()=>{const {error}=await sb.from("fixed_expenses").update({amount:previous}).eq("id",id);if(error)throw error;await loadAll();});};
$("categoryForm").onsubmit=async(e)=>{e.preventDefault();const {error}=await sb.from("categories").insert({family_id:state.family.id,name:$("categoryName").value.trim()});if(error)return toast(error.message);e.target.reset();await loadAll();};

window.setBudget=async(categoryId)=>{
  const category=state.categories.find(x=>x.id===categoryId); if(!category)return;
  const value=prompt(`תקציב חודשי ל-${category.name}`);if(value===null)return;
  const amount=Number(value);if(!Number.isFinite(amount)||amount<0)return toast("סכום לא תקין");
  const existing=state.budgets.find(b=>b.category_id===categoryId);
  if(existing){
    const previous=Number(existing.monthly_limit);
    const {error}=await sb.from("budgets").update({monthly_limit:amount}).eq("id",existing.id);\n    if(error)return toast(error.message);
    await loadAll();
    toast("התקציב עודכן",async()=>{const {error}=await sb.from("budgets").update({monthly_limit:previous}).eq("id",existing.id);if(error)throw error;await loadAll();});
  }else{
    const {data,error}=await sb.from("budgets").insert({family_id:state.family.id,category_id:categoryId,monthly_limit:amount}).select("id").single();\n    if(error)return toast(error.message);
    await loadAll();
    toast("התקציב נוסף",async()=>{const {error}=await sb.from("budgets").delete().eq("id",data.id);if(error)throw error;await loadAll();});
  }
};

window.makeToken=async(memberId)=>{const member=state.members.find(x=>x.id===memberId);if(!member)return;const {data,error}=await sb.functions.invoke("create-shortcut-token",{body:{memberId,label:`iPhone - ${member.name}`}});if(error||data?.error)return toast(data?.error||error.message);$("tokenValue").value=data.token;$("tokenDialog").showModal();};
$("rotateFamilyCode").onclick=async()=>{
  const {data,error}=await sb.functions.invoke("manage-family",{body:{action:"rotate"}});
  if(error||data?.error)return toast(data?.error||error.message);
  sessionStorage.removeItem("familyCode");
  if(data.maskedCode) $("familyCodeHint").textContent=data.maskedCode;
  if($("familyCodeLabel")) $("familyCodeLabel").textContent="קוד משפחה";
  toast("קוד המשפחה עודכן");
  await loadAll();
};

$("saveFamilyCode").onclick=async()=>{
  const code=$("customFamilyCode").value.trim().toUpperCase();
  if(code.length<6||code.length>24)return toast("הקוד חייב להיות באורך 6–24 תווים");
  $("saveFamilyCode").disabled=true;
  try{
    const {data,error}=await sb.functions.invoke("manage-family",{body:{action:"set_code",code}});
    if(error||data?.error){toast(data?.error||error.message);return;}
    $("customFamilyCode").value="";
    sessionStorage.removeItem("familyCode");
    if(data.maskedCode) $("familyCodeHint").textContent=data.maskedCode;
    if($("familyCodeLabel")) $("familyCodeLabel").textContent="קוד משפחה";
    toast("קוד המשפחה עודכן");
  }finally{
    $("saveFamilyCode").disabled=false;
  }
};
window.decideJoin=async(requestId,action)=>{
  const {data,error}=await sb.functions.invoke("manage-family",{body:{action,requestId}});
  if(error||data?.error)return toast(data?.error||error.message);
  toast(action==="approve"?"המשתמש אושר":"הבקשה נדחתה");
  await loadAll();
};

$("closeTokenDialog").onclick=()=>$("tokenDialog").close();
$("copyToken").onclick=async()=>{
  const value=$("tokenValue").value;
  if(!value)return toast("אין Token להעתקה");
  try{
    await navigator.clipboard.writeText(value);
  }catch(_){
    $("tokenValue").focus();
    $("tokenValue").select();
    document.execCommand("copy");
  }
  toast("ה־Token הועתק ✓");
};

$("testTransaction").onclick=async()=>{
  if(!state.members.length)return toast("אין בני משפחה");
  $("testTransaction").disabled=true;
  const merchants=["שופרסל","ארומה","סופר-פארם","Yellow","ויקטורי","גולדה","מקס סטוק","KSP","FOX","קפה לנדוור","Wolt","Gett"];
  const preferredCats=["סופר","אוכל בחוץ","בריאות","רכב","סופר","אוכל בחוץ","קניות","קניות","קניות","אוכל בחוץ","אוכל בחוץ","רכב"];
  const locations=[
    [31.930,34.800],[31.929,34.798],[31.927,34.801],[31.932,34.794],
    [31.925,34.804],[31.929,34.803],[31.923,34.799],[31.934,34.802]
  ];
  const categoryByName=Object.fromEntries(state.categories.map(c=>[c.name,c.id]));
  const now=new Date();
  const rows=[];
  for(let n=0;n<12;n++){
    const member=state.members[n%state.members.length];
    const d=new Date(now);
    d.setDate(Math.max(1,now.getDate()-((n*2)%Math.max(1,now.getDate()))));
    d.setHours(8+((n*3)%13),(n*7)%60,0,0);
    const hasLocation=n<8;
    const loc=hasLocation?locations[n%locations.length]:null;
    rows.push({
      family_id:state.family.id,
      member_id:member.id,
      category_id:categoryByName[preferredCats[n]]||null,
      amount:Number((29.9+(n*37.35)%310).toFixed(2)),
      currency:"ILS",
      merchant:merchants[n],
      source:"apple_pay",
      occurred_at:d.toISOString(),
      external_id:`demo-${Date.now()}-${n}`,
      latitude:loc?.[0]??null,
      longitude:loc?.[1]??null,
      location_name:loc?"מיקום בדיקה":null,
      location_source:loc?"test":null
    });
  }
  try{
    const {error}=await sb.from("transactions").insert(rows);\n    if(error){toast(error.message);return;}
    toast("נוספו 12 עסקאות בדיקה: 8 עם מיקום ו־4 בלי");
    await loadAll();
  }finally{
    $("testTransaction").disabled=false;
  }
};
function goToFixedExpenses(){
  openPage("settingsPage");
  $("fixedExpensesCard").open=true;
  setTimeout(()=>$("fixedExpensesCard").scrollIntoView({behavior:"smooth",block:"start"}),50);
}
$("fixedStatCard").onclick=()=>{
  openPage("settingsPage");
  $("fixedExpensesCard").open=true;
  setTimeout(()=>$("fixedExpensesCard").scrollIntoView({behavior:"smooth",block:"start"}),50);
};
$("fixedStatCard").onkeydown=(e)=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();$("fixedStatCard").click();}};
function editTransaction(id){
  const t=state.transactions.find(x=>x.id===id);
  if(!t)return;

  $("editTxId").value=t.id;
  $("editTxMerchant").value=t.merchant||"";
  $("editTxAmount").value=Number(t.amount||0);

  $("editTxMember").innerHTML=state.members
    .map(m=>`<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("");
  $("editTxMember").value=t.member_id||state.me?.id||"";

  $("editTxCategory").innerHTML='<option value="">ללא קטגוריה</option>'+
    state.categories.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  $("editTxCategory").value=t.category_id||"";

  $("editTransactionDialog").showModal();
}

$("closeEditTransactionDialog").onclick=()=>$("editTransactionDialog").close();
$("editTransactionForm").onsubmit=async(e)=>{
  e.preventDefault();
  const id=$("editTxId").value;
  const current=state.transactions.find(x=>x.id===id); if(!current)return;
  const previous={merchant:current.merchant||null,amount:Number(current.amount),member_id:current.member_id,category_id:current.category_id||null};
  const amount=Number($("editTxAmount").value);
  if(!Number.isFinite(amount)||amount<0)return toast("סכום לא תקין");

  const payload={
    merchant:$("editTxMerchant").value.trim()||null,
    amount,
    member_id:$("editTxMember").value,
    category_id:$("editTxCategory").value||null
  };
  const {error}=await sb.from("transactions").update(payload).eq("id",id);\n  if(error)return toast(error.message);
  $("editTransactionDialog").close();
  await loadAll();
  toast("העסקה עודכנה",async()=>{
    const {error}=await sb.from("transactions").update(previous).eq("id",id);\n    if(error)throw error;
    await loadAll();
  });
};

$("deleteTransaction").onclick=async()=>{
  const id=$("editTxId").value;
  const current=state.transactions.find(x=>x.id===id); if(!current)return;
  if(!confirm("למחוק את העסקה?"))return;
  const restore={
    id:current.id,
    family_id:current.family_id,
    member_id:current.member_id,
    category_id:current.category_id||null,
    amount:Number(current.amount),
    currency:current.currency||"ILS",
    merchant:current.merchant||null,
    source:current.source||"manual",
    occurred_at:current.occurred_at,
    external_id:current.external_id||null,
    latitude:current.latitude??null,
    longitude:current.longitude??null,
    location_name:current.location_name??null,
    location_source:current.location_source??null
  };
  const {error}=await sb.from("transactions").delete().eq("id",id);\n  if(error)return toast(error.message);
  $("editTransactionDialog").close();
  await loadAll();
  toast("העסקה נמחקה",async()=>{
    const {error}=await sb.from("transactions").insert(restore);\n    if(error)throw error;
    await loadAll();
  });
};

function bindTransactionLongPress(container){
  if(!container)return;
  container.querySelectorAll(".transaction-editable").forEach(row=>{
    let timer=null, moved=false;
    const start=()=>{
      moved=false;
      row.classList.add("holding");
      timer=setTimeout(()=>{
        timer=null;
        row.classList.remove("holding");
        if(!moved) editTransaction(row.dataset.txId);
      },650);
    };
    const cancel=()=>{
      if(timer){clearTimeout(timer);timer=null;}
      row.classList.remove("holding");
    };
    row.addEventListener("touchstart",start,{passive:true});
    row.addEventListener("touchmove",()=>{moved=true;cancel();},{passive:true});
    row.addEventListener("touchend",cancel,{passive:true});
    row.addEventListener("touchcancel",cancel,{passive:true});
    row.addEventListener("mousedown",start);
    row.addEventListener("mousemove",()=>{moved=true;cancel();});
    row.addEventListener("mouseup",cancel);
    row.addEventListener("mouseleave",cancel);
    row.addEventListener("contextmenu",e=>{e.preventDefault();e.stopPropagation();});
  });
}

function renderTransactionSearch(){
  const q=($("transactionSearch")?.value||"").trim().toLowerCase();
  const categoryFilter=$("transactionCategoryFilter")?.value||"";
  const amountFilter=$("transactionAmountFilter")?.value||"";
  let rows=state.transactions;

  if(categoryFilter){
    rows=rows.filter(t=>categoryFilter==="__none__"?!t.category_id:t.category_id===categoryFilter);
  }

  if(amountFilter){
    rows=rows.filter(t=>{
      const amount=Number(t.amount||0);
      if(amountFilter==="0-50") return amount<50;
      if(amountFilter==="50-100") return amount>=50 && amount<100;
      if(amountFilter==="100-250") return amount>=100 && amount<250;
      if(amountFilter==="250-500") return amount>=250 && amount<500;
      if(amountFilter==="500+") return amount>=500;
      return true;
    });
  }

  if(q){
    rows=rows.filter(t=>{
      const hay=[
        t.merchant||"",
        t.members?.name||"",
        t.categories?.name||"",
        String(t.amount??""),
        money(t.amount)
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  $("allTransactions").innerHTML=(rows.map(t=>`<div class="transaction-row transaction-editable" data-tx-id="${t.id}"><div class="transaction-main"><strong>${escapeHtml(t.merchant||"עסקה")}</strong><div class="amount-negative amount-under-name">${money(t.amount)}</div><small>${escapeHtml(t.members?.name||"")} · ${new Date(t.occurred_at).toLocaleDateString("he-IL")} · ${escapeHtml(t.categories?.name||"ללא קטגוריה")}</small></div></div>`).join("")||'<div class="empty-state">לא נמצאו עסקאות</div>');
  bindTransactionLongPress($("allTransactions"));

  const active=Boolean(q||categoryFilter||amountFilter);
  const filteredTotal=rows.reduce((sum,t)=>sum+Number(t.amount||0),0);
  if($("transactionFilterTotal")){
    const totalEl=$("transactionFilterTotal");
    totalEl.classList.toggle("hidden",!active);
    totalEl.innerHTML=active?`<span>סה״כ בסינון · ${escapeHtml(monthName())}</span><strong>${money(filteredTotal)}</strong>`:"";
  }
  if($("transactionSearchMeta")){
    $("transactionSearchMeta").classList.toggle("hidden",!active);
    const catName=categoryFilter==="__none__"?"ללא קטגוריה":state.categories.find(c=>c.id===categoryFilter)?.name;
    const amountLabel={"0-50":"עד 50 ₪","50-100":"50–100 ₪","100-250":"100–250 ₪","250-500":"250–500 ₪","500+":"500 ₪ ומעלה"}[amountFilter]||"";
    $("transactionSearchMeta").textContent=active?`${rows.length} תוצאות מתוך ${state.transactions.length}${catName?` · ${catName}`:""}${amountLabel?` · ${amountLabel}`:""}`:"";
  }
  if($("clearTransactionSearch")) $("clearTransactionSearch").classList.toggle("hidden",!q);
}
$("transactionSearch").oninput=renderTransactionSearch;
$("transactionCategoryFilter").onchange=renderTransactionSearch;
$("transactionAmountFilter").onchange=renderTransactionSearch;
$("clearTransactionSearch").onclick=()=>{$("transactionSearch").value="";renderTransactionSearch();$("transactionSearch").focus();};
$("incomeStatCard").onclick=toggleIncomeVisibility;
$("incomeStatCard").onkeydown=(e)=>{
  if(e.key==="Enter"||e.key===" "){
    e.preventDefault();
    toggleIncomeVisibility();
  }
};

$("openAddTransaction").onclick=()=>{
  manualTransactionLocation=null;
  setManualLocationStatus();
  $("captureTxLocation").textContent="📍 צרף את מיקום הטלפון";
  $("transactionDialog").showModal();
};
$("closeTransactionDialog").onclick=()=>$("transactionDialog").close();
$("captureTxLocation").onclick=captureCurrentPhoneLocation;
$("clearTxLocation").onclick=()=>{
  manualTransactionLocation=null;
  setManualLocationStatus();
  $("captureTxLocation").textContent="📍 צרף את מיקום הטלפון";
};
$("transactionForm").onsubmit=async(e)=>{
  e.preventDefault();
  const payload={
    family_id:state.family.id,
    member_id:$("txMember").value,
    category_id:$("txCategory").value||null,
    amount:Number($("txAmount").value),
    merchant:$("txMerchant").value.trim()||null,
    source:"manual",
    latitude:manualTransactionLocation?.latitude??null,
    longitude:manualTransactionLocation?.longitude??null,
    location_source:manualTransactionLocation?"manual":null
  };
  const {error}=await sb.from("transactions").insert(payload);\n  if(error)return toast(error.message);
  $("transactionDialog").close();
  e.target.reset();
  manualTransactionLocation=null;
  setManualLocationStatus();
  await loadAll();
};

sb.auth.onAuthStateChange((event)=>{
  if(event==="SIGNED_OUT") show("authView");
});

let externalRefreshBusy=false;
async function refreshVisibleAppData(){
  if(document.visibilityState!=="visible" || externalRefreshBusy || !state.family?.id || $("appView")?.classList.contains("hidden")) return;
  externalRefreshBusy=true;
  try{
    await loadAll();
  }catch(err){
    console.warn("External data refresh failed",err);
  }finally{
    externalRefreshBusy=false;
  }
}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden"&&pendingUsageActions){const n=pendingUsageActions;pendingUsageActions=0;syncUsage(n);}refreshVisibleAppData();});
window.addEventListener("focus",refreshVisibleAppData);

init();