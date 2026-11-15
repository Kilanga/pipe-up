// Runs in Meet's own page (MAIN world) before Meet asks for the microphone.
// It hands Meet a microphone track that mixes the real microphone with
// Pipe Up's locally synthesized voice, so other participants hear the reply
// the user chose. While Pipe Up speaks, the real microphone is muted.
(() => {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia || md.__pipeUpPatched) return;
  md.__pipeUpPatched = true;

  const original = md.getUserMedia.bind(md);
  let ctx = null;
  const mixes = new Set(); // one per microphone stream Meet asked for

  md.getUserMedia = async (constraints) => {
    const stream = await original(constraints);
    if (!constraints?.audio || !stream.getAudioTracks().length) return stream;
    try {
      ctx ??= new AudioContext();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const dst = ctx.createMediaStreamDestination();
      const mic = ctx.createGain();
      const voice = ctx.createGain();
      ctx.createMediaStreamSource(stream).connect(mic).connect(dst);
      voice.connect(dst);
      const mixed = dst.stream.getAudioTracks()[0];
      const realTrack = stream.getAudioTracks()[0];
      // Keep Meet's mute button working: muting our track mutes the source.
      Object.defineProperty(mixed, 'enabled', {
        get: () => realTrack.enabled,
        set: (v) => (realTrack.enabled = v),
      });
      const origStop = mixed.stop.bind(mixed);
      mixed.stop = () => {
        realTrack.stop();
        origStop();
        mixes.delete(entry);
      };
      const entry = { mic, voice, realTrack };
      mixes.add(entry);
      return new MediaStream([...stream.getVideoTracks(), mixed]);
    } catch (e) {
      console.warn('[Pipe Up] voice mixing unavailable, using the plain microphone', e);
      return stream;
    }
  };

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.type !== 'pipe-up:pcm') return;
    const live = [...mixes].filter((m) => m.realTrack.readyState === 'live');
    if (!ctx || !live.length) {
      window.postMessage({ type: 'pipe-up:pcm-status', ok: false, reason: 'no-mic' }, '*');
      return;
    }
    if (!live.some((m) => m.realTrack.enabled)) {
      window.postMessage({ type: 'pipe-up:pcm-status', ok: false, reason: 'muted' }, '*');
      return;
    }
    const { pcm, rate } = e.data;
    const buf = ctx.createBuffer(1, pcm.length, rate);
    buf.copyToChannel(pcm, 0);
    for (const m of live) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(m.voice);
      m.mic.gain.setValueAtTime(0, ctx.currentTime);
      src.onended = () => m.mic.gain.setValueAtTime(1, ctx.currentTime);
      src.start();
    }
    window.postMessage({ type: 'pipe-up:pcm-status', ok: true }, '*');
  });
})();
