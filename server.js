// PAARE – Deno-Server. Das Merkspiel mit einem gemeinsamen Brett: jeder sieht
// dasselbe Feld auf seinem eigenen Handy, dran ist immer nur einer.
//
// „memory" ist eine eingetragene Marke von Ravensburger – Regeln sind frei,
// der Name nicht. Deshalb heißt es hier Paare.
//
// Das Brett liegt vollständig im Server: welche Karte welches Zeichen trägt,
// erfährt der Client erst, wenn sie aufgedeckt ist. Sonst stünde die Lösung
// im Browser.

import { darfRaumOeffnen, raumVermerkt } from "./bremse.js";
import { cleanName, raumverwaltung, shuffle } from "./raum.js";
import { starte } from "./statisch.js";

const PORT = Number(Deno.env.get("PORT") ?? 8062);
const HOST = Deno.env.get("HOST") ?? "0.0.0.0";
const PUBLIC = new URL("./public/", import.meta.url);

const MAX_PLAYERS = 6;
const MIN_PLAYERS = 1;
const ZU_MS = 1800;   // so lange bleibt ein falsches Paar offen liegen

const ZEICHEN = [
  "🦊", "🐢", "🦉", "🐙", "🦩", "🐝", "🦔", "🐳", "🦕", "🐧",
  "🍄", "🌵", "🍋", "🍒", "🌻", "🥑", "🍩", "🌶️", "🥨", "🍇",
  "⚓", "🎈", "🎸", "🚲", "🧦", "🔑", "🪁", "🧭", "🕯️", "🪀",
];

const {
  rooms, browsing,
  createRoom, clearTimers, anwesende,
  send, raw, broadcast,
  roomList, pushState, pushRoomList,
  makePlayer, attach, dropPlayer,
} = raumverwaltung({
  maxPlayers: MAX_PLAYERS,
  minPlayers: MIN_PLAYERS,
  einstellungen: { paare: 15 },
  raumfelder: () => ({
    karten: [], offen: [], reihe: [], amZug: null, sperre: false, meldung: null,
  }),
  spielerfelder: () => ({ gefunden: 0 }),

  beimBeitritt: (room) => { if (room.phase === "playing") pushRunde(room); },
  nachVerlassen: (room, player) => {
    if (room.phase === "playing" && room.amZug === player.id) weiterWennWeg(room);
  },
  beimPlatzfrei: (room, id) => {
    if (room.phase !== "playing") return;
    const i = room.reihe.indexOf(id);
    if (i >= 0) room.reihe.splice(i, 1);
    if (!room.reihe.length) return finishGame(room);
    if (room.amZug === id) weiterWennWeg(room);
    pushRunde(room);
  },
  zurueckZurLobby: (room) => backToLobby(room),
});

const name = (room, id) => room.players.get(id)?.name ?? "?";

// ---------------------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------------------

function startGame(room) {
  clearTimers(room);
  room.phase = "playing";
  room.rundeNr = 1;
  const anzahl = Math.min(room.settings.paare, ZEICHEN.length);
  const zeichen = shuffle([...ZEICHEN]).slice(0, anzahl);
  room.karten = shuffle(
    zeichen.flatMap((z, i) => [
      { paar: i, zeichen: z, offen: false, weg: false, von: null },
      { paar: i, zeichen: z, offen: false, weg: false, von: null },
    ]),
  );
  room.offen = [];
  room.sperre = false;
  room.meldung = null;
  room.reihe = shuffle(anwesende(room).map((p) => p.id));
  for (const p of room.players.values()) {
    p.gefunden = 0;
    p.punkte = 0;
    p.ready = false;
  }
  room.amZug = room.reihe[0];
  pushState(room);
  pushRunde(room);
  pushRoomList();
}

function naechster(room, von) {
  if (!room.reihe.length) return null;
  const i = room.reihe.indexOf(von);
  return room.reihe[(i < 0 ? 0 : i + 1) % room.reihe.length];
}

function weiterWennWeg(room) {
  const p = room.players.get(room.amZug);
  if (p?.connected) return;
  room.amZug = naechster(room, room.amZug);
  pushRunde(room);
}

function pushRunde(room) {
  if (room.phase !== "playing") return;
  broadcast(room, {
    t: "runde",
    amZug: room.amZug,
    amZugName: name(room, room.amZug),
    sperre: room.sperre,
    meldung: room.meldung,
    // Nur aufgedeckte oder abgeräumte Karten verraten ihr Zeichen.
    brett: room.karten.map((k, i) => ({
      i,
      offen: k.offen,
      weg: k.weg,
      zeichen: k.offen || k.weg ? k.zeichen : null,
      von: k.weg ? k.von : null,
    })),
    spieler: room.reihe.map((id) => ({
      id, name: name(room, id),
      gefunden: room.players.get(id)?.gefunden ?? 0,
      weg: !room.players.get(id)?.connected,
    })),
    uebrig: room.karten.filter((k) => !k.weg).length / 2,
  });
}

function aufdecken(room, player, i) {
  const k = room.karten[i];
  if (!k || k.weg || k.offen) return;
  k.offen = true;
  room.offen.push(i);

  if (room.offen.length < 2) {
    room.meldung = null;
    return pushRunde(room);
  }

  const [a, b] = room.offen.map((x) => room.karten[x]);
  room.sperre = true;
  if (a.paar === b.paar) {
    a.weg = b.weg = true;
    a.von = b.von = player.name;
    player.gefunden++;
    player.punkte = player.gefunden;
    room.offen = [];
    room.sperre = false;
    room.meldung = `${player.name} hat ein Paar – noch mal!`;
    pushRunde(room);
    pushState(room);
    if (room.karten.every((x) => x.weg)) finishGame(room);
    return;
  }

  room.meldung = "Kein Paar.";
  pushRunde(room);
  const id = setTimeout(() => {
    room.timers.delete(id);
    for (const x of room.offen) room.karten[x].offen = false;
    room.offen = [];
    room.sperre = false;
    room.meldung = null;
    room.amZug = naechster(room, player.id);
    pushRunde(room);
  }, ZU_MS);
  room.timers.add(id);
}

function finishGame(room) {
  clearTimers(room);
  room.phase = "final";
  const tabelle = [...room.players.values()]
    .filter((p) => room.reihe.includes(p.id) || p.gefunden)
    .map((p) => ({ name: p.name, wert: `${p.gefunden} Paare`, punkte: p.gefunden }))
    .sort((a, b) => b.punkte - a.punkte);
  for (const p of room.players.values()) p.ready = false;
  broadcast(room, {
    t: "final",
    tabelle,
    untertitel: tabelle.length ? `${tabelle[0].name} hat die meisten Paare.` : "",
  });
  pushState(room);
  pushRoomList();
}

function backToLobby(room) {
  clearTimers(room);
  room.phase = "lobby";
  room.rundeNr = 0;
  room.karten = [];
  room.offen = [];
  room.reihe = [];
  room.sperre = false;
  room.meldung = null;
  for (const p of room.players.values()) {
    p.ready = false;
    p.gefunden = 0;
    p.punkte = 0;
  }
  pushState(room);
}

// ---------------------------------------------------------------------------
// Nachrichten
// ---------------------------------------------------------------------------

function handle(ws, msg) {
  const room = ws._room;
  const player = ws._player;

  if (msg.t === "ping") return raw(ws, { t: "pong", c: msg.c, s: Date.now() });

  if (msg.t === "browse") {
    if (!ws._room) {
      browsing.add(ws);
      raw(ws, { t: "rooms", rooms: roomList() });
    }
    return;
  }

  if (msg.t === "create") {
    if (room) return;
    if (!darfRaumOeffnen(ws._ip)) {
      return raw(ws, { t: "error", msg: "Zu viele Räume in kurzer Zeit. Warte kurz." });
    }
    raumVermerkt(ws._ip);
    const r = createRoom(msg.isPublic);
    const p = makePlayer(msg.name, true);
    r.hostId = p.id;
    r.players.set(p.id, p);
    attach(ws, r, p);
    pushState(r);
    pushRoomList();
    return;
  }

  if (msg.t === "join") {
    if (room) return;
    const r = rooms.get(String(msg.code ?? "").toUpperCase().trim());
    if (!r) return raw(ws, { t: "error", msg: "Diesen Raum gibt es nicht" });
    if (msg.token) {
      const back = [...r.players.values()].find((p) => p.token === msg.token);
      if (back) {
        if (back.ws && back.ws !== ws && back.ws.readyState === WebSocket.OPEN) {
          try { back.ws.close(4001, "woanders geöffnet"); } catch { /* egal */ }
        }
        attach(ws, r, back);
        pushState(r);
        return;
      }
    }
    if (r.players.size >= MAX_PLAYERS) {
      return raw(ws, { t: "error", msg: `Der Raum ist voll (${MAX_PLAYERS} Spieler)` });
    }
    if (r.phase !== "lobby") return raw(ws, { t: "error", msg: "Die Runde läuft schon" });
    const p = makePlayer(msg.name, false);
    r.players.set(p.id, p);
    attach(ws, r, p);
    pushState(r);
    return;
  }

  if (!room || !player) return;
  room.lastActivity = Date.now();

  switch (msg.t) {
    case "name":
      player.name = cleanName(msg.name);
      pushState(room);
      pushRunde(room);
      break;

    case "ready":
      player.ready = !!msg.value;
      pushState(room);
      break;

    case "settings":
      if (player.id !== room.hostId || room.phase !== "lobby") break;
      if ([8, 15, 24].includes(msg.paare)) room.settings.paare = msg.paare;
      if (typeof msg.isPublic === "boolean") room.isPublic = msg.isPublic;
      pushState(room);
      pushRoomList();
      break;

    case "start": {
      if (player.id !== room.hostId || room.phase !== "lobby") break;
      const da = anwesende(room);
      if (da.length < MIN_PLAYERS) break;
      if (!da.every((p) => p.ready || p.id === room.hostId)) break;
      startGame(room);
      break;
    }

    case "auf": {
      if (room.phase !== "playing" || room.sperre) break;
      if (room.amZug !== player.id) break;
      aufdecken(room, player, Number(msg.i));
      break;
    }

    case "ende":
      if (player.id !== room.hostId || room.phase !== "playing") break;
      finishGame(room);
      break;

    case "again":
      if (player.id !== room.hostId || room.phase !== "final") break;
      backToLobby(room);
      break;

    case "leave":
      dropPlayer(ws, { immediate: true });
      break;
  }
}

starte({ port: PORT, host: HOST, publicDir: PUBLIC, titel: "PAARE", handle, dropPlayer });
