// Positions use stage pixels; the API 2 adapter owns rendering and host messages.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function animationFrame(clip, view) {
  let at = view.loop ? (view.animationTime * 1000) % clip.durationMs
    : Math.min(view.animationTime * 1000, clip.durationMs - .001);
  let index = 0;
  while (index < clip.frames.length - 1 && at >= clip.frames[index].durationMs) at -= clip.frames[index++].durationMs;
  return clip.frames[index];
}

export function createFlight({ bounds, emit = () => {}, sound = () => {}, random = Math.random, clock = () => performance.now()/1000, startX, footY = {}, clipDurations = {}, clips = {} }) {
  let time = 0, idleTime = 0, route = null, press = null, gesture = null;
  let roam = 'off', holdUntil = 0, nextRoam = 5, dialogOpen = false, listening = false, thinking = false;
  let x = startX ?? bounds().W / 2, y = bounds().H * .45, hovered = false;
  let feedback = null, petAt = -Infinity, stroke = 0, lastPointer = null;
  let clickIndex = 0;
  let talkingUntil = 0, thoughtShown = true, nextIdle = 8, automaticRest = false;
  let nextDanceAt = Infinity, perch = null, restStarted = 0;
  let hoverOffset = 0, flightStartedAt = 0, singing = false, songDanceStart = 0;
  const flyPeriod = (clips.fly?.durationMs ?? 880) / 1000;
  const hoverPeriod = (clips['hover-wide']?.durationMs ?? 1760) / 1000;
  const frameMiddle = (clip, index, fallback) => clip
    ? (clip.frames.slice(0,index).reduce((sum,frame)=>sum+frame.durationMs,0)+clip.frames[index].durationMs/2)/1000 : fallback;
  // These original poses have matching head and foot positions; keep the source artwork intact.
  const flyJoin = frameMiddle(clips.fly,6,.715);
  const hoverJoin = frameMiddle(clips['hover-wide'],8,.935);
  const actionClips = {happy:'happy',excited:'excited',flustered:'flustered',love:'happy',dance:'dance',rest:'rest',faint:'rest'};
  const defaultDurations = {happy:.88,excited:.77,flustered:.77,love:.88,dance:1.48,rest:2.75,faint:2.75};
  const actionDuration = word => clipDurations[actionClips[word]] ?? defaultDurations[word] ?? 2;
  const joins = { happy:[6,8], excited:[5,13], flustered:[6,8], rest:[3,8], dance:[0,8] };
  const periodFor = clip => (clips[clip]?.durationMs ?? ({happy:880,excited:770,flustered:770,rest:2750,dance:1480}[clip] ?? 1760))/1000;
  const joinFor = clip => frameMiddle(clips[clip],joins[clip]?.[0] ?? 0,({happy:.715,excited:.605,flustered:.715,rest:.385,dance:.02}[clip] ?? 0));
  function returnHover(clip) {
    if(!joins[clip]) return;
    const index=joins[clip]?.[1] ?? 8;
    hoverOffset=frameMiddle(clips['hover-wide'],index,index===13?1.485:.935)-time*1.875;
  }
  function startPet() {
    wake();
    if(gesture && !['fly','dash','ascend','descend'].includes(gesture.word)) finishGesture();
    const phase=((time*1.875+hoverOffset)%hoverPeriod+hoverPeriod)%hoverPeriod;
    const delay=((hoverJoin-phase+hoverPeriod)%hoverPeriod)/1.875;
    const period=periodFor('happy');
    react('pet',delay+Math.ceil(2.2/period)*period,true,true);
    Object.assign(feedback,{delay,phase:joinFor('happy'),rate:1});
  }
  function continuePet() {
    const period=periodFor('happy'),start=feedback.start+feedback.delay;
    feedback.until=Math.max(feedback.until,start+Math.ceil((time+.35-start)/period)*period);
  }
  const idleDelay = () => 6 + random() * 3;
  const flightDelay = () => 8 + random() * 7;
  function pauseActivity() {
    nextIdle = time + idleDelay();
    nextRoam = time + flightDelay();
  }
  function perchTarget(edge) {
    const a = area(), margin = a.size / 2;
    if (![edge.x0, edge.x1, edge.y].every(Number.isFinite)) return null;
    const left = Math.max(a.left, edge.x0 + margin), right = Math.min(a.right, edge.x1 - margin);
    const idleFoot = clips['hover-wide']?.frames[8].footY ?? clips.idle?.frames[0].footY ?? footY.idle ?? 225;
    const feet = Object.values(clips).flatMap(clip => clip.frames.map(frame => frame.footY));
    // Every supported pose must fit above and below the edge without clamping the feet away from it.
    if (feet.length && (edge.y-(Math.max(...feet)-128)*a.size/256<a.top || edge.y-(Math.min(...feet)-128)*a.size/256>a.bottom)) return null;
    const ty = edge.y - (idleFoot - 128) * a.size / 256;
    return left <= right && ty >= a.top && ty <= a.bottom
      ? { x: clamp(x, left, right), y: ty } : null;
  }
  function hasPerch(edge) {
    const half = area().size / 2;
    return bounds().ledges?.some(e => Math.abs(e.y-edge.y)<.01 && e.x0<=edge.x-half && e.x1>=edge.x+half);
  }
  function move({ to, run = false, params = {} }, id) {
    if (press) return false;
    if (to === 'point') {
      const px=params.x ?? .5, py=params.y ?? .5;
      if (![px,py].every(v=>Number.isFinite(v)&&v>=0&&v<=1)) return false;
      const a=area();
      return flyTo(a.left+px*(a.right-a.left), a.top+py*(a.bottom-a.top),run,id);
    }
    if (to !== 'window-top') return false;
    const targets=(bounds().ledges ?? []).map(edge=>({edge,target:perchTarget(edge)})).filter(v=>v.target);
    const current=position();
    targets.sort((a,b)=>Math.hypot(a.target.x-current.x,a.target.y-current.y)-Math.hypot(b.target.x-current.x,b.target.y-current.y));
    if (!targets.length) {
      interrupt('replaced'); finishGesture(); pauseActivity();
      emit('interrupted',{walkId:id,x:Math.round(x),by:'no-window'});
      return true;
    }
    const {edge,target}=targets[0];
    const ok=flyTo(target.x,target.y,run,id);
    if (ok) {
      const destination={...edge,x:target.x};
      if(route) route.perch=destination;
      else perch=destination;
    }
    return ok;
  }
  const scheduleDance = () => { nextDanceAt = clock() + 105 + random() * 30; };

  function react(kind, duration, audible = true, loop = false) {
    const clip=actionClips[kind];
    const period=clip ? periodFor(clip) : duration;
    feedback = { kind, start: time, until: time + duration, loop:loop || !!clip,
      phase:clip?joinFor(clip):0,rate:clip&&loop?Math.max(1,Math.round(duration/period))*period/duration:1 };
    if(audible) sound(kind);
  }
  function wake() {
    if (gesture?.word === 'rest') finishGesture();
    automaticRest = false;
    nextIdle = time + idleDelay();
  }

  function area() {
    const { W, H, S } = bounds();
    const size = Math.max(0, Math.min(256 * S, W - 16, H - 16));
    const half = size / 2;
    return { W, H, size, left: half + 8, right: Math.max(half + 8, W - half - 8),
      top: half + 8, bottom: Math.max(half + 8, H - half - 8) };
  }
  function position() {
    const a = area();
    if (perch && !press && !route) {
      const view=visual(), clip=clips[view.clip];
      const foot=clip ? animationFrame(clip,view).footY : footY[view.clip] ?? 225;
      return {x,y:clamp(perch.y-(Math.cos(view.tilt)*(foot-128)-view.lift)*a.size/256,a.top,a.bottom)};
    }
    const bob = !press && !route ? Math.sin(idleTime * 2.2) * Math.min(3, a.size / 80) : 0;
    return { x, y: clamp(y + bob, a.top, a.bottom) };
  }
  function settle() {
    y = position().y;
    idleTime = 0;
    nextRoam = time + flightDelay();
  }
  function interrupt(by) {
    if (route?.id != null) emit('interrupted', { walkId: route.id, x: Math.round(x), by });
    route = null;
  }
  function finishGesture() {
    if (gesture) emit('done', { word: gesture.word });
    gesture = null;
  }
  function flyTo(tx, ty, run = false, id = null, cue = run ? 'dash' : 'fly') {
    if (press) return false;
    settle();
    automaticRest = false; feedback = null;
    perch = null;
    interrupt('replaced');
    finishGesture();
    const a = area();
    tx = clamp(tx, a.left, a.right); ty = clamp(ty, a.top, a.bottom);
    const distance = Math.hypot(tx - x, ty - y);
    if (distance < .5) {
      x = tx; y = ty;
      if (id != null) emit('arrived', { walkId: id, x: Math.round(x) });
      return true;
    }
    sound(cue);
    const phase = ((time*1.875+hoverOffset)%hoverPeriod+hoverPeriod)%hoverPeriod;
    const delay = ((hoverJoin-phase+hoverPeriod)%hoverPeriod)/1.875;
    flightStartedAt=time+delay;
    const travel = Math.min(24, Math.max(run ? 1.5 : 3, distance / (run ? 180 : 100)));
    route = { delay, fromX: x, fromY: y, x: tx, y: ty, elapsed: 0,
      duration: Math.ceil(travel/flyPeriod)*flyPeriod, id };
    emit('mode', { mode: 'fly' });
    return true;
  }
  function resize() {
    if (perch) { y=position().y; idleTime=0; }
    if (route?.perch) { interrupt('resize'); finishGesture(); }
    perch = null;
    const a = area();
    x = clamp(x, a.left, a.right); y = clamp(y, a.top, a.bottom);
    if (route) {
      const delay=Math.max(0,route.delay-route.elapsed);
      const remaining=Math.max(.45,route.duration-Math.max(0,route.elapsed-route.delay));
      const phase=((time+delay-flightStartedAt)%flyPeriod+flyPeriod)%flyPeriod;
      const toJoin=(flyPeriod-phase)%flyPeriod;
      const duration=toJoin+Math.max(0,Math.ceil((remaining-toJoin)/flyPeriod))*flyPeriod;
      route = { ...route, fromX: x, fromY: y, x: clamp(route.x, a.left, a.right),
        y: clamp(route.y, a.top, a.bottom), elapsed: 0, delay, duration };
    }
  }
  resize();

  const words = ['hover', 'ascend', 'descend', 'fly', 'dash', 'happy', 'excited', 'dance', 'rest', 'flustered', 'love', 'look', 'faint'];
  function doWord(word) {
    if (!words.includes(word) || press) return false;
    if(word==='dance' && roam!=='off') scheduleDance();
    automaticRest = false;
    feedback = null;
    nextIdle = time + idleDelay();
    if (word === 'ascend' || word === 'descend') {
      const a = area();
      const ok = flyTo(x, y + (word === 'ascend' ? -1 : 1) * Math.max(48, a.size * .7), false, null, word);
      if (route) gesture = { word, start:time, until: Infinity };
      else emit('done', { word });
      return ok;
    }
    if (word === 'fly' || word === 'dash') {
      const a = area();
      flyTo(a.left + random() * (a.right - a.left), a.top + random() * (a.bottom - a.top), word === 'dash');
      if (route) gesture = { word, start:time, until: Infinity };
      else emit('done', { word });
      return true;
    }
    sound(word);
    settle(); interrupt('action'); finishGesture();
    if (word !== 'hover') gesture = { word, start:time, until:time+actionDuration(word), phase:joinFor(actionClips[word]) };
    emit('mode', { mode: word === 'rest' ? 'sleep' : word === 'hover' ? 'idle' : word });
    return true;
  }
  function step(dt) {
    dt = Math.max(0, Math.min(dt, .1));
    time += dt;
    if (route?.perch && !hasPerch(route.perch)) {
      interrupt('window-gone'); finishGesture(); pauseActivity();
    }
    if (perch && !hasPerch(perch)) { y=position().y; perch=null; idleTime=0; pauseActivity(); }
    if (route && !press) {
      route.elapsed += dt;
      const k = Math.max(0, Math.min(1, (route.elapsed-route.delay) / route.duration)), ease = k * k * k * (k * (k * 6 - 15) + 10);
      x = route.fromX + (route.x - route.fromX) * ease;
      y = route.fromY + (route.y - route.fromY) * ease;
      if (k === 1) {
        const id = route.id;
        perch = route.perch ?? null;
        hoverOffset=hoverJoin-time*1.875;
        route = null; idleTime = 0; nextRoam = time + flightDelay(); nextIdle=Math.max(nextIdle,time+3);
        if (id != null) emit('arrived', { walkId: id, x: Math.round(x) });
        finishGesture(); emit('mode', { mode: 'idle' });
      }
    } else idleTime += dt;
    if (feedback && time >= feedback.until) {
      const ended=feedback.kind;feedback=null;returnHover(actionClips[ended] ?? (ended==='pet'?'happy':'idle'));
      if(ended==='pet') pauseActivity();
    }
    if (gesture && time >= gesture.until) { const clip=actionClips[gesture.word];finishGesture();returnHover(clip);emit('mode', { mode: visual().mode }); }
    const free = !singing && !route && !press && !gesture && !feedback && time >= talkingUntil && roam !== 'off' && !dialogOpen && !listening && !thinking && time >= holdUntil;
    if(free && clock() >= nextDanceAt) {
      automaticRest=false;
      react('dance',actionDuration('dance'));
      scheduleDance();
      pauseActivity();
      return;
    }
    if (free && automaticRest && time >= nextIdle) { automaticRest = false; returnHover('rest');pauseActivity(); }
    if (free && !automaticRest && time >= nextRoam) {
      const a = area(), range = roam === 'calm' ? .22 : 1;
      const split=a.top+(a.bottom-a.top)*.45;
      const targetY=random()<.8 ? a.top+random()*(split-a.top) : split+random()*(a.bottom-split);
      const reach=(a.bottom-a.top)*range/2;
      flyTo(clamp(x + (random() - .5) * (a.right - a.left) * range, a.left, a.right),
        roam==='calm' ? clamp(targetY,Math.max(a.top,y-reach),Math.min(a.bottom,y+reach)) : targetY);
      nextRoam = time + flightDelay();
    } else if (free && !automaticRest && time >= nextIdle) {
      const pick = random();
      if (pick < .55) react('look', 2);
      else if (pick < .65) react('happy', actionDuration('happy'), false);
      else { automaticRest = true; restStarted=time; nextIdle = time + 10 + random() * 5; nextRoam=Math.max(nextRoam,nextIdle+flightDelay()); sound('rest'); }
      if (!automaticRest) { nextIdle = feedback.until + idleDelay(); }
    }
  }
  function visual() {
    const departing=route && route.elapsed<route.delay;
    const petPreparing=feedback?.kind==='pet' && time-feedback.start<feedback.delay;
    const mode = press?.dragging ? 'drag' : feedback?.kind ?? (gesture && !['fly','dash','ascend','descend'].includes(gesture.word) ? gesture.word
      : route ? 'fly' : singing ? 'dance' : time < talkingUntil ? 'talk' : listening ? 'listening' : thinking && thoughtShown ? 'thinking' : automaticRest ? 'rest' : 'idle');
    const age = feedback ? time - feedback.start : 0, k = feedback ? age / (feedback.until - feedback.start) : 0;
    const pulse = feedback ? Math.sin(Math.PI * k) : 0;
    const clip = mode === 'drag' ? 'grab' : mode === 'rest' || mode === 'faint' ? 'rest' : mode === 'dance' ? 'dance'
      : mode === 'flustered' || mode === 'wing' ? 'flustered' : mode === 'excited' ? 'excited'
      : mode==='pet' && petPreparing ? 'hover-wide' : ['happy','love','head','body','pet','talk'].includes(mode) ? 'happy' : mode === 'fly' ? (departing?'hover-wide':'fly') : ['idle','look','listening','thinking'].includes(mode) ? 'hover-wide' : 'idle';
    const hovering=['idle','look','listening','thinking'].includes(mode) || (mode==='fly' && departing) || petPreparing;
    const animationTime=singing && mode==='dance' ? time-songDanceStart+joinFor('dance') : hovering?time*1.875+hoverOffset:mode==='fly'?time-flightStartedAt+flyJoin
      : feedback?(time-feedback.start-(feedback.delay??0))*(feedback.rate??1)+(feedback.phase??0)
      : gesture?time-gesture.start+(gesture.phase??0):time-(automaticRest?restStarted:0);
    const lookAction=feedback?.kind==='look'?feedback:gesture?.word==='look'?gesture:null;
    const lookProgress=lookAction?Math.max(0,Math.min(1,(time-lookAction.start)/(lookAction.until-lookAction.start))):0;
    return { mode, clip, time, animationTime, loop:singing && mode==='dance' || hovering || !!feedback?.loop || !!gesture&&!!actionClips[gesture.word] || ['fly','drag','talk'].includes(mode),
      tilt: mode === 'head' ? Math.sin(k * Math.PI * 4) * pulse * .035 : mode === 'look' ? Math.sin((time-(lookAction?.start??time))*2)*.025*Math.sin(Math.PI*lookProgress) : 0,
      lift: (clip==='rest'?10:0)+(mode === 'body' ? pulse * 8 : mode === 'talk' ? Math.abs(Math.sin(time * 11)) * 1.3 : 0),
      mark: ['love','pet'].includes(mode) ? 'heart' : mode === 'listening' ? 'listen' : mode === 'thinking' ? 'think' : mode === 'look' ? 'look' : mode==='faint' ? 'faint' : null };
  }
  function layout() {
    const a = area(), p = position(), r = a.size / 2, v=visual();
    const c=Math.cos(v.tilt), s=Math.sin(v.tilt), scale=a.size/256;
    return { x: p.x, facing: 1, mode: v.mode === 'rest' ? 'sleep' : v.mode,
      busy: !!press, moving: true, pressing: !!press, cursor: press ? 'grabbing' : hovered ? 'grab' : '',
      box: { x: p.x - r, y: p.y - r, w: a.size, h: a.size },
      hit: [[128,90,52],[128,177,42],[62,174,32],[194,174,32]].map(([cx,cy,cr]) => ({x:p.x+((cx-128)*c-(cy-128)*s)*scale,y:p.y+((cx-128)*s+(cy-128)*c-v.lift)*scale,r:cr*scale})),
      bubble: { x: p.x, y: p.y - r * .9 }, side: { x: p.x, y: p.y, reach: r * .9 } };
  }
  function hit(p) { return layout().hit.some(c => Math.hypot(p.x-c.x,p.y-c.y) <= c.r); }
  function zone(p) {
    const b=layout().box, view=visual(), dx=(p.x-b.x)/b.w*256-128, dy=(p.y-b.y)/b.h*256-128+view.lift;
    const c=Math.cos(view.tilt),s=Math.sin(view.tilt),u=dx*c+dy*s+128,v=-dx*s+dy*c+128;
    return v < 142 && u > 72 && u < 184 ? 'head' : u < 88 || u > 168 ? 'wing' : 'body';
  }
  function pointer(type, p) {
    if (type === 'leave') { hovered = false; lastPointer = null; stroke = 0; return; }
    if (type === 'down' && hit(p)) {
      const part=zone(p);
      settle();
      press = { x: p.x, y: p.y, dx: p.x - x, dy: p.y - y, dragging: false, part };
      stroke = 0;
    } else if (type === 'move') {
      hovered = hit(p);
      if (press) {
        if (!press.dragging && Math.hypot(p.x - press.x, p.y - press.y) > 4) {
          press.dragging = true;
          perch=null; interrupt('drag'); finishGesture(); feedback=null; automaticRest=false;
          sound('grab');
          emit('touch', { kind: 'grab' }); emit('mode', { mode: 'drag' });
        }
        if (press.dragging) {
          const a = area();
          x = clamp(p.x - press.dx, a.left, a.right); y = clamp(p.y - press.dy, a.top, a.bottom);
        }
      } else if (hovered && lastPointer && time-lastPointer.time < .25) {
        const distance=Math.hypot(p.x-lastPointer.x,p.y-lastPointer.y);
        if (feedback?.kind==='pet') {
          if(distance>1) continuePet();
        } else if (time-petAt>2.5) {
          stroke+=Math.min(30,distance);
          if(stroke>=area().size*1.2) {
            stroke=0;petAt=time;startPet();emit('touch',{kind:'pet'});
          }
        }
      } else if (!hovered) stroke=0;
      lastPointer = {x:p.x,y:p.y,time};
    } else if ((type === 'up' || type === 'cancel') && press) {
      if (press.dragging && type === 'up') pointer('move', p);
      const dragged = press.dragging, part=press.part;
      press = null; idleTime = 0; nextRoam = time + flightDelay(); nextIdle = time + idleDelay();
      if (dragged) { sound('drop'); emit('touch', { kind: 'drop', x: Math.round(x) }); }
      else if (type === 'up') {
        sound('poke');
        wake();
        if(gesture && !['fly','dash','ascend','descend'].includes(gesture.word)) finishGesture();
        const actions=['happy','excited','flustered','love','faint'];
        const action=actions[clickIndex];
        clickIndex=(clickIndex+1)%actions.length;
        react(action,3,true,true);
        emit('touch', { kind: 'poke', part, action });
      }
      emit('mode', { mode: visual().mode });
    }
  }
  return {
    step, layout, visual, resize, words, do: doWord, pointer, move,
    setSinging(active) {
      if (active) {
        if (!doWord('dance')) return false;
        singing = true; songDanceStart = time;
      } else if (singing) {
        singing = false;
        if (gesture?.word === 'dance') finishGesture();
        returnHover('dance'); pauseActivity();
        if (roam !== 'off') scheduleDance();
        emit('mode', { mode: visual().mode });
      }
      return true;
    },
    walk: (tx, run, id) => flyTo(tx, position().y, run, id),
    stopWalk(id) { if (route?.id === id) { interrupt('stop'); idleTime = 0; finishGesture(); } },
    drop(p) {
      if (!press) return;
      const a = area();
      x = clamp(p.x - press.dx, a.left, a.right); y = clamp(p.y - press.dy, a.top, a.bottom);
      press = null; idleTime = 0; nextRoam = time + flightDelay(); nextIdle = time + idleDelay();
      sound('drop');
      emit('touch', { kind: 'drop', x: Math.round(x) }); emit('mode', { mode: 'idle' });
    },
    shift(dx, dy) { if (press) { x += dx; y += dy; press.x += dx; press.y += dy; } },
    place(tx) { if (!press) { settle(); interrupt('place'); x = tx; resize(); } },
    set(s) {
      if (s.roam) {
        if(roam==='off' && s.roam!=='off') scheduleDance();
        roam = s.roam; nextRoam = time + flightDelay(); nextIdle=time+idleDelay();
        if(roam==='off') { automaticRest=false; nextDanceAt=Infinity; }
      }
      if (typeof s.hold === 'number') holdUntil = Math.max(holdUntil, time + s.hold);
      if (typeof s.dialogOpen === 'boolean') dialogOpen = s.dialogOpen;
      if (typeof s.listening === 'boolean') listening = s.listening;
      if (typeof s.thinking === 'boolean') thinking = s.thinking;
      if (typeof s.thoughtShown === 'boolean') thoughtShown = s.thoughtShown;
      if (listening || thinking || dialogOpen) { if(feedback?.kind==='pet') {feedback=null;returnHover('happy');} if(automaticRest) automaticRest=false; nextIdle=time+idleDelay(); }
      if (listening) wake();
    },
    talk() { if(time >= talkingUntil) wake(); talkingUntil=time+.3; },
  };
}
