(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const sceneRoot = $('scene');
  if (!window.THREE) {
    sceneRoot.innerHTML = '<div style="padding:30px;color:white">Three.js could not load. Check your internet connection and reload the page.</div>';
    return;
  }

  let scene, camera, renderer, clock;
  let player, torso, head, leftLeg, rightLeg, leftArm, rightArm;
  let roadSegments = [], roadside = [], obstacles = [], coins = [], particles = [];
  let running = false, paused = false, ended = false;
  let lane = 0, targetX = 0, jumpY = 0, jumpVelocity = 0, duckTimer = 0;
  let distance = 0, coinCount = 0, speed = 13, elapsed = 0, spawnTimer = 1.0, coinTimer = 1.3;
  // During a bottleneck, reserve the designated escape lane until the junction clears.
  let protectedLane = -1, protectionUntil = 0;
  let lastFrame = 0, toastTimer = 0, cameraBaseY = 5.4, previousPlayerX = 0, intersectionTimer = 16, intersectionWarning = 0;
  const laneX = [-2.35, 0, 2.35];
  const world = { roadWidth: 8.6, roadLength: 34 };
  const mat = (color, roughness = .82, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const materials = {
    road: mat(0x30363b), asphaltLine: mat(0xe9e6d9), grass: mat(0x536c3e), curb: mat(0xc2b89a),
    skin: mat(0x75432f), shirt: mat(0x176f9b), shirtBright: mat(0x39a7c8), shorts: mat(0x171c25), shoe: mat(0xd9dce0), sole: mat(0xe3a22e), vest: mat(0x242832), clothDark: mat(0x111820),
    coin: new THREE.MeshStandardMaterial({color:0xffd43b,metalness:.75,roughness:.22,emissive:0x684300}),
    glass: new THREE.MeshStandardMaterial({color:0x8fc8d9,roughness:.2,metalness:.2}),
    tire: mat(0x15191d), white: mat(0xf4f1e8), dark: mat(0x1a2229), red: mat(0xc94632), yellow: mat(0xf2a928), green: mat(0x2d7c56)
  };

  function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8cb6c8);
    scene.fog = new THREE.Fog(0x8cb6c8, 42, 160);
    camera = new THREE.PerspectiveCamera(57, innerWidth / innerHeight, .1, 220);
    camera.position.set(0, cameraBaseY, 10.6);
    camera.lookAt(0, 1.3, -7);
    renderer = new THREE.WebGLRenderer({antialias:true, alpha:false, powerPreference:'high-performance'});
    const mobileDevice = matchMedia('(max-width: 800px)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobileDevice ? 1.25 : 1.8));
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    // Keep desktop shadows; disable them on phones to reduce GPU load and heat.
    renderer.shadowMap.enabled = !mobileDevice;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    sceneRoot.appendChild(renderer.domElement);
    clock = new THREE.Clock();

    scene.add(new THREE.HemisphereLight(0xd9f5ff, 0x6b553a, 1.65));
    const sun = new THREE.DirectionalLight(0xffedca, 2.1);
    sun.position.set(-7, 14, 7); sun.castShadow = !mobileDevice;
    sun.shadow.mapSize.set(mobileDevice ? 512 : 1024,mobileDevice ? 512 : 1024); sun.shadow.camera.left=-16; sun.shadow.camera.right=16; sun.shadow.camera.top=20; sun.shadow.camera.bottom=-20;
    scene.add(sun);
    makeBackdrop(); makeRoad(); makePlayer();
    window.addEventListener('resize', onResize, {passive:true});
    window.addEventListener('orientationchange', () => setTimeout(onResize, 120), {passive:true});
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize, {passive:true});
    document.addEventListener('contextmenu', e => { if (e.target.closest('#game')) e.preventDefault(); });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    $('startBtn').addEventListener('click', startGame);
    $('pauseBtn').addEventListener('click', togglePause);
    $('resumeBtn').addEventListener('click', togglePause);
    $('retryBtn').addEventListener('click', resetGame);
    $('restartPauseBtn').addEventListener('click', resetGame);
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('pointerdown', e => { e.preventDefault(); if (!running || paused || ended) return; action(btn.dataset.action); });
    });
    let touchX=0, touchY=0;
    renderer.domElement.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse') { touchX=e.clientX; touchY=e.clientY; }
    }, {passive:true});
    renderer.domElement.addEventListener('pointerup', e => {
      if (e.pointerType === 'mouse' || !running || paused || ended) return;
      const dx=e.clientX-touchX, dy=e.clientY-touchY;
      if(Math.max(Math.abs(dx),Math.abs(dy))<28){jump();return;}
      if(Math.abs(dx)>Math.abs(dy)) action(dx>0?'right':'left'); else action(dy<0?'jump':'duck');
    }, {passive:true});
    onResize(); renderer.render(scene,camera); requestAnimationFrame(frame);
  }

  function makeBackdrop(){
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(260,260), materials.grass); ground.rotation.x=-Math.PI/2; ground.position.set(0,-.12,-65); ground.receiveShadow=true; scene.add(ground);
    // Distant low-rise Lagos-style buildings soften into the horizon.
    for(let i=0;i<52;i++){
      const side=i%2===0?-1:1, z=-18-Math.random()*100, x=side*(9+Math.random()*20), h=3+Math.random()*10, w=2+Math.random()*4;
      const building=new THREE.Group();
      const body=new THREE.Mesh(new THREE.BoxGeometry(w,h,2+Math.random()*3),mat([0xb5a58d,0xd1b99b,0x9aa8a6,0xc8c1ae][i%4])); body.position.y=h/2; building.add(body);
      const rows=Math.max(2,Math.floor(h/1.3));
      for(let r=0;r<rows;r++) for(let c=0;c<2;c++) { const win=new THREE.Mesh(new THREE.BoxGeometry(.22,.3,.03),mat(0x456a76,.3)); win.position.set((c-.5)*w*.45,.65+r*1.05,1.02); building.add(win); }
      building.position.set(x,0,z); scene.add(building);
    }
    // Warm haze and a sun disk.
    const sunDisk=new THREE.Mesh(new THREE.SphereGeometry(3,20,16),new THREE.MeshBasicMaterial({color:0xffd89a})); sunDisk.position.set(-25,25,-100); scene.add(sunDisk);
  }

  function makeRoad(){
    for(let i=0;i<7;i++){
      const group=new THREE.Group();
      const asphalt=new THREE.Mesh(new THREE.PlaneGeometry(world.roadWidth,world.roadLength),materials.road); asphalt.rotation.x=-Math.PI/2; asphalt.receiveShadow=true; group.add(asphalt);
      // Lane dividers are broken, not continuous.
      for(const x of [-1.42,1.42]) for(let j=0;j<5;j++){
        const dash=new THREE.Mesh(new THREE.PlaneGeometry(.075,2.3),materials.asphaltLine); dash.rotation.x=-Math.PI/2; dash.position.set(x,.012,-world.roadLength/2+2+j*6.1); group.add(dash);
      }
      for(const x of [-4.42,4.42]){
        const edge=new THREE.Mesh(new THREE.BoxGeometry(.24,.14,world.roadLength),materials.curb); edge.position.set(x,.04,0); group.add(edge);
      }
      group.position.z=-i*world.roadLength; roadSegments.push(group); scene.add(group);
    }
    // Roadside trees, poles and small kiosks are individual moving props.
    for(let i=0;i<48;i++){
      const side=i%2===0?-1:1, z=-8-i*4.0-Math.random()*3, x=side*(6.4+Math.random()*2.8);
      const prop=makeRoadProp(i); prop.position.set(x,0,z); roadside.push(prop); scene.add(prop);
    }
  }
  function makeRoadProp(i){
    const g=new THREE.Group();
    if(i%3===0){
      const w=3.0+Math.random()*3.0,h=8+Math.random()*16,d=3.0+Math.random()*3.5;
      const palette=[0x8f8173,0xb4a18a,0x777e80,0xc0b7a8,0x79685b];
      const building=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat(palette[i%palette.length]));building.position.set(0,h/2,-.3);g.add(building);
      const balconyMat=mat(0x3c4a50,.45,.15);
      for(let y=1.2;y<h-0.5;y+=1.65){for(let x=-w*.32;x<=w*.32;x+=w*.32){const win=new THREE.Mesh(new THREE.BoxGeometry(.48,.68,.045),mat(i%2?0x365b69:0x243b49,.25));win.position.set(x,y,d/2+.025);g.add(win);}const balcony=new THREE.Mesh(new THREE.BoxGeometry(w*.88,.09,.32),balconyMat);balcony.position.set(0,y-.38,d/2+.12);g.add(balcony);}
      const sign=new THREE.Mesh(new THREE.BoxGeometry(w*.72,.36,.08),mat(i%2?0x9f382c:0x246d68));sign.position.set(0,1.1,d/2+.07);g.add(sign);
    }else if(i%4===0){
      const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.13,.2,1.7,7),mat(0x65462e)); trunk.position.y=.85; g.add(trunk);
      for(const [y,r] of [[1.6,.95],[2.25,.72],[2.75,.45]]){const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(r,1),mat(i%8?0x2e6945:0x38764a));crown.position.y=y;g.add(crown);}
    }else if(i%4===1){
      const post=new THREE.Mesh(new THREE.CylinderGeometry(.06,.08,3.8,6),mat(0x4c5352));post.position.y=1.9;g.add(post);
      const arm=new THREE.Mesh(new THREE.BoxGeometry(1.2,.07,.07),mat(0x4c5352));arm.position.set(.45,3.6,0);g.add(arm);
      const lamp=new THREE.Mesh(new THREE.BoxGeometry(.28,.12,.24),new THREE.MeshStandardMaterial({color:0xffe9a0,emissive:0x4b3b14}));lamp.position.set(.95,3.52,0);g.add(lamp);
    }else{
      const w=1.5+Math.random()*1.0,h=1.4+Math.random()*1.2;
      const kiosk=new THREE.Mesh(new THREE.BoxGeometry(w,h,1.7),mat(i%3?0xb98a50:0x477d78));kiosk.position.y=h/2;g.add(kiosk);
      const roof=new THREE.Mesh(new THREE.BoxGeometry(w+.2,.18,1.95),mat(i%2?0x8e352b:0x303c46));roof.position.y=h+.08;g.add(roof);
      const front=new THREE.Mesh(new THREE.BoxGeometry(w*.58,.5,.05),mat(0x26333a));front.position.set(0,h*.58,.88);g.add(front);
    }
    g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}}); return g;
  }

  function makePlayer(){
    player=new THREE.Group();
    const torsoGroup=new THREE.Group(); torso=torsoGroup;
    const body=new THREE.Mesh(new THREE.CylinderGeometry(.27,.34,.78,12),materials.shirt); body.position.y=1.62; body.castShadow=true; torsoGroup.add(body);
    const shoulderShape=new THREE.Mesh(new THREE.SphereGeometry(.29,12,9),materials.shirt); shoulderShape.scale.set(1,.58,.82); shoulderShape.position.y=1.93; torsoGroup.add(shoulderShape);
    const stripe=new THREE.Mesh(new THREE.BoxGeometry(.1,.82,.57),materials.shirtBright);stripe.position.set(0,1.65,.31);torsoGroup.add(stripe);
    const neck=new THREE.Mesh(new THREE.CylinderGeometry(.105,.12,.18,10),materials.skin);neck.position.y=2.15;torsoGroup.add(neck);
    head=new THREE.Group();
    const face=new THREE.Mesh(new THREE.SphereGeometry(.245,18,14),materials.skin);face.position.y=2.42;head.add(face);
    const hair=new THREE.Mesh(new THREE.SphereGeometry(.255,16,12,0,Math.PI*2,0,Math.PI*.58),materials.dark);hair.position.set(0,2.48,.015);head.add(hair);
    const eyeMat=new THREE.MeshBasicMaterial({color:0x171a1c});
    for(const x of [-.085,.085]){const eye=new THREE.Mesh(new THREE.SphereGeometry(.022,8,6),eyeMat);eye.position.set(x,2.44,.225);head.add(eye);}
    // Open, worn street vest layered over the blue shirt.
    const vestBack=new THREE.Mesh(new THREE.BoxGeometry(.53,.77,.12),materials.vest);vestBack.position.set(0,1.66,-.22);torsoGroup.add(vestBack);
    for(const side of [-1,1]){
      const vestPanel=new THREE.Mesh(new THREE.BoxGeometry(.17,.72,.08),materials.vest);vestPanel.position.set(side*.235,1.66,.22);torsoGroup.add(vestPanel);
      const pocket=new THREE.Mesh(new THREE.BoxGeometry(.13,.15,.035),materials.clothDark);pocket.position.set(side*.235,1.55,.27);torsoGroup.add(pocket);
      // Jagged exposed-shirt/skin-colored tears along the sleeves.
      for(let t=0;t<3;t++){const tear=new THREE.Mesh(new THREE.BoxGeometry(.11,.035,.025),materials.clothDark);tear.position.set(side*(.31+t*.018),1.83-t*.12,.205);tear.rotation.z=side*(t%2?.25:-.18);torsoGroup.add(tear);}
    }
    // Rough cargo pockets and ripped knee panels.
    player.add(torsoGroup,head);
    const hips=new THREE.Mesh(new THREE.BoxGeometry(.55,.28,.34),materials.shorts);hips.position.y=1.08;player.add(hips);
    leftLeg=makeLimb(.13,.58,materials.shorts,materials.skin,materials.shoe);leftLeg.position.set(-.18,1.02,0);player.add(leftLeg);
    rightLeg=makeLimb(.13,.58,materials.shorts,materials.skin,materials.shoe);rightLeg.position.set(.18,1.02,0);player.add(rightLeg);
    for(const side of [-1,1]){const pocket=new THREE.Mesh(new THREE.BoxGeometry(.19,.22,.08),materials.vest);pocket.position.set(side*.27,.83,.05);player.add(pocket);const rip=new THREE.Mesh(new THREE.BoxGeometry(.12,.045,.025),materials.shirtBright);rip.position.set(side*.18,.46,.12);player.add(rip);}
    leftArm=makeArm();leftArm.position.set(-.39,1.95,0);player.add(leftArm);
    rightArm=makeArm();rightArm.position.set(.39,1.95,0);player.add(rightArm);
    player.position.set(0,0,1.2);scene.add(player);
    player.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  }
  function makeLimb(r,len,shortMat,skinMat,shoeMat){
    const g=new THREE.Group();const thigh=new THREE.Mesh(new THREE.CylinderGeometry(r*.82,r*.72,len*.56,9),shortMat);thigh.position.y=-.15;g.add(thigh);
    const shin=new THREE.Mesh(new THREE.CylinderGeometry(r*.63,r*.48,len*.52,9),skinMat);shin.position.set(0,-.47,.015);g.add(shin);
    const shoe=new THREE.Mesh(new THREE.BoxGeometry(.2,.13,.37),shoeMat);shoe.position.set(0,-.76,.09);g.add(shoe);
    const sole=new THREE.Mesh(new THREE.BoxGeometry(.205,.045,.38),materials.sole);sole.position.set(0,-.83,.09);g.add(sole);return g;
  }
  function makeArm(){const g=new THREE.Group();const sleeve=new THREE.Mesh(new THREE.SphereGeometry(.145,10,8),materials.shirt);sleeve.position.y=-.06;g.add(sleeve);const arm=new THREE.Mesh(new THREE.CylinderGeometry(.085,.065,.43,9),materials.skin);arm.position.y=-.32;g.add(arm);const hand=new THREE.Mesh(new THREE.SphereGeometry(.075,9,8),materials.skin);hand.position.y=-.56;g.add(hand);return g;}

  function makeVehicle(){
    const g=new THREE.Group();
    const roll=Math.random();
    const isBus=roll<.34;
    const isTruck=!isBus && roll<.48;
    const bodyMat=isBus?materials.yellow:(roll<.65?materials.green:(roll<.82?materials.red:mat(0x2877a8)));
    // Traffic is intentionally oversized and visually imposing compared with the runner.
    // Buses and delivery trucks are tall, broad obstacles that read clearly from a distance.
    const width=isBus?2.15:(isTruck?2.0:1.9);
    const length=isBus?5.2:(isTruck?4.2:3.35);
    const bodyHeight=isBus?2.65:(isTruck?1.85:1.42);
    const bodyY=bodyHeight/2+.18;
    const body=new THREE.Mesh(new THREE.BoxGeometry(width,bodyHeight,length),bodyMat);body.position.y=bodyY;g.add(body);
    if(isBus){
      const roof=new THREE.Mesh(new THREE.BoxGeometry(width*.96,.16,length*.94),mat(0xf0c54b));roof.position.y=bodyY+bodyHeight/2+.08;g.add(roof);
      // Large side windows make it read as a city bus, not a car.
      for(let side of [-1,1]) for(let z=-length*.36;z<=length*.36;z+=.82){
        const win=new THREE.Mesh(new THREE.BoxGeometry(.035,.76,.62),materials.glass);win.position.set(side*(width/2+.012),bodyY+.35,z);g.add(win);
      }
      const frontGlass=new THREE.Mesh(new THREE.BoxGeometry(width*.78,.65,.04),materials.glass);frontGlass.position.set(0,bodyY+.42,length/2+.022);g.add(frontGlass);
      const routeBoard=new THREE.Mesh(new THREE.BoxGeometry(.8,.2,.045),mat(0x17242a));routeBoard.position.set(0,bodyY+bodyHeight/2-.23,length/2+.03);g.add(routeBoard);
      const bumper=new THREE.Mesh(new THREE.BoxGeometry(width*1.03,.18,.18),materials.dark);bumper.position.set(0,.28,length/2+.06);g.add(bumper);
    } else if(isTruck){
      const cargo=new THREE.Mesh(new THREE.BoxGeometry(width*.94,1.0,length*.48),mat(0xbab7ac));cargo.position.set(0,bodyY+.65,-length*.18);g.add(cargo);
      const cab=new THREE.Mesh(new THREE.BoxGeometry(width*.84,1.35,length*.4),bodyMat);cab.position.set(0,.95,length*.28);g.add(cab);
      const cabGlass=new THREE.Mesh(new THREE.BoxGeometry(width*.68,.5,.04),materials.glass);cabGlass.position.set(0,1.25,length*.48);g.add(cabGlass);
    } else {
      const cabin=new THREE.Mesh(new THREE.BoxGeometry(width*.82,1.2,length*.42),bodyMat);cabin.position.set(0,bodyY+.92,-.18);g.add(cabin);
      const wind=new THREE.Mesh(new THREE.BoxGeometry(width*.68,.48,.045),materials.glass);wind.position.set(0,bodyY+.72,length*.22);g.add(wind);
      const rearWind=new THREE.Mesh(new THREE.BoxGeometry(width*.64,.38,.04),materials.glass);rearWind.position.set(0,bodyY+.7,-length*.4);g.add(rearWind);
    }
    const wheelR=isBus?.34:(isTruck?.29:.25);
    for(const z of [-length*.32,length*.32])for(const x of [-width*.53,width*.53]){
      const wheel=new THREE.Mesh(new THREE.CylinderGeometry(wheelR,wheelR,.16,12),materials.tire);wheel.rotation.z=Math.PI/2;wheel.position.set(x,wheelR+.04,z);g.add(wheel);
    }
    const lampMat=new THREE.MeshStandardMaterial({color:0xfff1bd,emissive:0x9b5e1b});
    for(const x of [-width*.32,width*.32]){const lamp=new THREE.Mesh(new THREE.BoxGeometry(.25,.14,.05),lampMat);lamp.position.set(x,.55,length/2+.025);g.add(lamp);}
    g.userData={kind:'vehicle',vehicleType:isBus?'bus':(isTruck?'truck':'car'),halfWidth:width/2,depth:length,height:isBus?3.8:3.15};
    g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});return g;
  }
  function makeBarrier(){
    const g=new THREE.Group();const body=new THREE.Mesh(new THREE.BoxGeometry(1.75,.88,.48),mat(0xf0a52b));body.position.y=.48;g.add(body);
    for(let i=-2;i<=2;i++){const stripe=new THREE.Mesh(new THREE.BoxGeometry(.19,.9,.5),materials.white);stripe.position.set(i*.34,.48,.015);stripe.rotation.z=-.35;g.add(stripe);}
    for(const x of [-.62,.62]){const foot=new THREE.Mesh(new THREE.BoxGeometry(.25,.13,.7),materials.dark);foot.position.set(x,.065,0);g.add(foot);}
    g.userData={kind:'barrier',halfWidth:.88,depth:.48,height:1.0};g.traverse(o=>{if(o.isMesh)o.castShadow=true;});return g;
  }
  function registerTraffic(obj, laneIndex, z, options={}){
    obj.position.set(laneX[laneIndex],0,z);
    obj.userData.lane=laneIndex;
    // Each vehicle has its own relative pace: slower traffic catches up to the runner,
    // while faster traffic approaches more quickly, producing a less mechanical flow.
    obj.userData.pace=options.pace ?? (0.72+Math.random()*0.62);
    obj.userData.lateralDrift=options.drift ?? 0;
    obj.userData.baseX=laneX[laneIndex];
    obj.userData.phase=Math.random()*Math.PI*2;
    obj.userData.passed=false;
    obstacles.push(obj);scene.add(obj);
    return obj;
  }
  function spawnObstacle(){
    if(obstacles.length>18)return;
    // Never spawn a vehicle in the lane reserved by an approaching intersection.
    const available=[0,1,2].filter(i=>!(protectedLane===i && elapsed<protectionUntil));
    if(!available.length)return;
    const chosen=available[Math.floor(Math.random()*available.length)];
    const roll=Math.random();
    const obj=roll<.84?makeVehicle():makeBarrier();
    registerTraffic(obj,chosen,-93,{pace:.78+Math.random()*.52});
    // Linked traffic can occupy at most one additional lane. Keep the third lane
    // free and stagger followers so a convoy cannot become an unavoidable wall.
    if(Math.random()<.34 && obstacles.length<15){
      const followerLanes=available.filter(i=>i!==chosen);
      if(followerLanes.length && Math.random()<.78){
        const otherLane=followerLanes[Math.floor(Math.random()*followerLanes.length)];
        const follower=makeVehicle();
        registerTraffic(follower,otherLane,-108,{pace:.76+Math.random()*.58});
      }
    }
  }
  function spawnIntersection(){
    // A temporary bottleneck: two lanes are occupied by slow-moving traffic,
    // leaving one clear lane as the intended route through the junction.
    const openLane=Math.floor(Math.random()*3);
    const z=-106;
    // Protect the chosen lane long enough for the runner to see and reach it.
    protectedLane=openLane;
    protectionUntil=elapsed+Math.max(5.5, 106/Math.max(speed,13)+2.5);
    for(let i=0;i<3;i++){
      if(i===openLane) continue;
      const blocker=makeVehicle();
      blocker.scale.setScalar(i===((openLane+1)%3)?1.06:.96);
      registerTraffic(blocker,i,z+Math.random()*2,{pace:.56+Math.random()*.22});
      blocker.userData.kind='intersection-vehicle';
    }
    const sign=new THREE.Group();
    const postMat=mat(0x555b60);
    for(const x of [-3.55,3.55]){const post=new THREE.Mesh(new THREE.CylinderGeometry(.055,.07,3.7,7),postMat);post.position.set(x,1.85,0);sign.add(post);}
    const board=new THREE.Mesh(new THREE.BoxGeometry(7.35,.7,.18),mat(0x193e35));board.position.y=3.35;sign.add(board);
    const letters=new THREE.Mesh(new THREE.BoxGeometry(3.6,.12,.205),mat(0xffd64a));letters.position.set(0,3.38,.11);sign.add(letters);
    sign.position.z=z;sign.userData={kind:'intersection-sign'};sign.traverse(o=>{if(o.isMesh)o.castShadow=true;});obstacles.push(sign);scene.add(sign);
    showToast('TRAFFIC BOTTLENECK — FIND THE OPEN LANE');
  }
  function spawnCoinLine(){
    if(coins.length>24)return;
    const chosen=Math.floor(Math.random()*3), count=3+Math.floor(Math.random()*3);
    for(let i=0;i<count;i++){
      const coin=new THREE.Mesh(new THREE.TorusGeometry(.27,.09,8,16),materials.coin);coin.rotation.y=Math.PI/2;coin.position.set(laneX[chosen],1.15+(i%2)*.08,-88-i*2.15);coin.castShadow=true;
      coin.userData={lane:chosen,phase:Math.random()*Math.PI*2};coins.push(coin);scene.add(coin);
    }
  }
  function action(which){if(which==='left')moveLane(-1);if(which==='right')moveLane(1);if(which==='jump')jump();if(which==='duck')duck();}
  function moveLane(dir){lane=Math.max(0,Math.min(2,lane+dir));targetX=laneX[lane];}
  function jump(){if(!running||paused||ended||jumpY>.02||duckTimer>0)return;jumpVelocity=9.2;}
  function duck(){if(!running||paused||ended||jumpY>.2)return;duckTimer=.68;}
  function onKeyDown(e){const key=e.key.toLowerCase();if(['arrowleft','arrowright','arrowup','arrowdown',' '].includes(key))e.preventDefault();if(key==='escape'||key==='p'){if(running&&!ended)togglePause();return;}if(!running||paused||ended)return;if(key==='arrowleft'||key==='a')action('left');else if(key==='arrowright'||key==='d')action('right');else if(key==='arrowup'||key==='w'||key===' ')action('jump');else if(key==='arrowdown'||key==='s')action('duck');}
  function onKeyUp(e){if(e.key==='ArrowDown'||e.key.toLowerCase()==='s')duckTimer=Math.min(duckTimer,.18);}
  function startGame(){resetWorld();$('startScreen').classList.add('hidden');$('pauseScreen').classList.add('hidden');$('overScreen').classList.add('hidden');running=true;paused=false;ended=false;clock.getDelta();}
  function resetWorld(){obstacles.forEach(o=>scene.remove(o));coins.forEach(o=>scene.remove(o));particles.forEach(o=>scene.remove(o));obstacles=[];coins=[];particles=[];lane=1;targetX=0;player.position.set(0,0,1.2);jumpY=0;jumpVelocity=0;duckTimer=0;distance=0;coinCount=0;speed=13;elapsed=0;previousPlayerX=0;spawnTimer=.9;coinTimer=1.1;intersectionTimer=17;intersectionWarning=0;protectedLane=-1;protectionUntil=0;updateHud();}
  function resetGame(){startGame();}
  function togglePause(){if(!running||ended)return;paused=!paused;$('pauseScreen').classList.toggle('hidden',!paused);$('pauseBtn').textContent=paused?'▶':'Ⅱ';clock.getDelta();}
  function gameOver(){running=false;ended=true;$('finalDistance').textContent=Math.floor(distance)+' m';$('finalCoins').textContent=coinCount;$('overScreen').classList.remove('hidden');$('pauseBtn').textContent='Ⅱ';}
  function updateHud(){$('distance').textContent=Math.floor(distance);$('coins').textContent=coinCount;$('speed').textContent=(speed/13).toFixed(1);}
  function showToast(text){$('toast').textContent=text;$('toast').classList.add('show');toastTimer=.75;}
  function coinBurst(position){for(let i=0;i<7;i++){const p=new THREE.Mesh(new THREE.SphereGeometry(.045,6,5),materials.coin);p.position.copy(position);p.userData={velocity:new THREE.Vector3((Math.random()-.5)*2,1+Math.random()*2,(Math.random()-.5)*1.5),life:.45};particles.push(p);scene.add(p);}}

  function frame(now){requestAnimationFrame(frame);const dt=Math.min(clock.getDelta(),.035);if(!scene||!renderer)return;if(running&&!paused&&!ended)update(dt);renderer.render(scene,camera);}
  function update(dt){
    elapsed+=dt;
    // Distance uses the current speed; acceleration is smooth, capped, and tied to both time and distance.
    distance+=speed*dt*.72;
    speed=Math.min(32,13+elapsed*.14+distance*.0027);
    spawnTimer-=dt;coinTimer-=dt;intersectionTimer-=dt;duckTimer=Math.max(0,duckTimer-dt);
    if(protectedLane!==-1 && elapsed>=protectionUntil){protectedLane=-1;}
    if(intersectionTimer<=0){spawnIntersection();intersectionTimer=23+Math.random()*11;spawnTimer=Math.max(spawnTimer,3.8);}
    if(spawnTimer<=0){spawnObstacle();spawnTimer=Math.max(.92,1.85-(speed-13)*.025)+Math.random()*.5;}
    if(coinTimer<=0){spawnCoinLine();coinTimer=2.5+Math.random()*1.8;}
    roadSegments.forEach(g=>{g.position.z+=speed*dt;if(g.position.z>world.roadLength)g.position.z-=roadSegments.length*world.roadLength;});
    roadside.forEach(g=>{g.position.z+=speed*dt;if(g.position.z>12){g.position.z=-125-Math.random()*20;g.position.x=Math.sign(g.position.x)*(6.4+Math.random()*1.8);}});
    player.position.x+=(targetX-player.position.x)*Math.min(1,dt*12);
    jumpVelocity-=24*dt;jumpY+=jumpVelocity*dt;if(jumpY<0){jumpY=0;jumpVelocity=0;}player.position.y=jumpY;
    const runPhase=elapsed*(8+speed*.28);const airborne=jumpY>.08;
    // Stronger foot cycles, counter-swinging arms, and a small running bounce make the runner feel alive.
    leftLeg.rotation.x=airborne?-.82:Math.sin(runPhase)*.88;rightLeg.rotation.x=airborne?.52:-Math.sin(runPhase)*.88;
    leftArm.rotation.x=airborne?-1.02:-Math.sin(runPhase)*.68;rightArm.rotation.x=airborne?.88:Math.sin(runPhase)*.68;
    leftArm.rotation.z=duckTimer>0?-.12:Math.sin(runPhase)*.035;rightArm.rotation.z=duckTimer>0?.12:-Math.sin(runPhase)*.035;
    torso.rotation.x=duckTimer>0?-.62:(airborne?-.16:Math.sin(runPhase*2)*.035);
    torso.position.y=(!airborne&&duckTimer<=0)?Math.abs(Math.sin(runPhase*2))*.045:0;
    head.rotation.x=duckTimer>0?.2:(airborne?-.04:Math.sin(runPhase*2)*.012);
    player.scale.y=duckTimer>0?.72:1;player.position.y=jumpY+(duckTimer>0?-.22:0);
    const lateralVelocity=(player.position.x-previousPlayerX)/Math.max(dt,.001);
    player.rotation.z=THREE.MathUtils.clamp(-lateralVelocity*.035,-.22,.22)-(targetX-player.position.x)*.035;
    previousPlayerX=player.position.x;
    camera.position.x+=(player.position.x*.14-camera.position.x)*Math.min(1,dt*2.4);
    camera.position.y=5.4+Math.sin(runPhase*2)*.035+(speed-13)*.012;
    camera.lookAt(player.position.x*.13,1.3,-7);

    for(let i=obstacles.length-1;i>=0;i--){const o=obstacles[i];
      const pace=o.userData.pace ?? 1;
      o.position.z+=speed*pace*dt;
      // Traffic has subtle independent steering/suspension motion instead of moving as a rigid wall.
      if(o.userData.kind==='vehicle'||o.userData.kind==='bus'||o.userData.kind==='intersection-vehicle'){
        o.rotation.y=Math.sin(elapsed*(1.1+pace)+o.userData.phase)*.012;
        o.position.x=o.userData.baseX+Math.sin(elapsed*.65+o.userData.phase)*o.userData.lateralDrift;
      }
      if(o.userData.kind==='intersection-sign'){if(o.position.z>13){scene.remove(o);obstacles.splice(i,1);}continue;}
      const closeZ=Math.abs(o.position.z-player.position.z)<(o.userData.depth/2+.65);
      const closeX=Math.abs(o.position.x-player.position.x)<(o.userData.halfWidth+.34);
      let hitHeight=true;if(o.userData.kind==='barrier'&&jumpY>.8)hitHeight=false;if(o.userData.kind==='intersection'&&jumpY>.95)hitHeight=false;
      if(closeZ&&closeX&&hitHeight){gameOver();return;}
      if(o.position.z>13){scene.remove(o);obstacles.splice(i,1);}
    }
    for(let i=coins.length-1;i>=0;i--){const c=coins[i];c.position.z+=speed*dt;c.rotation.z+=dt*2.8;c.position.y=1.15+Math.sin(elapsed*4+c.userData.phase)*.12;
      if(Math.abs(c.position.z-player.position.z)<1.25&&Math.abs(c.position.x-player.position.x)<.8&&Math.abs(c.position.y-(player.position.y+1.1))<1.35){coinCount++;coinBurst(c.position);scene.remove(c);coins.splice(i,1);showToast('+1 COIN');continue;}
      if(c.position.z>12){scene.remove(c);coins.splice(i,1);}
    }
    for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.userData.life-=dt;p.position.addScaledVector(p.userData.velocity,dt);p.userData.velocity.y-=4*dt;if(p.userData.life<=0){scene.remove(p);particles.splice(i,1);}}
    if(toastTimer>0){toastTimer-=dt;if(toastTimer<=0)$('toast').classList.remove('show');}
    updateHud();
  }
  function onResize(){
    if(!camera||!renderer)return;
    const width=window.visualViewport ? window.visualViewport.width : innerWidth;
    const height=window.visualViewport ? window.visualViewport.height : innerHeight;
    camera.aspect=width/height;
    camera.fov=width<650?(height>width?66:61):57;
    camera.position.z=width<650?(height>width?12.2:11.2):10.6;
    camera.updateProjectionMatrix();
    renderer.setSize(width,height,false);
  }

  init();
})();
