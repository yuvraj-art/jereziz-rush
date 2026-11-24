import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 650 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) errors.push(response.url());
  });
  await page.goto(new URL('?qa=1', process.env.GAME_URL || 'http://127.0.0.1:8173/').href);
  await page.waitForFunction(() => window.railRush?.world(), null, { timeout: 90000 });
  const result = await page.evaluate(() => {
    const { game, world: getWorld } = window.railRush;
    const world = getWorld();
    const marker=(tile,name)=>tile.getObjectByName(name).getWorldPosition(world.runner.position.clone());
    const districts=['01_Venom_Sanctum','02_Venom_Abyssal_Dock','03_Jester_Court','04_Jester_After_Dark','05_Dentist_Enamel_Ward','06_Dentist_Ortho_Lab'];
    const tiles=[...new Set(world.sections.map(t=>t.name))];
    const boundaries=[];
    const seams=[];
    const distances=new Set([0,1,49.99,50,100,150,10000]);
    for(let boundary=200;boundary<=2400;boundary+=200){
      for(const delta of [-.01,0,.01])distances.add(boundary+delta);
    }
    for(const distance of distances){
      game.start();game.phase='running';game.distance=distance;world.render(performance.now()/1000);
      const sections=[...world.sections].sort((a,b)=>b.position.z-a.position.z);
      const active=sections.find(s=>s.visible&&marker(s,'Tile_Start').z>=-1e-7&&marker(s,'Tile_End').z<-1e-7);
      const expected=districts[Math.floor(distance/200)%districts.length];
      if(active?.name!==expected)throw Error('Wrong district at '+distance+': '+active?.name+' expected '+expected);
      if(Boolean(active.getObjectByName('District_Gate'))!==(Math.floor(distance/50)%4===0))throw Error('Entrance placement at '+distance);
      boundaries.push({distance,district:active.name});
      for(const [index,section] of sections.entries()){
        const start=marker(section,'Tile_Start');
        if(Math.abs(start.y)>1e-5)throw Error('Railhead height '+section.name);
        for(let lane=1;lane<=3;lane++)if(Math.abs(marker(section,'Lane_'+lane+'_Spawn').x-(lane-2)*35/9)>1e-5)throw Error('Lane center '+section.name);
        if(index>0)seams.push(marker(sections[index-1],'Tile_End').distanceTo(start));
      }
    }
    const avatar=world.reskin.model('avatar',1.95), mixer=new world.mixer.constructor(avatar);
    const bones=[];avatar.traverse(node=>{if(node.isBone)bones.push(node)});
    const clips={};
    for(const clip of world.reskin.clips('avatar')){
      const unbound=clip.tracks.filter(t=>!avatar.getObjectByName(t.name.split('.')[0]));
      if(unbound.length)throw Error('Unbound '+clip.name+' '+unbound[0].name);
      mixer.stopAllAction();mixer.clipAction(clip).reset().play();mixer.setTime(0);
      const pose=()=>bones.flatMap(b=>[...b.position.toArray(),...b.quaternion.toArray()]);
      const base=pose();let motion=0;
      for(const fraction of [.17,.43,.79]){mixer.setTime(clip.duration*fraction);const sample=pose();motion=Math.max(motion,...sample.map((v,i)=>Math.abs(v-base[i])));}
      if(!Number.isFinite(motion)||motion<1e-5)throw Error('Static or invalid clip '+clip.name+' '+motion);
      clips[clip.name]={duration:clip.duration,tracks:clip.tracks.length,motion};
    }
    function fixture() {
      game.start();
      game.phase = 'running';
      game.entities.forEach(entity => { entity.active = false; });
    }
    const shapes = world.proportions();
    const outcomes = [];
    for (const kind of ['train', 'movingTrain']) {
      const shape = shapes.find(item => item.kind === kind);
      for (const roof of [false, true]) {
        fixture();
        Object.assign(game.entities[0], { active: true, kind, lane: 0, z: -1, length: shape.length });
        game.y = roof ? shape.height : 0;
        game.tick();
        outcomes.push({ kind, roof, phase: game.phase, y: game.y, height: shape.height });
      }
    }
    const clipStates = {};
    for (const ability of ['board', 'jetpack', 'boots', 'magnet']) {
      fixture();
      if (ability === 'board') game.input('board');
      else game.power(ability);
      game.tick();
      world.render(performance.now() / 1000);
      clipStates[ability] = world.stats().character;
    }
    fixture();world.render(performance.now()/1000);game.speed=42.77777777777778;for(let i=0;i<32;i++)game.tick();world.render(performance.now()/1000);
    return { tiles, boundaries, maxSeamError:Math.max(...seams), clips, topSpeed:world.currentClip, outcomes, clipStates, shapes, introDuration: game.startDuration };
  });
  assert.equal(result.tiles.length,6);
  assert.equal(Object.keys(result.clips).length,37);
  assert.ok(result.maxSeamError<1e-5);
  assert.equal(result.topSpeed,'RunFast');
  assert.ok(result.shapes.every(shape => shape.kind !== 'ramp'));
  for (const item of result.outcomes) {
    assert.equal(item.phase, item.roof ? 'running' : 'collision');
    if (item.roof) assert.equal(item.y, item.height);
  }
  assert.ok(result.clipStates.board.board.visible);
  assert.ok(result.clipStates.boots.boots.visible);
  assert.ok(result.clipStates.jetpack.jet.visible);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
