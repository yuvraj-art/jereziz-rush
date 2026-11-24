
import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {addNightLight,nightSky} from './night';
import {Reskin,trainShapes} from './reskin';
import {Game,C,Entity,Kind} from './engine';
import {RecoveredAssets} from './recovered-assets';
import {alignObstacle,ObstacleGeometry} from './obstacle-geometry';
import {characterMotion} from './character-motion';
import {jetpackMount} from './jetpack-attachment';
import {startPresentation} from './start-transition';
import {magnetGripPoint,raiseMagnetArm,attractedCoinPosition} from './magnet-presentation';

export class World {
 readonly scene=new T.Scene();
 readonly camera=new T.PerspectiveCamera(C.camera.verticalFov,1,.1,240);
 readonly renderer:T.WebGLRenderer;
 readonly runner=new T.Group();
 readonly menuTrain=new T.Group();

 private barriers!:Record<'barrier'|'overhead',T.Group>;
 private assets!:RecoveredAssets;
 private mixer!:T.AnimationMixer;
 private clips=new Map<string,T.AnimationAction>();
 private currentAction:T.AnimationAction|null=null;
 private currentClip='';
 private clipUntil=0;

 private avatar!:T.Group;
 private reskin=new Reskin();
 private outfitMaterials:T.MeshStandardMaterial[]=[];
 private sections:T.Group[]=[];
 private views=new Map<Entity,T.Group>();
 private pools=new Map<Kind,T.Group[]>();

 private lastClock=0;
 private cameraLift=0;
 private resizeObserver:ResizeObserver;
 private shadow:T.Mesh;

 private board=new T.Group();
 private jet=new T.Group();
 private boots=new T.Group();
 private feet:T.Object3D[]=[];
 private exhaust=new T.Group();

 private lastLane=0;
 private wasGrounded=true;
 private wasBoard=false;
 private wasJet=false;
 private previousRoll=0;
 private previousGameTime=0;

 private transientClip='';
 private mode='menu';

 private leftShoulder!:T.Object3D;
 private rightShoulder!:T.Object3D;
 private leftHip!:T.Object3D;
 private rightHip!:T.Object3D;
 private boardAnchor!:T.Object3D;

 private backError=0;

 private magnet=new T.Group();
 private magnetGrip=new T.Vector3();
 private magnetField!:T.Mesh<T.TorusGeometry,T.MeshBasicMaterial>;
 private magnetTip=new T.Vector3();

 private rightElbow!:T.Object3D;
 private rightHand!:T.Object3D;
 private rightHandTip!:T.Object3D;

 private armBase:T.Quaternion[]|null=null;
 private magnetWeight=0;
 private magnetPulse=0;

 private coinTrailMesh!:T.Mesh<T.BufferGeometry,T.MeshBasicMaterial>;
 private coinTrailCount=0;

 private readonly sectionLength=50;
 private readonly tilesPerDistrict=4;

 private approach!:T.Group;
 private obstacleGeometry:Partial<Record<Kind,ObstacleGeometry>>={};

 private equipment!:Record<'board'|'jetpack'|'magnet',T.Group>;

 static async create(host:HTMLElement,game:Game){
  const world=new World(host,game);

  try{
   await world.load();
   return world;
  }catch(e){
   world.resizeObserver.disconnect();
   world.renderer.dispose();
   world.renderer.domElement.remove();
   throw e;
  }
 }

 private constructor(private host:HTMLElement,public game:Game){

  this.renderer=new T.WebGLRenderer({
   antialias:true,
   powerPreference:'high-performance'
  });

  this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  this.renderer.outputColorSpace=T.SRGBColorSpace;
  this.renderer.toneMapping=T.NoToneMapping;

  host.append(this.renderer.domElement);

  this.scene.background=nightSky();

  this.scene.fog=new T.Fog(
   '#273659',
   428*C.referenceUnitScale,
   850*C.referenceUnitScale
  );

  this.scene.add(this.runner,this.menuTrain);

  addNightLight(this.scene);

  this.shadow=new T.Mesh(
   new T.CircleGeometry(.62,24),
   new T.MeshBasicMaterial({
    color:'#423022',
    transparent:true,
    opacity:.25,
    depthWrite:false
   })
  );

  this.shadow.rotation.x=-Math.PI/2;
  this.scene.add(this.shadow);

  this.resizeObserver=new ResizeObserver(()=>this.resize());
  this.resizeObserver.observe(host);

  this.resize();
 }

 private root(name:string){

  const id=this.assets.find(
   new RegExp('^'+name+'$'),true
  )[0];

  if(!id)
   throw new Error('Missing original prefab: '+name);

  const root=this.assets.prefab(id);

  root.visible=true;

  return root;
 }

 private reflected(content:T.Object3D){

  const group=new T.Group();

  group.scale.set(
   C.referenceUnitScale,
   C.referenceUnitScale,
   -C.referenceUnitScale
  );

  group.add(content);

  return group;
 }

 // OPTIMIZED PARALLEL ASSET LOADING

 private async load(){

  const loader=new GLTFLoader();

  const tiles=[
   '01_Venom_Sanctum',
   '02_Venom_Abyssal_Dock',
   '03_Jester_Court',
   '04_Jester_After_Dark',
   '05_Dentist_Enamel_Ward',
   '06_Dentist_Ortho_Lab'
  ];

  // Load maps and character assets concurrently.

  const districtLoading=Promise.all(
   tiles.map(async name=>{

    const {scene}=await loader.loadAsync(
     './railway/'+name+'.glb'
    );

    const start=scene.getObjectByName('Tile_Start')!;
    const end=scene.getObjectByName('Tile_End')!;
    const lane=scene.getObjectByName('Lane_3_Spawn')!;

    scene.scale.z=
     this.sectionLength/(start.position.z-end.position.z);

    scene.scale.x=C.laneWidth/lane.position.x;

    scene.position.y=-start.position.y;

    scene.name=name;

    return scene;
   })
  );

  const [
   assets,
   ,
   sneakers,
   jumpBarrier,
   rollBarrier,
   board,
   jetpack,
   magnet,
   districts
  ]=await Promise.all([

   RecoveredAssets.load(),

   this.reskin.load(),

   fetch('./recovered/character/super-sneakers.json')
    .then(r=>r.json()),

   loader.loadAsync(
    './models/Knull_Venom_Jump_Barrier.glb'
   ),

   loader.loadAsync(
    './models/Knull_Venom_Roll_Under_Barrier.glb'
   ),

   loader.loadAsync('./models/Hoverboard.glb'),

   loader.loadAsync('./models/Jetpack.glb'),

   loader.loadAsync('./models/Magnet.glb'),

   districtLoading
  ]);

  this.assets=assets;

  this.equipment={
   board:board.scene,
   jetpack:jetpack.scene,
   magnet:magnet.scene
  };

  this.barriers={
   barrier:this.prepareBarrier(
    jumpBarrier.scene,
    3.8331325319,
    2.5387651324
   ),

   overhead:this.prepareBarrier(
    rollBarrier.scene,
    3.8530812528,
    6.0341417558,
    1.6
   )
  };

  this.avatar=this.reskin.model('avatar',1.95);

  this.runner.add(this.avatar);

  this.avatar.traverse(node=>{
   if(
    node instanceof T.Mesh &&
    node.material instanceof T.MeshStandardMaterial
   ){
    this.outfitMaterials.push(node.material);
   }
  });

  this.mixer=new T.AnimationMixer(this.avatar);

  for(const clip of this.reskin.clips('avatar')){
   this.clips.set(
    clip.name,
    this.mixer.clipAction(clip)
   );
  }

  this.animate('Jereziz_Breathe');

  this.game.startDuration=1.2083332538604736;

  const bone=(name:string)=>{

   const b=this.avatar.getObjectByName('mixamorig'+name);

   if(!b)
    throw new Error('Missing Jereziz bone '+name);

   return b;
  };

  this.leftShoulder=bone('LeftArm');
  this.rightShoulder=bone('RightArm');

  this.rightElbow=bone('RightForeArm');
  this.rightHand=bone('RightHand');
  this.rightHandTip=bone('RightHandIndex2');

  this.leftHip=bone('LeftUpLeg');
  this.rightHip=bone('RightUpLeg');

  this.boardAnchor=this.avatar.getObjectByName('attachPoint1')!;

  this.feet=[
   bone('LeftFoot'),
   bone('RightFoot')
  ];

  const shoeMaterial=Object.keys(
   assets.data.materials
  ).find(
   id=>assets.data.materials[id].name===sneakers.material
  )!;

  for(const side of [1,-1]){

   const geometry=new T.BufferGeometry();

   geometry.setAttribute(
    'position',
    new T.Float32BufferAttribute(
     sneakers.positions.flat(),3
    )
   );

   geometry.setAttribute(
    'uv',
    new T.Float32BufferAttribute(
     sneakers.uv.flat(),2
    )
   );

   geometry.setIndex(
    sneakers.indices.filter(
     (_:number,i:number)=>
      side*sneakers.positions[
       sneakers.indices[i-i%3]
      ][0]>0
    )
   );

   const shoe=new T.Mesh(
    geometry,
    assets.materials.get(shoeMaterial)
   );

   const shape=alignObstacle(shoe);

   shoe.position.z+=shape.length/2;
   shoe.scale.setScalar(.18);
   shoe.position.multiplyScalar(.18);

   const mount=new T.Group();

   mount.add(shoe);

   this.boots.add(mount);
  }

  this.runner.add(this.boots);

  // Maps have already been loaded in parallel.

  this.sections=districts.flatMap(
   district=>Array.from(
    {length:this.tilesPerDistrict},
    (_,index)=>{

     const section=index===0
      ?district
      :district.clone(true);

     if(index>0){
      section.getObjectByName(
       'District_Gate'
      )!.removeFromParent();
     }

     this.scene.add(section);

     return section;
    }
   )
  );

  this.approach=this.sections[1].clone(true);

  this.scene.add(this.approach);

  const intro=this.reskin.model(
   'intro',5.52,3.80,28.46
  );

  intro.position.z=-8.39;

  this.menuTrain.add(
   intro,
   this.reflected(
    this.root('IrelandSpring_Train_Start')
   )
  );

  const capacities:Record<Kind,number>={
   coin:180,
   barrier:25,
   overhead:25,
   train:16,
   movingTrain:16,
   magnet:5,
   jetpack:5,
   boots:5,
   multiplier:5,
   board:5
  };

  for(const kind of Object.keys(capacities) as Kind[]){

   const template=this.pickup(kind);

   this.pools.set(
    kind,
    Array.from(
     {length:capacities[kind]},
     ()=>{

      const group=template.clone(true);

      group.visible=false;

      this.scene.add(group);

      return group;
     }
    )
   );
  }

  this.game.configureObstacleGeometry(
   this.obstacleGeometry
  );

  const heldMagnet=this.equipment.magnet.clone(true);

  this.magnetGrip=magnetGripPoint(heldMagnet);

  this.magnet.add(heldMagnet);

  this.scene.add(this.magnet);

  this.magnetField=new T.Mesh(

   new T.TorusGeometry(.49,.012,6,48),

   new T.MeshBasicMaterial({
    color:'#79eaff',
    transparent:true,
    opacity:.25,
    blending:T.AdditiveBlending,
    depthWrite:false
   })
  );

  this.magnetField.position.z=-.04;

  this.magnet.add(this.magnetField);

  // Reuse a fixed GPU buffer for coin trails.

  const trailGeometry=new T.BufferGeometry()
   .setAttribute(
    'position',
    new T.Float32BufferAttribute(
     new Float32Array(54*180),3
    )
   );

  const trailColors:number[]=[];
  const trailIndices:number[]=[];

  for(let i=0;i<180;i++){

   for(let j=0;j<9;j++){

    const fade=1-j/8;

    trailColors.push(
     fade,fade,fade,
     fade,fade,fade
    );

    if(j<8){

     const k=i*18+j*2;

     trailIndices.push(
      k,k+1,k+2,
      k+1,k+3,k+2
     );
    }
   }
  }

  trailGeometry.setAttribute(
   'color',
   new T.Float32BufferAttribute(trailColors,3)
  );

  trailGeometry.setIndex(trailIndices);

  trailGeometry.setDrawRange(0,0);

  this.coinTrailMesh=new T.Mesh(
   trailGeometry,

   new T.MeshBasicMaterial({
    color:'#ffe894',
    vertexColors:true,
    side:T.DoubleSide,
    transparent:true,
    opacity:.65,
    blending:T.AdditiveBlending,
    depthWrite:false
   })
  );

  this.coinTrailMesh.visible=false;
  this.coinTrailMesh.frustumCulled=false;

  this.scene.add(this.coinTrailMesh);

  this.board.add(this.equipment.board.clone(true));

  this.runner.add(this.board);

  const jetModel=this.equipment.jetpack.clone(true);

  this.jet.add(jetModel,this.exhaust);

  this.runner.add(this.jet);

  this.scene.updateMatrixWorld(true);

  for(const name of ['LeftThruster','RightThruster']){

   const thruster=jetModel.getObjectByName(name)!;

   const nozzle=new T.Group();

   nozzle.position.copy(
    this.jet.worldToLocal(
     thruster.getWorldPosition(new T.Vector3())
    )
   );

   const outer=new T.Mesh(

    new T.ConeGeometry(.065,.42,12),

    new T.MeshBasicMaterial({
     color:'#ff8a21',
     transparent:true,
     opacity:.8,
     blending:T.AdditiveBlending,
     depthWrite:false
    })
   );

   outer.rotation.z=Math.PI;
   outer.position.y=-.21;

   const core=new T.Mesh(

    new T.ConeGeometry(.035,.28,12),

    new T.MeshBasicMaterial({
     color:'#fff0ad',
     transparent:true,
     blending:T.AdditiveBlending,
     depthWrite:false
    })
   );

   core.rotation.z=Math.PI;
   core.position.y=-.14;

   nozzle.add(outer,core);

   this.exhaust.add(nozzle);
  }
 }

 private prepareBarrier(
  source:T.Group,
  width:number,
  height:number,
  clearance?:number
 ){

  source.rotation.y=Math.PI;

  source.updateMatrixWorld(true);

  const box=new T.Box3().setFromObject(source,true);

  const size=box.getSize(new T.Vector3());

  const center=box.getCenter(new T.Vector3());

  const sx=width/size.x;

  const bar=source.getObjectByName(
   'Functional_Obstacle_Crossbar'
  )!;

  const opening=
   new T.Box3().setFromObject(bar,true).min.y-box.min.y;

  const sy=clearance===undefined
   ?height/size.y
   :clearance/opening;

  const result=new T.Group();

  const batches=new Map<T.Material,T.BufferGeometry[]>();

  source.traverse(node=>{

   if(!(node instanceof T.Mesh))
    return;

   const geometry=node.geometry.clone()
    .applyMatrix4(node.matrixWorld);

   geometry.translate(
    -center.x,
    -box.min.y,
    -box.max.z
   );

   geometry.scale(sx,sy,sx);

   const batch=batches.get(node.material)??[];

   batch.push(geometry);

   batches.set(node.material,batch);
  });

  for(const [material,batch] of batches){

   const combined=mergeGeometries(batch);

   if(!combined)
    throw new Error(
     'Could not batch barrier material '+material.name
    );

   result.add(new T.Mesh(combined,material));

   for(const geometry of batch){
    geometry.dispose();
   }
  }

  return result;
 }

 private pickup(kind:Kind){

  if(kind==='train'||kind==='movingTrain'){

   const shape=trainShapes[kind];

   const group=new T.Group();

   const model=this.reskin.model(
    kind,
    shape.height,
    shape.width,
    shape.length
   );

   model.position.z=-shape.length/2;

   group.add(model);

   group.userData.kind=kind;

   this.obstacleGeometry[kind]={...shape};

   return group;
  }

  if(kind==='coin'){

   const group=new T.Group();

   const drop=this.reskin.model('drop',.74);

   drop.position.y=-.37;

   drop.traverse(o=>{

    if(
     o instanceof T.Mesh &&
     o.material instanceof T.MeshStandardMaterial
    ){

     o.material.emissive.setHex(0x9737be);

     o.material.emissiveIntensity=.45;
    }
   });

   group.add(drop);

   group.userData.kind=kind;

   return group;
  }

  if(kind==='barrier'||kind==='overhead'){

   const group=this.barriers[kind].clone(true);

   group.userData.kind=kind;

   this.obstacleGeometry[kind]=kind==='barrier'

    ?{
     width:3.8331325319,
     height:2.5387651324,
     length:3.0187639263
    }

    :{
     width:3.8530812528,
     height:6.0341417558,
     length:2.9409848319,
     clearance:1.6
    };

   return group;
  }

  if(
   kind==='board'||
   kind==='jetpack'||
   kind==='magnet'
  ){

   const group=new T.Group();

   const model=this.equipment[kind].clone(true);

   if(kind==='board'){

    model.rotation.z=.4;

   }else{

    const bounds=new T.Box3().setFromObject(model,true);

    const size=bounds.getSize(new T.Vector3());

    const scale=1.05/Math.max(size.x,size.y);

    model.scale.multiplyScalar(scale);

    model.position.sub(
     bounds.getCenter(new T.Vector3())
      .multiplyScalar(scale)
    );
   }

   group.add(model);

   group.userData.kind=kind;

   return group;
  }

  const model=this.root(
   kind==='boots'
    ?'powerups_superSneakers'
    :'powerups_2xMultiplier'
  );

  model.position.set(0,0,0);

  const reflected=this.reflected(model);

  const group=new T.Group();

  group.add(reflected);

  reflected.updateMatrixWorld(true);

  const shape=alignObstacle(reflected);

  const scale=1.05/Math.max(shape.width,shape.height);

  reflected.scale.multiplyScalar(scale);

  reflected.position.multiplyScalar(scale);

  reflected.position.y-=shape.height*scale/2;

  reflected.position.z+=shape.length*scale/2;

  group.userData.kind=kind;

  return group;
 }

 private animate(
  name:string,
  once=false,
  restart=false
 ){

  if(name===this.currentClip&&!restart)
   return;

  const action=this.clips.get(name);

  if(!action)
   throw new Error('Missing character animation '+name);

  const previous=this.currentAction;

  action.reset()
   .setEffectiveWeight(1)
   .setEffectiveTimeScale(1);

  action.setLoop(
   once?T.LoopOnce:T.LoopRepeat,
   once?1:Infinity
  );

  action.clampWhenFinished=once;

  action.play();

  if(previous&&previous!==action){

   action.crossFadeFrom(
    previous,
    name==='introRun'||this.currentClip==='introRun'
     ?.20
     :.10,
    false
   );
  }

  this.currentAction=action;

  this.currentClip=name;
 }

 resize(){

  const width=this.host.clientWidth;
  const height=this.host.clientHeight;

  this.renderer.setSize(width,height);

  this.camera.aspect=width/height;

  const maxHorizontalFov=75;

  this.camera.fov=Math.min(

   C.camera.verticalFov,

   T.MathUtils.radToDeg(
    2*Math.atan(
     Math.tan(
      T.MathUtils.degToRad(maxHorizontalFov/2)
     )/this.camera.aspect
    )
   )
  );

  this.camera.updateProjectionMatrix();
 }

 render(clock:number){

  const dt=Math.min(
   .05,
   Math.max(0,clock-this.lastClock)
  );

  this.lastClock=clock;

  const g=this.game;

  const start=startPresentation(
   g.phase,
   g.previousPhase,
   g.phaseTime,
   g.startDuration,
   g.distance,
   C.initialSpeed
  );

  const D=start.environmentDistance;

  const cycle=this.sections.length*this.sectionLength;

  for(const [index,tile] of this.sections.entries()){

   const offset=
    start.entityDistance-index*this.sectionLength;

   tile.position.z=
    offset-
    Math.floor(
     (offset-2*this.sectionLength)/cycle
    )*cycle-cycle;

   tile.visible=
    tile.position.z>=-180 &&
    tile.position.z<=this.sectionLength+15;

   if(
    index===this.sections.length-1 &&
    start.entityDistance<20
   ){
    tile.visible=false;
   }
  }

  this.approach.position.z=
   start.entityDistance+this.sectionLength;

  this.approach.visible=start.entityDistance<20;

  for(const [e,view] of this.views){

   if(!e.active||view.userData.kind!==e.kind){

    view.visible=false;

    this.pools.get(view.userData.kind)!.push(view);

    this.views.delete(e);
   }
  }

  for(const e of g.entities){

   if(!e.active)
    continue;

   let view=this.views.get(e);

   if(!view){

    view=this.pools.get(e.kind)!.pop();

    if(!view)
     continue;

    view.visible=true;

    this.views.set(e,view);
   }

   view.scale.setScalar(1);

   view.rotation.z=0;

   view.position.set(
    e.lane*C.laneWidth,
    e.y,
    start.entityDistance-e.z
   );

   if(
    e.kind==='coin'||
    [
     'magnet',
     'jetpack',
     'boots',
     'multiplier',
     'board'
    ].includes(e.kind)
   ){
    view.rotation.y=g.time*2;
   }
  }

  const menu=start.stage==='menu';

  const starting=start.stage==='starting';

  const blend=start.blend;

  this.menuTrain.visible=menu||starting||D<40;

  this.menuTrain.position.set(
   -C.laneWidth,0,3+D
  );

  this.runner.position.set(
   g.x+(1-blend)*.75,
   g.y,
   0
  );

  this.runner.rotation.y=
   (Math.PI-.4)*(1-blend);

  const jetpack=g.powers.jetpack>0;

  const board=g.powers.board>0&&!jetpack;

  const boots=g.powers.boots>0;

  const reset=
   g.time<this.previousGameTime||menu||starting;

  let restart=reset&&this.previousGameTime>0;

  if(reset){

   this.transientClip='';
   this.clipUntil=0;
   this.lastLane=g.lane;
   this.wasGrounded=true;
   this.wasBoard=false;
   this.wasJet=false;
  }

  if(g.phase==='running'){

   if(board&&!this.wasBoard){

    this.transientClip='h_skate_on';

    this.clipUntil=g.time+.458;

    restart=true;
   }

   if(jetpack!==this.wasJet){

    this.transientClip='';

    this.clipUntil=0;

    restart=true;
   }

   if(g.lane!==this.lastLane){

    const left=g.lane*C.laneWidth<g.laneFrom;

    this.lastLane=g.lane;

    if(jetpack||g.grounded){

     this.transientClip=jetpack

      ?(
       left
        ?'Jetpack_changeLane_left'
        :'Jackpack_changeLane_Right'
      )

      :board

       ?(left?'h_left':'h_right')

       :(left?'dodgeLeft':'dodgeRight');

     this.clipUntil=g.time+(jetpack?.4:.2);

     restart=true;
    }
   }

   if(g.grounded&&!this.wasGrounded&&!jetpack){

    this.transientClip=board?'h_landing':'landing';

    this.clipUntil=g.time+(board?.20:.10);

    restart=true;
   }

   if(
    this.wasGrounded&&!g.grounded||
    g.roll>this.previousRoll+.05
   ){
    restart=true;
   }
  }

  const motion=characterMotion({

   phase:start.stage,

   fast:g.speed>=C.initialSpeed*1.5,

   grounded:g.grounded,

   vy:g.vy,

   roll:g.roll,

   board,

   boots,

   jetpack,

   transient:g.time<this.clipUntil
    ?this.transientClip
    :undefined
  });

  this.mode=motion.mode;

  this.animate(motion.clip,motion.once,restart);

  if(this.currentAction){

   this.currentAction.timeScale=

    [
     'RunNormal',
     'RunFast',
     'superRun',
     'h_run'
    ].includes(motion.clip)

     ?g.speed/(
      C.initialSpeed*(motion.clip==='RunFast'?1.5:1)
     )

     :motion.clip==='jump'&&boots
      ?.72
      :1;
  }

  const animationDt=
   menu||starting||g.phase==='collision'
    ?dt
    :Math.max(0,g.time-this.previousGameTime);

  const arm=[
   this.rightShoulder,
   this.rightElbow,
   this.rightHand
  ];

  if(this.armBase){

   arm.forEach(
    (bone,i)=>bone.quaternion.copy(this.armBase![i])
   );
  }

  if(
   menu||
   g.phase==='running'||
   starting||
   g.phase==='collision'
  ){

   this.mixer.update(Math.min(.05,animationDt));
  }

  const attracting=g.entities.some(
   e=>e.active&&e.attraction
  );

  const holding=
   !menu&&!starting&&(g.powers.magnet>0||attracting);

  const poseDt=g.phase==='paused'?0:animationDt;

  if(reset)
   this.magnetWeight=0;

  this.magnetWeight=T.MathUtils.clamp(
   this.magnetWeight+(holding?1:-1)*poseDt*5,
   0,
   1
  );

  this.armBase=arm.map(
   bone=>bone.quaternion.clone()
  );

  this.runner.updateMatrixWorld(true);

  if(this.magnetWeight>0){

   raiseMagnetArm(
    this.rightShoulder,
    this.rightElbow,
    this.rightHand,
    this.magnetWeight
   );
  }

  this.wasGrounded=g.grounded;

  this.wasBoard=board;

  this.wasJet=jetpack;

  this.previousRoll=g.roll;

  this.previousGameTime=g.time;

  this.board.visible=!menu&&board;

  this.jet.visible=!menu&&jetpack;

  this.boots.visible=!menu&&boots;

  this.runner.updateMatrixWorld(true);

  this.magnet.visible=this.magnetWeight>.01;

  this.magnet.rotation.set(
   0,-.12,Math.sin(g.time*5)*.035
  );

  this.magnet.position.copy(

   this.rightHandTip.getWorldPosition(
    new T.Vector3()
   )

  ).sub(

   this.magnetGrip.clone()
    .applyQuaternion(this.magnet.quaternion)
  );

  this.magnetTip.copy(this.magnet.position)
   .add(new T.Vector3(0,.23,0));

  this.magnetPulse=Math.max(
   0,this.magnetPulse-poseDt*4
  );

  this.magnetField.scale.setScalar(
   1+Math.sin(g.time*7)*.08+this.magnetPulse*.32
  );

  this.magnetField.material.opacity=
   .15+this.magnetPulse*.6;

  this.updateAttractedCoins();

  const local=(bone:T.Object3D)=>
   this.runner.worldToLocal(
    bone.getWorldPosition(new T.Vector3())
   );

  this.board.position.copy(local(this.boardAnchor));

  this.boardAnchor.getWorldQuaternion(
   this.board.quaternion
  );

  this.board.quaternion.premultiply(
   this.runner.getWorldQuaternion(
    new T.Quaternion()
   ).invert()
  );

  this.feet.forEach((foot,i)=>{

   const shoe=this.boots.children[i];

   shoe.position.copy(local(foot));

   shoe.position.y-=.13;
  });

  const mount=jetpackMount(

   local(this.leftShoulder),

   local(this.rightShoulder),

   local(this.leftHip),

   local(this.rightHip)
  );

  this.jet.position.copy(mount.position);

  this.jet.quaternion.copy(mount.quaternion);

  this.backError=this.jet.position.distanceTo(
   mount.position
  );

  this.exhaust.visible=this.jet.visible;

  this.exhaust.scale.y=
   1+Math.sin(g.time*47)*.12;

  this.shadow.position.set(
   this.runner.position.x,
   g.ground+.02,
   0
  );

  this.shadow.scale.setScalar(
   Math.max(.42,1-g.y*.06)
  );

  const lift=g.y*(

   g.powers.jetpack>0||g.y>3

    ?C.camera.jetpackVerticalFollow

    :C.camera.jumpVerticalFollow
  );

  this.cameraLift+=(lift-this.cameraLift)*Math.min(1,dt*7);

  this.camera.position.set(

   T.MathUtils.lerp(
    4.8,
    g.x*C.camera.lateralPositionFollow,
    blend
   ),

   T.MathUtils.lerp(
    3.5,
    C.camera.y+this.cameraLift,
    blend
   ),

   T.MathUtils.lerp(
    5.8,
    C.camera.z+(this.camera.aspect>1.1?1.5:0),
    blend
   )
  );

  this.camera.lookAt(

   T.MathUtils.lerp(
    -.7,
    g.x*C.camera.lateralTargetFollow,
    blend
   ),

   T.MathUtils.lerp(
    2.1,
    C.camera.lookY+this.cameraLift,
    blend
   ),

   T.MathUtils.lerp(
    0,
    C.camera.lookZ,
    blend
   )
  );

  this.renderer.render(this.scene,this.camera);
 }

 private updateAttractedCoins(){

  const positions=
   this.coinTrailMesh.geometry.getAttribute(
    'position'
   ) as T.BufferAttribute;

  let count=0;

  for(const [entity,view] of this.views){

   const flight=entity.attraction;

   if(!flight)
    continue;

   attractedCoinPosition(
    flight,
    this.magnetTip,
    view.position
   );

   view.rotation.y=this.game.time*18;

   view.rotation.z=
    Math.sin(flight.elapsed*12)*.25;

   view.scale.setScalar(
    1-.72*Math.pow(
     Math.min(1,flight.elapsed/flight.duration),
     8
    )
   );

   if(count>=180)
    continue;

   for(let i=0;i<9;i++){

    const elapsed=Math.max(
     0,flight.elapsed-i*.012
    );

    const point=attractedCoinPosition(
     {...flight,elapsed},
     this.magnetTip
    );

    const behind=attractedCoinPosition(
     {
      ...flight,
      elapsed:Math.max(0,elapsed-.01)
     },
     this.magnetTip
    );

    const width=new T.Vector3().crossVectors(

     point.clone().sub(behind),

     this.camera.position.clone().sub(point)

    ).normalize().multiplyScalar(
     .045*(1-i/9)
    );

    const index=count*18+i*2;

    positions.setXYZ(
     index,
     point.x+width.x,
     point.y+width.y,
     point.z+width.z
    );

    positions.setXYZ(
     index+1,
     point.x-width.x,
     point.y-width.y,
     point.z-width.z
    );
   }

   count++;
  }

  this.coinTrailCount=count;

  this.coinTrailMesh.visible=count>0;

  this.coinTrailMesh.geometry.setDrawRange(
   0,count*48
  );

  positions.needsUpdate=count>0;
 }

 burst(type:string){

  if(type==='coin'&&this.magnet.visible){

   this.magnetPulse=1;
  }
 }

 setSkin(id:string){

  const tint=
   id==='mint'
    ?0xb2ffda
    :id==='violet'
     ?0xd5b4ff
     :0xffffff;

  for(const material of this.outfitMaterials){

   material.color.setHex(tint);
  }
 }

 get metrics(){

  return this.reskin.measurements;
 }

 calibration(){

  const project=(p:T.Vector3)=>{

   p.project(this.camera);

   return{
    x:(p.x+1)/2,
    y:(1-p.y)/2
   };
  };

  return{

   feet:project(
    new T.Vector3(
     this.game.x,
     this.game.y,
     0
    )
   ),

   head:project(
    new T.Vector3(
     this.game.x,
     this.game.y+1.91,
     0
    )
   ),

   horizon:project(
    new T.Vector3(0,0,-10000)
   )
  };
 }

 proportions(){

  return Object.entries(
   this.obstacleGeometry
  ).map(([kind,shape])=>{

   const model=this.pools.get(
    kind as Kind
   )?.[0]?.children[0];

   return{
    kind,
    ...shape,
    scale:model?.scale.toArray()
   };
  });
 }

 startup(){

  return{

   presentation:startPresentation(

    this.game.phase,

    this.game.previousPhase,

    this.game.phaseTime,

    this.game.startDuration,

    this.game.distance,

    C.initialSpeed
   ),

   runnerPosition:this.runner.position.toArray(),

   runnerHeading:this.runner.rotation.y,

   cameraPosition:this.camera.position.toArray(),

   cameraQuaternion:this.camera.quaternion.toArray(),

   trainPosition:this.menuTrain.position.toArray(),

   trainVisible:this.menuTrain.visible,

   clip:this.currentClip,

   actionTime:this.currentAction?.time??0,

   sections:this.sections.map(
    section=>section.position.z
   )
  };
 }

 stats(){

  return{

   calls:this.renderer.info.render.calls,

   triangles:this.renderer.info.render.triangles,

   geometries:this.renderer.info.memory.geometries,

   viewCount:this.views.size,

   assets:'APK-derived',

   animation:this.currentClip,

   clips:this.clips.size,

   character:{

    magnet:{

     visible:this.magnet.visible,

     weight:this.magnetWeight,

     position:this.magnet.position.toArray(),

     target:this.magnetTip.toArray(),

     flyingCoins:this.game.entities.filter(
      e=>e.active&&e.attraction
     ).length,

     trails:this.coinTrailCount
    },

    mode:this.mode,

    clip:this.currentClip,

    actionTime:this.currentAction?.time??0,

    board:{

     visible:this.board.visible,

     parent:this.board.parent?.name,

     anchorError:this.board.getWorldPosition(
      new T.Vector3()
     ).distanceTo(
      this.boardAnchor.getWorldPosition(
       new T.Vector3()
      )
     )
    },

    boots:{

     visible:this.boots.visible,

     skinned:false,

     boneCount:this.feet.length
    },

    jet:{

     visible:this.jet.visible,

     parent:'back-follow',

     backError:this.backError,

     exhaustVisible:this.exhaust.visible
    }
   }
  };
 }
}
