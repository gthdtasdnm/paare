// ══════════════ Gemeinsame Client-Schale ══════════════ Anfang ═══════════
// ERZEUGT - NICHT HIER AENDERN. Quelle: /var/www/html/gemeinsam/schale.js
// Aendern, dann `node werkzeug/verteilen.mjs --nur <spiel>`.
//
// Was in jedem Spiel-Client wortgleich dasteht: Verbindung mit Wiederaufbau,
// Raumliste, Beitreten per Code oder Link, Lobby mit Sitzen und Bereit-Knopf,
// Umschalten der vier Bildschirme, Toast und Hilfe-Dialog.
//
// Was NICHT hier drin ist: das Spiel. `starteSchale({ zeichneSpiel })` bekommt
// den Zeichner des Spielbildschirms uebergeben und ruft ihn bei jeder
// `runde`-Nachricht auf. Jedes Spiel behaelt eine eigene vollstaendige Kopie
// dieser Datei; faellt gemeinsam/ weg, laeuft es weiter.
// ──────────────────────────────────────────────────────────────────────────

export const $ = (id) => document.getElementById(id);

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export const S = {
  ws: null, me: null, token: null, code: null,
  room: null, runde: null, isPublic: true, key: "spiel",
};

export const schicke = (m) =>
  S.ws?.readyState === WebSocket.OPEN && S.ws.send(JSON.stringify(m));

export const nameFeld = () => $("name").value.trim() || "Spieler";

export function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("on");
  setTimeout(() => t.classList.remove("on"), 2600);
}

export function zeige(name) {
  for (const s of document.querySelectorAll(".screen")) {
    s.classList.toggle("active", s.id === "screen-" + name);
  }
}

export const binHost = () => S.room?.hostId === S.me;
export const ich = () => S.room?.players.find((p) => p.id === S.me);

function wsUrl() {
  const u = new URL("ws", location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.href;
}

/**
 * @param {object} o
 * @param {string} o.key                  Name fuer sessionStorage
 * @param {(m:object) => void} o.zeichneSpiel   eine `runde`-Nachricht
 * @param {(m:object) => void} [o.zeichneFinal] sonst: Tabelle mit name/wert
 * @param {(m:object) => void} [o.zeichneRaum]  zusaetzlich zur Lobby
 * @param {(m:object) => void} [o.sonstige]     alles, was die Schale nicht kennt
 * @param {() => object} [o.raumOptionen] Zusatzfelder fuer `create`
 */
export function starteSchale({
  key, zeichneSpiel, zeichneFinal, zeichneRaum, sonstige, raumOptionen,
}) {
  S.key = key;

  function empfange(m) {
    switch (m.t) {
      case "rooms": zeichneRaeume(m.rooms); break;
      case "joined":
        S.me = m.you; S.token = m.token; S.code = m.code;
        sessionStorage.setItem(key, JSON.stringify({ code: m.code, token: m.token }));
        history.replaceState(null, "", "#" + m.code);
        break;
      case "room": S.room = m; zeichneLobby(); zeichneRaum?.(m); break;
      case "runde": S.runde = m; zeichneSpiel(m); break;
      case "final": (zeichneFinal ?? standardFinal)(m); break;
      case "error": toast(m.msg); break;
      default: sonstige?.(m);
    }
  }

  function verbinde(dann) {
    if (S.ws && S.ws.readyState === WebSocket.OPEN) return dann?.();
    S.ws = new WebSocket(wsUrl());
    S.ws.onopen = () => { $("status").textContent = ""; dann?.(); };
    S.ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      empfange(m);
    };
    S.ws.onclose = () => {
      $("status").textContent = "Verbindung weg – neu verbinden …";
      setTimeout(() => verbinde(() => {
        if (S.code) schicke({ t: "join", code: S.code, token: S.token, name: nameFeld() });
        else schicke({ t: "browse" });
      }), 1500);
    };
  }

  function zeichneRaeume(liste) {
    const box = $("roomList");
    box.innerHTML = "";
    $("roomsCount").textContent = liste.length ? `(${liste.length})` : "";
    if (!liste.length) {
      box.append(el("div", "rooms-empty", "Gerade keine offenen Räume."));
      return;
    }
    for (const r of liste) {
      const row = el("div", "roomrow");
      row.append(el("span", "roomrow-code", r.code));
      row.append(el("span", "roomrow-name", r.host));
      row.append(el("span", "roomrow-count", `${r.count}/${r.max}`));
      row.onclick = () => verbinde(() => schicke({ t: "join", code: r.code, name: nameFeld() }));
      box.append(row);
    }
  }

  function zeichneLobby() {
    const r = S.room;
    if (r.phase === "lobby") zeige("lobby");
    $("roomCode").textContent = r.code;
    $("roomVis").textContent = r.isPublic ? "öffentlich" : "privat";
    $("lobbyCount").textContent = `${r.players.length}/${r.maxPlayers}`;

    const liste = $("playerList");
    liste.innerHTML = "";
    for (const p of r.players) {
      const s = el("div", "seat" + (p.ready ? " ready" : "") + (p.connected ? "" : " off"));
      s.append(el("div", "av", (p.name[0] ?? "?").toUpperCase()));
      s.append(el("div", "nm", p.name));
      s.append(el("div", "st", p.ready ? "bereit" : p.connected ? "wartet" : "weg"));
      if (p.host) s.append(el("div", "host", "Host"));
      liste.append(s);
    }

    const host = binHost();
    $("hostControls").hidden = !host;
    $("guestControls").hidden = host;
    if ($("endeBtn")) $("endeBtn").hidden = !host;
    for (const b of document.querySelectorAll("[data-lobbyvis]")) {
      b.classList.toggle("sel", (b.dataset.lobbyvis === "public") === r.isPublic);
    }
    const da = r.players.filter((p) => p.connected).length;
    const alleBereit = r.players
      .filter((p) => p.connected && p.id !== r.hostId)
      .every((p) => p.ready);
    $("startBtn").disabled = da < r.minPlayers || !alleBereit;
    $("startHint").textContent = da < r.minPlayers
      ? `Mindestens ${r.minPlayers} Leute – ihr seid ${da}.`
      : alleBereit ? "" : "Noch nicht alle sind bereit.";
    $("readyBtn").classList.toggle("on", !!ich()?.ready);
  }

  function standardFinal(m) {
    zeige("final");
    $("finalSub").textContent = m.untertitel ?? "";
    const ol = $("podium");
    ol.innerHTML = "";
    for (const z of m.tabelle ?? []) {
      const li = el("li");
      li.append(el("span", "pd-name", z.name));
      li.append(el("span", "pd-pt", String(z.wert ?? z.punkte ?? "")));
      ol.append(li);
    }
    $("againBtn").hidden = !binHost();
  }

  // ---- Bedienung ---------------------------------------------------------
  for (const b of document.querySelectorAll("[data-vis]")) {
    b.onclick = () => {
      S.isPublic = b.dataset.vis === "public";
      for (const x of document.querySelectorAll("[data-vis]")) x.classList.toggle("sel", x === b);
    };
  }
  for (const b of document.querySelectorAll("[data-lobbyvis]")) {
    b.onclick = () => schicke({ t: "settings", isPublic: b.dataset.lobbyvis === "public" });
  }
  $("createBtn").onclick = () =>
    verbinde(() =>
      schicke({ t: "create", name: nameFeld(), isPublic: S.isPublic, ...(raumOptionen?.() ?? {}) })
    );
  $("joinBtn").onclick = () => {
    const code = $("codeInput").value.toUpperCase().trim();
    if (code) verbinde(() => schicke({ t: "join", code, name: nameFeld() }));
  };
  $("copyBtn").onclick = async () => {
    const link = location.origin + location.pathname + "#" + S.code;
    try {
      await navigator.clipboard.writeText(link);
      toast("Link kopiert");
    } catch {
      toast(link);
    }
  };
  $("readyBtn").onclick = () => schicke({ t: "ready", value: !ich()?.ready });
  $("startBtn").onclick = () => schicke({ t: "start" });
  if ($("endeBtn")) $("endeBtn").onclick = () => schicke({ t: "ende" });
  $("againBtn").onclick = () => schicke({ t: "again" });
  $("leaveBtn").onclick = () => {
    schicke({ t: "leave" });
    S.code = null; S.room = null; S.runde = null;
    sessionStorage.removeItem(key);
    history.replaceState(null, "", location.pathname);
    zeige("home");
    schicke({ t: "browse" });
  };
  $("helpBtn").onclick = () => { $("help").hidden = false; };
  $("helpClose").onclick = () => { $("help").hidden = true; };

  const gespeichert = JSON.parse(sessionStorage.getItem(key) ?? "null");
  const hash = location.hash.replace("#", "").toUpperCase();
  $("name").value = localStorage.getItem("spielername") ?? "";
  $("name").onchange = () => localStorage.setItem("spielername", nameFeld());
  verbinde(() => {
    if (hash && gespeichert?.code === hash) {
      schicke({ t: "join", code: hash, token: gespeichert.token, name: nameFeld() });
    } else {
      if (hash) $("codeInput").value = hash;
      schicke({ t: "browse" });
    }
  });
  setInterval(() => schicke({ t: "ping", c: Date.now() }), 25000);

  return { verbinde };
}

// ══════════════ Gemeinsame Client-Schale ══════════════ Ende ══════════════
