// Runs in Meet's own page (MAIN world) before Meet asks for the microphone.
// When the Pipe Up voice is set up, it hands Meet a microphone track that
// mixes the real microphone with Pipe Up's locally synthesized voice, so other
// participants hear the reply the user chose. While Pipe Up speaks, the real
// microphone is muted. When the voice is not set up, Meet gets the plain
// microphone, untouched.
(() => {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia || md.__pipeUpPatched) return;
  md.__pipeUpPatched = true;

  const ORIGIN = location.origin;
  const original = md.getUserMedia.bind(md);
  // Set by voice-flag.js (isolated world) from the extension's storage.
  const voiceWanted = () => document.documentElement.dataset.pipeUpVoice === 'on';
  let ctx = null;
  let bus = null;
  let plainMics = 0; // microphones handed out before the voice was set up
  const mixes = new Set(); // one per microphone stream Meet asked for
  let queue = Promise.resolve();
  let playId = 0;

  function ensureContext() {
    if (!ctx) {
      ctx = new AudioContext({ latencyHint: 'interactive' });
      // Limiter on the voice bus, so synthetic peaks never clip.
      bus = ctx.createDynamicsCompressor();
      bus.threshold.value = -6;
      bus.knee.value = 0;
      bus.ratio.value = 20;
      bus.attack.value = 0.003;
      bus.release.value = 0.1;
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    return ctx;
  }
  // A suspended AudioContext would silence the whole microphone: resume it on
  // the first click or key press (Chrome's autoplay rule).
  for (const t of ['pointerdown', 'keydown'])
    addEventListener(t, () => ctx && ctx.state !== 'running' && ctx.resume().catch(() => {}), { capture: true });

  // Meet reads the track's label, settings and constraints and may change
  // them (microphone switch, noise settings): forward all of it to the real
  // one. Muting in Meet turns `enabled` off: that must silence Pipe Up's
  // voice too, at once, even in the middle of a reply.
  function mirror(mixed, real, voice) {
    const def = (k, d) => Object.defineProperty(mixed, k, { configurable: true, ...d });
    def('enabled', {
      get: () => real.enabled,
      set: (v) => {
        real.enabled = v;
        ramp(voice, v ? 1 : 0);
      },
    });
    def('label', { get: () => real.label });
    def('muted', { get: () => real.muted });
    mixed.getSettings = () => real.getSettings();
    mixed.getConstraints = () => real.getConstraints();
    mixed.getCapabilities = () => real.getCapabilities?.() ?? {};
    mixed.applyConstraints = (c) => real.applyConstraints(c);
    for (const ev of ['mute', 'unmute']) real.addEventListener(ev, () => mixed.dispatchEvent(new Event(ev)));
  }

  md.getUserMedia = async (constraints) => {
    const stream = await original(constraints);
    const real = stream.getAudioTracks()[0];
    if (!constraints?.audio || !real) return stream;
    if (!voiceWanted()) {
      plainMics++;
      return stream;
    }
    try {
      const c = ensureContext();
      const src = c.createMediaStreamSource(new MediaStream([real]));
      const mic = c.createGain();
      const voice = c.createGain();
      const dst = c.createMediaStreamDestination();
      voice.gain.value = real.enabled ? 1 : 0;
      src.connect(mic).connect(dst);
      bus.connect(voice).connect(dst);
      const mixed = dst.stream.getAudioTracks()[0];
      mirror(mixed, real, voice);
      const entry = { mic, voice, real };
      const teardown = () => {
        if (!mixes.delete(entry)) return;
        src.disconnect();
        mic.disconnect();
        voice.disconnect();
      };
      const origStop = mixed.stop.bind(mixed);
      mixed.stop = () => {
        teardown();
        real.stop();
        origStop();
      };
      // Microphone unplugged or permission revoked: tell Meet, as a real track would.
      real.addEventListener('ended', () => {
        teardown();
        origStop();
        mixed.dispatchEvent(new Event('ended'));
      });
      mixes.add(entry);
      return new MediaStream([...stream.getVideoTracks(), mixed]);
    } catch (e) {
      console.warn('[Pipe Up] voice mixing unavailable, using the plain microphone', e);
      return stream;
    }
  };

  const status = (ok, reason) => window.postMessage({ type: 'pipe-up:pcm-status', ok, reason }, ORIGIN);
  const ramp = (g, v) => {
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setTargetAtTime(v, ctx.currentTime, 0.015);
  };

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== ORIGIN || e.data?.type !== 'pipe-up:pcm') return;
    const live = [...mixes].filter((m) => m.real.readyState === 'live');
    if (!live.length) return status(false, plainMics ? 'reload' : 'no-mic');
    if (ctx.state !== 'running') {
      ctx.resume().catch(() => {});
      return status(false, 'needs-click');
    }
    if (!live.some((m) => m.real.enabled)) return status(false, 'muted');
    // Audio that cannot be played is reported, not accepted: in "voice only"
    // mode the reply then goes to the chat instead of being lost.
    let buf;
    try {
      const { pcm, rate } = e.data;
      buf = ctx.createBuffer(1, pcm.length, rate);
      buf.copyToChannel(pcm, 0);
    } catch {
      return status(false, 'bad-audio');
    }
    status(true);
    // One reply at a time: a second one waits for the first to finish.
    // Whatever happens to one reply, the next ones are still played.
    const play = () =>
      new Promise((done) => {
        const id = ++playId;
        const s = ctx.createBufferSource();
        const end = () => {
          s.disconnect();
          if (id === playId) for (const m of mixes) ramp(m.mic, 1);
          done();
        };
        try {
          s.buffer = buf;
          s.connect(bus);
          for (const m of live) ramp(m.mic, 0);
          s.onended = end;
          s.start(ctx.currentTime + 0.03);
        } catch {
          end();
        }
      });
    queue = queue.then(play, play);
  });
})();
