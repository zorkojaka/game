# Audit projekta: AI vs Humanity

Datum pregleda: 2026-06-01

## Povzetek

Projekt je majhna TypeScript/React igra z jasnim namenom: potezna enoigralska strategija, kjer igralec vodi človeški klan proti AI. Arhitekturno je razdeljen na engine (`src/engine`), REST strežnik (`src/server`, `src/db`) in Vite/React frontend (`client/src`).

Največja tehnična značilnost projekta je, da je veliko gameplay logike že skoncentrirane v čistem engine modulu, vendar sta tako engine kot UI zrasla v velike monolite:

- `src/engine/game.ts` ima 943 vrstic in vsebuje skoraj celotno mesečno simulacijo.
- `client/src/App.tsx` ima 3374 vrstic in vsebuje praktično vse zaslone, komponente, state in UI izračune.
- Testnih datotek trenutno ni.
- Obstaja precej legacy kode za star sistem scoutov/misij, ki ni več aktivno povezana z novim sistemom odprav po heks mapi.

## Struktura projekta

```text
.
├── AGENTS.md
├── CLAUDE.md
├── deploy.sh
├── ecosystem.config.cjs
├── package.json
├── tsconfig.json
├── docs/
│   └── audit.md
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

### Backend in DB

- `src/server/index.ts` je Express aplikacija. Servira `/api/*` in produkcijski frontend build iz `client/dist`.
- `src/db/connection.ts` vzpostavi MongoDB Atlas povezavo z `MONGO_URI` in bazo `ai-vs-humanity`.
- `GameSession` hrani celoten `GameState` z `strict: false`, zato lahko preživi evolucijo stanja brez migracij.
- `CompletedRun` hrani končane run-e za statistiko in bodočo evolucijo AI.
- `Feedback` hrani povratne informacije igralcev.

### Engine

- `types.ts`: vsi glavni tipi.
- `constants.ts`: balancing konstante.
- `game.ts`: `newGame`, `processRound`, `previewOdds` in večina pravil.
- `combat.ts`: izračun moči, odds in izidov bojnih napadov.
- `expedition.ts`: premikanje odprav po mapi, tveganja, najdbe.
- `map.ts`: generiranje heks mape, drugi klani, vidnost heksov.
- `fog.ts`: odkrivanje AI drevesa.
- `ai-brain.ts`: AI genome, drevo AI in šibke točke.
- `rng.ts`: deterministični RNG.

### Frontend

- `client/src/App.tsx`: en velik React monolit z vsemi zasloni, UI komponentami, lokalnim stateom, logiko poti, preview izračuni in layoutom.
- `client/src/api.ts`: fetch wrapperji za API.
- `client/src/types.ts`: kopija engine tipov za frontend.
- `client/src/index.css`: celoten styling aplikacije.

## API poti

- `POST /api/game/new`: ustvari novo igro, shrani `GameSession`, vrne `runId` in `state`.
- `GET /api/game/:runId`: vrne stanje igre.
- `POST /api/game/:runId/round`: izvede eno rundo prek `processRound`, posodobi sejo in po potrebi ustvari `CompletedRun`.
- `POST /api/game/:runId/preview`: vrne odds za trenutno razporeditev.
- `POST /api/feedback`: shrani feedback.
- `GET /api/feedback`: vrne zadnjih 200 feedback zapisov.
- `GET /api/sessions`: vrne zadnjih 20 sej.

## Vse strani in zasloni

Projekt nima routerja. Vse je v `App.tsx`, prikaz pa je odvisen od stanja igre in izbranega zavihka.

### Start screen

`StartScreen` se prikaže, ko ni aktivnega `game` stanja. Uporabnik lahko začne novo igro. Ob zagonu frontend poskusi iz `localStorage` prebrati `avh-runId` in naložiti obstoječo igro.

### Glavni game screen

Glavni ekran je `app-shell` z:

- zgornjo vrstico resursov, populacije, AI statusa in menija;
- levim nav menijem z zavihki;
- centralno operativno heks mapo;
- desnim dnevnikom dogodkov;
- spodnjo vrstico s fazami in gumbom `NASLEDNJI MESEC`.

### Zavihek Obramba

Prikazuje:

- število branilcev;
- verjetnost AI napada v tekočem mesecu;
- kumulativno verjetnost vsaj enega napada v 6 mesecih;
- verjetnost odbitja napada;
- število obzidij in bonus;
- bojno kapaciteto iz orožja.

### Zavihek Prehrana

Prikazuje:

- število nabiralcev;
- obroke;
- pridelek;
- porabo kampa;
- projekcijo hrane naslednji mesec;
- oceno varnosti nabiranja.

### Zavihek Delavnice

Prikazuje delavce in cilj izdelave:

- orožje;
- obzidje;
- artefakt.

Prikazuje material, obstoječe orožje/obzidje in napredek delavec-mesecev.

### Zavihek Raziskave

Prikazuje raziskovalce in cilj:

- `AI roboti`: več intela za bojni bonus;
- `Ranljivosti`: razkrivanje AI drevesa.

### Zavihek Izvidniki

Uporabnik riše pot po heks mapi. Pot se lahko potrdi kot scout odprava. Odprava vzame ljudi in hrano, nato se po izvedbi meseca doda v `newExpeditions`.

### Zavihek Napad

Uporabnik riše pot do AI jedra ali odkrite šibke točke. Pot se potrdi kot `mission` odprava. Spopad se zgodi ob prihodu na cilj, ne takoj ob kliku.

### Zavihek V teku

Prikazuje aktivne `expeditions` in stare `activeMissions`, če obstajajo.

### Zavihek Misije

Prikazuje:

- `AlliesPanel`: drugi človeški klani, odkrite lokacije, zavezništva in mesečni bonus.
- `Missions`: stare misije proti šibkim točkam prek `missionAssignments`, ločeno od novega sistema poti.

### Zavihek Drevo

Prikazuje:

- `HumanTree`: napredek po oseh `hiding`, `espionage`, `defense`.
- `AITree`: AI načrtovalno drevo po fazah.

### Dnevnik dogodkov

`EventLog` je frontend-only časovni trak zadnjih 50 vnosov. Zgradi se iz `lastRoundLog` po vsaki rundi in ni trajno shranjen kot seznam; po refreshu ostane samo zadnji `lastRoundLog`, ne celotna zgodovina.

### Modali

- `FeedbackModal`: pošiljanje predlogov/napak.
- `RulesModal`: razlaga pravil.
- `PhaseTransitionBanner`: prikaz ob prehodu faze.
- `GameOverScreen`: končni ekran za zmago ali poraz.

## Game loop

Glavna zanka je:

1. Frontend naloži ali ustvari `GameState`.
2. Igralec razporedi ljudi, obroke, delavnice, raziskave in morebitne odprave.
3. Frontend kliče `POST /api/game/:runId/preview` za predogled verjetnosti.
4. Ob kliku `NASLEDNJI MESEC` frontend pošlje `PlayerAction`.
5. Server naloži `GameSession`, pokliče `processRound(state, action)` in shrani nov state.
6. Frontend dobi nov `state`, iz `lastRoundLog` sestavi vnos v lokalni event log in nadaljuje.

Engine je zamišljen kot determinističen. V `GameState` sta `rngSeed` in `rngCallCount`; vsak RNG klic poveča števec. To omogoča ponovljivost, če ista začetna igra prejme iste akcije.

## Kako delujejo runde

`processRound` izvede eno mesečno rundo v tem zaporedju:

1. Če igra ni `active`, vrne nespremenjeno stanje.
2. Inicializira RNG iz `rngSeed` in `rngCallCount`.
3. Izračuna celotno velikost klana pred rundo: kamp + aktivne misije + odprave.
4. Normalizira razporeditev borcev in branilcev glede na razpoložljivo orožje.
5. Iz `axisHistory` izračuna nivoje `hiding`, `espionage`, `defense`.
6. Uporabi obroke za porabo hrane, moč in populacijske učinke.
7. Kamp porabi hrano, nabiralci proizvedejo hrano.
8. Raziskovalci dodajo intel in po potrebi razkrivajo AI drevo.
9. Delavci napredujejo v delavnicah in porabijo material za orožje, obzidje ali artefakt.
10. Šibke točke se lahko odkrijejo prek AI drevesa ali raziskane mape.
11. Neposredni `combatants` napad je še podprt v engineu, vendar frontend trenutno v `handleRound` vedno pošlje `combatants: 0`; dejanski napadi so prek poti.
12. AI lahko izvede raid na kamp. Verjetnost temelji na populaciji, AI znanju, osi in aktivnosti drugih klanov.
13. Uporabi se artefakt, če je izbran.
14. Aktivne odprave se premaknejo za en korak, lahko doživijo srečanja, najdbe, odkritja, zavezništva ali boj ob prihodu.
15. Nove odprave iz `assignment.newExpeditions` se sprejmejo: ljudje odidejo iz kampa, hrana se odšteje upfront.
16. Stare `activeMissions` se tickajo, nove iz `missionAssignments` se lahko začnejo.
17. Drugi klani se odkrijejo in zavezniki pošljejo mesečne bonuse.
18. `clanActivity` se posodobi glede na skrivanje/izpostavljenost in zaveznike.
19. AI pridobi novo `aiKnowledge` iz nadzora.
20. Lakota lahko ubije del populacije.
21. Obroki lahko spremenijo populacijo.
22. Preveri se poraz zaradi izumrtja ali popolnega AI znanja v fazi `eliminate`.
23. Napreduje faza/mesec, po 12 rundah pride do prehoda faze.
24. Če so vsi roboti uničeni ali vse šibke točke exploited, status postane `victory`.
25. Sestavi se `RoundLog` in vrne nov `GameState`.

## Kako deluje AI napredek

AI ima tri faze:

- `find`;
- `understand`;
- `eliminate`.

Vsaka faza traja 12 rund (`ROUNDS_PER_PHASE`). `aiPhaseProgress` se vsak mesec poveča za 1. Ko doseže 12:

- `round` se resetira na 1;
- `phase` preide na naslednjo fazo;
- `aiPhaseProgress` se resetira na 0;
- vozlišča zaključene faze v `aiTree` se retroaktivno razkrijejo in označijo kot `executed`.

AI napredek ni trenutno vezan na `DEFAULT_GENOME.phaseSpeed`, čeprav genome vsebuje `phaseSpeed`. AI tudi ne izbira aktivnih akcij iz `aiTree`; drevo je predvsem fog-of-war in narativna struktura. Realni pritisk AI prihaja iz:

- števila `aiRobots`;
- `aiKnowledge`;
- `raidProbability`;
- faznih prehodov;
- raid izidov;
- interakcije s `clanActivity`.

`aiKnowledge` raste glede na izpostavljenost igralca:

```text
exposure = (combatants + researchers) / population
gain = calcAISurveillanceGain(DEFAULT_GENOME, clanActivity, exposure)
```

Drugi klani z višjim `clanActivity` zmanjšujejo AI surveillance gain. Raid izidi lahko dodatno povečajo `aiKnowledge`.

## Glavne komponente

### Engine komponente

- `newGame(seed?)`: ustvari začetni `GameState`.
- `processRound(state, action)`: glavni mesečni reducer.
- `previewOdds(state, assignment)`: izračuna preview za UI.
- `resolveCombat`: razreši neposreden napad.
- `resolveRaid`: razreši AI napad na kamp.
- `tickExpedition`: premakne odpravo po mapi in sproži srečanja/najdbe.
- `spendIntelOnFog`: porabi raziskovalni budget za AI drevo.
- `generateMap`: ustvari fiksno 6x5 heks mapo.
- `generateOtherClans`: ustvari fiksne druge klane.
- `generateAITree`: ustvari fiksno AI drevo.
- `generateAIWeakPoints`: ustvari tri šibke točke.

### Frontend komponente

Najpomembnejše aktivne komponente:

- `App`: glavni state, API klici, layout, tab routing.
- `StartScreen`, `GameOverScreen`.
- `PhaseHeader`, `PhaseTransitionBanner`.
- `BigStat`, `RationsMini`, `WorkshopSelector`, `ResearchSelector`.
- `HexMap`: mapa, kamp zoni, risanje poti, odprave, weak point markerji.
- `AlliesPanel`, `Missions`.
- `HumanTree`, `AITree`, `NodeCard`.
- `EventLog`, `RoundLog`.
- `FeedbackModal`, `RulesModal`.
- `FitScale`: pomanjša vsebino levih panelov.

Komponente, ki obstajajo, a niso več očitno uporabljene:

- `ResStat`;
- `ResourceRow`;
- `ClanStatus`;
- `WeakPoints`;
- `PeopleAllocator`;
- `PeopleBar`;
- `SliderRow`;
- `AxisSelector`;
- `RationsSelector`;
- `OddsDisplay`;
- `OddsArc`;
- `BalanceTrend`;
- `HumanMissionsPlaceholder`;
- verjetno tudi `RoundLog` kot samostojen prikaz zadnjega meseca.

## Glavne game state spremenljivke

### Čas in status

- `round`: mesec znotraj faze, 1-12.
- `phase`: `find`, `understand`, `eliminate`.
- `totalRounds`: globalni števec mesecev.
- `status`: `active`, `victory`, `defeat_extinction`, `defeat_overwhelmed`.
- `runId`: ID seje.

### Populacija

- `population`: ljudje v kampu. Pomembno: ljudje na aktivnih misijah/odpravah niso vključeni.
- `maxPopulation`: največja dosežena populacija.
- `consecutiveStarvationMonths`: zaporedni meseci lakote.

### Resursi

- `resources.survival`: hrana/voda.
- `resources.combat`: orožje.
- `resources.intelligence`: intel.
- `resources.material`: material.
- `resources.artifacts`: artefakti za instant uničenje šibke točke.

### AI

- `aiRobots`: število AI robotov.
- `aiKnowledge`: koliko AI ve o klanu, 0-1.
- `aiPhaseProgress`: napredek v fazi, 0-12.
- `aiTree`: vozlišča AI načrta.
- `aiWeakPoints`: šibke točke.

### Klani

- `clanActivity`: koliko so drugi klani aktivni in s tem zaposlujejo AI.
- `otherClans`: fiksni drugi klani z `discovered`, `allied`, `specialty`.

### Napredek igralca

- `axisHistory`: število rund po oseh `hiding`, `espionage`, `defense`.
- `weaponWorkshopProgress`.
- `weaponWorkshopScouts`: legacy ime/stanje.
- `wallProgress`.
- `wallsBuilt`.
- `artifactWorkshopProgress`.

### Misije in odprave

- `expeditions`: aktivne odprave po heks poti.
- `completedExpeditions`: zaključene/izgubljene odprave.
- `activeMissions`: stari timer sistem misij proti šibkim točkam.
- `completedMissions`: zaključene stare misije.

### Mapa

- `mapTiles`: 6x5 heks mapa.
- `HexTile.researchProgress`: 0-1 kontinuirana raziskanost.
- `HexTile.visibility`: izpeljana vidnost `unknown`, `partial`, `revealed`.
- `HexTile.hidesWeakPointId`.
- `HexTile.otherClanId`.

### RNG in log

- `rngSeed`.
- `rngCallCount`.
- `lastRoundLog`.

## Neuporabljena ali legacy koda

### Engine

- `createRNG` je importan v `game.ts`, vendar ni uporabljen.
- `rngBool` je importan v `game.ts` in `combat.ts`, vendar ni uporabljen.
- `rngInt` je importan v `combat.ts`, vendar ni uporabljen.
- `spendScoutsOnMap` in `visibilityFromProgress` sta importana v `game.ts`, vendar nista uporabljena.
- `adaptGenome` je importan v `game.ts`, vendar ni uporabljen.
- `currentAxis` je exportan, vendar ga ni videti v rabi.
- `PhaseEvent` tip obstaja, vendar dejanski fazni damage iz `PHASE_EVENT_BASE_DAMAGE` ni uporabljen.
- `ScoutPlan`, `scouts`, `scoutPlan`, `dayGuard`, `nightGuard` so legacy polja.
- `scoutSuccessProbability` in `scoutCaptureProbability` računata legacy `assignment.scouts`, medtem ko novi UI uporablja `newExpeditions`.
- `weaponWorkshopScouts` je legacy polje, ki se nastavlja na `workers`.
- `spendScoutsOnMap` v `map.ts` je označen kot star backward compatibility sistem, vendar v trenutnem flowu ni priključen.

### Frontend

- Več komponent v `App.tsx` ni priključenih v trenutni render flow: `ResStat`, `ResourceRow`, `ClanStatus`, `WeakPoints`, `PeopleAllocator`, `PeopleBar`, `SliderRow`, `AxisSelector`, `RationsSelector`, `OddsDisplay`, `OddsArc`, `BalanceTrend`, `HumanMissionsPlaceholder`.
- `scoutTargets` state je ostanek starega sistema; setter in preview dependency obstajata, vendar ni več aktivne UI rabe za targetiranje scoutov.
- `combatants` state obstaja, vendar `handleRound` pošlje `combatants: 0`; dejanski napad gre prek `pendingExpeditions`.
- `tab` tip vključuje `'log'`, vendar side menu nima log zavihka. Mobilni log blok je zato težko dosegljiv iz trenutnega UI.

## Potencialni bugi

### 1. Neposredni combat preview in dejanski napad sta razvezana

Frontend ima `combatants` in star `previewOdds`, vendar `handleRound` vedno pošlje `combatants: 0`. Uporabnik napada prek poti, medtem ko del engine kode za neposredni napad ostaja aktiven samo teoretično. To lahko vodi do napačnih pričakovanj, če katerikoli UI element še vedno kaže neposredni combat odds.

### 2. `population` pomeni kamp, UI ga pogosto obravnava kot celotno populacijo

Engine pri odhodu odprave zmanjša `population`, ob vrnitvi jo poveča. Zato `population` dejansko pomeni ljudi v kampu, ne celoten klan. UI na več mestih prikazuje `game.population` kot `Populacija`, nato dodatno računa `inMissions`; to lahko vodi do dvojno zmedenih prikazov. V `ClanStatus` je celo `inCamp = game.population - inMissions`, kar bi bilo napačno, če bi se komponenta uporabljala.

### 3. `canConfirmDraft` ne upošteva že tekočega drafta v `plannedTotal`

`plannedTotal` vključuje `pendingExpeditions`, `missions` in `combatants`, ne vključuje pa trenutnega `draftPeople`. `canConfirmDraft` ga doda posebej, kar je v redu. Toda plus gumbi za `draftPeople` preverjajo `assignedHome + plannedTotal + draftPeople >= availablePop`, zato so robni pogoji občutljivi na staro vrednost in lahko UI ob nekaterih kombinacijah dovoli/pokaže malo nekonsistentno stanje.

### 4. Potrjena in nepotrjena draft pot se lahko podvojeno pošljeta

`handleRound` doda vse `pendingExpeditions`, nato pa, če `draftPath.length >= 2`, doda še trenutni draft. Če uporabnik potrdi pot, se draft resetira na kamp. Če reset iz kakršnega koli razloga ne uspe ali je uporabnik po potrditvi začel novo pot, bo ob izvedbi meseca poslan tudi novi nepotrjeni draft. To je morda namerno, vendar UI tekst ločuje "potrdi" in "sproži ob izvedbi", zato je implicitna oddaja nepotrjene poti lahko presenetljiva.

### 5. Aktivne stare misije in nove odprave so dva paralelna sistema za isti cilj

`Missions` uporablja `missionAssignments` in `activeMissions`, medtem ko zavihek `Napad` uporablja `newExpeditions` z `kind: mission`. Oba lahko uničujeta šibke točke. To poveča možnost edge caseov, npr. dve vzporedni poti/misiji na isto weak point stanje.

### 6. `CompletedRun.axisHistory` je napačen povzetek

Server ob koncu runa ne shrani dejanskega `newState.axisHistory`, ampak ustvari `{ hiding: 0, espionage: 0, defense: 0 }` in nastavi samo zadnjo os na 1. To bo slabo za statistiko in kasnejšo AI evolucijo.

### 7. `PHASE_EVENT_BASE_DAMAGE` in `PREPARED_DAMAGE_REDUCTION` nista uporabljena

Komentarji govorijo o faznem razpletu in damage, vendar prehod faze samo razkrije/označi vozlišča. Igralec lahko pričakuje udarec ob prehodu, ki ga engine ne izvede.

### 8. Combat resolver ne uporablja RNG za izid

`resolveCombat` izračuna verjetnost in nato deterministično izbere outcome po thresholdih. RNG se ne uporabi, čeprav komentarji in UI govorijo o verjetnosti. To ni nujno bug, če je dizajn determinističen "odds tier", vendar izraz `successProbability` daje vtis rolla.

### 9. Raid outcome je tudi determinističen glede na verjetnost odbitja

AI raid se random sproži, a ko se sproži, je izid določen iz `raidRepelProbability` prek thresholdov, ne z rollom. To pomeni, da 64% vedno pomeni `partial`, 65% vedno `victory`.

### 10. Lakota se sproži pri `survival <= 0`, čeprav survival nikoli ne gre pod 0

Engine survival po prehrani in odštevanjih clampa na 0. Nato `isStarving = survival <= 0`, kar pomeni, da se lakota sproži tudi, ko je hrana natančno 0 po normalni porabi. To je lahko namerno, vendar komentar govori "če hrana pade pod 0".

### 11. `rngInt` je komentarno opisan kot max exclusive, klici pa pogosto pričakujejo max inclusive

`rngInt(state, min, max)` vrača `[min, max)`. Primeri:

- `rngInt(rng, 20, 60)` nikoli ne vrne 60.
- `rngInt(rng, 1, 4)` vrne 1-3, kar je morda namerno.
- `rngInt(rng, rations.popMin, rations.popMax)` za obroke z `popMin=-5`, `popMax=-3` nikoli ne vrne -3. To verjetno ni skladno z besedilom "−5 do −3".

### 12. `aiKnowledgeGain` exposure uporablja kamp populacijo po odhodih in lahko eksplodira

Exposure deli z `state.population`, ne s celotnim klanom. Ko je veliko ljudi na odpravah, je kamp populacija manjša, zato lahko raziskovalci/combatants pomenijo večjo izpostavljenost kot pričakovano.

### 13. Frontend in engine imata podvojene konstante

Rations, encounter risk, map path months in del workshop logike so podvojeni v UI. To lahko zlahka odstopi od engine pravil. Nekatere vrednosti so že frontend-only kopije.

### 14. `GameState` tipi so podvojeni med backendom in frontendom

`src/engine/types.ts` in `client/src/types.ts` se morata ročno usklajevati. Trenutno že obstaja razlika: backend `GameState` vključuje `rngCallCount`, frontend tip ga ne.

### 15. Event log ni persistenten

`EventLog` se akumulira samo v React state. Po refreshu se zgodovina izgubi, čeprav je `lastRoundLog` shranjen. Za produkcijsko igro to oteži debugging in igralčevo razumevanje runa.

### 16. Feedback in sessions admin poti niso zaščitene

`GET /api/feedback` in `GET /api/sessions` sta javni. Ker produkcija teče na javnem hostu, je to potencialna zasebnostna/operativna luknja.

### 17. Ni try/catch okoli async API handlerjev

Napake DB ali enginea v Express handlerjih nimajo centralnega error middlewarea. To lahko povzroči nejasne 500 odzive in potencialno unhandled promise situacije.

### 18. `GameSession.updateOne({ runId }, newState)` zamenja veliko polj brez `$set`

Mongoose bo to običajno obravnaval kot update dokument, vendar je varneje in jasneje uporabljati `$set`. Trenutno je odvisno od Mongoose interpretacije plain objekta.

### 19. `runId = Date.now().toString(36)` lahko kolidira

Če se dve igri ustvarita v istem milisekundnem oknu, lahko pride do unique konflikta. Verjetnost je majhna, vendar produkcijsko nepotrebna.

### 20. Ni validacije assignment števil

Server preveri le obstoj `assignment`. Negativne vrednosti, decimalke, previsoke vrednosti ali čudni objekti se zanašajo na engine/UI clampanje, kar ni dovolj za javni API.

## Tehnični dolg

### Monolitni frontend

`App.tsx` bi bilo smiselno razdeliti na:

- `screens/StartScreen.tsx`, `screens/GameScreen.tsx`, `screens/GameOverScreen.tsx`;
- `components/map/HexMap.tsx`;
- `components/panels/*`;
- `components/modals/*`;
- `hooks/useGameSession.ts`, `hooks/usePreviewOdds.ts`, `hooks/useEventLog.ts`;
- `game-ui/constants.ts`.

### Monolitni engine reducer

`processRound` bi bilo smiselno razdeliti na manjše čiste korake:

- `normalizeAssignment`;
- `applyFoodAndForaging`;
- `applyResearch`;
- `applyWorkshop`;
- `resolveCampRaid`;
- `tickExpeditions`;
- `tickLegacyMissions` ali odstranitev legacy sistema;
- `applyAllies`;
- `advanceAI`;
- `buildRoundLog`.

### Podvojeni tipi in konstante

Frontend bi moral uporabljati tipe iz deljenega paketa ali generirane tipe. Konstante za rations, workshop stroške, path risk in duration naj imajo en vir resnice.

### Legacy sistemi

Treba je sprejeti odločitev:

- obdržati samo novi path-based expedition sistem;
- ali obdržati tudi stare timer misije, a jih jasno poimenovati in testirati kot ločeno mehaniko.

Trenutno oba sistema obstajata in povečujeta kompleksnost.

### Testi

Ni testnih datotek. Najbolj kritični testi:

- determinističnost `processRound` z istim seedom;
- prehrana/lakota;
- raid probability in raid result;
- odprave po poti, encounterji in return populacija;
- weak point discovery/exploit;
- phase transition;
- zavezniki;
- delavnice;
- API create/load/round flow z mock DB ali integration setupom.

### Validacija API vhoda

`PlayerAction` naj se validira na strežniku. Minimalno:

- vse številke morajo biti finite integer >= 0;
- `rations` 1-5;
- `axis` ena od treh vrednosti;
- poti morajo biti sestavljene iz veljavnih sosednjih heksov;
- razporeditev ne sme preseči razpoložljive populacije;
- server naj ne zaupa frontend clampanju.

### Persistenca zgodovine

Če je dnevnik pomemben za igralca in debugging, `GameState` potrebuje `roundLogs: RoundLog[]` ali ločeno kolekcijo. Trenutni `lastRoundLog` je premalo.

### Admin zaščita

`/api/feedback` GET in `/api/sessions` naj bosta zaščitena vsaj z osnovnim admin tokenom ali IP allowlistom.

### Deploy/produkcija

Repo se ureja neposredno na produkcijskem strežniku. To je dokumentirano v `AGENTS.md`, vendar povečuje tveganje. Minimalni varovalni ukrepi:

- vedno test pred deployem;
- commit/push pred deployem;
- ne spreminjati `.env`;
- ne posegati v druge PM2 aplikacije.

## Priporočena prioriteta

1. Dodati osnovne engine teste za `processRound`, odprave, lakoto in phase transition.
2. Popraviti `CompletedRun.axisHistory`, da shrani dejanski `newState.axisHistory`.
3. Odločiti se glede starega `activeMissions` sistema in ga odstraniti ali jasno ločiti.
4. Uskladiti pomen `population`: bodisi "kamp populacija" bodisi "celoten klan"; UI naj uporablja dosledna imena.
5. Odstraniti ali izolirati neuporabljene frontend komponente in legacy state.
6. Izločiti `App.tsx` v manjše komponente.
7. Uvesti runtime validacijo API inputa.
8. Zaščititi admin-like API poti.
9. Deliti tipe/konstante med frontendom in engineom.
10. Persistirati round history, če je časovni trak del core UX.
