// Težavnost igre — EN vir multiplikatorjev, ki jih engine bere na ključnih točkah.
// Uteževanje: spreminjaj številke tu (ali dodaj nov profil); engine in UI sledita.
// Objektivno preverjanje: `npm run sim` odigra N iger na profil in izpiše win-rate.

export type DifficultyId = 'easy' | 'normal' | 'hard' | 'brutal';

export interface DifficultyProfile {
  id: DifficultyId;
  label: string;
  desc: string;
  raidChanceMult: number;     // verjetnost AI raida na kamp
  aiStrengthMult: number;     // AI moč v raidu (niža P odbitja, viša žrtve prek preboja)
  lethalityMult: number;      // smrtonosnost — množi žrtve v raidu
  encounterMult: number;      // verjetnost srečanj na poti odprav
  garrisonMult: number;       // moč straže šibkih točk
  forageMult: number;         // donos nabiralcev (hrana)
  researchSpeedMult: number;  // hitrost raziskav (roboti/orožje/obzidje)
  findChanceMult: number;     // verjetnost najdb na odpravah
}

export const DIFFICULTIES: Record<DifficultyId, DifficultyProfile> = {
  easy: {
    id: 'easy', label: 'Lahka', desc: 'Za spoznavanje igre — AI je redkejši in milejši, viri izdatnejši.',
    raidChanceMult: 0.70, aiStrengthMult: 0.80, lethalityMult: 0.70, encounterMult: 0.80,
    garrisonMult: 0.70, forageMult: 1.20, researchSpeedMult: 1.25, findChanceMult: 1.30,
  },
  normal: {
    id: 'normal', label: 'Normalna', desc: 'Uravnotežena izkušnja — privzeto.',
    raidChanceMult: 1, aiStrengthMult: 1, lethalityMult: 1, encounterMult: 1,
    garrisonMult: 1, forageMult: 1, researchSpeedMult: 1, findChanceMult: 1,
  },
  hard: {
    id: 'hard', label: 'Težka', desc: 'AI je agresiven in smrtonosen, viri skopi. Za veterane.',
    raidChanceMult: 1.35, aiStrengthMult: 1.25, lethalityMult: 1.30, encounterMult: 1.25,
    garrisonMult: 1.40, forageMult: 0.85, researchSpeedMult: 0.80, findChanceMult: 0.80,
  },
  brutal: {
    id: 'brutal', label: 'Brutalna', desc: 'AI lovi tvoj klan brez milosti. Vsaka napaka je zadnja.',
    raidChanceMult: 1.70, aiStrengthMult: 1.50, lethalityMult: 1.60, encounterMult: 1.50,
    garrisonMult: 1.80, forageMult: 0.70, researchSpeedMult: 0.65, findChanceMult: 0.65,
  },
};

/** Varno vrne profil (neznana/manjkajoča vrednost → normal). */
export function difficultyProfile(id?: string | null): DifficultyProfile {
  return DIFFICULTIES[(id as DifficultyId)] ?? DIFFICULTIES.normal;
}
