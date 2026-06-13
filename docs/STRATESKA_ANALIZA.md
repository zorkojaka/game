# AI vs Humanity — Strateška analiza gameplaya

> Stanje engina ob pisanju (veja `claude`, sinhronizirano z `main`). Vse številke so iz
> `src/engine/constants.ts`, `combat.ts`, `game.ts`, `difficulty.ts`, `expedition.ts`.
> Ta dokument je *opis srca igre* — kasneje del notranjega "inšpektorja engina" v meniju.

---

## 1. Kako se ZMAGA in kako se IZGUBI

### Zmaga igralca — dve poti (`game.ts:1086`)
```
if (aiRobots <= 0  ||  vse šibke točke uničene)  →  ZMAGA
```
1. **Iztrebljenje vojske** — pobiješ *vse* AI robote (z odbijanjem raidov in/ali napadi).
2. **Uničenje šibkih točk** — uničiš vse **3 šibke točke**:
   - `wp_power` (Centralni energetski vozli) — relevantna od faze 1
   - `wp_comm` (Komunikacijski protokol) — faza 2
   - `wp_core` (Centralno procesorsko jedro) — faza 3

Vsako šibko točko uničiš na **dva načina**:
- **Napad/misija** — pošlješ odpravo na polje, kjer je skrita; rezultat je verjetnosten.
- **Artefakt** — instant uničenje, brez kocke (`game.ts:700`). En artefakt = ena točka.

### Poraz igralca — samo izumrtje (`game.ts:1055`)
```
if (skupni klan ≤ 0)  →  defeat_extinction
```
Skupni klan = ljudje v kampu + ljudje na misijah + ljudje na odpravah. **Rok-poraza ni več.**
Po 36. mesecu se igra **nadaljuje** v ero totalnega napada.

### Kako lahko zmaga AI
AI nima eksplicitne "zmage" — **zmaga tako, da te iztrebi** (pripelje te na klan ≤ 0).
To doseže prek raidov (preboji obrambe → žrtve) in stradanja, ki ga sprožiš sam.
> **Posledica:** AI je trenutno *pasiven mehanizem*, ne odločevalec. To je glavni
> manjko za resno strateško igro in za 2-player (poglavje 6).

---

## 2. Predvideni lok igre vs dejanska dinamika

| Obdobje | Meseci | Kaj pride (normal) | Načrtovani raidi |
|---|---|---|---|
| **Faza 1 — Najdi** | 1–12 | 100 izvidnikov (šibki) | 1–3 |
| **Faza 2 — Razumi** | 13–24 | +75 napadalcev (močni) | 2–4 |
| **Faza 3 — Iztrebi** | 25–36 | +25 people-killerjev (smrtonosni) | 4–6 |
| **Totalni napad** | 37+ | AI ve, kje je kamp | **8–10 / leto** |

**Moč AI enot** (`constants.ts:31`): izvidnik napad 0.4 / obramba 0.5 / hp 1 · napadalec
1.6 / 1.2 / hp 2 · people-killer **3.5 / 2.6 / hp 4**. People-killerji dodatno večajo
smrtnost raida (+1.2 % na enoto, do ~+30 %).

> **Srce napetosti (točno tvoje opažanje):** igralec se lahko *neskončno* izboljšuje, a
> AI eskalira po urniku. Kdor "čaka in optimizira", ga faza 3 ujame nepripravljenega —
> in ker so takrat orožje/ljudje že porabljeni, je vrnitev težka. Hkrati AI *predolgo*
> dejansko iztreblja, ker igralec dobiva nove preživele (`SURVIVOR_RESCUE_CHANCE = 0.15`).

---

## 3. Pet strateških vzvodov (po pomembnosti za izid, ne razporeditev enot)

> Tvoja poanta: **razporeditev enot je drugotnega pomena — štejejo REZULTATI.**
> Spodaj je za vsak vzvod *od česa je odvisen izid* in *kje je past*.

### 3.1 OROŽJE (resources.combat) — osrednji vir, vir "death spirala"
Eno orožje služi **trem** stvarem hkrati:
- obramba: `equip = min(combat, branilci) × 0.40 × orožje_mult` (`game.ts:179`)
- napad na točko: del `teamPower` (`game.ts:239`)
- odprave ga **nesejo s seboj** (ne-stealth), vrnejo ob povratku (`game.ts:760`)

**Past:** ko orožja zmanjka, ne moreš ne dobro braniti ne napadati → težko nadoknadiš
(delavnica: 6 delavec-mesecev + 1 material na kos). **Stealth izvidniki orožja NE
porabijo** (`game.ts:760`) — torej je tvoj predlog "izvidniki brez orožja" za stealth
*že res*; odprto vprašanje je le, ali to velja tudi za navadne izvidnike.

### 3.2 RAZISKAVE — ×2 učinek na stopnjo, a počasne
- **Roboti** odpirajo *insight* (znanje o AI) → razkrivajo šibke točke in logične bonuse.
  Insight raste **samo z raziskovalci** (`AI_INSIGHT_PER_RESEARCHER = 0.003`), s faznimi
  stropi 30 % / 60 % / 90 % (`constants.ts:246`).
- **Orožje / Obzidje**: vsaka stopnja **podvoji** učinek (`researchMult = 2^level`),
  a stane 60 raziskovalec-mesecev na stopnjo.
> **Past (tvoje opažanje):** v fazi 3 je AI nemogoče ujeti, če nisi nič raziskal —
> ker brez orožja-stopenj in razkritih šibkih točk so napadi prešibki.

### 3.3 OBRAMBA + OBZIDJE — edina pot do "obrambne zmage"
`P(odbij) = defStr / (defStr + aiStr)`, kjer:
```
defStr = (branilci×1.2×rations + min(combat,branilci)×0.4×orožje_mult) × (1+intel) × wallBonus
wallBonus = 1 + wallDefensePct × 2^wallResearch × šт_obzidij      (normal: +2 %/obzidje)
aiStr   = efektivna_napadalna_moč_AI × 0.20
```
Izid skozi **taktično kocko** (80/20, poglavje 4). Močna obramba v eri totalnega napada
melje vojsko → zmaga z iztrebljenjem. **Obzidje je linearno** (vsak +X %), obzidje-stopnje
podvojijo prispevek.

### 3.4 HRANA / OBROKI — rast ljudi in moč dela
Obroki 1–5 (`constants.ts:153`): vplivajo na **porabo** (×0.5–×5), **rast populacije**
(−5…+6/mesec) in **moč** (×0.55–×1.6). Obilje (5) = +3..6 ljudi/mesec, a požre 5× hrane.
Več ljudi → več branilcev/delavcev/napadalcev → več moči povsod.

### 3.5 SKRIVANJE LJUDI — varni, dokler te AI ne "vidi"
Nerazporejeni ljudje so "skriti". Trenutno so žrtve **šele pri `aiKnowledge ≥ 0.99`**
(`game.ts:307`). **Predlog (tvoj): znižati na 0.95** — da je pozno-igralna izpostavljenost
realna grožnja in skrivanje ni "skoraj zastonj".

---

## 4. Kako se določi IZID boja — taktična kocka (taktika > sreča)

Vsak boj/raid uporabi `tacticalRoll` (`combat.ts:106`):
```
roll = 0.5 + (rng − 0.5) × 0.6        → roll ∈ [0.20, 0.80]
P ≥ 0.80  ⇒ VEDNO uspeh        P ≤ 0.20  ⇒ VEDNO neuspeh
```
- **Uspeh je zaslužen z močjo** — če imaš premoč, zmagaš zagotovljeno.
- **Dominacija ni zagotovljena** — *razred* izida (navadno / popolno) določa margina
  `DECISIVE_MARGIN = 0.25` proti rollu. Tudi pri P = 1 je popolna dominacija stvar
  verjetnosti, ne pravice.

Razredi raida → preboji (`constants.ts:282`): zmaga 0 con, delno 1, poraz 2, pokol vse 4.
Žrtve so **zvezne** glede na moč preboja (`1 − P(odbij)`).

> **Opomba o "mrtvih" konstantah:** `VICTORY_THRESHOLD / PARTIAL_THRESHOLD /
> DEFEAT_THRESHOLD` (0.65/0.45/0.20) so iz starega determinističnega modela; zdaj
> izid določa `rollOutcome`. Predlagam, da jih v inšpektorju jasno označimo kot legacy
> (ali odstranimo), da ne zavajajo.

---

## 5. Ugotovljene težave in predlogi za RESNO igro

| # | Težava | Predlog | Datoteka |
|---|---|---|---|
| P1 | Skrivanje "skoraj zastonj" (prag 0.99) | **prag na 0.95** | `game.ts:307` |
| P2 | Orožje = en sam vir za obrambo+napad+odprave → death spiral | izvidniki naj **nikoli** ne porabijo orožja (ne le stealth); razmisli o ločenem "obrambnem" vs "ofenzivnem" orožju | `game.ts:760`, `179`, `239` |
| P3 | Šibke točke se v praksi ne najdejo pravočasno (sim: 0/3) | hitrost/doseg raziskovanja ali zgodnejša vidnost šibkih točk; cilj: vse 3 najdljive do faze 3 | `expedition.ts`, `map.ts` |
| P4 | AI ne sprejema odločitev (statičen genom, urnik) | dati AI dejanske odločitve (poglavje 6) | `ai-brain.ts` |
| P5 | Legacy pragovi zavajajo | označi/odstrani | `constants.ts:115` |
| P6 | "Predolgo umiranje" v fazi 3 | znižati `SURVIVOR_RESCUE_CHANCE` v eri totalnega napada, da iztrebljenje ni neskončno | `constants.ts:103` |

> **Pomembno (metodologija):** meriti je treba **rezultate, ne razporeditve.** Npr.
> "dal ljudi na artefakt, a ga ni dokončal" ne pove nič. Zato self-improvement loop
> (ločen dokument) zajema *dosežke*: izdelano orožje, poslane/lootane odprave, izvedene
> napade, raziskane stopnje, zgrajeno obzidje, uničene točke — ne deležev razporeditve.

---

## 6. Inšpektor engina (meni) — "celo srce igre na enem mestu"

Cilj: zaslon, kjer **kadarkoli** vidiš stanje obeh strani + vse uteži + žive izračune.
(Kasneje skrijemo navadnim igralcem.) Predlagana drevesna struktura:

```
SRCE IGRE
├─ JAZ (klan)
│  ├─ Ljudje: skupaj / branilci / nabiralci / delavci / raziskovalci / skriti
│  ├─ Viri: hrana (+poraba/mesec) · orožje · material · intel · artefakti
│  ├─ Tehnologija: orožje Lv (×2^Lv) · obzidje Lv · št. obzidij · insight %
│  └─ Moč: P(odbij raid) · P(napad na vsako točko) — z razčlembo členov
├─ AI
│  ├─ Enote: izvidniki / napadalci / people-killerji (napad·obramba·hp)
│  ├─ Napadalna moč (raid) · obrambna moč · garnizije šibkih točk
│  ├─ aiKnowledge % (kdaj +foreknowledge / kdaj vidi skrite)
│  └─ Raid-plan tega obdobja (kateri meseci napade)
├─ MAPA: razkrita polja, kje so šibke točke, kje AI jedro, kje smo mi
└─ UTEŽI & FORMULE (žive vrednosti)
   ├─ tacticalRoll: pas [0.20,0.80], DECISIVE_MARGIN 0.25
   ├─ P(odbij) = defStr/(defStr+aiStr) — vstavljene trenutne številke
   ├─ teamPower napada = … — vstavljene trenutne številke
   └─ vse konstante iz constants.ts, grupirane po učinku (= "balančni list")
```
Ključno: formule naj se prikažejo z **vstavljenimi trenutnimi vrednostmi**, da vidiš
*zakaj* je P(odbij) npr. 0.62 ta mesec, ne le številko.

---

## 7. Simetrični AI → 2-player (AI igra drugi človek)

Da bo igra uravnotežena za dva igralca, mora AI sprejemati **zrcalne odločitve** igralcu:

| Igralec odloča | AI naj odloča (simetrično) |
|---|---|
| razporeditev ljudi | razporeditev robotov: raid / patrulja mape / straža točk / lov na odprave |
| obroki, rast | produkcija novih enot (tempo, kateri tip) iz lastne ekonomije |
| raziskave (orožje/obzidje/roboti) | nadgradnje enot (napad/hp/smrtnost/foreknowledge) |
| kam odprave, stealth/loot | kam izvidovati, da nas najde + kje koncentrira napad |
| kdaj napasti točko | kdaj sprožiti raid vs zbirati intel |
| zgradi obzidje / artefakt | utrdi garnizijo točk / "anti-artefakt" obramba |

**Kar manjka v kodi:** AI nima ekonomije (enote pridejo po fiksnem urniku) ne ciljne
funkcije. Predlagani koraki:
1. **AI ekonomija** — robotom dati produkcijski vir (material/energija) in tempo, da
   *AI sam* odloča, koliko in katerih enot zgradi (namesto fiksnih prihodov po fazah).
2. **AI akcijski prostor** — formalizirati zgornje odločitve kot "AI potezo" na rundo
   (zrcalo `PlayerAction`).
3. **AI politika** — najprej skripta (hevristike), nato genom iz self-improvement loopa
   (uči se proti resničnim igralcem), nazadnje **človeški drugi igralec** prek istega
   akcijskega prostora.
4. **Uravnoteženje** — ker je engine determinističen, lahko 2-player ravnotežje testiramo
   z replayem (obe strani igrata znane poteze pod danimi konstantami).

> To je ločen vir od balansa 1-player: 2-player zahteva, da sta **obe** strani polni
> odločevalki s primerljivo ekonomijo in akcijskim prostorom.

---

## 8. Povzetek — kaj predlagam za "resno igro"

1. **Takoj/poceni:** P1 (skrivanje 0.95), P5 (legacy konstante), P2 (izvidniki brez orožja).
2. **Strukturno:** P3 (najdljivost šibkih točk) + P6 (iztrebljenje ni neskončno) — da je
   lok "razišči → pripravi → napadi → totalni napad" dejansko igralen po vseh poteh.
3. **Vidnost:** inšpektor engina (poglavje 6) — da balansiraš brez branja kode.
4. **Merjenje:** self-improvement loop na **dosežkih**, ne razporeditvah (ločen dokument).
5. **Dolgi cilj:** simetrični AI → 2-player (poglavje 7).

Naslednji korak: skupaj izberemo, kaj gre v prvi izvedbeni sveženj, in šele nato kodiramo.
