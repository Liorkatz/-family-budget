(()=>{
const stage=document.getElementById('moneyLiveStage');
const art=document.getElementById('moneyLiveArt');
const wind=document.getElementById('moneyWindField');
const balanceEl=document.getElementById('moneyLiveBalance');
const status=document.getElementById('moneyLiveStatus');
if(!stage||!art||!wind)return;

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const parseMoney=(el)=>{
  const n=Number((el?.textContent||'').replace(/[^0-9.,-]/g,'').replace(/,/g,''));
  return Number.isFinite(n)?n:0;
};

const source=document.getElementById('availableAmount');
const incomeSource=document.getElementById('incomeAmount');

let yaw=0,targetYaw=0,pitch=0,targetPitch=0;
let scale=.93,targetScale=.93,userDelta=0,lastBalance=null;
let dragging=false,startX=0,startY=0,startYaw=0,startPitch=0;
let gustTimer=0;

function gust(message){
  if(status)status.textContent=message;
  wind.classList.remove('gust');
  void wind.offsetWidth;
  wind.classList.add('gust');
  clearTimeout(gustTimer);
  gustTimer=setTimeout(()=>{
    wind.classList.remove('gust');
    if(status)status.textContent='100/200 דו־צדדיים • רוח פעילה';
  },1100);
}

function sync(){
  const balance=parseMoney(source);
  const income=parseMoney(incomeSource);
  if(balanceEl){
    balanceEl.textContent=new Intl.NumberFormat('he-IL',{
      style:'currency',currency:'ILS',maximumFractionDigits:0
    }).format(balance);
  }
  const ratio=income>0?clamp(balance/income,0,1.25):(balance>0?.8:.35);
  targetScale=clamp(.70+ratio*.27+userDelta,.62,1.12);

  if(lastBalance!==null&&Math.abs(balance-lastBalance)>.01){
    gust(balance>lastBalance?'נכנס כסף — משב רוח וההר גדל':'יצא כסף — משב רוח וההר קטן');
  }
  lastBalance=balance;
}

const mo=new MutationObserver(sync);
if(source)mo.observe(source,{childList:true,subtree:true,characterData:true});
if(incomeSource)mo.observe(incomeSource,{childList:true,subtree:true,characterData:true});
setTimeout(sync,250);

stage.addEventListener('pointerdown',e=>{
  dragging=true;
  startX=e.clientX;startY=e.clientY;
  startYaw=targetYaw;startPitch=targetPitch;
  stage.setPointerCapture?.(e.pointerId);
});
stage.addEventListener('pointermove',e=>{
  if(!dragging)return;
  targetYaw=clamp(startYaw+(e.clientX-startX)*.045,-8,8);
  targetPitch=clamp(startPitch-(e.clientY-startY)*.02,-3,3);
});
stage.addEventListener('pointerup',()=>dragging=false);
stage.addEventListener('pointercancel',()=>dragging=false);

document.getElementById('moneyLiveGrow')?.addEventListener('click',()=>{
  userDelta=clamp(userDelta+.07,-.28,.28);
  targetScale=clamp(targetScale+.07,.62,1.12);
  gust('בדיקה: ההר גדל');
});
document.getElementById('moneyLiveShrink')?.addEventListener('click',()=>{
  userDelta=clamp(userDelta-.07,-.28,.28);
  targetScale=clamp(targetScale-.07,.62,1.12);
  gust('בדיקה: ההר קטן');
});

function frame(){
  yaw+=(targetYaw-yaw)*.075;
  pitch+=(targetPitch-pitch)*.075;
  scale+=(targetScale-scale)*.055;
  art.style.setProperty('--live-yaw',yaw.toFixed(2)+'deg');
  art.style.setProperty('--live-pitch',pitch.toFixed(2)+'deg');
  art.style.setProperty('--live-scale',scale.toFixed(3));
  requestAnimationFrame(frame);
}
if(status)status.textContent='100/200 דו־צדדיים • רוח פעילה';
requestAnimationFrame(frame);
})();