// Entscheidet, ob fuer eine einzelne Anfrage die Wissensbasis (File Search)
// abgefragt werden muss. Neu am 2026-09-01 (Boris' Arbeitsauftrag, Teil 1
// Punkt 7 -- ausdruecklich als groesster Sparposten benannt).
//
// WARUM DAS DER GROESSTE HEBEL IST (gemessen am 2026-09-01 gegen die echte
// API): eine typische Diagnose verbraucht rund 38.000 Token, davon allein
// ~20.000 fuer die vom RAG gelieferten Fundstellen -- also etwa 70% der
// Kosten. Ein Gespraech besteht aber selten aus lauter neuen Themen: nach
// der ersten, ausfuehrlichen Schilderung kommen meist kurze Rueckfragen zur
// gerade gegebenen Antwort ("wie oft?", "und bei Kokos?", "danke, was
// noch?"). Fuer die braucht das Modell keine neuen Fundstellen -- es hat die
// vorherige Antwort ueber den [VERLAUF]-Block ohnehin im Kontext.
//
// BEWUSST OHNE ZWEITE KI-ANFRAGE (so beauftragt): die Entscheidung faellt
// hier im Code. Ein vorgeschalteter Klassifizierer waere ein zweiter
// Modellaufruf und damit teilweise selbst wieder das Problem, das er loesen
// soll -- und die Vorgeschichte in diesem Projekt spricht dagegen: der
// fruehere "Tuersteher" fuer das Modell-Routing wurde am 2026-08-16 genau
// deshalb abgeschaltet, weil er diagnosewuerdige Nachrichten faelschlich
// als Smalltalk abtat (siehe modelRouter.js).
//
// GRUNDHALTUNG: im Zweifel abrufen. Eine ueberfluessige Abfrage kostet
// Bruchteile eines Cents. Eine faelschlich ausgelassene Abfrage kostet
// Antwortqualitaet -- und die ist laut Projektgrundsatz wichtiger.
// Deshalb ist "nicht abrufen" hier der eng definierte Sonderfall und
// nicht die Regel.

// Ab dieser Laenge gilt eine Nachricht als eigenstaendige Schilderung und
// nicht mehr als kurze Rueckfrage. Bewusst grosszuegig: "wie oft muss ich
// bei Kokos in der Bluete giessen?" sind 52 Zeichen und damit klar noch
// Rueckfrage-Gebiet.
const LANGE_NACHRICHT_AB_ZEICHEN = 140;

// Begriffe, die ein NEUES Symptom oder ein NEUES Fachthema anzeigen. Taucht
// einer davon auf, wird abgerufen -- unabhaengig von der Laenge.
//
// Bewusst NICHT in dieser Liste: reine Substrat-/Methodennamen wie "Kokos",
// "Erde", "Hydro". Boris hat "und bei Kokos?" ausdruecklich als Beispiel
// fuer eine reine Rueckfrage benannt, die keinen neuen Abruf ausloesen
// soll. Sie stehen typischerweise in einer Nachfrage zur eben gegebenen
// Antwort, nicht in einer neuen Problemschilderung.
const NEUES_THEMA = new RegExp(
  [
    // Sichtbare Symptome
    "gelb", "braun", "schwarz", "fleck", "punkte", "welk", "schlaff",
    "kraeusel", "kräusel", "roll", "vertrockn", "verbrannt", "brandfleck",
    "loch", "löcher", "loecher", "klebrig", "spinnweb", "belag", "verfaerb",
    "verfärb", "blass", "vergeil", "kuemmer", "kümmer", "haengt", "hängt",
    // Krankheiten / Schaedlinge
    "schimmel", "mehltau", "faeule", "fäule", "faul", "rost", "virus",
    "milbe", "laus", "laeuse", "läuse", "thrips", "trauermuecken",
    "trauermücken", "fliege", "raupe", "schnecke", "kaefer", "käfer",
    "befall", "schaedling", "schädling", "pilz",
    // Naehrstoffe / Wasser / Wurzeln
    "mangel", "ueberduen", "überdün", "duenger", "dünger", "duengen",
    "düngen", "giessen", "gießen", "staunaesse", "staunässe", "ueberwaess",
    "überwäss", "wurzel", "ph-wert", "ph wert", "\\bph\\b", "\\bec\\b",
    "ppm", "leitwert", "spuelen", "spülen",
    // Klima / Technik
    "hitze", "kaelte", "kälte", "temperatur", "luftfeucht", "\\bvpd\\b",
    "klima", "lueft", "lüft", "licht", "lampe", "ppfd", "\\blux\\b",
    // Kulturmassnahmen
    "umtopf", "schneiden", "entlaub", "beschneid", "ernte", "trocknen",
    "curing", "vorbluete", "vorblüte", "stress",
  ].join("|"),
  "i"
);

/**
 * @param {object} args
 * @param {string} args.userMessage  Die aktuelle Nachricht des Nutzers.
 * @param {string|undefined} args.history  Der vom Client mitgeschickte
 *   Gespraechsverlauf. Leer/undefined = erste Nachricht dieses Gespraechs.
 * @param {Array|undefined} args.images  Bereits validierte Bilder.
 * @returns {{noetig: boolean, grund: string}}
 */
function brauchtWissensbasis({ userMessage, history, images }) {
  // 1. Erste Nachricht eines Gespraechs -- immer abrufen. Hier steht die
  //    eigentliche Problemschilderung, hier zahlt sich die Wissensbasis aus.
  if (typeof history !== "string" || history.trim() === "") {
    return { noetig: true, grund: "erste_nachricht" };
  }

  // 2. Neue Fotos -- immer abrufen. Ein Bild bringt neue sichtbare
  //    Merkmale ins Spiel, also potenziell ein neues Symptom, auch wenn der
  //    Begleittext kurz ist ("und das hier?").
  if (Array.isArray(images) && images.length > 0) {
    return { noetig: true, grund: "neue_fotos" };
  }

  const text = typeof userMessage === "string" ? userMessage.trim() : "";

  // 3. Ausfuehrliche Nachricht -- als eigenstaendige Schilderung behandeln.
  if (text.length > LANGE_NACHRICHT_AB_ZEICHEN) {
    return { noetig: true, grund: "ausfuehrliche_schilderung" };
  }

  // 4. Neues Symptom / neues Fachthema benannt.
  if (NEUES_THEMA.test(text)) {
    return { noetig: true, grund: "neues_thema" };
  }

  // 5. Alles andere: kurze Rueckfrage zur vorherigen Antwort.
  return { noetig: false, grund: "kurze_rueckfrage" };
}

module.exports = { brauchtWissensbasis, LANGE_NACHRICHT_AB_ZEICHEN };
