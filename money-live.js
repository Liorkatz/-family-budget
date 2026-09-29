(()=>{
const stage=document.getElementById('moneyLiveStage');
const art=document.getElementById('moneyLiveArt');
const fly=document.getElementById('moneyLiveFly');
const balanceEl=document.getElementById('moneyLiveBalance');
const status=document.getElementById('moneyLiveStatus');
if(!stage||!art||!fly)return;

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const parseMoney=(el)=>{const n=Number((el?.textContent||'').replace(/[^0-9.,-]/g,'').replace(/,/g,''));return Number.isFinite(n)?n:0};
const source=document.getElementById('availableAmount');
const incomeSource=document.getElementById('incomeAmount');

let yaw=0,targetYaw=0,pitch=0,targetPitch=0;
let scale=.93,targetScale=.93,userDelta=0,lastBalance=null;
let dragging=false,startX=0,startY=0,startYaw=0,startPitch=0;
let sprites=[],raf=0,started=false;

function applyMountain(){
  art.style.setProperty('--live-yaw',yaw.toFixed(2)+'deg');
  art.style.setProperty('--live-pitch',pitch.toFixed(2)+'deg');
  art.style.setProperty('--live-scale',scale.toFixed(3));
}

function pulse(text,kind){
  if(status)status.textContent=text;
  art.style.filter=kind==='in'?'drop-shadow(0 0 28px rgba(255,211,121,.45)) brightness(1.08)':'drop-shadow(0 22px 30px rgba(0,0,0,.35)) brightness(.90)';
  clearTimeout(pulse.t);
  pulse.t=setTimeout(()=>{art.style.filter='drop-shadow(0 28px 34px rgba(0,0,0,.32))';if(status)status.textContent='גרור לצדדים • שטרות בתנועה'},900);
}

function sync(){
  const b=parseMoney(source),income=parseMoney(incomeSource);
  if(balanceEl)balanceEl.textContent=new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',maximumFractionDigits:0}).format(b);
  const ratio=income>0?clamp(b/income,0,1.25):(b>0?.8:.35);
  targetScale=clamp(.70+ratio*.27+userDelta,.62,1.12);
  if(lastBalance!==null&&Math.abs(b-lastBalance)>.01)pulse(b>lastBalance?'נכנס כסף — ההר גדל':'יצא כסף — ההר קטן',b>lastBalance?'in':'out');
  lastBalance=b;
}
const mo=new MutationObserver(sync);
if(source)mo.observe(source,{childList:true,subtree:true,characterData:true});
if(incomeSource)mo.observe(incomeSource,{childList:true,subtree:true,characterData:true});
setTimeout(sync,350);

stage.addEventListener('pointerdown',e=>{dragging=true;startX=e.clientX;startY=e.clientY;startYaw=targetYaw;startPitch=targetPitch;stage.setPointerCapture?.(e.pointerId)});
stage.addEventListener('pointermove',e=>{if(!dragging)return;targetYaw=clamp(startYaw+(e.clientX-startX)*.045,-8,8);targetPitch=clamp(startPitch-(e.clientY-startY)*.02,-3,3)});
stage.addEventListener('pointerup',()=>dragging=false);
stage.addEventListener('pointercancel',()=>dragging=false);

document.getElementById('moneyLiveGrow')?.addEventListener('click',()=>{userDelta=clamp(userDelta+.07,-.28,.28);targetScale=clamp(targetScale+.07,.62,1.12);pulse('נכנס כסף — ההר גדל','in')});
document.getElementById('moneyLiveShrink')?.addEventListener('click',()=>{userDelta=clamp(userDelta-.07,-.28,.28);targetScale=clamp(targetScale-.07,.62,1.12);pulse('יצא כסף — ההר קטן','out')});

function makeSprite(img,rect,poly){
  const c=document.createElement('canvas');
  c.width=rect[2];c.height=rect[3];
  const x=c.getContext('2d');
  x.save();x.beginPath();
  poly.forEach((p,i)=>{const px=p[0]*c.width,py=p[1]*c.height;i?x.lineTo(px,py):x.moveTo(px,py)});
  x.closePath();x.clip();
  x.drawImage(img,rect[0],rect[1],rect[2],rect[3],0,0,rect[2],rect[3]);
  x.restore();
  c.className='money-live-note';
  fly.appendChild(c);
  return c;
}

function buildSprites(img){
  fly.replaceChildren();
  const defs=[
    {r:[65,145,390,205],p:[[.03,.28],[.15,.06],[.94,.23],[.91,.82],[.73,.96],[.19,.88],[.02,.57]]},
    {r:[845,135,230,135],p:[[.08,.22],[.86,.04],[.98,.67],[.15,.95],[.02,.48]]},
    {r:[1170,260,245,180],p:[[.04,.17],[.62,.02],[.92,.18],[.98,.72],[.73,.91],[.14,.64]]},
    {r:[965,385,180,115],p:[[.02,.22],[.55,.06],[.96,.31],[.86,.82],[.30,.95],[.04,.63]]}
  ];
  for(let i=0;i<12;i++){
    const d=defs[i%defs.length],el=makeSprite(img,d.r,d.p);
    sprites.push({el,phase:i*.79,speed:.16+(i%4)*.025,rad:.26+(i%5)*.055,y:.18+(i%6)*.095,z:.55+(i%4)*.18,dir:i%2?1:-1});
  }
  if(status)status.textContent='גרור לצדדים • שטרות בתנועה';
}

function animate(t){
  yaw+=(targetYaw-yaw)*.075;pitch+=(targetPitch-pitch)*.075;scale+=(targetScale-scale)*.055;applyMountain();
  const w=stage.clientWidth,h=stage.clientHeight,ts=t*.001;
  sprites.forEach((s,i)=>{
    const a=s.phase+ts*s.speed*s.dir;
    const depth=(Math.sin(a)+1)/2;
    const x=w*(.5+Math.cos(a)*s.rad);
    const y=h*(s.y+Math.sin(a*1.7+s.phase)*.055);
    const sc=(.42+s.z*.36)*(0.72+depth*.55);
    const ry=Math.sin(a)*58;
    const rz=Math.sin(a*1.3+s.phase)*24;
    const blur=(1-depth)*2.2;
    s.el.style.opacity=String(.48+depth*.48);
    s.el.style.filter='drop-shadow(0 10px 15px rgba(0,0,0,.24)) blur('+blur.toFixed(2)+'px)';
    s.el.style.transform='translate3d('+(x-s.el.width/2)+'px,'+(y-s.el.height/2)+'px,'+(depth*120)+'px) perspective(800px) rotateY('+ry.toFixed(1)+'deg) rotateZ('+rz.toFixed(1)+'deg) scale('+sc.toFixed(3)+')';
  });
  raf=requestAnimationFrame(animate);
}

art.addEventListener('load',()=>{
  if(started)return;started=true;
  const img=new Image();
  img.onload=()=>{sprites=[];buildSprites(img);cancelAnimationFrame(raf);raf=requestAnimationFrame(animate)};
  img.onerror=()=>{if(status)status.textContent='שגיאה בטעינת שכבת השטרות'};
  img.src=art.src;
});
art.addEventListener('error',()=>{if(status)status.textContent='שגיאה בטעינת גרפיקת ההר'});
if(art.complete&&art.naturalWidth)art.dispatchEvent(new Event('load'));
})();