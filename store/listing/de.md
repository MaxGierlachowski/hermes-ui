# Store-Eintrag – Deutsch (de-DE)

Jedes Feld unten ist der Text zum Einfügen: nur den Inhalt des Codeblocks kopieren.
`<!-- field: … max=… -->` markiert ein Feld mit Längengrenze; [`../README.md`](../README.md#checking-the-lengths)
enthält das Skript, das sie zählt.

## Namen (die einzige Stelle, an der der sichtbare Name steht)

Der Arbeitsname ist **Hermes UI**. Er steht **nur** in den beiden Titelfeldern unten; alle anderen
Texte sagen „die App“ (und „Hermes“ meint immer Hermes Agent). Für eine Umbenennung reicht es, diesen
Abschnitt zu ändern.

<!-- field: apple.name max=30 -->
```text
Hermes UI für Hermes Agent
```

<!-- field: play.title max=30 -->
```text
Hermes UI für Hermes Agent
```

Muster für andere Namen: `<Name> für Hermes Agent` (der Zusatz hat 17 Zeichen, der Name selbst also
höchstens 13).

## Untertitel (App Store)

<!-- field: apple.subtitle max=30 -->
```text
Dein KI-Agent, selbst gehostet
```

## Kurzbeschreibung (Google Play)

<!-- field: play.short max=80 -->
```text
Inoffizieller Client für deinen selbst gehosteten Hermes Agent – Board & Chats.
```

## Werbetext (App Store)

Lässt sich jederzeit ohne neue Prüfung ändern.

<!-- field: apple.promo max=170 -->
```text
Neu: Probier die ganze App ohne Backend aus. Tipp auf dem ersten Bildschirm auf „Demo ansehen“ und erkunde Board, Chats und Inbox mit Beispieldaten.
```

## Beschreibung (App-Store-Beschreibung und vollständige Beschreibung bei Google Play)

Reiner Text; beide Stores zeigen Zeilenumbrüche, aber kein Markdown.

<!-- field: description max=4000 -->
```text
Hermes Agent arbeitet auf deinem Rechner – mit dieser App hast du ihn auch unterwegs im Blick. Jeder Hermes-Chat ist eine Karte auf einem Kanban-Board, das sich live aktualisiert. Du liest mit, beantwortest Rückfragen und gibst Befehle frei, ohne an den Schreibtisch zu müssen.

Inoffizielle App: Das hier ist ein unabhängiges Open-Source-Projekt. Es steht in keiner Verbindung zu Nous Research, den Machern von Hermes Agent, und wird von ihnen weder unterstützt noch gesponsert.

SO FUNKTIONIERT ES
Auf deinem Rechner läuft neben Hermes Agent das quelloffene Backend. Die App koppelst du einmal per QR-Code, danach verbindet sie sich Ende-zu-Ende-verschlüsselt über iroh (Peer-to-Peer-QUIC): direkt, wenn es geht, sonst über ein Relay, das nur verschlüsselte Daten weiterreicht. Kein Konto, kein Cloud-Dienst des Entwicklers, kein offener Port auf deinem Rechner.

DAS BOARD
• Jeder Chat ist eine Karte – egal ob vom Desktop, aus Slack, von Cron-Jobs, aus der CLI oder aus der App
• Spalten New Task, Doing, Waiting und Done, live aktualisiert
• Zwischen den Spalten wischen, zum Aktualisieren ziehen, sofort sehen, welcher Chat auf dich wartet

CHATS
• Antworten erscheinen Wort für Wort, während Hermes schreibt
• Markdown, Codeblöcke, Tool-Aufrufe, Bilder und Sprachnachrichten
• Neue Chats starten und antworten – mit Text, Fotos aus der Mediathek oder der Kamera oder per Sprachnachricht
• Einen laufenden Durchgang stoppen

FREIGABEN UND RÜCKFRAGEN
• Befehle freigeben oder ablehnen, die Hermes ausführen will (einmal, für die Sitzung, immer)
• Rückfragen mit den angebotenen Optionen oder freiem Text beantworten
• Eine Inbox sammelt alle offenen Anfragen aus allen Chats, dazu einen Verlauf

CODING-AGENTEN
• Die Paseo-Coding-Agenten eines Chats sehen, mit Transkripten zum Mitlesen
• Ihre Berechtigungsanfragen direkt aus der Inbox beantworten

GEMACHT FÜRS HANDY
• Volltextsuche über alle Chats
• Offline-Cache: Der letzte Stand ist sofort da, auch ohne Verbindung
• Hell und dunkel, Deutsch und Englisch
• Android: Text oder Bilder aus anderen Apps teilen und damit einen Chat starten
• Benachrichtigungen für fertige Antworten und neue Anfragen, solange die App läuft; unter Android auf Wunsch auch im Hintergrund über eine dezente Daueranzeige

OHNE BACKEND AUSPROBIEREN
Tipp auf dem ersten Bildschirm auf „Demo ansehen“. Die Demo zeigt Beispiel-Chats, eine Freigabe, eine Rückfrage, Coding-Agenten und die Inbox und spielt eine Antwort ab, wenn du eine Nachricht schickst. Dabei verlässt nichts dein Gerät.

DATENSCHUTZ
Keine Analyse, keine Werbung, kein Tracking – und der Entwickler bekommt keine deiner Daten. Chats, Bilder und Sprachnachrichten gehen nur zwischen deinem Handy und deinem eigenen Backend hin und her, Ende-zu-Ende-verschlüsselt.

WAS DU BRAUCHST
• Hermes Agent auf deinem Rechner
• Das kostenlose, quelloffene Backend (MIT-Lizenz) von der GitHub-Seite des Projekts
• Ein paar Minuten für die Einrichtung; die Anleitung auf GitHub führt dich durch

Open Source unter der MIT-Lizenz. Fehlermeldungen und Beiträge sind auf GitHub willkommen.
```

## Keywords (App Store)

Durch Kommas getrennt, ohne Leerzeichen nach dem Komma, keine Wörter aus dem Namen, keine fremden
Marken.

<!-- field: apple.keywords max=100 -->
```text
ki,assistent,kanban,selbst gehostet,llm,chatbot,freigabe,inbox,verschlüsselt,p2p,sprachnachricht
```

## Neu in Version 0.3.0

Erste Store-Version. Google Play zeigt den Text als Versionshinweise (500 Zeichen pro Sprache). App Store Connect bietet das Feld erst ab der zweiten Version an; dort für 0.3.1+ wiederverwenden (Grenze 4000).

<!-- field: whatsnew max=500 -->
```text
Die erste Version in den Stores.
• Demo-Modus: Tipp auf dem ersten Bildschirm auf „Demo ansehen“ und probier die App mit Beispieldaten aus – ganz ohne Backend
• Fit für die Stores: Datenschutz-Manifest, nur die Berechtigungen, die die App wirklich braucht, klarere Einstellungen für Benachrichtigungen und Hintergrund
• Die Demo lässt sich jederzeit beenden, danach koppelst du dein eigenes Backend
```

## URLs

| Feld | URL |
|---|---|
| Support-URL (Apple, Pflicht) / Play „Website“ | https://maxgierlachowski.github.io/hermes-ui/support/de/ |
| Datenschutz-URL (beide Stores, Pflicht) | https://maxgierlachowski.github.io/hermes-ui/privacy/de/ |
| Marketing-URL (Apple, optional) | https://github.com/MaxGierlachowski/hermes-ui |
| Kontakt-E-Mail (Play, Pflicht; Kontakt für die Prüfung bei Apple) | {{CONTACT_EMAIL}} |

Hinweis: Bei Google Play gelten Datenschutz-URL und Website für alle Sprachen gemeinsam (dort die
englischen Seiten eintragen, sie verlinken die deutschen). Bei Apple sind Support- und Datenschutz-URL
pro Sprache einstellbar.

## Kategorie-Vorschlag

- App Store: primär **Produktivität**, sekundär **Entwickler-Tools**.
- Google Play: **Produktivität**.
