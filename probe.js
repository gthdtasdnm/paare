// Spielt Paare mit zwei Clients bis zum leeren Brett durch: aufdecken, Paar
// behalten und noch einmal dran sein, danebengreifen und abgeben, Endstand,
// Neustart – und zum Schluss eine Partie allein, denn das Spiel erlaubt sie
// ausdrücklich.
//
// Kein Testrahmen, keine Abhaengigkeit – das Skript wirft, wenn etwas nicht
// stimmt, und schreibt sonst mit, was passiert ist. Der Server muss dafuer
// laufen:
//
//   deno task dev            (in einer zweiten Sitzung)
//   deno task probe
// Gegen die Live-Fassung statt gegen den lokalen Server:
//   WS_URL=wss://inf-zeus.de/paare/ws deno task probe
//
// Das Brett liegt vollstaendig im Server; die Probe kennt es so wenig wie ein
// Spieler und merkt sich nur, was schon einmal offen lag. Genau das ist der
// wichtigste Punkt hier: haette der Client die Loesung, waere das Spiel kaputt.
// Die Probe prueft in jedem Zug, dass verdeckte Karten kein Zeichen mitschicken.
//
// Ein falsches Paar bleibt 1,8 Sekunden liegen; mit acht Paaren braucht die
// Probe deshalb rund eine halbe Minute.

const PORT = Deno.env.get("PORT") ?? "8062";
const URL_WS = Deno.env.get("WS_URL") ?? `ws://127.0.0.1:${PORT}/ws`;

const muss = (bedingung, text) => { if (!bedingung) throw new Error(text); };

function client(name) {
  const c = {
    name, ws: new WebSocket(URL_WS), you: null, room: null, runde: null,
    final: null, fehler: [],
  };
  c.ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === "joined") c.you = m.you;
    if (m.t === "room") c.room = m;
    if (m.t === "runde") { c.runde = m; c.final = null; }
    if (m.t === "final") c.final = m;
    if (m.t === "error") c.fehler.push(m.msg);
  };
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.offen = new Promise((res) => { c.ws.onopen = res; });
  return c;
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

async function bis(bedingung, was, ms = 8000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (bedingung()) return;
    await warte(20);
  }
  throw new Error("Zeitüberschreitung: " + was);
}

const A = client("Anna"), B = client("Ben");
const alleC = [A, B];
await Promise.all(alleC.map((c) => c.offen));

// Nicht oeffentlich: die Probe laeuft auch gegen live, und dort soll kein
// Geisterraum in der Liste stehen.
A.send({ t: "create", name: "Anna", isPublic: false });
await bis(() => A.room, "Raum angelegt");
console.log("Raum:", A.room.code);

B.send({ t: "join", code: A.room.code, name: "Ben" });
await bis(() => A.room.players.length === 2, "zwei Spieler");

A.send({ t: "settings", paare: 8 });
await bis(() => A.room.settings.paare === 8, "acht Paare eingestellt");
A.send({ t: "settings", paare: 9 });
await warte(150);
muss(A.room.settings.paare === 8, "Eine Paarzahl außerhalb der Auswahl ging durch");
console.log("ok  nur 8, 15 oder 24 Paare, nichts dazwischen");

A.send({ t: "start" });
await warte(150);
muss(A.room.phase === "lobby", "Start ging ohne Bereit durch");
B.send({ t: "ready", value: true });
await bis(() => A.room.players.every((p) => p.ready || p.host), "alle bereit");
A.send({ t: "start" });
await bis(() => A.runde?.brett?.length === 16, "Brett aufgebaut");
console.log("ok  Start blockiert, solange nicht alle bereit sind");

// --- Das Brett verrät nichts ------------------------------------------------

/** Kein einziges Zeichen darf an einer verdeckten Karte haengen. */
function pruefeGeheim(c) {
  for (const f of c.runde.brett) {
    muss(f.offen || f.weg ? f.zeichen !== null : f.zeichen === null,
      `${c.name} sieht das Zeichen einer verdeckten Karte (${f.i}: ${f.zeichen})`);
  }
}

for (const c of alleC) {
  muss(c.runde.brett.length === 16, "Acht Paare sind sechzehn Karten");
  muss(c.runde.brett.every((f) => !f.offen && !f.weg), "Am Anfang liegt schon etwas offen");
  pruefeGeheim(c);
  muss(c.runde.uebrig === 8, "Es sind nicht acht Paare übrig");
}
console.log("ok  16 verdeckte Karten, kein Zeichen im Client – die Lösung bleibt im Server");

const amZug = () => alleC.find((c) => c.you === A.runde.amZug);
const brett = () => A.runde.brett;

// --- Wer nicht dran ist, deckt nichts auf ------------------------------------

{
  const fremd = alleC.find((c) => c !== amZug());
  fremd.send({ t: "auf", i: 0 });
  await warte(200);
  muss(brett().every((f) => !f.offen), "Wer nicht dran ist, konnte aufdecken");
  console.log("ok  wer nicht am Zug ist, deckt nichts auf");
}

// --- Eine Partie bis zum leeren Brett ---------------------------------------

/** Was schon einmal offen lag: Feldnummer -> Zeichen. Mehr weiß die Probe nicht. */
const bekannt = new Map();

function lerne() {
  for (const f of brett()) if (f.zeichen) bekannt.set(f.i, f.zeichen);
}

async function decke(d, i) {
  d.send({ t: "auf", i });
  await bis(() => brett()[i].offen || brett()[i].weg, `Karte ${i} aufgedeckt`);
  lerne();
  for (const c of alleC) pruefeGeheim(c);
}

/** Zwei bekannte, noch liegende Karten mit demselben Zeichen. */
function bekanntesPaar() {
  const liegen = [...bekannt].filter(([i]) => !brett()[i].weg);
  for (const [i, z] of liegen) {
    const j = liegen.find(([k, zz]) => k !== i && zz === z);
    if (j) return [i, j[0]];
  }
  return null;
}

let paare = 0, danebengegriffen = 0, sperreGeprueft = false, doppeltGeprueft = false;

for (let zug = 0; zug < 60 && !A.final; zug++) {
  const d = amZug();
  muss(d, "Niemand ist am Zug");
  const vorher = d.runde.spieler.find((s) => s.id === d.you).gefunden;

  const sicher = bekanntesPaar();
  if (sicher) {
    await decke(d, sicher[0]);
    // Dieselbe Karte noch einmal antippen darf nichts tun.
    if (!doppeltGeprueft) {
      d.send({ t: "auf", i: sicher[0] });
      await warte(150);
      muss(brett().filter((f) => f.offen).length === 1, "Dieselbe Karte ließ sich zweimal aufdecken");
      doppeltGeprueft = true;
    }
    await decke(d, sicher[1]);
  } else {
    const zu = brett().filter((f) => !f.weg && !f.offen);
    const neu = zu.filter((f) => !bekannt.has(f.i));
    const erste = (neu[0] ?? zu[0]).i;
    await decke(d, erste);
    const z = bekannt.get(erste);
    const partner = [...bekannt].find(([i, zz]) => i !== erste && zz === z && !brett()[i].weg);
    const zweite = partner
      ? partner[0]
      : brett().filter((f) => !f.weg && !f.offen && !bekannt.has(f.i))[0]?.i ??
        brett().filter((f) => !f.weg && !f.offen)[0].i;
    await decke(d, zweite);
  }

  const nachher = d.runde.spieler.find((s) => s.id === d.you)?.gefunden ?? vorher;
  if (nachher > vorher) {
    paare++;
    muss(nachher === vorher + 1, "Ein Paar zählte mehr als eins");
    if (!A.final) muss(A.runde.amZug === d.you, "Nach einem Paar ist jemand anderes dran");
    const weg = brett().filter((f) => f.weg);
    muss(weg.every((f) => f.von), "Bei einer abgeräumten Karte steht nicht, wer sie geholt hat");
    muss(weg.every((f) => !f.offen), "Eine abgeräumte Karte gilt weiter als offen");
    muss(A.runde.uebrig === 8 - paare, "Die Zahl der übrigen Paare stimmt nicht");
  } else {
    danebengegriffen++;
    muss(A.runde.sperre, "Nach zwei ungleichen Karten ist das Brett nicht gesperrt");
    // Waehrend der Sperre darf auch der, der dran ist, nichts aufdecken.
    if (!sperreGeprueft) {
      const zu = brett().find((f) => !f.weg && !f.offen);
      d.send({ t: "auf", i: zu.i });
      await warte(150);
      muss(!brett()[zu.i].offen, "Während der Sperre ließ sich eine Karte aufdecken");
      sperreGeprueft = true;
    }
    await bis(() => !A.runde.sperre || A.final, "die Karten drehen sich wieder um", 5000);
    if (A.final) break;
    muss(brett().filter((f) => f.offen).length === 0,
      "Die falschen Karten blieben offen: " + JSON.stringify(brett().filter((f) => f.offen)));
    muss(A.runde.amZug !== d.you, "Nach einem Fehlgriff ist derselbe noch dran");
  }
}

muss(A.final, "Das Brett wurde in 60 Zügen nicht leer");
muss(paare === 8, `Es wurden ${paare} Paare gefunden, nicht acht`);
muss(sperreGeprueft && doppeltGeprueft, "Sperre oder Doppelklick kamen nicht vor");
console.log(`ok  Brett leergespielt: 8 Paare, ${danebengegriffen}× danebengegriffen`);
console.log("ok  Paar behalten und noch einmal dran, Fehlgriff sperrt und gibt ab");

const f = A.final;
muss(f.tabelle.length === 2, "Im Endstand fehlt jemand");
muss(f.tabelle.reduce((n, z) => n + z.punkte, 0) === 8, "Es sind nicht acht Paare verteilt");
muss(f.tabelle[0].punkte >= f.tabelle[1].punkte, "Der Endstand ist nicht sortiert");
console.log("Endstand: " + f.tabelle.map((z) => `${z.name} ${z.wert}`).join(" · "));

A.send({ t: "again" });
await bis(() => A.room.phase === "lobby", "zurück im Warteraum");
muss(A.room.players.every((p) => !p.ready), "Bereit wurde nicht zurückgesetzt");
console.log("ok  Nochmal setzt alles zurück");

// --- Allein spielen ---------------------------------------------------------

// MIN_PLAYERS ist hier eins, und das ist Absicht: Paare geht auch allein.
B.send({ t: "leave" });
await bis(() => A.room.players.length === 1, "allein im Raum");
A.send({ t: "settings", paare: 8 });
await warte(120);
// Das alte Brett steht sonst noch in `A.runde` und die Wartebedingung waere
// sofort erfuellt.
A.runde = null;
A.send({ t: "start" });
await bis(() => A.runde?.brett?.length === 16, "allein gestartet");
muss(A.runde.spieler.length === 1, "Allein ist man nicht allein");
muss(A.runde.amZug === A.you, "Allein ist jemand anderes dran");
console.log("ok  eine Partie allein lässt sich starten – so ist es gemeint");

A.send({ t: "ende" });
await bis(() => A.final, "allein beendet");
console.log("ok  und sie lässt sich auch allein beenden");

if (A.fehler.length) throw new Error("Fehlermeldungen: " + JSON.stringify(A.fehler));
console.log("\nALLES GRÜN");
Deno.exit(0);
