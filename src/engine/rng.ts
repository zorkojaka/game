// Seedan deterministični RNG — mulberry32 algoritem
// Vsak klic šteje, kar zagotavlja ponovljivost pri istem seedu

export interface RNGState {
  seed: number;
  calls: number;
}

function mulberry32(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function createRNG(seed: number): RNGState {
  return { seed, calls: 0 };
}

// Vrne [0, 1) in posodobi stanje (immutable — vrne nov state)
export function rngNext(state: RNGState): [number, RNGState] {
  const value = mulberry32(state.seed + state.calls * 1013904223);
  return [value, { seed: state.seed, calls: state.calls + 1 }];
}

// Vrne cel[min, max)
export function rngInt(state: RNGState, min: number, max: number): [number, RNGState] {
  const [v, next] = rngNext(state);
  return [Math.floor(v * (max - min)) + min, next];
}

// Bernoulli trial — vrne true z verjetnostjo p
export function rngBool(state: RNGState, p: number): [boolean, RNGState] {
  const [v, next] = rngNext(state);
  return [v < p, next];
}

// Generira seed iz stringa (za consistentnost med sejami)
export function seedFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}
