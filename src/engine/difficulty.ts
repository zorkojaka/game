// Težavnost igre — spreminja SAMO VIDNE VHODNE MOČI (začetne ljudi/vire, velikost
// AI vojske, doprinos obzidja, učinek nadgradnje orožja). NE množi izidov bojev:
// kdo zmaga, vedno določa ISTA formula moči obeh strani — igralec vse vidi
// (👥 ljudje, 🤖 števec robotov, % obzidja, × orožja) in se lahko pripravi.
// Objektivno preverjanje: `npm run sim`.

export type DifficultyId = 'easy' | 'normal' | 'hard' | 'brutal';

export interface DifficultyProfile {
  id: DifficultyId;
  label: string;
  desc: string;
  // Naša stran — začetno stanje (vidno v zgornji vrstici od prvega meseca)
  startPopulation: number;
  startFood: number;
  startWeapons: number;
  // AI vojska — prihodi enot po fazah (vidno v 🤖 števcu in razčlembi enot)
  aiScouts: number;        // faza 1
  aiAttackers: number;     // faza 2
  aiPeopleKillers: number; // faza 3
  // Učinkovitost naše tehnologije (vidno v opisih obrambe/raziskav)
  wallDefensePct: number;     // doprinos enega obzidja k obrambni moči (× 2^stopnja raziskave)
  weaponResearchMult: number; // množitelj učinka orožja na stopnjo raziskave (normal = ×2)
  // AI ekonomija — pritok energije na mesec iz jedra (poganja nadomeščanje izgub)
  aiEnergyInflow: number;
}

export const DIFFICULTIES: Record<DifficultyId, DifficultyProfile> = {
  easy: {
    id: 'easy', label: 'Lahka', desc: 'Več ljudi in zalog, manjša AI vojska, izdatnejša tehnologija.',
    startPopulation: 90, startFood: 140, startWeapons: 70,
    aiScouts: 80, aiAttackers: 55, aiPeopleKillers: 15,
    wallDefensePct: 0.03, weaponResearchMult: 2.25, aiEnergyInflow: 3,
  },
  normal: {
    id: 'normal', label: 'Normalna', desc: 'Uravnotežena izkušnja — privzeto.',
    startPopulation: 80, startFood: 120, startWeapons: 60,
    aiScouts: 100, aiAttackers: 75, aiPeopleKillers: 25,
    wallDefensePct: 0.02, weaponResearchMult: 2, aiEnergyInflow: 5,
  },
  hard: {
    id: 'hard', label: 'Težka', desc: 'Manj ljudi in zalog, večja AI vojska, skromnejša tehnologija.',
    startPopulation: 70, startFood: 100, startWeapons: 50,
    aiScouts: 120, aiAttackers: 95, aiPeopleKillers: 35,
    wallDefensePct: 0.015, weaponResearchMult: 1.8, aiEnergyInflow: 7,
  },
  brutal: {
    id: 'brutal', label: 'Brutalna', desc: 'Maloštevilen klan proti ogromni AI vojski. Vsaka napaka je zadnja.',
    startPopulation: 60, startFood: 85, startWeapons: 40,
    aiScouts: 145, aiAttackers: 115, aiPeopleKillers: 50,
    wallDefensePct: 0.012, weaponResearchMult: 1.6, aiEnergyInflow: 10,
  },
};

/** Varno vrne profil (neznana/manjkajoča vrednost → normal). */
export function difficultyProfile(id?: string | null): DifficultyProfile {
  return DIFFICULTIES[(id as DifficultyId)] ?? DIFFICULTIES.normal;
}

/** Učinek orožja pri dani stopnji raziskave (odvisno od težavnosti; normal: ×2 na stopnjo). */
export function weaponEffectMult(difficulty: string | undefined, weaponLevel: number): number {
  return Math.pow(difficultyProfile(difficulty).weaponResearchMult, Math.max(0, weaponLevel | 0));
}
