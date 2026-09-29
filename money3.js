(()=>{
const canvas=document.getElementById('money3Canvas');
const sceneEl=document.querySelector('.money3-scene');
if(!canvas||!sceneEl)return;
const ctx=canvas.getContext('2d',{alpha:true});
let DPR=Math.min(window.devicePixelRatio||1,2);
let W=0,H=0;
let scale=.92,targetScale=.92,userDelta=0;
let yaw=-0.12,targetYaw=-0.12,drag=false,startX=0,startYaw=0;
let last=null,t0=performance.now();

const source=document.getElementById('availableAmount');
const incomeSource=document.getElementById('incomeAmount');
const display=document.getElementById('money3Balance');
const status=document.getElementById('money3Status');

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const rng=(n)=>{const x=Math.sin(n*91.733)*43758.5453;return x-Math.floor(x)};
const parseMoney=(el)=>{const n=Number((el?.textContent||'').replace(/[^0-9.,-]/g,'').replace(/,/g,''));return Number.isFinite(n)?n:0};

function resize(){
  const r=sceneEl.getBoundingClientRect();
  W=Math.max(320,r.width); H=Math.max(420,r.height);
  DPR=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.round(W*DPR); canvas.height=Math.round(H*DPR);
  canvas.style.width=W+'px'; canvas.style.height=H+'px';
  ctx.setTransform(DPR,0,0,DPR,0,0);
}
new ResizeObserver(resize).observe(sceneEl); resize();

function roundRect(x,y,w,h,r,fill,stroke){
  ctx.beginPath();
  ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);
  if(fill){ctx.fillStyle=fill;ctx.fill()}
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke()}
}
function drawNote(x,y,w,h,val,rot,depth=0,alpha=1){
  ctx.save();ctx.translate(x,y);ctx.rotate(rot);ctx.globalAlpha=alpha;
  const grad=ctx.createLinearGradient(-w/2,-h/2,w/2,h/2);
  if(val===100){grad.addColorStop(0,'#b8622f');grad.addColorStop(.48,'#f3c879');grad.addColorStop(1,'#d98a3a')}
  else{grad.addColorStop(0,'#2c659b');grad.addColorStop(.48,'#9fd0ea');grad.addColorStop(1,'#3475ae')}
  ctx.shadowColor='rgba(0,0,0,.34)';ctx.shadowBlur=10+depth*2;ctx.shadowOffsetY=6+depth;
  roundRect(-w/2,-h/2,w,h,Math.max(4,h*.12),grad,'rgba(255,255,255,.22)');
  ctx.shadowColor='transparent';
  ctx.fillStyle='rgba(245,236,215,.92)';ctx.fillRect(-w*.07,-h*.54,w*.14,h*1.08);
  ctx.fillStyle='rgba(7,28,44,.62)';ctx.textAlign='right';ctx.textBaseline='alphabetic';
  ctx.font='900 '+Math.round(h*.43)+'px Arial';ctx.fillText(String(val),w*.42,h*.32);
  ctx.textAlign='left';ctx.font='900 '+Math.round(h*.38)+'px Arial';ctx.fillText('₪',-w*.4,-h*.12);
  ctx.restore();
}
function drawCoin(x,y,r,tilt=1,alpha=1){
  ctx.save();ctx.globalAlpha=alpha;
  ctx.shadowColor='rgba(0,0,0,.32)';ctx.shadowBlur=8;ctx.shadowOffsetY=4;
  const g=ctx.createRadialGradient(x-r*.2,y-r*.2,r*.15,x,y,r);
  g.addColorStop(0,'#ffe7a1');g.addColorStop(.35,'#dca53b');g.addColorStop(.75,'#a76c14');g.addColorStop(1,'#6f4509');
  ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(x,y,r,r*.42*tilt,0,0,Math.PI*2);ctx.fill();
  ctx.shadowColor='transparent';ctx.strokeStyle='rgba(255,235,170,.45)';ctx.lineWidth=1;
  ctx.beginPath();ctx.ellipse(x,y,r*.72,r*.29*tilt,0,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle='rgba(91,55,10,.65)';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='900 '+Math.max(8,r*.65)+'px Arial';ctx.fillText('₪',x,y);
  ctx.restore();
}

const layers=[
 {count:25,rad:.44,y:.73,s:1.10},
 {count:22,rad:.39,y:.66,s:1.04},
 {count:19,rad:.33,y:.59,s:.98},
 {count:16,rad:.27,y:.52,s:.91},
 {count:13,rad:.21,y:.45,s:.84},
 {count:10,rad:.16,y:.38,s:.77},
 {count:7,rad:.11,y:.31,s:.70},
 {count:4,rad:.065,y:.25,s:.63}
];
const notes=[];
let seed=1;
for(let li=0;li<layers.length;li++){
  const L=layers[li];
  for(let i=0;i<L.count;i++,seed++){
    const a=i/L.count*Math.PI*2+li*.31;
    const rr=L.rad*(.76+.24*rng(seed+3));
    notes.push({
      val:(seed%3===0)?100:200,
      a,rr,y:L.y+(rng(seed+7)-.5)*.025,
      rot:(rng(seed+11)-.5)*.34,
      s:L.s*(.92+.16*rng(seed+17)),
      z:Math.sin(a)
    });
  }
}
const coins=[];
for(let i=0;i<70;i++){
  const a=rng(i+300)*Math.PI*2;
  coins.push({a,rr:.08+rng(i+330)*.42,y:.69+rng(i+360)*.16,r:.009+rng(i+390)*.012,z:Math.sin(a)});
}
const flyers=[];
for(let i=0;i<18;i++){
  flyers.push({
    val:i%3===0?100:200,
    phase:rng(i+500)*Math.PI*2,
    speed:.18+rng(i+530)*.18,
    rad:.33+rng(i+560)*.28,
    h:.19+rng(i+590)*.48,
    s:.55+rng(i+620)*.7
  });
}

function pulse(msg){
  if(status)status.textContent=msg;
  clearTimeout(pulse._t);
  pulse._t=setTimeout(()=>{if(status)status.textContent='Canvas 3D פעיל • גרור לצדדים'},1000);
}
function sync(){
  const balance=parseMoney(source),income=parseMoney(incomeSource);
  if(display)display.textContent=new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',maximumFractionDigits:0}).format(balance);
  const ratio=income>0?clamp(balance/income,0,1.25):(balance>0?.8:.35);
  targetScale=clamp(.62+ratio*.34+userDelta,.55,1.18);
  if(last!==null&&Math.abs(balance-last)>.01)pulse(balance<last?'יצא כסף — ההר קטן':'נכנס כסף — ההר גדל');
  last=balance;
}
const obs=new MutationObserver(sync);
if(source)obs.observe(source,{childList:true,subtree:true,characterData:true});
if(incomeSource)obs.observe(incomeSource,{childList:true,subtree:true,characterData:true});
setTimeout(sync,300);

document.getElementById('money3Grow')?.addEventListener('click',()=>{userDelta=clamp(userDelta+.07,-.28,.28);targetScale=clamp(targetScale+.07,.55,1.18);pulse('נכנס כסף — ההר גדל')});
document.getElementById('money3Shrink')?.addEventListener('click',()=>{userDelta=clamp(userDelta-.07,-.28,.28);targetScale=clamp(targetScale-.07,.55,1.18);pulse('יצא כסף — ההר קטן')});

canvas.addEventListener('pointerdown',e=>{drag=true;startX=e.clientX;startYaw=targetYaw;canvas.setPointerCapture?.(e.pointerId)});
canvas.addEventListener('pointermove',e=>{if(!drag)return;targetYaw=startYaw+(e.clientX-startX)*.008});
canvas.addEventListener('pointerup',()=>drag=false);
canvas.addEventListener('pointercancel',()=>drag=false);

function project(a,rr,y,zScale=1){
  const aa=a+yaw;
  const z=Math.sin(aa)*rr;
  const x=Math.cos(aa)*rr;
  const persp=1+z*.38*zScale;
  return {x:W*.5+x*W*persp,y:H*y-z*H*.06,depth:z,p:persp};
}

function draw(now){
  const t=(now-t0)/1000;
  scale+=(targetScale-scale)*.06;
  yaw+=(targetYaw-yaw)*.08;
  ctx.clearRect(0,0,W,H);

  // floor glow
  const glow=ctx.createRadialGradient(W*.5,H*.76,10,W*.5,H*.76,W*.38);
  glow.addColorStop(0,'rgba(255,195,84,.28)');glow.addColorStop(.45,'rgba(255,181,66,.09)');glow.addColorStop(1,'rgba(255,170,60,0)');
  ctx.fillStyle=glow;ctx.beginPath();ctx.ellipse(W*.5,H*.78,W*.39*scale,H*.10*scale,0,0,Math.PI*2);ctx.fill();

  // rocky pedestal / shadow
  ctx.save();ctx.globalAlpha=.86;
  const pg=ctx.createLinearGradient(0,H*.69,0,H*.9);pg.addColorStop(0,'#6f4b31');pg.addColorStop(1,'#281914');
  ctx.fillStyle=pg;ctx.beginPath();
  ctx.ellipse(W*.5,H*.79,W*.34*scale,H*.095*scale,0,0,Math.PI*2);ctx.fill();ctx.restore();

  // coins behind & within mountain
  [...coins].sort((a,b)=>a.z-b.z).forEach((c,i)=>{
    const p=project(c.a,c.rr*scale,c.y);
    drawCoin(p.x,p.y,c.r*W*scale*p.p,1,.92);
  });

  // banknotes, painter-sorted by depth
  const sorted=[...notes].sort((a,b)=>Math.sin(a.a+yaw)-Math.sin(b.a+yaw));
  sorted.forEach((n,i)=>{
    const p=project(n.a,n.rr*scale,n.y);
    const ww=W*.145*n.s*scale*p.p;
    const hh=ww*.50;
    drawNote(p.x,p.y,ww,hh,n.val,n.rot+Math.cos(n.a+yaw)*.08,p.depth*3+1,1);
  });

  // foreground scattered coins
  for(let i=0;i<18;i++){
    const x=W*(.23+rng(i+900)*.54),y=H*(.74+rng(i+930)*.095),r=W*(.008+rng(i+960)*.009)*scale;
    drawCoin(x,y,r,1,.96);
  }

  // flying notes
  flyers.forEach((f,i)=>{
    const a=f.phase+t*f.speed;
    const x=W*.5+Math.cos(a)*W*f.rad;
    const y=H*f.h+Math.sin(a*1.7+f.phase)*H*.055;
    const z=(Math.sin(a)+1)/2;
    const ww=W*.11*f.s*(.75+z*.4);
    drawNote(x,y,ww,ww*.49,f.val,Math.sin(a*1.3)*.42,2,.58+z*.35);
  });

  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
})();