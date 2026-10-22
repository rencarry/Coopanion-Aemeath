import { createFlight, animationFrame } from './flight.js';
import { createSongPlayer } from './songs.js';

const TOUCH_TONES = { poke: 'grab', grab: 'grab', drop: 'pop' };

export async function createPixelFlight(base, { host, model, loadImage, asset }) {
  const images = Object.fromEntries(await Promise.all(Object.entries(model.clips).map(async ([key, clip]) =>
    [key, await loadImage(asset(clip.sheet))])));
  const canvas = host.root.ownerDocument.createElement('canvas');
  canvas.width = canvas.height = 256;
  Object.assign(canvas.style, { position: 'absolute', width: '0', height: '0', pointerEvents: 'none', imageRendering: 'pixelated' });
  host.root.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  let soundReadyAt = 0, pendingVoice = null, music = null, quietDance = false, musicPress = null, lastMusicTap = null;
  const soundIndexes = new Map();
  function playVoice(voice,now) {
    const list=Array.isArray(voice.choices)?voice.choices:[voice.choices];
    const index=soundIndexes.get(list.join(','))??0;
    const name=list[index%list.length];
    soundIndexes.set(list.join(','),index+1);
    soundReadyAt=now+3.15;
    host.sound(name,voice.kind);
  }
  const flight = createFlight({ clips:model.clips, clipDurations:Object.fromEntries(Object.entries(model.clips).map(([key,clip])=>[key,clip.durationMs/1000])), footY: Object.fromEntries(Object.entries(model.clips).map(([key,clip])=>[key,clip.footY])), bounds: host.bounds, emit: host.emit, startX: host.start?.x,
    sound(cue) {
      if(TOUCH_TONES[cue]) host.sound(TOUCH_TONES[cue],'touch');
      const choices=model.soundCues?.[cue], now=flight.visual().time;
      // The click tone precedes the expression cue; only the latter replaces the pending voice.
      if(cue==='poke')return;
      pendingVoice=null;
      if(quietDance || music?.busy() || !choices)return;
      const voice={choices,kind:['head','body','wing','grab','drop','pet'].includes(cue)?'touch':['fly','dash','ascend','descend','look','dance'].includes(cue)?'move':'face'};
      if(now < soundReadyAt) pendingVoice=voice;
      else playVoice(voice,now);
    } });
  music = createSongPlayer({ tracks: model.songs, sound: host.sound, emit: host.emit,
    start() {
      quietDance = true;
      try { return flight.setSinging(true); }
      finally { quietDance = false; }
    },
    finish: () => flight.setSinging(false),
    stopSound: host.musicControl === true ? () => host.sound('__music_stop__','move') : null,
  });
  function heart(cx,cy,scale,alpha) {
    const rows=['0110110','1111111','1111111','0111110','0011100','0001000'];
    ctx.globalAlpha=alpha; ctx.fillStyle='#ed84b2';
    rows.forEach((row,y)=>[...row].forEach((v,x)=>{if(v==='1')ctx.fillRect(cx+(x-3)*scale,cy+y*scale,scale,scale);}));
    ctx.globalAlpha=1;
  }
  function draw() {
    const l = flight.layout();
    const view=flight.visual(), key=view.clip;
    const clip = model.clips[key];
    const frame = animationFrame(clip,view);
    ctx.clearRect(0, 0, 256, 256);
    ctx.save(); ctx.translate(128,128-view.lift); ctx.rotate(view.tilt);
    if(view.mode==='faint')ctx.globalAlpha=.65;
    ctx.drawImage(images[key], frame.x, frame.y, 256, 256, -128, -128, 256, 256);
    ctx.restore();
    if(view.mark==='heart') {
      for(let i=0;i<3;i++){const age=(view.time*.65+i/3)%1;heart(67+i*58,65-age*45,1.5,Math.sin(age*Math.PI));}
    } else if(view.mark==='think') {
      for(let i=0;i<3;i++){ctx.globalAlpha=.35+.65*(.5+.5*Math.sin(view.time*5-i));ctx.fillStyle='#ba8bba';ctx.fillRect(110+i*15,14,7,7);}ctx.globalAlpha=1;
    } else if(view.mark==='listen') {
      ctx.strokeStyle='#d18fb5';ctx.lineWidth=3;
      for(const side of [-1,1])for(let i=0;i<2;i++){ctx.globalAlpha=.35+.65*(.5+.5*Math.sin(view.time*4-i));const xx=128+side*(58+i*10);ctx.beginPath();ctx.moveTo(xx,72);ctx.lineTo(xx+side*5,80);ctx.lineTo(xx+side*5,93);ctx.lineTo(xx,101);ctx.stroke();}ctx.globalAlpha=1;
    } else if(view.mark==='look') {
      ctx.fillStyle='#c88dac';ctx.fillRect(126+Math.round(Math.sin(view.time*2)*15),15,4,4);
    } else if(view.mark==='faint') {
      ctx.fillStyle='#a28bab';for(let i=0;i<3;i++){const xx=110+i*15,yy=20+Math.sin(view.time*4+i)*3;ctx.fillRect(xx,yy,7,2);ctx.fillRect(xx+2,yy-2,2,7);}
    }
    Object.assign(canvas.style, { width: `${l.box.w}px`, height: `${l.box.h}px`, transform: `translate(${l.box.x}px,${l.box.y}px)` });
  }
  draw();
  return {
    ...flight,
    words: [...flight.words, ...music.words],
    layout() { return { ...flight.layout(), handlesDoubleClick: host.musicControl === true && music.busy() }; },
    pointer(type, p) {
      if (type === 'down') {
        flight.pointer(type, p);
        musicPress = host.musicControl === true && music.busy() && flight.layout().pressing
          ? { x:p.x, y:p.y, dragged:false } : null;
        return;
      }
      if (type === 'move' && musicPress && Math.hypot(p.x-musicPress.x,p.y-musicPress.y)>4) {
        musicPress.dragged = true; lastMusicTap = null;
      }
      if (type === 'up' && musicPress && !musicPress.dragged) {
        flight.pointer('cancel', p); musicPress = null;
        const now = performance.now()/1000;
        if (lastMusicTap && now-lastMusicTap.at<=.35 && Math.hypot(p.x-lastMusicTap.x,p.y-lastMusicTap.y)<=10) {
          lastMusicTap = null; pendingVoice = null; music.request('stop-singing');
        } else lastMusicTap = { x:p.x, y:p.y, at:now };
        return;
      }
      if (type === 'up' || type === 'cancel') { musicPress = null; lastMusicTap = null; }
      flight.pointer(type, p);
    },
    do(word) {
      if (!music.words.includes(word)) return flight.do(word);
      if (flight.layout().pressing && word !== 'stop-singing') return false;
      const accepted = music.request(word, Math.max(0, soundReadyAt - flight.visual().time));
      if (accepted) { pendingVoice = null; lastMusicTap = null; }
      return accepted;
    },
    step(dt) {
      const elapsed = Math.max(0, Math.min(dt, .1)); flight.step(elapsed);
      const now=flight.visual().time;
      music.step();
      if(pendingVoice && !music.busy() && now >= soundReadyAt) { const voice=pendingVoice;pendingVoice=null;playVoice(voice,now); }
      draw();
    },
    set(state) { if(state.listening||state.thinking||state.dialogOpen)pendingVoice=null;flight.set(state); },
    cue(kind) { if (kind === 'cheer') flight.do('happy'); },
    setScheme() {},
    z: '#ed94bd',
    dispose() { pendingVoice=null;music.dispose();canvas.remove(); },
  };
}
