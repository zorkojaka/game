# Audit projekta: AI vs Humanity

Datum pregleda: 2026-06-02

Zadnja posodobitev audita: 2026-06-02

Sprint update: veja `dev/research-ai-logic` je po prvem auditu implementirala novi research-driven AI loop in je bila nato fast-forwardana na `main`. Za opis glavne sistemske spremembe glej tudi [research-ai-logic.md](research-ai-logic.md). Spodnji audit je posodobljen z naknadnimi popravki kode, ki so bili narejeni po research sprintu.

## Povzetek

Projekt je po prejšnjem auditu opazno posodobljen. Glavne izboljšave:

- dodani so engine testi (`src/engine/game.test.ts`);
- frontend tipi so zdaj re-export iz `src/engine/types.ts`;
- obroki v UI uporabljajo engine konstante;
- AI ima razčlembo enot (`scouts`, `attackers`, `peopleKillers`);
- boji in raidi uporabljajo dejanski seedan RNG roll;
- dodani so raziskovalni leveli za robote, orožje in obzidje;
- dodan je `aiInsight`, ki odpira AI drevo;
- odprave imajo povratek, nošen plen in round-trip hrano;
- admin API poti so zaščitene z `ADMIN_TOKEN`;
- `CompletedRun` zdaj shrani dejanski `axisHistory`;
- `GameSession.updateOne` uporablja `$set`;
- dodana je osnovna validacija `assignment`.

Največji preostali problem ni več samo arhitektura, ampak skladnost razlag in pravil:

- `RulesModal` je bil posodobljen na research-driven sistem, vendar so razlage še vedno raztresene po UI in engine komentarjih.
- UI ocene so bile delno usklajene z engine logiko, vendar je treba še sistematično centralizirati preview formule.
- Stari `activeMissions` sistem je v normalnem gameplayu izklopljen, a ostaja migracijska kompatibilnost za stare shranjene seje.
- `processRound` in `App.tsx` sta še večja monolita kot prej.

## Kaj je bilo implementirano po auditu

### Research-driven AI loop

Commit: `2b221ee Implement research-driven AI progression`.

Glavne spremembe:

- `aiInsight` ni več pasiven timer. Raste glede na raziskovalce in izbrani research target.
- Če je cilj raziskav `robots`, insight raste s polno hitrostjo: `researchers * AI_INSIGHT_PER_RESEARCHER * rations.strengthMult`.
- Če je cilj `weapon` ali `wall`, insight raste samo z manjšim faktorjem `NON_ROBOT_RESEARCH_INSIGHT_FACTOR`.
- AI drevo ima konkretne tematske node:
  - `Izvidniške enote`, `Senzorji in optika`, `Vzorec patruljiranja`;
  - `Napadalne enote`, `Napajalni členki`, `Taktika frontalnega pritiska`;
  - `People-killer enote`, `Termalno jedro`, `Prioritetni algoritem tarč`.
- Mehanske šibkosti odklepajo stopnje tehnologije:
  - scout mechanical weakness -> stopnja 1;
  - attacker mechanical weakness -> stopnja 2;
  - people-killer mechanical weakness -> stopnja 3.
- Logične šibkosti dajejo takojšen pasivni bonus v boju/obrambi.
- Legacy `activeMissions` niso več normalen gameplay sistem; stare seje se migrirajo tako, da se ljudje vrnejo v kamp.
- UI research tekst je preurejen v loop: `Research -> Intel -> AI weak points -> Upgrades -> Survival`.
- Research level labeli so tematski:
  - roboti: `Izvidniki`, `Napadalci`, `People-killerji`;
  - orožje: `Puške`, `EMP strelivo`, `Anti-core orožje`;
  - obzidje: `Leseni zid`, `EMP obramba`, `Napredni obrambni sistemi`.

Testi dodani/posodobljeni:

- brez raziskovalcev `aiInsight` ne raste več pasivno;
- robot research povečuje `aiInsight`;
- `aiInsight` odpira AI tree node;
- mehanske šibkosti odklepajo weapon/wall progression;
- logične šibkosti vplivajo na combat/raid odds;
- legacy missions niso več uporabljene kot normalen gameplay;
- stare seje z `activeMissions` ne crashajo.

### Popravki map UI kontrol

Commit: `64850ca Fix map draft control icons`.

Spremembe:

- Gumbi na zadnjem hexu med risanjem poti ne uporabljajo več emoji teksta kot glavnega renderja.
- Ikone za `scout`, `attack`, `+`, `-` in potrditev so zamenjane z inline SVG ikonami.
- Popravljeno je centriranje in konsistenten prikaz ikon znotraj krožnih SVG gumbov.
- Gameplay logika pošiljanja odprave ni bila spremenjena.

Commit: `bb4719b Fix map progress arc alignment`.

Spremembe:

- Progress lok za artefakt in raziskovalne gumbe ne uporablja več `circle + strokeDashoffset`.
- Lok se riše kot eksplicitni SVG `path`, zato začetek ne plava in vedno začne na vrhu obroča.
- Pri 100% se še vedno prikaže poln krog.

### Zaklenjene raziskave

Commit: `3be2d22 Prevent selecting locked research`.

Spremembe:

- Zaklenjenih raziskav ni več mogoče izbrati v research selectorju.
- Zaklenjenih raziskav ni več mogoče izbrati na map gumbih raziskovalne cone.
- Če trenutni research target po zaključku runde postane zaklenjen za nadaljevanje, se fokus sam prestavi na `robots`.
- Preview in `playRound` uporabljata normaliziran research target, da engine ne prejme zaklenjene izbire iz starega/migriranega UI stanja.
- V človeškem research drevesu so imena zaklenjenih stopenj skrita in prikazana kot `Zaklenjeno`.

### Robots research completion bugfix

Commit: `b22b6c3 Reset robot research progress on unlock`.

Spremembe:

- Popravljen bug, kjer se `robotsResearchProgress` po odklepu prve robots/mechanical stopnje ni porabil/resetiral.
- Ko AI drevo razkrije mehansko šibkost in se `robotsResearchLevel` dvigne, engine zdaj odšteje `RESEARCH_LEVEL_WORKER_MONTHS` za vsako novo odklenjeno stopnjo.
- Dodan test, ki preveri: `Roboti 120` -> `robotsResearchLevel = 1` in `robotsResearchProgress = 0`.

### Kako se AI načrtovalno drevo trenutno odpira

AI tree se odpira prek `aiInsight`, ne več prek pasivnega časovnika.

1. Igralec dodeli ljudi v `Research`.
2. Če je research target `robots`, raziskovalci ustvarijo največ `aiInsight`.
3. Če je target `weapon` ali `wall`, se `aiInsight` še vedno rahlo poveča, vendar samo z 15% faktorjem.
4. `revealTreeByInsight()` primerja `aiInsight` z `insightThreshold` vsakega nodea.
5. Node postane:
   - `partial`, ko je insight blizu praga;
   - `revealed`, ko insight doseže prag.
6. Faza omeji največji možen insight:
   - `find`: največ `0.30`;
   - `understand`: največ `0.60`;
   - `eliminate`: največ `0.90`.

Pragovi nodeov:

- `0.10`: izvidniške enote;
- `0.20`: scout mechanical weakness;
- `0.30`: scout logical weakness;
- `0.40`: napadalne enote;
- `0.50`: attacker mechanical weakness;
- `0.60`: attacker logical weakness;
- `0.70`: people-killer enote;
- `0.80`: people-killer mechanical weakness;
- `0.90`: people-killer logical weakness.

## Struktura projekta

```text
.
├── AGENTS.md
├── CLAUDE.md
├── deploy.sh
├── ecosystem.config.cjs
├── jest.config.cjs
├── package.json
├── tsconfig.json
├── docs/
│   ├── audit.md
│   └── research-ai-logic.md
├── src/
│   ├── db/
│   │   ├── connection.ts
│   │   └── models/
│   │       ├── CompletedRun.ts
│   │       ├── Feedback.ts
│   │       └── GameSession.ts
│   ├── engine/
│   │   ├── ai-brain.ts
│   │   ├── combat.ts
│   │   ├── constants.ts
│   │   ├── expedition.ts
│   │   ├── fog.ts
│   │   ├── game.test.ts
│   │   ├── game.ts
│   │   ├── map.ts
│   │   ├── rng.ts
│   │   └── types.ts
│   └── server/
│       └── index.ts
└── client/
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── App.tsx
        ├── api.ts
        ├── index.css
        ├── main.tsx
        └── types.ts
```

Velikosti glavnih datotek:

- `src/engine/game.ts`: 1092 vrstic.
- `client/src/App.tsx`: 3727 vrstic.
- `src/engine/constants.ts`: 264 vrstic.
- `src/engine/game.test.ts`: 279 vrstic.
- `docs/audit.md`: 1081+ vrstic po tej posodobitvi.
- `docs/research-ai-logic.md`: 44 vrstic.

## Strani in zasloni

Ni routerja. `App.tsx` upravlja vse zaslone.

### Start

`StartScreen` se prikaže, ko ni naloženega `GameState`. Ob zagonu poskusi naložiti `runId` iz `localStorage` (`avh-runId`).

### Glavni ekran

Sestava:

- zgornja vrstica z resursi, AI enotami, znanjem in menijem;
- levi panel z zavihki;
- osrednja heks mapa;
- desni dnevnik dogodkov in aktivne odprave;
- spodnja vrstica s fazami in gumbom `NASLEDNJI MESEC`.

### Zavihek Obramba

Prikazuje:

- branilce;
- mesečno verjetnost AI napada;
- verjetnost vsaj enega napada v 6 mesecih;
- verjetnost odbitja napada;
- orožje, prosto orožje, obzidje, artefakt.

### Zavihek Prehrana

Prikazuje:

- nabiralce;
- obroke;
- pridelek, porabo, zalogo;
- projekcijo hrane;
- varnost nabiranja.

### Zavihek Delavnice

Prikazuje izdelavo:

- orožje: 6 delavec-mesecev + 1 material;
- obzidje: 12 delavec-mesecev + 4 materiala;
- artefakt: 360 delavec-mesecev + 20 materiala.

### Zavihek Raziskave

Prikazuje raziskovalce, cilj raziskave in drevesa:

- `robots`;
- `weapon`;
- `wall`.

Roboti odklepajo stopnje orožja/obzidja. AI drevo se odpira prek `aiInsight`.

### Zavihek Izvidniki

Risanje poti po heks mapi. Izvidniška odprava:

- vzame ljudi iz kampa;
- vzame hrano za pot tja in nazaj;
- raziskuje hekse;
- lahko najde material/orožje/artefakt;
- plen dostavi šele ob vrnitvi.

### Zavihek Napad

Risanje napadalne poti do AI jedra ali odkrite šibke točke. Spopad se zgodi ob prihodu. Preživeli se vračajo v kamp.

### Desni panel V teku

Prikazuje:

- aktivne path-based odprave;
- odprave v povratku;
- stare `activeMissions`, če obstajajo.

### Modali

- `FeedbackModal`;
- `RulesModal`;
- `PhaseTransitionBanner`;
- `GameOverScreen`.

## API in strežnik

### API poti

- `POST /api/game/new`: nova igra.
- `GET /api/game/:runId`: stanje igre.
- `POST /api/game/:runId/round`: izvede mesec.
- `POST /api/game/:runId/preview`: preview odds.
- `POST /api/feedback`: shrani feedback.
- `GET /api/feedback`: admin, zahteva `x-admin-token`.
- `GET /api/sessions`: admin, zahteva `x-admin-token`.

### Validacija

`validateAssignment` preveri:

- `axis` mora biti `obzidje`, `orozje` ali `roboti`;
- glavna numerična polja morajo biti integer >= 0;
- `rations` mora biti 1-5;
- `newExpeditions` mora biti seznam s potmi.

To je dobra osnovna validacija, vendar še ne preveri:

- da so koraki poti sosednji;
- da so koordinate na mapi;
- da odprava ne preseže populacije;
- da `missionAssignments` in `missionRations` vsebujejo veljavne vrednosti;
- da `newExpeditions.kind` velja samo `scout` ali `mission`.

## Game loop

1. Frontend ustvari ali naloži igro.
2. Igralec razporedi branilce, nabiralce, delavce, raziskovalce, obroke in odprave.
3. Frontend kliče `/api/game/:runId/preview` za predogled.
4. Ob `NASLEDNJI MESEC` frontend pošlje `PlayerAction`.
5. Server naloži `GameSession`, validira assignment, pokliče `processRound`.
6. Novi `GameState` se shrani z `$set`.
7. Če je igra zaključena, server ustvari `CompletedRun`.
8. Frontend iz `lastRoundLog` doda vnos v lokalni event log.

Engine je determinističen za isti seed in isti sequence akcij. RNG stanje je:

- `rngSeed`;
- `rngCallCount`.

## Runde: zaporedje v engineu

`processRound` naredi:

1. vrne state, če status ni `active`;
2. sestavi RNG iz `rngSeed/rngCallCount`;
3. izračuna celoten klan pred rundo: kamp + odprave + morebitne legacy misije za migracijo;
4. normalizira oborožene ljudi glede na orožje;
5. naloži obroke;
6. kamp porabi hrano;
7. nabiralci proizvedejo hrano;
8. raziskovalci dodajo intel in napredek raziskav;
9. `aiInsight` naraste in odpre AI drevo;
10. delavci napredujejo v delavnicah;
11. šibke točke se lahko odkrijejo prek AI drevesa ali mape;
12. neposredni `combatants` napad se razreši, če je uporabljen;
13. AI lahko izvede raid na kamp;
14. artefakt lahko uniči šibko točko;
15. nove odprave se sprejmejo pred tikanjem;
16. aktivne odprave se premaknejo, napadejo ali se vračajo;
17. legacy `activeMissions`, če obstajajo v stari seji, se odstranijo in ljudje se vrnejo v kamp;
18. drugi klani se odkrijejo in zavezniki pošljejo pomoč;
19. `clanActivity` se spremeni;
20. AI pridobi `aiKnowledge`;
21. lakota lahko ubije del populacije;
22. obroki lahko spremenijo populacijo;
23. preveri se poraz;
24. faza napreduje;
25. ob prehodu faze AI dobi nove enote;
26. preveri se zmaga;
27. sestavi se `RoundLog`.

## Popis igralne logike in formul

### Začetno stanje

Začetek:

- populacija: 80;
- hrana/voda: 120;
- orožje: 60;
- intel: 10;
- material: 30;
- artefakti: 0;
- AI znanje o nas: 0.1;
- aktivnost drugih klanov: 0.60;
- AI insight igralca: 0.01;
- AI enote: 100 izvidnikov.

### AI enote

AI ima tri tipe:

| Tip | Faza prihoda | Število | Napad | Obramba | HP |
| --- | --- | ---: | ---: | ---: | ---: |
| `scouts` | `find` | 100 | 0.4 | 0.5 | 1 |
| `attackers` | `understand` | 75 | 1.6 | 1.2 | 2 |
| `peopleKillers` | `eliminate` | 25 | 3.5 | 2.6 | 4 |

Skupna ofenzivna moč:

```text
aiAttackPower =
  scouts * 0.4 +
  attackers * 1.6 +
  peopleKillers * 3.5
```

Skupna obrambna moč:

```text
aiDefensePower =
  scouts * 0.5 +
  attackers * 1.2 +
  peopleKillers * 2.6
```

Polna AI attack referenca:

```text
100*0.4 + 75*1.6 + 25*3.5 = 247.5
```

Ob faznih prehodih:

- v `understand` pride +75 attackers;
- v `eliminate` pride +25 peopleKillers.

### Uničevanje AI enot

`destroyAIUnits(units, count)` razporedi izgube po tipih uteženo z `1 / hp`.

Pomen: šibkejši roboti padajo prej, people-killerji preživijo dlje. Ostanek po zaokroževanju se odstrani v vrstnem redu:

```text
scouts → attackers → peopleKillers
```

### Obroki

| Nivo | Hrana | Populacija | Moč |
| --- | ---: | ---: | ---: |
| 1 Lakota | x0.50 | -5 do -3 | x0.55 |
| 2 Skopo | x0.75 | -2 do -1 | x0.80 |
| 3 Normalno | x1.00 | 0 | x1.00 |
| 4 Dobro | x2.50 | +1 do +3 | x1.30 |
| 5 Obilje | x5.00 | +3 do +6 | x1.60 |

Pomembno: `rngInt(min, max)` je max-exclusive, zato trenutna implementacija dejansko ne doseže zgornje meje. Primer: `-5 do -3` v praksi vrne `-5` ali `-4`, ne `-3`.

### Hrana

Poraba kampa:

```text
survivalCost = round(population * 1 * rations.foodMult)
```

Nabiranje:

```text
foraged = floor(foragers * 4 * rations.strengthMult)
```

Po porabi in nabiranju se `survival` clampa na 0.

Lakota:

```text
isStarving = survival <= 0
```

Izgube:

- 1. mesec lakote: 25 % kamp populacije;
- 2. mesec: 50 %;
- 3+ mesec: 75 %.

### Raziskave

Raziskovalci vedno dodajo osnovni intel:

```text
intel += floor(researchers * 8 * rations.strengthMult)
```

Če je cilj `robots`, dodajo še enak dodaten intel bonus in napredujejo v robots research:

```text
intel += floor(researchers * 8 * rations.strengthMult)
robotsResearchProgress += researchers
```

Vsaka raziskovalna stopnja zahteva:

```text
120 raziskovalec-mesecev
```

Zaklep:

- `robotsResearchLevel` odklepa maksimalni level `weaponResearchLevel` in `wallResearchLevel`;
- `weapon` in `wall` ne moreta preseči `robots`.

Učinek levelov:

```text
researchMult(level) = 2^level
```

Orožje:

- level 0: x1;
- level 1: x2;
- level 2: x4.

Obzidje:

- level 0: x1;
- level 1: x2;
- level 2: x4.

### AI insight in AI drevo

Začetek:

```text
aiInsight = 0.01
```

Vsaka runda:

```text
aiInsight += 0.03
```

Fazni stropi:

- `find`: 0.30;
- `understand`: 0.60;
- `eliminate`: 0.90.

AI drevo ima 9 vozlišč:

- 3 tipi robotov;
- za vsakega: unit, mechanical weak point, logical weak point.

Thresholdi:

- scouts: 0.10, 0.20, 0.30;
- attackers: 0.40, 0.50, 0.60;
- peopleKillers: 0.70, 0.80, 0.90.

`revealTreeByInsight`:

- če `aiInsight >= threshold`, node postane `revealed`;
- če je v razponu `threshold - 0.08`, lahko postane `partial`;
- revealed node se nikoli ne degradira.

Razkrite logical weak point točke dajo bojni bonus:

```text
logicalWeaknessBonus = numberOfRevealedLogicalNodes * 0.5
humanCombatMultiplier *= (1 + logicalWeaknessBonus)
```

### Neposredni napad iz kampa

Če `assignment.combatants > 0`, se uporabi `resolveCombat`.

Človeška moč:

```text
equipUsed = min(combatResources, combatants)
base =
  combatants * 1.2 * rations.strengthMult +
  equipUsed * 0.8 * weaponResearchMult

humanStrength = base * intelCombatMultiplier * logicalWeaknessMultiplier
```

Intel:

```text
intelCombatMultiplier = 1 + min(0.25, 0.05 * intelligence / 100)
```

AI moč:

```text
aiStrength = aiDefensePower(aiUnits) * (1 - clanActivity) * foreknowledge
foreknowledge = 1.3 if aiKnowledge > 0.5 else 1.0
```

Verjetnost uspeha:

```text
p = humanStrength * (1 + weakPointBonus) /
    (humanStrength * (1 + weakPointBonus) + aiStrength)
```

Če napad izkorišča odkrito šibko točko:

```text
weakPointBonus = 0.25
```

Izid je RNG:

```text
roll = rngNext()
if roll < p:
  outcome = victory if p - roll >= 0.25 else partial
else:
  outcome = annihilation if roll - p >= 0.25 else defeat
```

Izgube in plen:

| Izid | Ljudje izgubljeni | AI uničen | Plen |
| --- | ---: | ---: | --- |
| victory | 5 % combatants | 90 % engaged | 10 % orožja, +15 intel |
| partial | 20 % | 50 % | 5 % orožja, +8 intel |
| defeat | 55 % | 20 % | +3 intel |
| annihilation | 100 % | 5 % | nič |

`aiRobotsEngaged`:

```text
floor(aiRobots * (1 - clanActivity) * 0.3)
```

### AI raid na kamp

Verjetnost raida:

```text
attackPow = aiAttackPower(aiUnits)
popFactor = min(1, population / 100)

pRaid =
  (0.05 + 0.20 * popFactor + 0.15 * aiKnowledge)
  * (1 - clanActivity * 0.50)
  * min(1, attackPow / 247.5)
```

Če `attackPow <= 0`, raid probability = 0.

Opomba: `axis` trenutno ne vpliva na raid, čeprav je parameter prisoten.

Verjetnost odbitja raida:

```text
defenders = assignment.defenders + dayGuard + nightGuard
weaponMult = 2^weaponResearchLevel
wallMult = 2^wallResearchLevel
wallBonus = 1 + 0.20 * wallMult * wallsBuilt

base = defenders * 1.2 * rations.strengthMult
equip = min(combat, defenders) * 0.40 * weaponMult
defStr = (base + equip) * (1 + intelCombatBonus) * wallBonus

aiStr = aiAttackPower(aiUnits) * (1 - clanActivity) * 0.50

pRepel = defStr / (defStr + max(1, aiStr))
```

Raid izid uporablja isti `rollOutcome(pRepel)`.

Raid žrtve:

Front-line branilci:

| Izid | Branilci | AI uničen |
| --- | ---: | ---: |
| victory | 5 % | 80 % |
| partial | 25 % | 35 % |
| defeat | 60 % | 12 % |
| annihilation | 100 % | 3 % |

People-killerji povečajo smrtnost:

```text
lethality = 1 + 0.012 * peopleKillers
```

Preboj območij:

| Izid | Prebitih območij |
| --- | ---: |
| victory | 0 |
| partial | 1 |
| defeat | 2 |
| annihilation | 4 |

Območja so naključno izbrana iz:

- food;
- workshop;
- research;
- defense.

Žrtve v prebitih območjih:

```text
partial: 20 % * lethality
defeat: 40 % * lethality
annihilation: 70 % * lethality
```

Uničeni viri:

- food: 25 % trenutne hrane;
- workshop: 20 % trenutnega orožja;
- research: 30 % trenutnega materiala;
- defense: -1 stopnja obzidja.

Neuporabljeno orožje se dodatno lahko uniči:

```text
weaponsIdle = max(0, combat - defenders - combatants)
weaponsDestroyed = floor(weaponsIdle * random(20..80 %) / 100)
```

### Odprave

Premik:

```text
TILES_PER_MONTH = 1
pathMonths = path.length - 1
returnMonths = min(pathMonths, hexDistance(lastTile, camp))
roundTripMonths = pathMonths + returnMonths
```

Ob ustvarjanju odprava vzame hrano za `roundTripMonths`.

Stealth:

- vsak 3. mesec preskoči premik;
- srečanja x0.5;
- napad po poti ima +20 % bojni bonus.

Raziskovanje heksa:

```text
researchPerVisit = min(0.55, 0.30 + 0.025 * assigned)
```

Srečanje na heksu:

```text
base = 0.05 + 0.004 * assigned + 0.20 * aiKnowledge
pTile = base * tileEncounterMultiplier * encounterScoutFactor(aiScouts)
pEncounter = stealth ? pTile * 0.5 : pTile
```

`tileEncounterMultiplier`:

- progress < 0.25: x1.5;
- progress < 0.50: x1.2;
- progress < 1.0: x0.7;
- progress = 1.0: x0.3;
- distance <= 1: dodatno x0.5;
- distance <= 2: dodatno x0.8.

`encounterScoutFactor`:

```text
0.25 + 0.75 * min(1, aiScouts / 100)
```

Izgube ob srečanju:

```text
lost = max(1, floor(assignedNow * random(20..50 %) / 100))
```

Najdbe na nepopolnoma raziskanem polju:

- artefakt: 0.5 %;
- orožje: dodatnih 2.5 %;
- material: dodatnih 12 %.

Najdbe se nosijo in pridejo v kamp šele ob vrnitvi.

### Napad po poti

Če je cilj odkrito weak point polje, uporablja `missionSuccessProbability`:

```text
teamPower =
  (sqrt(assigned) * 1.2 * 8 + min(combat, assigned) * 1.2)
  * rations.strengthMult

p = teamPower * (1 + intelBonus) /
    (teamPower * (1 + intelBonus) + wpDifficulty)
```

Težavnosti:

- `wp_power`: 70;
- `wp_comm`: 90;
- `wp_core`: 120.

Stealth:

```text
p = min(0.98, pBase * 1.2)
```

Če je cilj splošni napad na AI:

```text
humanStr =
  survivors * 1.2 * rations.strengthMult *
  stealthBonus *
  weaponResearchMult *
  (1 + logicalWeaknessBonus)

aiStr = max(1, aiDefensePower(aiUnits) * 0.05)
p = humanStr / (humanStr + aiStr)
```

Ob uspehu:

```text
destroyed = min(aiRobots, round(survivors * (1 + p)))
lost = round(survivors * (1 - p) * 0.3)
```

Ob neuspehu:

```text
destroyed = min(aiRobots, round(survivors * 0.5))
lost = round(survivors * 0.6)
```

### Drugi klani

Drugi klani so fiksni:

- Severni klan: people, `(1,0)`;
- Vzhodni klan: material, `(4,3)`;
- Dolinski klan: food, `(2,1)`.

Odkrijejo se pri `researchProgress >= 0.50`.

Če odprava pride na njihov heks, postanejo allied. Vsak allied klan:

```text
clanActivity += 0.04
```

Mesečni bonus:

- food: +8 hrane;
- material: +4 materiala;
- weapons: +2 orožja;
- people: +1 populacija.

### Clan activity in AI knowledge

Osnovni padec:

```text
clanActivity += -0.004 + allyBoost
```

AI surveillance:

```text
exposure = (combatants + researchers) / max(1, state.population)
base = 0.4 * exposure
clansBlock = clanActivity * 0.5
aiKnowledgeGain = max(0, base - clansBlock) * 0.1
```

Raid lahko dodatno poveča `aiKnowledge`:

- victory: +0.03;
- partial: +0.07;
- defeat/annihilation: +0.15.

## Glavne state spremenljivke

### Čas

- `round`;
- `phase`;
- `totalRounds`;
- `aiPhaseProgress`;
- `status`.

### Populacija

- `population`: ljudje v kampu;
- `maxPopulation`;
- ljudje na aktivnih odpravah so ločeno v `expeditions`;
- `activeMissions` je samo legacy/migracijsko stanje, ne normalen gameplay.

### Resursi

- `survival`;
- `combat`;
- `intelligence`;
- `material`;
- `artifacts`.

### AI

- `aiRobots`;
- `aiUnits`;
- `aiKnowledge`;
- `aiInsight`;
- `aiTree`;
- `aiWeakPoints`.

### Raziskave in delavnice

- `robotsResearchLevel`, `robotsResearchProgress`;
- `weaponResearchLevel`, `weaponResearchProgress`;
- `wallResearchLevel`, `wallResearchProgress`;
- `weaponWorkshopProgress`;
- `wallProgress`, `wallsBuilt`;
- `artifactWorkshopProgress`.

### Mapa in odprave

- `mapTiles`;
- `otherClans`;
- `expeditions`;
- `completedExpeditions`;
- `activeMissions`;
- `completedMissions`.

## Testi

Dodani so engine testi za:

- determinizem;
- RNG outcome;
- fazni prehod;
- lakoto;
- AI enote po fazah;
- zmago ob uničenju vseh robotov;
- `destroyAIUnits`;
- encounter faktor glede na AI scout enote;
- research gating;
- `aiInsight`;
- povratni čas odprav;
- raid breached areas;
- `axisHistory`.

To je dober začetek. Manjkajo še testi za:

- frontend/build skladnost;
- validacijo poti v API;
- path-based weak point napad;
- dostavo nošenega plena ob vrnitvi;
- uničenje virov po raid območjih;
- `CompletedRun` brez duplikata, če round endpoint nekako ponovno obdela končano igro;
- edge case z migracijo starih `HumanAxis` vrednosti.

## Neuporabljena ali legacy koda

### Engine

Neuporabljeni importi ali legacy:

- `createRNG` v `game.ts`;
- `rngBool` v `game.ts`;
- `spendScoutsOnMap` v `game.ts`;
- `visibilityFromProgress` v `game.ts`;
- `tileId` v `game.ts`;
- `adaptGenome` v `game.ts`;
- `SCOUT_FOG_YIELD`;
- `CLAN_ACTIVITY_BY_PHASE`;
- `CLAN_ACTIVITY_HIDDEN_MODIFIER`;
- `PHASE_EVENT_BASE_DAMAGE`;
- `PREPARED_DAMAGE_REDUCTION`;
- `SCOUT_HIDING_REDUCTION`;
- `SCOUT_PARTIAL_EFFECTIVE`;
- `SCOUT_CAPTURED_LOSS_MAX` v `game.ts`;
- `currentAxis`;
- legacy `scoutSuccessProbability` / `scoutCaptureProbability`;
- legacy `scouts`, `scoutPlan`, `dayGuard`, `nightGuard`;
- legacy `activeMissions` timer sistem.

### Frontend

Verjetno neuporabljene komponente:

- `ResStat`;
- `ResourceRow`;
- `ClanStatus`;
- `WeakPoints`;
- `PeopleAllocator`;
- `PeopleBar`;
- `SliderRow`;
- `RationsSelector`;
- `OddsDisplay`;
- `OddsArc`;
- `BalanceTrend`;
- `HumanMissionsPlaceholder`.

Stanje/flow:

- `combatants` obstaja, vendar path attack uporablja `draftPeople`; direct combat UI ni več glavni flow.
- `missionAssignments` in `activeMissions` ostajata v tipih zaradi kompatibilnosti starih sej, vendar normalni UI in engine gameplay uporabljata `newExpeditions`.

## Potencialni bugi in neskladja

### 1. Pravila in razlage so še razpršene

`RulesModal` je bil posodobljen na research-driven sistem, vendar razlage še vedno živijo na več mestih:

- `HELP`;
- `RulesModal`;
- panel tekst;
- tooltipi;
- engine komentarji.

Tveganje ni več staro besedilo o `skrivanje / špijonaža / obramba`, ampak ponovno razhajanje formul in opisov ob naslednjih gameplay spremembah.

### 2. UI pravi, da nizka populacija znižuje napad, vendar raid uporablja kamp populacijo

To je delno res, vendar `population` v engineu pomeni kamp populacijo. Ljudje na odpravah niso v `population`, zato lahko množično pošiljanje ven zniža raid chance na kamp. Če je to namerno, naj UI to razloži kot "manj ljudi v kampu", ne "nižja populacija".

### 3. Attack preview po poti ne uporablja iste formule kot engine

UI v zavihku Napad računa:

```text
hStr = draftPeople * 1.2 * rations * stealth
aiStr = aiDefensePower(aiUnits) * 0.05
```

Engine za splošni path attack vključuje še:

- `weaponResearchLevel`;
- `logicalWeaknessBonus`.

Engine za weak point path attack uporablja čisto drugo formulo `missionSuccessProbability`. Zato UI `OCENA ZMAGE` ni zanesljiva za vse napade.

### 4. Pending expedition prikazuje samo pot tja, engine hrano računa tja+nazaj

V map tab pending row:

```text
months = e.path.length - 1
food = assigned * months * foodMult
```

Engine ob ustvarjanju uporablja:

```text
roundTripMonths(path)
```

Glavni draft panel že kaže `tja + nazaj`, pending seznam pa lahko kaže premalo hrane/časa.

### 5. `rngInt` zgornja meja je max-exclusive

Komentarji in UI razlage uporabljajo intervale kot "−5 do −3" in "+1 do +3", vendar `rngInt(min,max)` zgornje meje ne vključuje. To vpliva na obroke in loss roll opise.

### 6. Server validacija ne preverja sosednosti poti

Frontend omejuje klik na sosednje hekse, API pa sprejme poljubno pot. Ker je produkcijski API javen, lahko client pošlje teleport poti.

### 7. Legacy misije ostajajo v tipih in migraciji

Path-based odprave/napadi so zdaj normalni sistem. `activeMissions` se ne uporablja več za normalen gameplay, vendar ostaja v tipih in migraciji starih sej. To je še vedno tehnični dolg, ker tip še namiguje na star sistem.

### 8. `aiInsight` je research-driven, a razlaga mora ostati centralizirana

AI drevo se zdaj odpira prek raziskovalcev. `robots` research daje poln insight gain, `weapon`/`wall` samo 15% stranski gain. Preostalo tveganje je, da UI tooltipi ali dokumentacija ob prihodnjem balansiranju ne bodo več sledili konstantam.

### 9. `axisHistory` beleži fokus, vendar osi nimajo neposrednega mehanskega učinka

`axisHistory` je zdaj predvsem UI/progress/future hook. V `processRound` komentar pravi, da je brez mehanskih učinkov. Če UI daje občutek, da izbira osi ta mesec neposredno spremeni izid, je to napačno.

### 10. `clanActivity` uporablja samo fiksni padec

Konstante `CLAN_ACTIVITY_BY_PHASE`, `CLAN_ACTIVITY_HIDDEN_MODIFIER` ostajajo, a trenutni engine uporablja samo:

```text
-CLAN_ACTIVITY_EXPOSURE_MODIFIER + allyBoost
```

Ni fazne krivulje in ni posebnega hiding/focus vpliva.

### 11. `PhaseEvent` in fazni damage niso uporabljeni

`PHASE_EVENT_BASE_DAMAGE` in `PREPARED_DAMAGE_REDUCTION` ostajata, vendar fazni prehod samo razkrije vozlišča in pripelje nove AI enote.

### 12. Direct combat uporablja `state` pred novimi research spremembami

Če raziskovalci v isti rundi dokončajo `weaponResearchLevel`, neposredni `resolveCombat` še uporablja `state.weaponResearchLevel`, ne lokalno posodobljenega levela. Verjetno je to sprejemljivo, ker raziskava začne učinkovati naslednji mesec, ampak UI naj to ne predstavlja kot instant.

### 13. Raid uporablja `state` pred delavniškimi spremembami pri obrambi

`raidRepelProbability(state, assignment)` uporablja `state.wallsBuilt` in `state.resources.combat`, ne lokalno v isti rundi zgrajenega orožja/obzidja. To pomeni, da novo zgrajeno obzidje učinkuje naslednji mesec. To je lahko pravilno, a mora biti razloženo.

### 14. `populationDelta` pri returning expeditions šteje vračanje kot spremembo klana?

`totalClanBefore` vključuje vse odprave. Ko returning odprava pride domov, ni več v `tickedExps`, ampak se doda v `finalPopulation`, zato delta bi moral ostati nevtralen. To je pravilno, vendar je občutljivo; test za to bi bil koristen.

### 15. Event log je še vedno frontend-only

Po refreshu izgine zgodovina razen zadnjega `lastRoundLog`.

### 16. `GameState.population` ime ostaja nejasno

V engineu pomeni kamp populacijo, v nekaterih UI labelih še vedno izgleda kot celotna populacija. Ker je "na odpravi" ločeno prikazano, naj top label jasno govori "V kampu" ali naj se uvede derived `totalClanPopulation`.

## Tehnični dolg

### Monolitni `App.tsx`

`App.tsx` je približno 3727 vrstic. Smiselna delitev:

- `screens/StartScreen.tsx`;
- `screens/GameScreen.tsx`;
- `screens/GameOverScreen.tsx`;
- `components/map/HexMap.tsx`;
- `components/panels/DefensePanel.tsx`;
- `FoodPanel.tsx`;
- `WorkshopPanel.tsx`;
- `ResearchPanel.tsx`;
- `ExpeditionPanel.tsx`;
- `AttackPanel.tsx`;
- `hooks/useGameSession.ts`;
- `hooks/useEventLog.ts`;
- `hooks/useDraftPath.ts`.

### Monolitni `processRound`

`game.ts` je približno 1092 vrstic. Smiselni čisti moduli:

- `round/food.ts`;
- `round/research.ts`;
- `round/workshop.ts`;
- `round/raid.ts`;
- `round/expeditions.ts`;
- `round/missions.ts`;
- `round/allies.ts`;
- `round/ai-progress.ts`;
- `round/log.ts`.

### Legacy odstranitev

Normalni gameplay uporablja path-based `expeditions`. Preostali dolg:

1. odstraniti `activeMissions` in `missionAssignments` iz tipov, ko migracija starih sej ne bo več potrebna;
2. odstraniti stare helperje in UI placeholderje, ki so ostali kot zgodovinski ostanki;
3. dodati server-side migracijski test za stare shranjene seje.

### Pravila in formula razlage

Treba je centralizirati pravila v dokument ali data strukturo, iz katere se polni UI. Trenutno so razlage raztresene:

- `HELP`;
- `RulesModal`;
- panel text;
- title atributi;
- engine komentarji.

Zaradi tega obstaja tveganje, da se `RulesModal` ali panel tooltipi ponovno razidejo z engineom.

### API validacija poti

Dodati server-side:

- validne koordinate;
- pot se začne v kampu;
- vsak korak je sosed;
- `kind` validacija;
- `assigned <= available population`;
- food cost sanity;
- prepoved negativnih `missionAssignments`.

### Test coverage

Dodati teste za najbolj tvegane stvari:

- path attack formula in weak point success;
- returning expeditions ne spremenijo total clan population;
- carried loot se dostavi šele ob vrnitvi;
- raid resource destruction;
- server validation, če se doda unit/integration layer.

## Priporočena prioriteta

1. Centralizirati formule in razlage za research, attack preview, raid odds in weak point bonuse.
2. Dodati server validacijo poti.
3. Odstraniti legacy `activeMissions`/`missionAssignments` iz tipov, ko migracija ni več potrebna.
4. Uvesti derived prikaz `totalClanPopulation = population + expeditions`.
5. Popraviti max-exclusive razlage ali spremeniti `rngInt`/klice v inclusive helper.
6. Razbiti `processRound` in `App.tsx` v module.
7. Persistirati round history ali vsaj zadnjih N logov v `GameState`.
8. Dodati teste za odprave, raid damage in UI/engine formula skladnost.
