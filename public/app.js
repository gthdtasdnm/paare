// PAARE – Client. Das Brett kommt fertig vom Server; verdeckte Karten haben
// dort kein Zeichen, damit die Lösung nicht im Browser steht.
import { $, el, S, schicke, starteSchale, zeige } from "./schale.js";

const HILFE = [
  "<b>Ein gemeinsames Brett</b>, jeder sieht es auf seinem eigenen Handy. Dran ist immer nur einer.",
  "<b>Zwei Karten aufdecken.</b> Passen sie zusammen, gehören sie dir und du bist noch mal dran.",
  "<b>Passen sie nicht</b>, bleiben sie kurz offen liegen – damit alle sie sehen können – und werden wieder zugedeckt.",
  "<b>Verdeckte Karten kennt auch dein Browser nicht.</b> Nachschauen im Quelltext bringt nichts.",
  "<b>Wer die meisten Paare hat, gewinnt.</b> Allein geht es auch: dann ist es ein Gedächtnistraining.",
];

// Bedenkzeit: ohne sichtbare Uhr wirkt der Zugwechsel nach Ablauf wie ein
// Fehler. Mit Uhr ist er das, was er ist – eine Frist. Allein gespielt gibt es
// keine Frist, dann bleibt die Uhr leer.
let uhrZiel = 0;

function uhr() {
  const u = $("uhr");
  if (!u) return;
  const rest = Math.max(0, Math.ceil((uhrZiel - Date.now()) / 1000));
  u.textContent = uhrZiel && rest <= 20 ? rest + "s" : "";
}
setInterval(uhr, 500);

function zeichneSpiel(m) {
  zeige("game");
  $("tbLinks").innerHTML = `Übrig <strong>${m.uebrig}</strong> <span id="uhr"></span>`;
  uhrZiel = m.frist || 0;
  uhr();
  $("tbTag").textContent = m.amZug === S.me ? "Du bist dran" : m.amZugName;

  const b = $("buehne");
  b.innerHTML = "";

  const tafel = el("div", "punkttafel");
  for (const p of m.spieler) {
    const s = el("span", "pt" + (p.id === m.amZug ? " zug" : "") + (p.weg ? " off" : ""));
    s.textContent = `${p.name} ${p.gefunden}`;
    tafel.append(s);
  }
  b.append(tafel);

  const brett = el("div", "brett");
  const spalten = m.brett.length <= 16 ? 4 : m.brett.length <= 30 ? 5 : 6;
  brett.style.gridTemplateColumns = `repeat(${spalten}, 1fr)`;
  for (const k of m.brett) {
    const c = el("button", "pk" + (k.offen ? " auf" : "") + (k.weg ? " weg" : ""),
      k.zeichen ?? "");
    c.disabled = m.amZug !== S.me || m.sperre || k.offen || k.weg;
    c.onclick = () => schicke({ t: "auf", i: k.i });
    if (k.weg && k.von) c.title = "gefunden von " + k.von;
    brett.append(c);
  }
  b.append(brett);

  $("rundenHint").textContent = m.meldung ??
    (m.amZug === S.me ? "Deck zwei Karten auf." : `${m.amZugName} ist dran.`);
  $("aktionen").innerHTML = "";
}

$("helpList").innerHTML = HILFE.map((h) => `<li>${h}</li>`).join("");

const extra = $("hostExtra");
extra.innerHTML = `<div class="setting"><span class="setting-label">Paare</span>
  <div class="segmented">
    <button class="seg" data-p="8">8</button>
    <button class="seg sel" data-p="15">15</button>
    <button class="seg" data-p="24">24</button>
  </div></div>`;
for (const b of extra.querySelectorAll("[data-p]")) {
  b.onclick = () => schicke({ t: "settings", paare: Number(b.dataset.p) });
}

starteSchale({
  key: "paare",
  zeichneSpiel,
  zeichneRaum: (r) => {
    for (const b of extra.querySelectorAll("[data-p]")) {
      b.classList.toggle("sel", Number(b.dataset.p) === r.settings.paare);
    }
  },
});
