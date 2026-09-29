(()=>{
const scene=document.querySelector('.money2-scene');
const wrap=document.querySelector('.money2-mountain-wrap');
const notes=document.getElementById('money2Notes');
const coins=document.getElementById('money2Coins');
const flying=document.querySelector('.money2-flying');
if(!scene||!wrap||!notes||!coins||!flying)return;

const ns='http://www.w3.org/2000/svg';
const add=(tag,attrs,parent=notes)=>{const e=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,String(v)));parent.appendChild(e);return e};
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

const rng=(n)=>{const x=Math.sin(n*999.31)*43758.5453;return x-Math.floor(x)};
const layerSpecs=[
  {y:575,w:720,count:18,scale:1.08},
  {y:510,w:625,count:16,scale:1.02},
  {y:445,w:535,count:14,scale:.96},
  {y:378,w:440,count:12,scale:.90},
  {y:310,w:340,count:10,scale:.83},
  {y:245,w:245,count:8,scale:.76},
  {y:190,w:150,count:5,scale:.69}
];
let seed=1;
layerSpecs.forEach((L,li)=>{
  for(let i=0;i<L.count;i++,seed++){
    const val=(seed%3===0)?100:200;
    const ww=112*L.scale, hh=57*L.scale;
    const x=500-L.w/2 + rng(seed)*L.w - ww/2;
    const y=L.y + (rng(seed+8)-.5)*35;
    const rot=(rng(seed+16)-.5)*22;
    const g=add('g',{transform:`translate(${x} ${y}) rotate(${rot} ${ww/2} ${hh/2})`,filter:'url(#m2smallshadow)'});
    add('rect',{x:0,y:0,width:ww,height:hh,rx:8*L.scale,fill:val===100?'url(#m2100)':'url(#m2200)',stroke:'#fff','stroke-opacity':.18,'stroke-width':1},g);
    add('rect',{x:ww*.44,y:-2,width:ww*.14,height:hh+4,rx:3,fill:'#f6ecd4','fill-opacity':.88},g);
    add('text',{x:ww*.83,y:hh*.72,'text-anchor':'end',fill:'#102436','fill-opacity':.72,'font-size':20*L.scale,'font-weight':900,'font-family':'Arial'},g).textContent=val;
    add('text',{x:ww*.12,y:hh*.35,fill:'#102436','fill-opacity':.52,'font-size':17*L.scale,'font-weight':900,'font-family':'Arial'},g).textContent='₪';
  }
});
for(let i=0;i<46;i++){
  const cx=180+rng(i+90)*650, cy=545+rng(i+180)*105, r=10+rng(i+230)*13;
  add('ellipse',{cx,cy,rx:r*1.15,ry:r*.48,fill:'url(#m2coin)',stroke:'#ffe6a0','stroke-opacity':.42,'stroke-width':1},coins);
  if(i%4===0)add('text',{x:cx,y:cy+3,'text-anchor':'middle',fill:'#6e470d','font-size':r*.85,'font-weight':900},coins).textContent='₪';
}

const paths=[
[-20,92,88,8],[106,88,-15,20],[-12,68,104,31],[98,72,-18,39],
[8,103,80,2],[90,104,18,13],[-18,49,96,4],[104,54,2,25],
[15,95,98,41],[87,90,-12,48],[-10,78,72,-5],[98,100,23,20],
[5,82,91,18],[95,67,-8,9]
];
paths.forEach((p,i)=>{
  const n=document.createElement('div'); const v=i%3===0?100:200;
  n.className='money2-fly-note v'+v; n.dataset.v=v;
  n.style.setProperty('--x0',p[0]+'vw');n.style.setProperty('--y0',p[1]+'vh');
  n.style.setProperty('--x1',p[2]+'vw');n.style.setProperty('--y1',p[3]+'vh');
  n.style.setProperty('--xm',((p[0]+p[2])/2)+'vw');n.style.setProperty('--ym',((p[1]+p[3])/2-9)+'vh');
  n.style.setProperty('--d',(10+(i%5)*1.4)+'s');n.style.setProperty('--delay',(-i*1.7)+'s');
  flying.appendChild(n);
});

let scale=.88,ry=0,manualDelta=0;
let dragging=false,startX=0,startRy=0;
const apply=()=>{wrap.style.setProperty('--m2scale',scale.toFixed(3));wrap.style.setProperty('--m2ry',ry+'deg')};
scene.addEventListener('pointerdown',e=>{dragging=true;startX=e.clientX;startRy=ry;scene.setPointerCapture?.(e.pointerId)});
scene.addEventListener('pointermove',e=>{if(!dragging)return;ry=clamp(startRy+(e.clientX-startX)*.16,-13,13);apply()});
scene.addEventListener('pointerup',()=>dragging=false);
scene.addEventListener('pointercancel',()=>dragging=false);

const pulse=(cls,msg)=>{scene.classList.remove('money2-income','money2-expense');void scene.offsetWidth;scene.classList.add(cls);const s=document.getElementById('money2Status');if(s)s.textContent=msg;setTimeout(()=>{scene.classList.remove(cls);if(s)s.textContent='גרור לצדדים כדי להזיז את ההר'},1100)};
document.getElementById('money2Grow')?.addEventListener('click',()=>{manualDelta=clamp(manualDelta+.08,-.28,.28);scale=clamp(scale+.08,.56,1.18);apply();pulse('money2-income','ההר גדל')});
document.getElementById('money2Shrink')?.addEventListener('click',()=>{manualDelta=clamp(manualDelta-.08,-.28,.28);scale=clamp(scale-.08,.56,1.18);apply();pulse('money2-expense','ההר קטן')});

const parseMoney=(el)=>{const n=Number((el?.textContent||'').replace(/[^0-9.,-]/g,'').replace(/,/g,''));return Number.isFinite(n)?n:0};
const source=document.getElementById('availableAmount');
const incomeSource=document.getElementById('incomeAmount');
const display=document.getElementById('money2Balance');
let last=null;
const sync=()=>{
 const balance=parseMoney(source), income=parseMoney(incomeSource);
 if(display)display.textContent=new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',maximumFractionDigits:0}).format(balance);
 const ratio=income>0?clamp(balance/income,0,1.25):(balance>0?.8:.35);
 const target=clamp(.64+ratio*.33+manualDelta,.56,1.18);
 if(last!==null&&Math.abs(balance-last)>.01){
   if(balance<last){scale=target;apply();pulse('money2-expense','יצא כסף — ההר קטן')}
   else {scale=target;apply();pulse('money2-income','נכנס כסף — ההר גדל')}
 }else{scale=target;apply()}
 last=balance;
};
const obs=new MutationObserver(sync);
if(source)obs.observe(source,{childList:true,subtree:true,characterData:true});
if(incomeSource)obs.observe(incomeSource,{childList:true,subtree:true,characterData:true});
setTimeout(sync,450);
})();