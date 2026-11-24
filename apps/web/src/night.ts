import * as T from 'three';

export function addNightLight(scene:T.Scene){
 const moonlight=new T.DirectionalLight(0xc6dbff,1.7);
 moonlight.position.set(-6,9,4);
 scene.add(moonlight,new T.HemisphereLight(0xbccdf4,0x72698d,1.15));
}

export function nightSky(){
 const canvas=document.createElement('canvas');
 canvas.width=1024;canvas.height=1024;
 const ctx=canvas.getContext('2d')!;
 const gradient=ctx.createLinearGradient(0,0,0,1024);
 gradient.addColorStop(0,'#080d24');
 gradient.addColorStop(.24,'#17203f');
 gradient.addColorStop(.44,'#344263');
 gradient.addColorStop(1,'#1a223d');
 ctx.fillStyle=gradient;ctx.fillRect(0,0,1024,1024);
 let seed=41;
 const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<175;i++){
  const x=next()*1024,y=next()*370;
  ctx.fillStyle='rgba(220,232,255,'+(.2+next()*.6)*(1-y/490)+')';
  ctx.beginPath();ctx.arc(x,y,.55+next()*1.2,0,Math.PI*2);ctx.fill();
 }
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
 return texture;
}
