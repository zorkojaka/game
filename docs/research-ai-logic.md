# Research / AI Logic Sprint

Branch: `dev/research-ai-logic`

## Kaj se je spremenilo

- `aiInsight` ni več pasiven timer. Raste predvsem, ko igralec dodeli raziskovalce na `Roboti`.
- Raziskave ustvarijo intel, intel/robot research razkriva AI drevo.
- AI drevo ima konkretne enote, opise in učinke za:
  - izvidnike;
  - napadalce;
  - people-killerje.
- Mehanske šibkosti odklepajo tech stopnje:
  - izvidniki → stopnja 1;
  - napadalci → stopnja 2;
  - people-killerji → stopnja 3.
- Logične šibkosti dajejo takojšnje pasivne bonuse v boju, obrambi ali srečanjih.
- Legacy timer misije so odstranjene iz normalnega gameplaya. Napadi in misije gredo prek path-based odprav na mapi.
- Stare aktivne misije se pri naslednji rundi migrirajo nazaj v kamp, da stari save-i ne crashajo.

## Novi loop

```text
Research → Intel → AI weak points → Upgrades → Survival
```

- Food ohranja ljudi pri življenju.
- Defense ščiti kamp.
- Workshop gradi orožje, obzidje in artefakte.
- Research razkriva AI šibkosti in odklepa boljšo tehnologijo.
- Map expeditions so operativna plast za izvidništvo, zaveznike in napade.

## AI faze

1. `find`: AI ima predvsem izvidniške enote. Človeška tehnologija je osnovna.
2. `understand`: AI dobi napadalne enote. Igralec potrebuje boljše orožje in EMP-style obrambo.
3. `eliminate`: AI dobi people-killer enote. Igralec potrebuje napredno obrambo in močnejše orožje.

## Znane odprte točke

- `processRound` in `App.tsx` sta še vedno velika monolita.
- Server validacija poti še ne preveri vseh gameplay pravil, na primer sosednosti heksov.
- Event log ostaja frontend-only.
- Nekatere legacy komponente v `App.tsx` so še v datoteki, vendar niso več normalni gameplay flow.
