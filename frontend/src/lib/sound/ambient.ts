// Ambient soundscapes, generated live with the Web Audio API: no audio files,
// nothing to download. Loaded only when sound is first switched on.
//
// Each scape builds its own nodes into a scape gain, so switching crossfades
// one scape out while the next fades in. Everything runs through one master
// gain, a shared reverb and a gentle compressor.

import type { Scape } from "./scapes";

type Running = { scape: Scape; out: GainNode; stop: () => void };

const MAX_LEVEL = 0.32; // master gain at full volume; scapes are mixed well below this
const FADE_IN = 4;
const FADE_OUT = 1.4;
const CROSSFADE = 3;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let input: GainNode | null = null;
let current: Running | null = null;
let volume = 0.6;
let playing = false;
let visibilityBound = false;

function now() {
  return ctx ? ctx.currentTime : 0;
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

// A decaying stereo noise burst: a small, smooth hall.
function impulse(context: AudioContext, seconds: number, decay: number) {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}

// Brown noise: soft and low, like distant wind.
function brownNoise(context: AudioContext, seconds: number) {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = last * 3.5;
  }
  return buffer;
}

function ensure(): AudioContext | null {
  if (ctx) return ctx;
  const AudioCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtor) return null;

  ctx = new AudioCtor();
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.ratio.value = 3;
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(compressor).connect(ctx.destination);

  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 5, 2.4);
  const wet = ctx.createGain();
  wet.gain.value = 0.7;
  reverb.connect(wet).connect(master);

  input = ctx.createGain();
  const dry = ctx.createGain();
  dry.gain.value = 0.55;
  input.connect(dry).connect(master);
  input.connect(reverb);

  if (!visibilityBound) {
    visibilityBound = true;
    // Never play to a hidden tab.
    document.addEventListener("visibilitychange", () => {
      if (!ctx) return;
      if (document.hidden) void ctx.suspend();
      else if (playing) void ctx.resume();
    });
  }
  return ctx;
}

function lfo(
  context: AudioContext,
  rate: number,
  depth: number,
  target: AudioParam,
) {
  const osc = context.createOscillator();
  osc.frequency.value = rate;
  const gain = context.createGain();
  gain.gain.value = depth;
  osc.connect(gain).connect(target);
  osc.start();
  return osc;
}

// A soft sine bell with one inharmonic partial, sent mostly to the reverb.
function bell(
  context: AudioContext,
  out: AudioNode,
  freq: number,
  level: number,
  decay: number,
) {
  const t = context.currentTime + 0.02;
  const env = context.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(level, t + 0.03);
  env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  env.connect(out);
  for (const [ratio, amount] of [
    [1, 1],
    [2.76, 0.18],
  ] as const) {
    const osc = context.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq * ratio;
    const partial = context.createGain();
    partial.gain.value = amount;
    osc.connect(partial).connect(env);
    osc.start(t);
    osc.stop(t + decay + 0.1);
  }
}

type Builder = (context: AudioContext, out: GainNode) => () => void;

// Drift: a deep drone on A with a slowly breathing filter, and a far-off
// pentatonic star now and then.
const drift: Builder = (context, out) => {
  const nodes: AudioScheduledSourceNode[] = [];
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 340;
  filter.Q.value = 0.8;
  const body = context.createGain();
  body.gain.value = 0.4;
  filter.connect(body).connect(out);

  for (const [type, freq, detune, level] of [
    ["sine", 55, 0, 0.9],
    ["sine", 82.41, 3, 0.45],
    ["triangle", 110, 5, 0.3],
    ["triangle", 110, -6, 0.3],
    ["sine", 164.81, 0, 0.12],
  ] as const) {
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    const gain = context.createGain();
    gain.gain.value = level;
    osc.connect(gain).connect(filter);
    osc.start();
    nodes.push(osc);
  }
  nodes.push(lfo(context, 0.021, 230, filter.frequency));
  nodes.push(lfo(context, 0.047, 0.08, body.gain));

  const stars = [880, 987.77, 1174.66, 1318.51, 1567.98, 1760] as const;
  let timer = 0;
  const twinkle = () => {
    bell(context, out, pick(stars), 0.05, rand(3.5, 6));
    timer = window.setTimeout(twinkle, rand(5000, 12000));
  };
  timer = window.setTimeout(twinkle, 3500);

  return () => {
    window.clearTimeout(timer);
    for (const node of nodes) node.stop();
  };
};

// Orbit: four slow, open chords that crossfade every fourteen seconds, with
// soft bells drawn from the chord.
const CHORDS = [
  [110, 164.81, 196, 246.94, 261.63],
  [87.31, 130.81, 164.81, 220, 261.63],
  [65.41, 130.81, 196, 246.94, 329.63],
  [98, 146.83, 164.81, 220, 293.66],
] as const;
const CHORD_SECONDS = 14;

const orbit: Builder = (context, out) => {
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 720;
  filter.Q.value = 0.5;
  const body = context.createGain();
  body.gain.value = 0.7;
  filter.connect(body).connect(out);
  const filterLfo = lfo(context, 0.03, 180, filter.frequency);

  let index = 0;
  let chordTimer = 0;
  let bellTimer = 0;
  const live = new Set<OscillatorNode>();

  const playChord = () => {
    const chord = CHORDS[index % CHORDS.length];
    const t = context.currentTime;
    const env = context.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.22, t + 5);
    env.gain.setValueAtTime(0.22, t + CHORD_SECONDS - 1);
    env.gain.linearRampToValueAtTime(0.0001, t + CHORD_SECONDS + 4);
    env.connect(filter);
    for (const freq of chord) {
      for (const detune of [-7, 7]) {
        const osc = context.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = freq;
        osc.detune.value = detune;
        osc.connect(env);
        osc.start(t);
        osc.stop(t + CHORD_SECONDS + 4.2);
        live.add(osc);
        osc.onended = () => live.delete(osc);
      }
    }
    index += 1;
    chordTimer = window.setTimeout(playChord, CHORD_SECONDS * 1000);
  };

  const ring = () => {
    if (Math.random() < 0.65) {
      const chord = CHORDS[(index + CHORDS.length - 1) % CHORDS.length];
      bell(context, out, pick(chord) * 4, 0.09, rand(2.5, 4));
    }
    bellTimer = window.setTimeout(ring, rand(2800, 5200));
  };

  playChord();
  bellTimer = window.setTimeout(ring, 4000);

  return () => {
    window.clearTimeout(chordTimer);
    window.clearTimeout(bellTimer);
    filterLfo.stop();
    for (const osc of live) osc.stop();
  };
};

// Solar wind: filtered noise that rises and falls, a faint shimmer of high
// partials, and a low hum underneath.
const wind: Builder = (context, out) => {
  const nodes: AudioScheduledSourceNode[] = [];
  const buffer = brownNoise(context, 6);

  const gust = context.createBufferSource();
  gust.buffer = buffer;
  gust.loop = true;
  const band = context.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 700;
  band.Q.value = 0.9;
  const gustGain = context.createGain();
  gustGain.gain.value = 2.2;
  gust.connect(band).connect(gustGain).connect(out);
  gust.start();
  nodes.push(gust);
  nodes.push(lfo(context, 0.037, 520, band.frequency));
  nodes.push(lfo(context, 0.06, 0.9, gustGain.gain));

  const air = context.createBufferSource();
  air.buffer = buffer;
  air.loop = true;
  air.playbackRate.value = 2.5;
  const high = context.createBiquadFilter();
  high.type = "highpass";
  high.frequency.value = 2800;
  const airGain = context.createGain();
  airGain.gain.value = 0.2;
  air.connect(high).connect(airGain).connect(out);
  air.start(context.currentTime + 0.5);
  nodes.push(air);

  for (const [freq, rate] of [
    [1318.51, 0.11],
    [1975.53, 0.07],
    [2637.02, 0.13],
  ] as const) {
    const osc = context.createOscillator();
    osc.frequency.value = freq;
    const gain = context.createGain();
    gain.gain.value = 0.02;
    osc.connect(gain).connect(out);
    osc.start();
    nodes.push(osc, lfo(context, rate, 0.02, gain.gain));
  }

  const hum = context.createOscillator();
  hum.frequency.value = 65.41;
  const humGain = context.createGain();
  humGain.gain.value = 0.3;
  hum.connect(humGain).connect(out);
  hum.start();
  nodes.push(hum);

  return () => {
    for (const node of nodes) node.stop();
  };
};

const BUILDERS: Record<Scape, Builder> = { drift, orbit, wind };

function level() {
  return MAX_LEVEL * volume * volume; // a squared curve feels even to the ear
}

/** Start (or switch to) a scape. Must be called from a user gesture the first time. */
export function play(scape: Scape) {
  const context = ensure();
  if (!context || !master || !input) return false;
  void context.resume();
  playing = true;

  const t = now();
  master.gain.cancelScheduledValues(t);
  master.gain.setValueAtTime(master.gain.value, t);
  master.gain.linearRampToValueAtTime(level(), t + FADE_IN);

  if (current?.scape === scape) return true;

  if (current) {
    const old = current;
    old.out.gain.cancelScheduledValues(t);
    old.out.gain.setValueAtTime(old.out.gain.value, t);
    old.out.gain.linearRampToValueAtTime(0, t + CROSSFADE);
    window.setTimeout(
      () => {
        old.stop();
        old.out.disconnect();
      },
      CROSSFADE * 1000 + 200,
    );
  }

  const out = context.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(1, t + CROSSFADE);
  out.connect(input);
  current = { scape, out, stop: BUILDERS[scape](context, out) };
  return true;
}

/** Fade out, stop every voice and let the audio device sleep. */
export function stop() {
  if (!ctx || !master) return;
  playing = false;
  const t = now();
  master.gain.cancelScheduledValues(t);
  master.gain.setValueAtTime(master.gain.value, t);
  master.gain.linearRampToValueAtTime(0, t + FADE_OUT);
  const running = current;
  current = null;
  window.setTimeout(
    () => {
      running?.stop();
      running?.out.disconnect();
      if (!playing) void ctx?.suspend();
    },
    FADE_OUT * 1000 + 200,
  );
}

/** 0..1. Applies smoothly while playing. */
export function setVolume(value: number) {
  volume = Math.min(1, Math.max(0, value));
  if (!ctx || !master || !playing) return;
  const t = now();
  master.gain.cancelScheduledValues(t);
  master.gain.setValueAtTime(master.gain.value, t);
  master.gain.linearRampToValueAtTime(level(), t + 0.25);
}
