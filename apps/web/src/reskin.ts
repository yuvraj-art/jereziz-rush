import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneRig} from 'three/addons/utils/SkeletonUtils.js';

const names=['avatar','train','movingTrain','intro','drop'] as const;
type Name=typeof names[number];
type Template={root:T.Group;size:T.Vector3;animations:T.AnimationClip[];rigged:boolean};
export const trainShapes={
 train:{width:3.7981897725,height:5.4469516815,length:11.0199169583},
 movingTrain:{width:3.5847901768,height:5.3885776078,length:33.5468066004},
};
export class Reskin {
 private templates=new Map<Name,Template>();
 readonly measurements:{name:string;scale:number[];height:number}[]=[];
 async load(){
  const loader=new GLTFLoader();
  await Promise.all(names.map(async name=>{
   const gltf=await loader.loadAsync('./models/'+name+'.glb');
   const oriented=new T.Group();oriented.add(gltf.scene);
   if (name==='train') oriented.rotation.y=-Math.PI/2;
   if (['movingTrain','intro'].includes(name)) oriented.rotation.y=Math.PI/2;
   if (name==='avatar') oriented.rotation.y=Math.PI;
   oriented.updateMatrixWorld(true);
   const bounds=new T.Box3().setFromObject(oriented,true);
   const size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3());
   oriented.position.set(-center.x,-bounds.min.y,-center.z);
   const root=new T.Group();root.add(oriented);
   let rigged=false;root.traverse(n=>{if(n instanceof T.SkinnedMesh)rigged=true});
   this.templates.set(name,{root,size,animations:gltf.animations,rigged});
  }));
 }
 clips(name:Name){return this.templates.get(name)!.animations;}
 model(name:Name,height:number,width?:number,length?:number){
  const t=this.templates.get(name)!;
  const root=(t.rigged?cloneRig(t.root):t.root.clone(true)) as T.Group;
  const s=height/t.size.y;
  root.scale.set(width===undefined?s:width/t.size.x,s,length===undefined?s:length/t.size.z);
  root.name=name;this.measurements.push({name,scale:root.scale.toArray(),height});
  return root;
 }
}
