(() => {
  const scene=document.querySelector('.money-scene');
  const stage=document.querySelector('.money-stage');
  const mountain=document.querySelector('.money-mountain');
  const flying=document.querySelector('.flying-money-layer');
  if(!scene||!stage||!mountain||!flying)return;

  const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
  const numberFrom=(el)=>{
    const s=(el?.textContent||'').replace(/[^0-9.,-]/g,'').replace(/,/g,'');
    const n=Number(s);
    return Number.isFinite(n)?n:0;
  };

  const makeBundle=(value,x,y,z,scale,angle,tilt)=>{
    const el=document.createElement('div');
    el.className='money-bundle note-'+value;
    el.innerHTML='<div class="note-face" data-value="'+value+'"></div><i class="bundle-band"></i><i class="bundle-edge"></i>';
    el.style.left='calc(50% - 46px)';
    el.style.bottom=y+'px';
    el.style.transform='translate3d('+x+'px,0,'+z+'px) rotateY('+angle+'deg) rotateZ('+tilt+'deg) scale('+scale+')';
    el.style.zIndex=String(1000+Math.round(z));
    mountain.appendChild(el);
  };

  const layers=[
    {count:20,bottom:32,r:205,scale:1.04},
    {count:17,bottom:88,r:168,scale:.98},
    {count:14,bottom:145,r:132,scale:.91},
    {count:11,bottom:205,r:101,scale:.84},
    {count:8,bottom:268,r:72,scale:.77},
    {count:5,bottom:330,r:43,scale:.70},
    {count:2,bottom:385,r:18,scale:.64}
  ];

  let k=0;
  layers.forEach((layer,li)=>{
    for(let i=0;i<layer.count;i++){
      const a=(i/layer.count)*Math.PI*2+li*.34;
      const jitter=((i*17+li*11)%19)-9;
      const x=Math.cos(a)*layer.r+jitter;
      const z=Math.sin(a)*layer.r;
      const value=(i+li)%3===0?100:200;
      makeBundle(value,x,layer.bottom,z,layer.scale,(-a*180/Math.PI)+8,((k*13)%9)-4);
      k++;
    }
  });

  const paths=[
    [-18,92,82,8], [104,86,-14,18], [-12,62,105,30], [96,72,-18,38],
    [8,102,78,3], [88,104,18,14], [-20,46,96,5], [102,52,2,26],
    [14,92,96,42], [86,88,-10,50], [-8,76,74,-4], [96,98,24,22]
  ];
  paths.forEach((p,i)=>{
    const n=document.createElement('div');
    const value=i%3===0?100:200;
    n.className='flying-note n'+value;
    n.textContent=value;
    n.style.setProperty('--x0',p[0]+'vw');
    n.style.setProperty('--y0',p[1]+'vh');
    n.style.setProperty('--x1',p[2]+'vw');
    n.style.setProperty('--y1',p[3]+'vh');
    n.style.setProperty('--xm',((p[0]+p[2])/2)+'vw');
    n.style.setProperty('--ym',((p[1]+p[3])/2-8)+'vh');
    n.style.setProperty('--dur',(9+(i%5)*1.35)+'s');
    n.style.setProperty('--delay',(-i*1.9)+'s');
    flying.appendChild(n);
  });

  let ry=-18,rx=-8,down=false,sx=0,sy=0,sry=ry,srx=rx;
  const orbit=()=>{
    stage.style.setProperty('--ry',ry+'deg');
    stage.style.setProperty('--rx',rx+'deg');
  };
  scene.addEventListener('pointerdown',e=>{
    down=true;sx=e.clientX;sy=e.clientY;sry=ry;srx=rx;
    scene.setPointerCapture?.(e.pointerId);
  });
  scene.addEventListener('pointermove',e=>{
    if(!down)return;
    ry=sry+(e.clientX-sx)*.28;
    rx=clamp(srx-(e.clientY-sy)*.12,-18,6);
    orbit();
  });
  scene.addEventListener('pointerup',()=>down=false);
  scene.addEventListener('pointercancel',()=>down=false);

  const available=document.getElementById('availableAmount');
  const income=document.getElementById('incomeAmount');
  let last=null;
  const sync=()=>{
    const balance=numberFrom(available);
    const totalIncome=numberFrom(income);
    const ratio=totalIncome>0?clamp(balance/totalIncome,0,1.15):(balance>0?1:.45);
    stage.style.setProperty('--mountain-scale',clamp(.60+ratio*.40,.58,1.08).toFixed(3));

    if(last!==null&&Math.abs(balance-last)>.01){
      const cls=balance>last?'income-event':'expense-event';
      scene.classList.remove('income-event','expense-event');
      void scene.offsetWidth;
      scene.classList.add(cls);
      setTimeout(()=>scene.classList.remove(cls),1000);
    }
    last=balance;
  };
  const observer=new MutationObserver(sync);
  if(available)observer.observe(available,{childList:true,subtree:true,characterData:true});
  if(income)observer.observe(income,{childList:true,subtree:true,characterData:true});
  setTimeout(sync,350);
})();