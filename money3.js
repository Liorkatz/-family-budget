import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.181.1/build/three.module.js';

const canvas=document.getElementById('money3Canvas');
const sceneEl=document.querySelector('.money3-scene');
if(!canvas||!sceneEl) throw new Error('money3 canvas missing');

const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(36,1,.1,100);
camera.position.set(0,5.6,14.5);
camera.lookAt(0,2.1,0);

const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.1;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;

scene.add(new THREE.HemisphereLight(0xbddcff,0x3c2415,2.2));
const sun=new THREE.DirectionalLight(0xffd48a,5.4);
sun.position.set(6,8,6);sun.castShadow=true;
sun.shadow.mapSize.set(1024,1024);
sun.shadow.camera.left=-8;sun.shadow.camera.right=8;sun.shadow.camera.top=10;sun.shadow.camera.bottom=-2;
scene.add(sun);
const fill=new THREE.DirectionalLight(0x7ab8ff,1.8);fill.position.set(-6,4,2);scene.add(fill);

const mountain=new THREE.Group();
scene.add(mountain);

const baseMat=new THREE.MeshStandardMaterial({color:0x49311f,roughness:.95,metalness:0});
const base=new THREE.Mesh(new THREE.CylinderGeometry(5.8,6.4,.7,48),baseMat);
base.position.y=.15;base.receiveShadow=true;mountain.add(base);

function makeNoteTexture(value,kind){
  const c=document.createElement('canvas');c.width=512;c.height=256;
  const x=c.getContext('2d');
  const grad=x.createLinearGradient(0,0,512,256);
  if(kind===100){grad.addColorStop(0,'#b8642c');grad.addColorStop(.45,'#f4c66f');grad.addColorStop(1,'#d98b39')}
  else{grad.addColorStop(0,'#245b91');grad.addColorStop(.48,'#9dcee9');grad.addColorStop(1,'#377cb4')}
  x.fillStyle=grad;x.fillRect(0,0,512,256);
  x.globalAlpha=.18;x.fillStyle='#ffffff';
  for(let i=0;i<12;i++){x.beginPath();x.arc(45+i*42,128+(i%2?25:-25),23,0,Math.PI*2);x.fill()}
  x.globalAlpha=.8;x.fillStyle='#10283b';x.font='900 86px Arial';x.fillText(String(value),315,205);
  x.font='900 54px Arial';x.fillText('₪',35,78);
  x.globalAlpha=.22;x.strokeStyle='#17314a';x.lineWidth=6;x.strokeRect(13,13,486,230);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=renderer.capabilities.getMaxAnisotropy();
  return t;
}
const tex100=makeNoteTexture(100,100),tex200=makeNoteTexture(200,200);
const noteGeom=new THREE.BoxGeometry(1.72,.20,.86);
const edgeMat=new THREE.MeshStandardMaterial({color:0xe7dcc7,roughness:.78,metalness:.02});
function noteMaterials(tex){
  const face=new THREE.MeshStandardMaterial({map:tex,roughness:.72,metalness:.02});
  return [edgeMat,edgeMat,edgeMat,edgeMat,face,face];
}
const mats100=noteMaterials(tex100),mats200=noteMaterials(tex200);

const seeded=(i)=>{const x=Math.sin(i*91.733)*43758.5453;return x-Math.floor(x)};
let n=0;
const rings=[
 {count:26,r:4.9,y:.65,s:1.05},{count:23,r:4.25,y:1.05,s:1.02},{count:20,r:3.65,y:1.48,s:.98},
 {count:17,r:3.05,y:1.92,s:.94},{count:14,r:2.48,y:2.38,s:.89},{count:11,r:1.92,y:2.88,s:.84},
 {count:8,r:1.38,y:3.38,s:.78},{count:5,r:.86,y:3.86,s:.72},{count:3,r:.38,y:4.26,s:.66}
];
for(const [ri,R] of rings.entries()){
 for(let i=0;i<R.count;i++,n++){
   const a=i/R.count*Math.PI*2+ri*.31;
   const rr=R.r*(.72+.28*seeded(n+3));
   const mesh=new THREE.Mesh(noteGeom,(n%3===0)?mats100:mats200);
   mesh.position.set(Math.cos(a)*rr,R.y+(seeded(n+7)-.5)*.22,Math.sin(a)*rr);
   mesh.rotation.set((seeded(n+5)-.5)*.16,-a+(seeded(n+9)-.5)*.5,(seeded(n+12)-.5)*.22);
   mesh.scale.setScalar(R.s*(.92+.16*seeded(n+15)));
   mesh.castShadow=true;mesh.receiveShadow=true;mountain.add(mesh);
 }
}

const coinMat=new THREE.MeshStandardMaterial({color:0xd69b2d,metalness:.82,roughness:.28});
const coinGeom=new THREE.CylinderGeometry(.24,.24,.07,32);
for(let i=0;i<72;i++){
  const a=seeded(i+300)*Math.PI*2, rr=1.0+seeded(i+340)*4.4;
  const coin=new THREE.Mesh(coinGeom,coinMat);
  coin.position.set(Math.cos(a)*rr,.55+seeded(i+380)*1.7,Math.sin(a)*rr);
  coin.rotation.set(Math.PI/2+(seeded(i+420)-.5)*.3,seeded(i+460)*Math.PI,(seeded(i+500)-.5)*.35);
  coin.castShadow=true;mountain.add(coin);
}

const flying=new THREE.Group();scene.add(flying);
for(let i=0;i<18;i++){
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1.35,.67),new THREE.MeshStandardMaterial({map:i%3===0?tex100:tex200,side:THREE.DoubleSide,roughness:.65,transparent:true}));
 mesh.userData={a:seeded(i+610)*Math.PI*2,r:5.6+seeded(i+630)*2.5,h:1.6+seeded(i+650)*4.8,speed:.13+seeded(i+670)*.15,phase:seeded(i+690)*Math.PI*2};
 mesh.scale.setScalar(.65+seeded(i+710)*.65);flying.add(mesh);
}

let targetScale=.9,currentScale=.9,userDelta=0;
let yaw=-.18,targetYaw=-.18,drag=false,startX=0,startYaw=0;
canvas.addEventListener('pointerdown',e=>{drag=true;startX=e.clientX;startYaw=targetYaw;canvas.setPointerCapture?.(e.pointerId)});
canvas.addEventListener('pointermove',e=>{if(!drag)return;targetYaw=startYaw+(e.clientX-startX)*.006});
canvas.addEventListener('pointerup',()=>drag=false);
canvas.addEventListener('pointercancel',()=>drag=false);

const status=document.getElementById('money3Status');
const pulse=(msg)=>{if(status)status.textContent=msg;setTimeout(()=>{if(status)status.textContent='WebGL פעיל • גרור לצדדים'},1000)};
document.getElementById('money3Grow')?.addEventListener('click',()=>{userDelta=Math.min(.28,userDelta+.07);targetScale=Math.min(1.18,targetScale+.07);pulse('נכנס כסף — ההר גדל')});
document.getElementById('money3Shrink')?.addEventListener('click',()=>{userDelta=Math.max(-.28,userDelta-.07);targetScale=Math.max(.55,targetScale-.07);pulse('יצא כסף — ההר קטן')});

const parseMoney=(el)=>{const n=Number((el?.textContent||'').replace(/[^0-9.,-]/g,'').replace(/,/g,''));return Number.isFinite(n)?n:0};
const source=document.getElementById('availableAmount');
const incomeSource=document.getElementById('incomeAmount');
const display=document.getElementById('money3Balance');
let last=null;
function sync(){
 const balance=parseMoney(source),income=parseMoney(incomeSource);
 if(display)display.textContent=new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',maximumFractionDigits:0}).format(balance);
 const ratio=income>0?THREE.MathUtils.clamp(balance/income,0,1.25):(balance>0?.8:.35);
 targetScale=THREE.MathUtils.clamp(.62+ratio*.34+userDelta,.55,1.18);
 if(last!==null&&Math.abs(balance-last)>.01)pulse(balance<last?'יצא כסף — ההר קטן':'נכנס כסף — ההר גדל');
 last=balance;
}
const obs=new MutationObserver(sync);
if(source)obs.observe(source,{childList:true,subtree:true,characterData:true});
if(incomeSource)obs.observe(incomeSource,{childList:true,subtree:true,characterData:true});
setTimeout(sync,450);

function resize(){
 const w=sceneEl.clientWidth,h=sceneEl.clientHeight;
 renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
 camera.position.z=h>w?15.8:13.6;
}
new ResizeObserver(resize).observe(sceneEl);resize();

const clock=new THREE.Clock();
function animate(){
 const t=clock.getElapsedTime();
 currentScale+= (targetScale-currentScale)*.055;
 yaw+=(targetYaw-yaw)*.08;
 mountain.scale.setScalar(currentScale);
 mountain.rotation.y=yaw;
 mountain.position.y=-.2+Math.sin(t*.7)*.025;
 flying.children.forEach((m,i)=>{
   const u=m.userData;
   const a=u.a+t*u.speed;
   m.position.set(Math.cos(a)*u.r,u.h+Math.sin(t*.9+u.phase)*.45,Math.sin(a)*u.r);
   m.lookAt(camera.position);
   m.rotation.z=Math.sin(t*1.3+u.phase)*.35;
 });
 renderer.render(scene,camera);requestAnimationFrame(animate);
}
animate();
