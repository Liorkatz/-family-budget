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
let categoryPieChart = null;
const PIE_COLORS=["#6478F3","#8B5CF6","#22B8CF","#34C875","#F2A51A","#EF5B5B","#E85D9E","#8BCF2F","#28B7A5","#F47B35"];
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

async function logout(){ await sb.auth.signOut(); state={family:null,me:null,members:[],categories:[],transactions:[],incomes:[],fixed:[],budgets:[],adminInfo:null}; show("authView"); }
$("logoutBtn").onclick=logout; $("bootstrapLogout").onclick=logout;
$("appVersion").onclick=()=>{
  sessionStorage.setItem("showRefreshToast","1");
  location.reload();
};

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
    if(categoryPieChart){categoryPieChart.dispose();categoryPieChart=null;}
    container.innerHTML='<div class="empty-state chart-empty">אין עדיין עסקאות</div>';
    return;
  }

  container.innerHTML="";
  const total=entries.reduce((sum,[,value])=>sum+value,0);
  const data=entries.map(([name,value],index)=>({
    name,value,
    itemStyle:{
      color:PIE_COLORS[index%PIE_COLORS.length],
      borderColor:"#F8FAFC",
      borderWidth:4,
      borderRadius:8,
      shadowBlur:7,
      shadowOffsetY:3,
      shadowColor:"rgba(25,35,55,.12)"
    }
  }));

  if(categoryPieChart) categoryPieChart.dispose();
  categoryPieChart=echarts.init(container);

  categoryPieChart.setOption({
    animationDuration:700,
    animationEasing:"cubicOut",
    tooltip:{show:false},
    series:[{
      type:"pie",
      radius:["27%","44%"],
      center:["50%","48%"],
      startAngle:110,
      selectedMode:false,
      selectedOffset:0,
      minAngle:4,
      avoidLabelOverlap:true,
      itemStyle:{borderRadius:8},
      label:{
        show:true,
        position:"outside",
        alignTo:"edge",
        edgeDistance:10,
        distanceToLabelLine:4,
        bleedMargin:2,
        width:116,
        overflow:"break",
        color:"#273247",
        formatter:p=>`${p.name}\n${money(p.value)}`,
        fontWeight:700,
        fontSize:13,
        lineHeight:20
      },
      labelLine:{
        show:true,
        length:24,
        length2:14,
        minTurnAngle:80,
        maxSurfaceAngle:80,
        smooth:false,
        lineStyle:{color:"#91A0B5",width:1.5}
      },
      labelLayout:params=>{
        const points=params.labelLinePoints;
        if(!points||points.length<3) return {hideOverlap:false,draggable:false};
        const cx=container.clientWidth*.50;
        const cy=container.clientHeight*.48;
        const dx=points[0][0]-cx;
        const dy=points[0][1]-cy;
        const d=Math.hypot(dx,dy)||1;
        const outerRadius=Math.min(container.clientWidth,container.clientHeight)*.22;
        const overlapRadius=Math.max(0,outerRadius-7);
        points[0]=[cx+(dx/d)*overlapRadius,cy+(dy/d)*overlapRadius];
        return {labelLinePoints:points,hideOverlap:false,draggable:false};
      },
      emphasis:{
        scale:true,
        scaleSize:14,
        label:{fontSize:14,fontWeight:800,lineHeight:20},
        itemStyle:{
          shadowBlur:28,
          shadowOffsetY:12,
          shadowColor:"rgba(0,0,0,.55)"
        }
      },
      data
    }],
    graphic:[
      {type:"text",left:"center",top:"40.5%",style:{text:"סה״כ",fill:"#7B8798",fontSize:12,fontWeight:600}},
      {type:"text",left:"center",top:"48%",style:{text:money(total),fill:"#1A2435",fontSize:22,fontWeight:800}}
    ]
  });

  categoryPieChart.off("click");
  setTimeout(()=>categoryPieChart?.resize(),50);
}

function render(){
  const income=state.incomes.reduce((s,x)=>s+Number(x.amount),0);
  const spent=state.transactions.reduce((s,x)=>s+Number(x.amount),0);
  const fixed=state.fixed.reduce((s,x)=>s+Number(x.amount),0);
  const d=new Date(), daysInMonth=new Date(d.getFullYear(),d.getMonth()+1,0).getDate(), elapsed=Math.max(1,d.getDate());
  const forecast=Math.round((spent/elapsed)*daysInMonth);
  const available=income-spent-fixed;
  $("incomeAmount").textContent=money(income); $("spentAmount").textContent=money(spent); $("fixedAmount").textContent=money(fixed); $("forecastAmount").textContent=money(forecast); $("availableAmount").textContent=money(available);

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
  const orderedFixed=[...state.fixed].sort((a,b)=>{
    const aFilled=Number(a.amount)>0?1:0;
    const bFilled=Number(b.amount)>0?1:0;
    if(aFilled!==bFilled)return bFilled-aFilled;
    const aOrder=Number(a.display_order)||0;
    const bOrder=Number(b.display_order)||0;
    if(aOrder!==bOrder)return aOrder-bOrder;
    return String(a.description||"").localeCompare(String(b.description||""),"he");
  });
  $("fixedList").innerHTML=orderedFixed.map(x=>`<div class="settings-row fixed-edit-row"><div><strong>${escapeHtml(x.description)}</strong><small>חודשי</small></div><div class="fixed-edit"><input id="fixed-${x.id}" type="number" min="0" step="0.01" value="${Number(x.amount)}" inputmode="decimal"><button class="mini-btn" onclick="saveFixed('${x.id}')">שמור</button></div></div>`).join("")||'<div class="empty-state">אין הוצאות קבועות</div>';
  $("categoriesList").innerHTML=state.categories.map(c=>{const b=state.budgets.find(x=>x.category_id===c.id);return `<div class="settings-row"><div><strong>${escapeHtml(c.name)}</strong><small>${b?"תקציב "+money(b.monthly_limit):"ללא תקציב"}</small></div><div class="mini-actions"><button class="mini-btn" onclick="setBudget('${c.id}','${escapeHtml(c.name)}')">תקציב</button></div></div>`}).join("");

  $("txMember").innerHTML=state.members.map(m=>`<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("");
  $("txCategory").innerHTML='<option value="">ללא קטגוריה</option>'+state.categories.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");

  const byMember={};state.transactions.forEach(t=>{const k=t.members?.name||"לא ידוע";byMember[k]=(byMember[k]||0)+Number(t.amount)});
  $("memberBreakdown").innerHTML='<div class="analysis-block"><div class="bar-label"><strong>הוצאות לפי בן משפחה</strong></div>'+Object.entries(byMember).sort((a,b)=>b[1]-a[1]).map(([n,v])=>`<div class="settings-row"><span>${escapeHtml(n)}</span><strong>${money(v)}</strong></div>`).join("")+'</div>';
  $("budgetBreakdown").innerHTML='<div class="analysis-block"><div class="bar-label"><strong>ניצול תקציבים</strong></div>'+state.budgets.map(b=>{const used=state.transactions.filter(t=>t.category_id===b.category_id).reduce((s,t)=>s+Number(t.amount),0);const pct=Math.min(100,Math.round(used/Number(b.monthly_limit)*100)||0);return `<div style="margin:14px 0"><div class="bar-label"><span>${escapeHtml(b.categories?.name||"קטגוריה")}</span><strong>${money(used)} / ${money(b.monthly_limit)}</strong></div><div class="progress"><i style="width:${pct}%"></i></div></div>`}).join("")+'</div>';
}

$("incomeForm").onsubmit=async(e)=>{e.preventDefault();const {error}=await sb.from("incomes").insert({family_id:state.family.id,description:$("incomeDesc").value,amount:Number($("incomeValue").value),frequency:"monthly"});if(error)return toast(error.message);e.target.reset();await loadAll();};

window.editIncome=async(id)=>{
  const item=state.incomes.find(x=>x.id===id); if(!item)return;
  const description=prompt("תיאור ההכנסה",item.description); if(description===null)return;
  const value=prompt("סכום חודשי",String(item.amount)); if(value===null)return;
  const amount=Number(value); if(!description.trim()||!Number.isFinite(amount)||amount<0)return toast("פרטים לא תקינים");
  const {error}=await sb.from("incomes").update({description:description.trim(),amount}).eq("id",id);
  if(error)return toast(error.message); toast("ההכנסה עודכנה"); await loadAll();
};
window.deleteIncome=async(id,name)=>{
  if(!confirm(`למחוק את ההכנסה "${name}"?`))return;
  const {error}=await sb.from("incomes").delete().eq("id",id);
  if(error)return toast(error.message); toast("ההכנסה נמחקה"); await loadAll();
};

window.editMember=async(id,currentName)=>{
  const name=prompt("שם בן המשפחה",currentName); if(name===null)return;
  if(!name.trim())return toast("השם לא יכול להיות ריק");
  const {error}=await sb.from("members").update({name:name.trim()}).eq("id",id);
  if(error)return toast(error.message);
  if(id===state.me.id)state.me.name=name.trim();
  toast("שם בן המשפחה עודכן"); await loadAll();
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
function renderFixedPreview(){
  const name=$("fixedDesc").value.trim();
  const value=$("fixedValue").value;
  const box=$("fixedPreview");
  if(!name){box.classList.add("hidden");box.innerHTML="";return;}
  box.classList.remove("hidden");
  box.innerHTML=`<div class="preview-label">יופיע ברשימה כך:</div><div class="settings-row preview-row"><div><strong>${escapeHtml(name)}</strong><small>חודשי</small></div><strong>${value?money(Number(value)):money(0)}</strong></div>`;
}
$("fixedDesc").oninput=renderFixedPreview;
$("fixedValue").oninput=renderFixedPreview;
$("fixedForm").onsubmit=async(e)=>{e.preventDefault();const nextOrder=Math.min(0,...state.fixed.map(x=>Number(x.display_order)||0))-1;const {error}=await sb.from("fixed_expenses").insert({family_id:state.family.id,description:$("fixedDesc").value.trim(),amount:Number($("fixedValue").value),frequency:"monthly",display_order:nextOrder});if(error)return toast(error.message);e.target.reset();renderFixedPreview();await loadAll();};
window.saveFixed=async(id)=>{const amount=Number($("fixed-"+id).value);if(!Number.isFinite(amount)||amount<0)return toast("סכום לא תקין");const {error}=await sb.from("fixed_expenses").update({amount}).eq("id",id);if(error)return toast(error.message);toast("ההוצאה עודכנה");await loadAll();};
$("categoryForm").onsubmit=async(e)=>{e.preventDefault();const {error}=await sb.from("categories").insert({family_id:state.family.id,name:$("categoryName").value.trim()});if(error)return toast(error.message);e.target.reset();await loadAll();};

window.setBudget=async(categoryId,name)=>{const value=prompt(`תקציב חודשי ל-${name}`);if(value===null)return;const amount=Number(value);if(!Number.isFinite(amount)||amount<0)return toast("סכום לא תקין");const existing=state.budgets.find(b=>b.category_id===categoryId);const q=existing?sb.from("budgets").update({monthly_limit:amount}).eq("id",existing.id):sb.from("budgets").insert({family_id:state.family.id,category_id:categoryId,monthly_limit:amount});const {error}=await q;if(error)return toast(error.message);await loadAll();};

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
  toast("העסקה עודכנה");
  await loadAll();
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
  let rows=state.transactions;
  if(q){
    rows=state.transactions.filter(t=>{
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
  if($("transactionSearchMeta")){
    $("transactionSearchMeta").classList.toggle("hidden",!q);
    $("transactionSearchMeta").textContent=q?`${rows.length} תוצאות מתוך ${state.transactions.length}`:"";
  }
  if($("clearTransactionSearch"))$("clearTransactionSearch").classList.toggle("hidden",!q);
}
$("transactionSearch").oninput=renderTransactionSearch;
$("clearTransactionSearch").onclick=()=>{$("transactionSearch").value="";renderTransactionSearch();$("transactionSearch").focus();};

$("openAddTransaction").onclick=()=>$("transactionDialog").showModal();
$("closeTransactionDialog").onclick=()=>$("transactionDialog").close();
$("transactionForm").onsubmit=async(e)=>{e.preventDefault();const payload={family_id:state.family.id,member_id:$("txMember").value,category_id:$("txCategory").value||null,amount:Number($("txAmount").value),merchant:$("txMerchant").value.trim()||null,source:"manual"};const {error}=await sb.from("transactions").insert(payload);if(error)return toast(error.message);$("transactionDialog").close();e.target.reset();await loadAll();};

sb.auth.onAuthStateChange((event)=>{
  if(event==="SIGNED_OUT") show("authView");
});
init();