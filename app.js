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
let incomeRevealed=false;
let incomeUnlockBusy=false;

const incomeCredentialStorageKey=()=>`familyBudgetIncomeCredential:${state.me?.id||"default"}`;
const randomBytes=(length=32)=>crypto.getRandomValues(new Uint8Array(length));
const arrayBufferToBase64Url=(buffer)=>{
  let binary="";
  new Uint8Array(buffer).forEach(byte=>binary+=String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
};
const base64UrlToArrayBuffer=(value)=>{
  const base64=String(value||"").replace(/-/g,"+").replace(/_/g,"/");
  const padded=base64+"=".repeat((4-base64.length%4)%4);
  const binary=atob(padded);
  return Uint8Array.from(binary,ch=>ch.charCodeAt(0)).buffer;
};

function syncIncomePrivacy(){
  const amount=$("incomeAmount"), card=$("incomeStatCard"), hint=$("incomeLockHint");
  if(!amount||!card)return;
  amount.classList.toggle("income-blurred",!incomeRevealed);
  card.classList.toggle("income-revealed",incomeRevealed);
  card.setAttribute("aria-label",incomeRevealed?"הכנסות מוצגות. לחץ להסתרה":"הכנסות מוסתרות. לחץ להצגה");
  if(hint)hint.textContent=incomeRevealed?"👁":"🔒";
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

  const storageKey=incomeCredentialStorageKey();
  const savedCredential=localStorage.getItem(storageKey);
  const challenge=randomBytes();

  try{
    if(savedCredential){
      const assertion=await navigator.credentials.get({
        publicKey:{
          challenge,
          allowCredentials:[{type:"public-key",id:base64UrlToArrayBuffer(savedCredential),transports:["internal"]}],
          userVerification:"required",
          timeout:60000
        }
      });
      return {supported:true,ok:Boolean(assertion)};
    }

    const userId=randomBytes(24);
    const credential=await navigator.credentials.create({
      publicKey:{
        challenge,
        rp:{name:"Family Budget"},
        user:{id:userId,name:"family-budget-income",displayName:"הצגת הכנסות"},
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
    localStorage.setItem(storageKey,arrayBufferToBase64Url(credential.rawId));
    return {supported:true,ok:true};
  }catch(err){
    if(err?.name==="NotFoundError" && savedCredential){
      localStorage.removeItem(storageKey);
    }
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
    if(!result.supported)toast("אימות ביומטרי לא זמין בדפדפן הזה");
  }finally{
    incomeUnlockBusy=false;
    card?.classList.remove("income-unlocking");
  }
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
  const email=$("authEmail").value.trim(), password=$("authPassword").value;
  const result=authMode==="login"
    ? await sb.auth.signInWithPassword({email,password})
    : await sb.auth.signUp({email,password,options:{emailRedirectTo:location.href}});
  if(result.error){ toast(result.error.message); return; }
  if(authMode==="signup" && !result.data.session){ toast("נשלח אימייל אימות. פתח אותו ואז חזור לאתר."); return; }
  await init();
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

async function logout(){ incomeRevealed=false; await sb.auth.signOut(); state={family:null,me:null,members:[],categories:[],transactions:[],incomes:[],fixed:[],budgets:[],adminInfo:null}; show("authView"); }
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
}
document.querySelectorAll(".bottom-nav button").forEach(btn=>btn.onclick=()=>{
  openPage(btn.dataset.page);
});

async function loadAll(){
  const f=state.family.id;
  const [members,cats,txs,incomes,fixed,budgets]=await Promise.all([
    sb.from("members").select("*").eq("family_id",f).order("created_at"),
    sb.from("categories").select("*").eq("family_id",f).order("name"),
    sb.from("transactions").select("*,members(name),categories(name)").eq("family_id",f).gte("occurred_at",monthStart()).lt("occurred_at",monthEnd()).order("occurred_at",{ascending:false}),
    sb.from("incomes").select("*").eq("family_id",f).eq("active",true).order("created_at"),
    sb.from("fixed_expenses").select("*,categories(name)").eq("family_id",f).eq("active",true).order("display_order",{ascending:true}).order("created_at",{ascending:true}),
    sb.from("budgets").select("*,categories(name)").eq("family_id",f)
  ]);
  for(const r of [members,cats,txs,incomes,fixed,budgets]) if(r.error) throw r.error;
  state.members=members.data; state.categories=cats.data; state.transactions=txs.data; state.incomes=incomes.data; state.fixed=fixed.data; state.budgets=budgets.data;
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
  if(!container||!window.echarts)return;

  const byCat={};
  state.transactions.forEach(t=>{
    const key=t.categories?.name||"ללא קטגוריה";
    byCat[key]=(byCat[key]||0)+Number(t.amount||0);
  });
  const entries=Object.entries(byCat).sort((x,y)=>y[1]-x[1]);

  if(!entries.length){
    selectedCategoryIndex=null;
    if(categoryPieChart){categoryPieChart.dispose();categoryPieChart=null;}
    container.innerHTML='<div class="empty-state chart-empty">אין עדיין עסקאות</div>';
    return;
  }

  if(selectedCategoryIndex!==null && !entries[selectedCategoryIndex]) selectedCategoryIndex=null;

  const total=entries.reduce((sum,[,value])=>sum+value,0);
  const data=entries.map(([name,value],index)=>({
    name,
    value,
    selected:index===selectedCategoryIndex,
    itemStyle:{
      color:PIE_COLORS[index%PIE_COLORS.length],
      borderColor:"rgba(8,12,20,.88)",
      borderWidth:3,
      borderRadius:9,
      shadowBlur:index===selectedCategoryIndex?22:10,
      shadowOffsetY:index===selectedCategoryIndex?8:4,
      shadowColor:index===selectedCategoryIndex?"rgba(0,0,0,.52)":"rgba(0,0,0,.24)",
      opacity:selectedCategoryIndex===null||index===selectedCategoryIndex?1:.38
    }
  }));

  if(categoryPieChart) categoryPieChart.dispose();
  container.innerHTML="";
  categoryPieChart=echarts.init(container);

  const centerTitle=selectedCategoryIndex===null?"סה״כ":data[selectedCategoryIndex].name;
  const centerValue=selectedCategoryIndex===null?money(total):money(data[selectedCategoryIndex].value);

  categoryPieChart.setOption({
    animationDuration:650,
    animationEasing:"cubicOut",
    tooltip:{show:false},
    series:[{
      type:"pie",
      radius:["27%","45%"],
      center:["50%","48%"],
      startAngle:110,
      selectedMode:"single",
      selectedOffset:11,
      minAngle:4,
      avoidLabelOverlap:true,
      label:{
        show:true,
        position:"outside",
        alignTo:"edge",
        edgeDistance:18,
        distanceToLabelLine:8,
        bleedMargin:2,
        width:112,
        overflow:"break",
        color:"#EAF0FA",
        formatter:p=>`${p.name}\n${money(p.value)}`,
        fontWeight:800,
        fontSize:15,
        lineHeight:22
      },
      labelLine:{
        show:true,
        length:30,
        length2:22,
        minTurnAngle:80,
        maxSurfaceAngle:80,
        smooth:false,
        lineStyle:{color:"#93A3BA",width:1.55}
      },
      labelLayout:params=>{
        const points=params.labelLinePoints;
        if(!points||points.length<3)return{hideOverlap:false,draggable:false};

        const w=container.clientWidth;
        const h=container.clientHeight;
        const cx=w*.50;
        const cy=h*.48;

        const dx=points[0][0]-cx;
        const dy=points[0][1]-cy;
        const d=Math.hypot(dx,dy)||1;
        const r=Math.min(w,h)*.225-5;
        points[0]=[cx+(dx/d)*r,cy+(dy/d)*r];

        const slices=data.map((item,index)=>{
          const before=data.slice(0,index).reduce((s,x)=>s+Number(x.value||0),0);
          const sweep=(Number(item.value||0)/total)*360;
          const mid=110-((before/total)*360)-(sweep/2);
          const rad=mid*Math.PI/180;
          return{
            index,
            side:Math.cos(rad)>=0?"right":"left",
            naturalY:cy-Math.sin(rad)*r
          };
        });

        const current=slices[params.dataIndex];
        const sameSide=slices
          .filter(x=>x.side===current.side)
          .sort((a,b)=>a.naturalY-b.naturalY);

        const rank=sameSide.findIndex(x=>x.index===params.dataIndex);
        const top=54;
        const bottom=h-58;
        const slot=sameSide.length<=1
          ? (top+bottom)/2
          : top+(rank*(bottom-top)/(sameSide.length-1));

        const spreadY=current.naturalY+((slot-current.naturalY)*0.5);
        const labelH=params.labelRect?.height||44;
        points[1][1]=spreadY;
        points[2][1]=spreadY;

        return{
          y:spreadY-(labelH/2),
          labelLinePoints:points,
          hideOverlap:false,
          draggable:false
        };
      },
      emphasis:{
        scale:true,
        scaleSize:13,
        label:{color:"#FFFFFF",fontSize:18,fontWeight:900,lineHeight:24},
        labelLine:{lineStyle:{color:"#FFFFFF",width:2}},
        itemStyle:{shadowBlur:28,shadowOffsetY:10,shadowColor:"rgba(0,0,0,.55)"}
      },
      data
    }],
    graphic:[
      {type:"text",left:"center",top:"39.5%",style:{text:centerTitle,fill:selectedCategoryIndex===null?"#91A0B5":"#D9E3F2",fontSize:selectedCategoryIndex===null?12:14,fontWeight:700}},
      {type:"text",left:"center",top:"48%",style:{text:centerValue,fill:"#FFFFFF",fontSize:24,fontWeight:900}}
    ]
  },true);

  categoryPieChart.off("click");
  categoryPieChart.on("click",params=>{
    selectedCategoryIndex=selectedCategoryIndex===params.dataIndex?null:params.dataIndex;
    renderCategoryPie();
  });

  if(!window.__categoryPieOutsideClickBound){
    window.__categoryPieOutsideClickBound=true;
    document.addEventListener("pointerdown",e=>{
      if(selectedCategoryIndex===null)return;
      const pie=$("categoryPie");
      if(pie && pie.contains(e.target))return;
      selectedCategoryIndex=null;
      renderCategoryPie();
    },{passive:true});
  }

  setTimeout(()=>categoryPieChart?.resize(),40);
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

  const txHtml=(arr)=>arr.map(t=>`<div class="transaction-row transaction-editable" data-tx-id="${t.id}"><div class="transaction-main"><strong>${escapeHtml(t.merchant||"עסקה")}</strong><div class="amount-negative amount-under-name">${money(t.amount)}</div><small>${escapeHtml(t.members?.name||"")} · ${new Date(t.occurred_at).toLocaleDateString("he-IL")} · ${escapeHtml(t.categories?.name||"ללא קטגוריה")}</small></div></div>`).join("")||'<div class="empty-state">אין עדיין עסקאות</div>';
  $("recentTransactions").innerHTML=txHtml(state.transactions.slice(0,5));
  bindTransactionLongPress($("recentTransactions"));
  renderTransactionSearch();

  $("membersList").innerHTML=state.members.map(m=>`<div class="settings-row"><div><strong>${escapeHtml(m.name)}</strong><small>${m.role==="admin"?"מנהל":"בן משפחה"}</small></div><div class="mini-actions">${state.me?.role==="admin"?`<button class="mini-btn" onclick="editMember('${m.id}','${escapeHtml(m.name)}')">ערוך</button>${m.id!==state.me.id?`<button class="mini-btn danger-btn" onclick="deleteMember('${m.id}','${escapeHtml(m.name)}')">מחק</button>`:""}<button class="mini-btn" onclick="makeToken('${m.id}','${escapeHtml(m.name)}')">צור טוקן</button>`:""}</div></div>`).join("");

  $("familyAdminCard").classList.toggle("hidden",state.me?.role!=="admin");
  if(state.me?.role==="admin"){
    const visibleCode=sessionStorage.getItem("familyCode");
    $("familyCodeHint").textContent=visibleCode || (state.adminInfo?.codeHint ? `•••${state.adminInfo.codeHint}` : "לא הוגדר");
    const pending=state.adminInfo?.pending||[];
    $("pendingRequests").innerHTML=pending.length
      ? pending.map(r=>`<div class="settings-row"><div><strong>${escapeHtml(r.display_name)}</strong><small>בקשת הצטרפות</small></div><div class="mini-actions"><button class="mini-btn approve" onclick="decideJoin('${r.id}','approve')">אשר</button><button class="mini-btn" onclick="decideJoin('${r.id}','reject')">דחה</button></div></div>`).join("")
      : '<div class="empty-state">אין בקשות הצטרפות ממתינות</div>';
  }
  $("incomeList").innerHTML=state.incomes.map(x=>`<div class="settings-row"><div><strong>${escapeHtml(x.description)}</strong><small>חודשי · ${money(x.amount)}</small></div><div class="mini-actions"><button class="mini-btn" onclick="editIncome('${x.id}')">ערוך</button><button class="mini-btn danger-btn" onclick="deleteIncome('${x.id}','${escapeHtml(x.description)}')">מחק</button></div></div>`).join("")||'<div class="empty-state">אין הכנסות</div>';
  renderFixedList();
  $("categoriesList").innerHTML=state.categories.map(c=>{const b=state.budgets.find(x=>x.category_id===c.id);return `<div class="settings-row"><div><strong>${escapeHtml(c.name)}</strong><small>${b?"תקציב "+money(b.monthly_limit):"ללא תקציב"}</small></div><div class="mini-actions"><button class="mini-btn" onclick="setBudget('${c.id}','${escapeHtml(c.name)}')">תקציב</button></div></div>`}).join("");

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
}

$("incomeForm").onsubmit=async(e)=>{e.preventDefault();const {error}=await sb.from("incomes").insert({family_id:state.family.id,description:$("incomeDesc").value,amount:Number($("incomeValue").value),frequency:"monthly"});if(error)return toast(error.message);e.target.reset();await loadAll();};

window.editIncome=async(id)=>{
  const item=state.incomes.find(x=>x.id===id); if(!item)return;
  const previous={description:item.description,amount:Number(item.amount)};
  const description=prompt("תיאור ההכנסה",item.description); if(description===null)return;
  const value=prompt("סכום חודשי",String(item.amount)); if(value===null)return;
  const amount=Number(value); if(!description.trim()||!Number.isFinite(amount)||amount<0)return toast("פרטים לא תקינים");
  const {error}=await sb.from("incomes").update({description:description.trim(),amount}).eq("id",id);
  if(error)return toast(error.message);
  await loadAll();
  toast("ההכנסה עודכנה",async()=>{
    const {error}=await sb.from("incomes").update(previous).eq("id",id);
    if(error)throw error;
    await loadAll();
  });
};
window.deleteIncome=async(id,name)=>{
  const item=state.incomes.find(x=>x.id===id); if(!item)return;
  if(!confirm(`למחוק את ההכנסה "${name}"?`))return;
  const restore={...item};
  const {error}=await sb.from("incomes").delete().eq("id",id);
  if(error)return toast(error.message);
  await loadAll();
  toast("ההכנסה נמחקה",async()=>{
    const {error}=await sb.from("incomes").insert(restore);
    if(error)throw error;
    await loadAll();
  });
};

window.editMember=async(id,currentName)=>{
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
window.deleteMember=async(id,name)=>{
  if(!confirm(`למחוק את ${name} מהמשפחה?`))return;
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

window.setBudget=async(categoryId,name)=>{
  const value=prompt(`תקציב חודשי ל-${name}`);if(value===null)return;
  const amount=Number(value);if(!Number.isFinite(amount)||amount<0)return toast("סכום לא תקין");
  const existing=state.budgets.find(b=>b.category_id===categoryId);
  if(existing){
    const previous=Number(existing.monthly_limit);
    const {error}=await sb.from("budgets").update({monthly_limit:amount}).eq("id",existing.id);
    if(error)return toast(error.message);
    await loadAll();
    toast("התקציב עודכן",async()=>{const {error}=await sb.from("budgets").update({monthly_limit:previous}).eq("id",existing.id);if(error)throw error;await loadAll();});
  }else{
    const {data,error}=await sb.from("budgets").insert({family_id:state.family.id,category_id:categoryId,monthly_limit:amount}).select("id").single();
    if(error)return toast(error.message);
    await loadAll();
    toast("התקציב נוסף",async()=>{const {error}=await sb.from("budgets").delete().eq("id",data.id);if(error)throw error;await loadAll();});
  }
};

window.makeToken=async(memberId,name)=>{const {data,error}=await sb.functions.invoke("create-shortcut-token",{body:{memberId,label:`iPhone - ${name}`}});if(error||data?.error)return toast(data?.error||error.message);$("tokenValue").value=data.token;$("tokenDialog").showModal();};
$("rotateFamilyCode").onclick=async()=>{
  const {data,error}=await sb.functions.invoke("manage-family",{body:{action:"rotate"}});
  if(error||data?.error)return toast(data?.error||error.message);
  sessionStorage.setItem("familyCode", data.familyCode);
  $("familyCodeHint").textContent=data.familyCode;
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
    sessionStorage.setItem("familyCode", data.familyCode);
    $("familyCodeHint").textContent=data.familyCode;
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
$("copyToken").onclick=async()=>{await navigator.clipboard.writeText($("tokenValue").value);toast("ה־Token הועתק");};

$("testTransaction").onclick=async()=>{
  if(!state.members.length)return toast("אין בני משפחה");
  $("testTransaction").disabled=true;
  const merchants=[
    "שופרסל","רמי לוי","ויקטורי","סופר-פארם","Wolt",
    "McDonald's","ארומה","Yellow","פז","Gett",
    "FOX","ZARA","KSP","ACE","IKEA",
    "Cinema City","גולדה","Be","סטימצקי","מקס סטוק"
  ];
  const preferredCats=[
    "סופר","בריאות","אוכל בחוץ","רכב","קניות",
    "בילויים","ילדים","חשבונות","אחר"
  ];
  const categoryByName=Object.fromEntries(state.categories.map(c=>[c.name,c.id]));
  const now=new Date();
  const rows=[];
  state.members.forEach((member,memberIndex)=>{
    for(let n=0;n<20;n++){
      const d=new Date(now);
      const dayOffset=(n*2+memberIndex)%Math.max(1,now.getDate());
      d.setDate(Math.max(1,now.getDate()-dayOffset));
      d.setHours(8+((n*3+memberIndex)%13), (n*7)%60, 0, 0);
      const merchant=merchants[(n+memberIndex*4)%merchants.length];
      const catName=preferredCats[(n+memberIndex)%preferredCats.length];
      const amount=Number((18.9 + ((n+1)*(memberIndex+2)*13.37)%420).toFixed(2));
      rows.push({
        family_id:state.family.id,
        member_id:member.id,
        category_id:categoryByName[catName]||null,
        amount,
        currency:"ILS",
        merchant,
        source:"apple_pay",
        occurred_at:d.toISOString(),
        external_id:`demo-${member.id}-${Date.now()}-${n}`
      });
    }
  });
  try{
    const {error}=await sb.from("transactions").insert(rows);
    if(error){toast(error.message);return;}
    toast(`${rows.length} עסקאות בדיקה נוספו`);
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
  const {error}=await sb.from("transactions").update(payload).eq("id",id);
  if(error)return toast(error.message);
  $("editTransactionDialog").close();
  await loadAll();
  toast("העסקה עודכנה",async()=>{
    const {error}=await sb.from("transactions").update(previous).eq("id",id);
    if(error)throw error;
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
    external_id:current.external_id||null
  };
  const {error}=await sb.from("transactions").delete().eq("id",id);
  if(error)return toast(error.message);
  $("editTransactionDialog").close();
  await loadAll();
  toast("העסקה נמחקה",async()=>{
    const {error}=await sb.from("transactions").insert(restore);
    if(error)throw error;
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
  let rows=state.transactions;

  if(categoryFilter){
    rows=rows.filter(t=>categoryFilter==="__none__"?!t.category_id:t.category_id===categoryFilter);
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

  const active=Boolean(q||categoryFilter);
  const filteredTotal=rows.reduce((sum,t)=>sum+Number(t.amount||0),0);
  if($("transactionFilterTotal")){
    const totalEl=$("transactionFilterTotal");
    totalEl.classList.toggle("hidden",!active);
    totalEl.innerHTML=active?`<span>סה״כ בסינון · ${escapeHtml(monthName())}</span><strong>${money(filteredTotal)}</strong>`:"";
  }
  if($("transactionSearchMeta")){
    $("transactionSearchMeta").classList.toggle("hidden",!active);
    const catName=categoryFilter==="__none__"?"ללא קטגוריה":state.categories.find(c=>c.id===categoryFilter)?.name;
    $("transactionSearchMeta").textContent=active?`${rows.length} תוצאות מתוך ${state.transactions.length}${catName?` · ${catName}`:""}`:"";
  }
  if($("clearTransactionSearch")) $("clearTransactionSearch").classList.toggle("hidden",!q);
}
$("transactionSearch").oninput=renderTransactionSearch;
$("transactionCategoryFilter").onchange=renderTransactionSearch;
$("clearTransactionSearch").onclick=()=>{$("transactionSearch").value="";renderTransactionSearch();$("transactionSearch").focus();};
$("incomeStatCard").onclick=toggleIncomeVisibility;
$("incomeStatCard").onkeydown=(e)=>{
  if(e.key==="Enter"||e.key===" "){
    e.preventDefault();
    toggleIncomeVisibility();
  }
};

$("openAddTransaction").onclick=()=>$("transactionDialog").showModal();
$("closeTransactionDialog").onclick=()=>$("transactionDialog").close();
$("transactionForm").onsubmit=async(e)=>{e.preventDefault();const payload={family_id:state.family.id,member_id:$("txMember").value,category_id:$("txCategory").value||null,amount:Number($("txAmount").value),merchant:$("txMerchant").value.trim()||null,source:"manual"};const {error}=await sb.from("transactions").insert(payload);if(error)return toast(error.message);$("transactionDialog").close();e.target.reset();await loadAll();};

sb.auth.onAuthStateChange((event)=>{
  if(event==="SIGNED_OUT") show("authView");
});
init();