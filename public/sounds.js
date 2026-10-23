// sounds.js
// Small synthesized sound effects, so there are no audio files to load.
const Sound = (() => {
  const STORAGE_KEY = 'soundMuted';
  let context = null;
  let muted = false;
  try {
    muted = localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    // Storage can be unavailable (private mode); sound just stays on
  }

  // Browsers only allow audio after a user gesture, so create it lazily
  function audio() {
    if (muted) return null;
    if (!context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      context = new AudioContext();
    }
    if (context.state === 'suspended') context.resume();
    return context;
  }

  function tone(freq, { start = 0, duration = 0.12, type = 'sine', volume = 0.15, slideTo } = {}) {
    const ctx = audio();
    if (!ctx) return;
    const at = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + duration);
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  function noiseHit(start, volume) {
    const ctx = audio();
    if (!ctx) return;
    const length = Math.floor(ctx.sampleRate * 0.06);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(ctx.currentTime + start);
  }

  return {
    get muted() {
      return muted;
    },
    toggle() {
      muted = !muted;
      try {
        localStorage.setItem(STORAGE_KEY, String(muted));
      } catch {
        // Not persisted, still applies for this page
      }
      return muted;
    },
    click() {
      tone(660, { duration: 0.08, type: 'triangle', slideTo: 990 });
    },
    pop() {
      tone(420, { duration: 0.1, type: 'sine', slideTo: 840, volume: 0.1 });
    },
    // Accelerating snare roll across the countdown
    drumroll(seconds = 3) {
      let t = 0;
      let gap = 0.12;
      while (t < seconds) {
        noiseHit(t, 0.25 + (t / seconds) * 0.35);
        t += gap;
        gap = Math.max(0.035, gap * 0.94);
      }
    },
    tada() {
      [523.25, 659.25, 783.99].forEach((freq) =>
        tone(freq, { duration: 0.18, type: 'triangle' })
      );
      [659.25, 830.61, 987.77, 1318.5].forEach((freq) =>
        tone(freq, { start: 0.18, duration: 0.6, type: 'triangle', volume: 0.12 })
      );
    },
    hmm() {
      tone(330, { duration: 0.25, type: 'sine', slideTo: 247 });
    },
    nudge() {
      tone(880, { duration: 0.09, type: 'square', volume: 0.06 });
      tone(880, { start: 0.14, duration: 0.09, type: 'square', volume: 0.06 });
    },
  };
})();
