const cfg = window.FAMILY_BUDGET_CONFIG;
const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey);

const $ = (id) => document.getElementById(id);
const money = (n) => new Intl.NumberFormat("he-IL",{style:"currency",currency:"ILS",maximumFractionDigits:0}).format(Number(n||0));
const monthName = () => new Intl.DateTimeFormat("he-IL",{month:"long",year:"numeric"}).format(new Date());
const monthStart = () => { const d=new Date(); return new Date(d.getFullYear(),d.getMonth(),1).toISOString(); };
const monthEnd = () => { const d=new Date(); return new Date(d.getFullYear(),d.getMonth()+1,1).toISOString(); };
const toast = (msg) => { $("toast").textContent=msg; $("toast").classList.add("show"); setTimeout(()=>$("toast").classList.remove("show"),2200); };
const escapeHtml = (v="") => String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));

let authMode = "login";
let state = { family:null, me:null, members:[], categories:[], transactions:[], incomes:[], fixed:[], budgets:[], adminInfo:null };

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
  $("monthTitle").textContent = monthName();
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
    $("familyCodeValue").value=data.familyCode;
    $("familyCodeDialog").showModal();
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

async function logout(){ await sb.auth.signOut(); state={family:null,me:null,members:[],categories:[],transactions:[],incomes:[],fixed:[],budgets:[],adminInfo:null}; show("authView"); }
$("logoutBtn").onclick=logout; $("bootstrapLogout").onclick=logout;

document.querySelectorAll(".bottom-nav button").forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll(".bottom-nav button").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  $(btn.dataset.page).classList.add("active");
});

async function loadAll(){
  const f=state.family.id;
  const [members,cats,txs,incomes,fixed,budgets]=await Promise.all([
    sb.from("members").select("*").eq("family_id",f).order("created_at"),
    sb.from("categories").select("*").eq("family_id",f).order("name"),
    sb.from("transactions").select("*,members(name),categories(name)").eq("family_id",f).gte("occurred_at",monthStart()).lt("occurred_at",monthEnd()).order("occurred_at",{ascending:false}),
    sb.from("incomes").select("*").eq("family_id",f).eq("active",true).order("created_at"),
    sb.from("fixed_expenses").select("*,categories(name)").eq("family_id",f).eq("active",true).order("created_at"),
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

function render(){
  const income=state.incomes.reduce((s,x)=>s+Number(x.amount),0);
  const spent=state.transactions.reduce((s,x)=>s+Number(x.amount),0);
  const fixed=state.fixed.reduce((s,x)=>s+Number(x.amount),0);
  const d=new Date(), daysInMonth=new Date(d.getFullYear(),d.getMonth()+1,0).getDate(), elapsed=Math.max(1,d.getDate());
  const forecast=Math.round((spent/elapsed)*daysInMonth);
  const available=income-spent-fixed;
  $("incomeAmount").textContent=money(income); $("spentAmount").textContent=money(spent); $("fixedAmount").textContent=money(fixed); $("forecastAmount").textContent=money(forecast); $("availableAmount").textContent=money(available);

  const byCat={}; state.transactions.forEach(t=>{const k=t.categories?.name||"ללא קטגוריה";byCat[k]=(byCat[k]||0)+Number(t.amount)});
  const max=Math.max(1,...Object.values(byCat));
  $("categoryBars").innerHTML=Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,7).map(([n,v])=>`<div class="category-row"><div><strong>${escapeHtml(n)}</strong><small>${money(v)}</small></div><div class="progress"><i style="width:${Math.round(v/max*100)}%"></i></div><b>${spent?Math.round(v/spent*100):0}%</b></div>`).join("")||"אין עדיין עסקאות";

  const txHtml=(arr)=>arr.map(t=>`<div class="transaction-row"><div class="transaction-main"><strong>${escapeHtml(t.merchant||"עסקה")}</strong><small>${escapeHtml(t.members?.name||"")} · ${new Date(t.occurred_at).toLocaleDateString("he-IL")} · ${escapeHtml(t.categories?.name||"ללא קטגוריה")}</small></div><div class="amount-negative">${money(t.amount)}</div></div>`).join("")||'<div class="empty-state">אין עדיין עסקאות</div>';
  $("recentTransactions").innerHTML=txHtml(state.transactions.slice(0,5));
  $("allTransactions").innerHTML=txHtml(state.transactions);

  $("membersList").innerHTML=state.members.map(m=>`<div class="settings-row"><div><strong>${escapeHtml(m.name)}</strong><small>${m.role==="admin"?"מנהל":"בן משפחה"}</small></div><div class="mini-actions">${state.me?.role==="admin"?`<button class="mini-btn" onclick="makeToken('${m.id}','${escapeHtml(m.name)}')">Shortcut</button>`:""}</div></div>`).join("");

  $("familyAdminCard").classList.toggle("hidden",state.me?.role!=="admin");
  if(state.me?.role==="admin"){
    $("familyCodeHint").textContent=state.adminInfo?.codeHint ? `FAM-•••${state.adminInfo.codeHint}` : "לא הוגדר";
    const pending=state.adminInfo?.pending||[];
    $("pendingRequests").innerHTML=pending.length
      ? pending.map(r=>`<div class="settings-row"><div><strong>${escapeHtml(r.display_name)}</strong><small>בקשת הצטרפות</small></div><div class="mini-actions"><button class="mini-btn approve" onclick="decideJoin('${r.id}','approve')">אשר</button><button class="mini-btn" onclick="decideJoin('${r.id}','reject')">דחה</button></div></div>`).join("")
      : '<div class="empty-state">אין בקשות הצטרפות ממתינות</div>';
  }
  $("incomeList").innerHTML=state.incomes.map(x=>`<div class="settings-row"><div><strong>${escapeHtml(x.description)}</strong><small>חודשי</small></div><strong>${money(x.amount)}</strong></div>`).join("")||'<div class="empty-state">אין הכנסות</div>';
  $("fixedList").innerHTML=state.fixed.map(x=>`<div class="settings-row"><div><strong>${escapeHtml(x.description)}</strong><small>קבועה</small></div><strong>${money(x.amount)}</strong></div>`).join("")||'<div class="empty-state">אין הוצאות קבועות</div>';
  $("categoriesList").innerHTML=state.categories.map(c=>{const b=state.budgets.find(x=>x.category_id===c.id);return `<div class="settings-row"><div><strong>${escapeHtml(c.name)}</strong><small>${b?"תקציב "+money(b.monthly_limit):"ללא תקציב"}</small></div><div class="mini-actions"><button class="mini-btn" onclick="setBudget('${c.id}','${escapeHtml(c.name)}')">תקציב</button></div></div>`}).join("");

  $("txMember").innerHTML=state.members.map(m=>`<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("");
  $("txCategory").innerHTML='<option value="">ללא קטגוריה</option>'+state.categories.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");

  const byMember={};state.transactions.forEach(t=>{const k=t.members?.name||"לא ידוע";byMember[k]=(byMember[k]||0)+Number(t.amount)});
  $("memberBreakdown").innerHTML='<div class="analysis-block"><div class="bar-label"><strong>הוצאות לפי בן משפחה</strong></div>'+Object.entries(byMember).sort((a,b)=>b[1]-a[1]).map(([n,v])=>`<div class="settings-row"><span>${escapeHtml(n)}</span><strong>${money(v)}</strong></div>`).join("")+'</div>';
  $("budgetBreakdown").innerHTML='<div class="analysis-block"><div class="bar-label"><strong>ניצול תקציבים</strong></div>'+state.budgets.map(b=>{const used=state.transactions.filter(t=>t.category_id===b.category_id).reduce((s,t)=>s+Number(t.amount),0);const pct=Math.min(100,Math.round(used/Number(b.monthly_limit)*100)||0);return `<div style="margin:14px 0"><div class="bar-label"><span>${escapeHtml(b.categories?.name||"קטגוריה")}</span><strong>${money(used)} / ${money(b.monthly_limit)}</strong></div><div class="progress"><i style="width:${pct}%"></i></div></div>`}).join("")+'</div>';
}

$("incomeForm").onsubmit=async(e)=>{e.preventDefault();const {error}=await sb.from("incomes").insert({family_id:state.family.id,description:$("incomeDesc").value,amount:Number($("incomeValue").value),frequency:"monthly"});if(error)return toast(error.message);e.target.reset();await loadAll();};
$("fixedForm").onsubmit=async(e)=>{e.preventDefault();const {error}=await sb.from("fixed_expenses").insert({family_id:state.family.id,description:$("fixedDesc").value,amount:Number($("fixedValue").value),frequency:"monthly"});if(error)return toast(error.message);e.target.reset();await loadAll();};
$("categoryForm").onsubmit=async(e)=>{e.preventDefault();const {error}=await sb.from("categories").insert({family_id:state.family.id,name:$("categoryName").value.trim()});if(error)return toast(error.message);e.target.reset();await loadAll();};

window.setBudget=async(categoryId,name)=>{const value=prompt(`תקציב חודשי ל-${name}`);if(value===null)return;const amount=Number(value);if(!Number.isFinite(amount)||amount<0)return toast("סכום לא תקין");const existing=state.budgets.find(b=>b.category_id===categoryId);const q=existing?sb.from("budgets").update({monthly_limit:amount}).eq("id",existing.id):sb.from("budgets").insert({family_id:state.family.id,category_id:categoryId,monthly_limit:amount});const {error}=await q;if(error)return toast(error.message);await loadAll();};

window.makeToken=async(memberId,name)=>{const {data,error}=await sb.functions.invoke("create-shortcut-token",{body:{memberId,label:`iPhone - ${name}`}});if(error||data?.error)return toast(data?.error||error.message);$("tokenValue").value=data.token;$("tokenDialog").showModal();};
$("closeFamilyCodeDialog").onclick=()=>$("familyCodeDialog").close();
$("copyFamilyCode").onclick=async()=>{await navigator.clipboard.writeText($("familyCodeValue").value);toast("קוד המשפחה הועתק");};
$("rotateFamilyCode").onclick=async()=>{
  const {data,error}=await sb.functions.invoke("manage-family",{body:{action:"rotate"}});
  if(error||data?.error)return toast(data?.error||error.message);
  $("familyCodeValue").value=data.familyCode;
  $("familyCodeDialog").showModal();
  await loadAll();
};
window.decideJoin=async(requestId,action)=>{
  const {data,error}=await sb.functions.invoke("manage-family",{body:{action,requestId}});
  if(error||data?.error)return toast(data?.error||error.message);
  toast(action==="approve"?"המשתמש אושר":"הבקשה נדחתה");
  await loadAll();
};

$("closeTokenDialog").onclick=()=>$("tokenDialog").close();
$("copyToken").onclick=async()=>{await navigator.clipboard.writeText($("tokenValue").value);toast("ה־Token הועתק");};

$("openAddTransaction").onclick=()=>$("transactionDialog").showModal();
$("closeTransactionDialog").onclick=()=>$("transactionDialog").close();
$("transactionForm").onsubmit=async(e)=>{e.preventDefault();const payload={family_id:state.family.id,member_id:$("txMember").value,category_id:$("txCategory").value||null,amount:Number($("txAmount").value),merchant:$("txMerchant").value.trim()||null,source:"manual"};const {error}=await sb.from("transactions").insert(payload);if(error)return toast(error.message);$("transactionDialog").close();e.target.reset();await loadAll();};

sb.auth.onAuthStateChange(()=>setTimeout(init,0));
init();