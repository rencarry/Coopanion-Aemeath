// A controllable host owns the exclusive music source; legacy hosts finish songs naturally.
export function createSongPlayer({ tracks = [], sound, emit = () => {}, start = () => true,
  finish = () => {}, stopSound = null, clock = () => performance.now() / 1000, random = Math.random }) {
  const byId = new Map(tracks.map(track => [track.id, track]));
  const words = tracks.length ? ['sing', ...byId.keys(), ...(stopSound ? ['stop-singing'] : [])] : [];
  let pending = null, playing = null, last = null, disposed = false;
  function end(stop = false) {
    const word = playing?.word ?? pending?.word;
    if (stop && stopSound) stopSound();
    pending = playing = null;
    finish();
    if (word) emit('done', { word });
  }
  function step() {
    if (disposed) return;
    const now = clock();
    if (playing && now >= playing.until) end();
    if (!pending || now < pending.readyAt) return;
    const request = pending; pending = null;
    if (!start()) { emit('done', { word: request.word }); return; }
    last = request.track.id;
    playing = { word: request.word, until: now + request.track.seconds + .5 };
    sound(request.track.sound, 'move', ...(stopSound ? [true] : []));
  }
  return {
    words,
    busy: () => !!pending || !!playing,
    request(word, delay = 0) {
      if (disposed || !words.includes(word)) return false;
      if (word === 'stop-singing') { end(true); return true; }
      step();
      if (pending || playing) { if (!stopSound) return false; end(true); }
      let track = byId.get(word);
      if (word === 'sing') {
        const choices = tracks.length > 1 ? tracks.filter(track => track.id !== last) : tracks;
        track = choices[Math.floor(random() * choices.length)];
      }
      pending = { word, track, readyAt: clock() + delay };
      step(); return true;
    },
    step,
    dispose() { if (playing || pending) end(!!stopSound); disposed = true; },
  };
}
