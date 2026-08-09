# Paare 🃏

Das Merkspiel mit einem **gemeinsamen** Brett: alle sehen dasselbe Feld auf
ihrem eigenen Handy, dran ist immer nur einer. Zwei Karten aufdecken – passen
sie zusammen, gehören sie dir und du bist noch mal dran.

„memory" ist eine eingetragene Marke von Ravensburger. Regeln sind frei, der
Name nicht; deshalb heißt es hier **Paare**.

Läuft auf **Deno**, ohne eine einzige externe Abhängigkeit. Kein Build-Schritt,
kein `node_modules`, ein Prozess.

---

## Starten

```bash
deno task dev          # http://localhost:8062/
PORT=9000 deno task dev
deno task check        # Typprüfung
deno task probe        # spielt ein Brett leer (Server muss laufen)
ZUG_MS=3000 deno task dev    # kurze Bedenkzeit zum Ausprobieren
```

## An den Tisch kommen

Name eintippen, **Raum eröffnen** oder über die Liste bzw. den vierstelligen
**Code** beitreten. **Eine bis sechs** Personen.

**Eine ist Absicht.** Allein gespielt ist es ein Gedächtnistraining, und dafür
braucht es keinen zweiten Menschen. `MIN_PLAYERS` steht deshalb auf 1, was die
Lobby-Prüfung zur Formsache macht – ungewohnt, aber kein Fehler.

Der Host stellt die Brettgröße ein: **8, 15 oder 24 Paare** (16, 30 oder 48
Karten). Etwas dazwischen gibt es nicht; die drei Größen sind auf dem Handy alle
noch lesbar.

## Die Regeln

- Zwei Karten aufdecken. **Passen sie**, gehören sie dir und du bist noch mal
  dran.
- **Passen sie nicht**, bleiben sie 1,8 Sekunden offen liegen – damit alle sie
  sehen können – und werden wieder zugedeckt. Dann ist der Nächste dran.
- Wer die meisten Paare hat, gewinnt.

## Bedenkzeit

**60 Sekunden je Zug**, sobald mindestens zwei mitspielen. Läuft sie ab, wird
eine einzeln offene Karte wieder zugedeckt und der Zug rückt weiter, mit einer
Meldung – sonst hält eine Person, die das Handy weggelegt hat, die ganze Runde
an.

Allein gespielt gibt es keine Frist. Das ist kein Sonderfall, sondern der
Normalfall dieses Spiels für eine Person: es gibt niemanden aufzuhalten.

## Was nur der Server weiß

**Das ist hier der wichtigste Punkt überhaupt.** Das Brett liegt vollständig im
Server; welche Karte welches Zeichen trägt, erfährt der Client erst, wenn sie
aufgedeckt ist. Stünde die Lösung im Browser, wäre das Spiel kaputt – und von
außen sieht man das nie.

`probe.js` prüft deshalb in **jedem einzelnen Zug**, dass an keiner verdeckten
Karte ein Zeichen hängt. Sie spielt ein Brett mit acht Paaren wirklich leer und
kennt es dabei so wenig wie ein Spieler: sie merkt sich nur, was schon einmal
offen lag.

## Wenn jemand geht

- Wer die Verbindung verliert, behält seinen Platz eine Minute lang.
- Verlässt jemand den Raum, während er am Zug ist, rückt der Zug weiter.
- Ist niemand mehr da, endet die Partie.

## Dateien

| Datei | Was |
|---|---|
| `server.js` | Brett, Zugreihenfolge, Aufdecken, Bedenkzeit, Endstand |
| `probe.js` | spielt ein Brett leer, prüft jede Runde auf Geheimhaltung |
| `bremse.js`, `raum.js`, `statisch.js` | gemeinsam, **wortgleich in allen Spielen** |
| `public/index.html` | alle vier Bildschirme plus die Hilfe |
| `public/schale.js` | gemeinsame Client-Schale (Verbindung, Lobby) |
| `public/style.css` | Lobby-Basis, gemeinsamer Rahmen, darunter das Eigene |
| `public/app.js` | Brett, Karten, Punktestand, Uhr |

## Betrieb

Port **8062**, gebunden auf `127.0.0.1`, davor Apache als Reverse Proxy unter
`/paare/`. Dienst: `paare.service` (systemd, läuft als `www-data`).

```bash
systemctl status paare
journalctl -u paare -f
```

Der Zustand liegt vollständig im RAM. Ein Neustart wirft alle laufenden Partien
weg – das ist gewollt, es gibt nichts zu sichern.
