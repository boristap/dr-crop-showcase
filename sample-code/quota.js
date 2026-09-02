const admin = require("firebase-admin");

// Kontingent-Pruefung (Arbeitsschritt 16, vereinfachte Variante nach
// Arbeitsanweisung v1.3, Teil 3.1): gezaehlt wird NUR nach erfolgreicher
// Gemini-Ausfuehrung, in einer einzigen Firestore-Transaktion. Bewusst
// KEINE Reserve-/Confirm-Logik in zwei Schritten -- bei einem einmaligen
// Kontingent von nur 10 Anfragen kostet ein seltenes Race ein paar Cent,
// waehrend Reserve+Rollback zusaetzliche Aufraeumlogik (TTL fuer
// haengengebliebene Reservierungen) noetig machen wuerde. Das Verhaeltnis
// stimmt nicht.

function todayUtc() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function monthUtc() {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

const RATE_WINDOW_MS = 60 * 1000;

// Minuten-Limit gegen automatisierte Massenabfragen (Boris' Auftrag
// 2026-09-01, Teil 1 Punkt 1). Laeuft VOR dem Gemini-Aufruf, im Sperrfall
// entstehen also keine Modellkosten.
//
// BEWUSSTE ABWEICHUNG vom sonstigen Muster dieser Datei: checkQuota ist
// absichtlich schreibfrei und gezaehlt wird erst NACH einer erfolgreichen
// Antwort (siehe Kommentar ganz oben). Fuer eine Missbrauchsbremse geht das
// nicht -- sie muss VERSUCHE zaehlen, nicht Erfolge. Wuerde sie erst
// hinterher zaehlen, koennte jemand beliebig viele Anfragen gleichzeitig
// losschicken, bevor der erste Zaehler steht, und genau das ist der Fall,
// den diese Bremse verhindern soll. Deshalb hier eine eigene atomare
// Transaktion mit Schreibzugriff.
//
// Bewusst unabhaengig von config.quotaEnabled: das ist kein Kontingent,
// sondern ein Schutz, der auch in einer Testphase greifen soll. 8 pro
// Minute liegen weit ueber allem, was ein Mensch tippt.
async function checkRateLimit(db, uid, config) {
  const limit = config.rateLimitPerMinute;
  if (!limit) {
    return { allowed: true };
  }

  const userRef = db.collection("users").doc(uid);
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(userRef);
    // Nutzerdokument noch nicht angelegt (ganz frische Installation, siehe
    // Selbstheilung in checkQuota): durchlassen, checkQuota legt es gleich
    // an. Eine allererste Anfrage kann per Definition kein Massenabruf sein.
    if (!snap.exists) {
      return { allowed: true };
    }

    const user = snap.data();
    const windowStart =
      typeof user.rateWindowStart === "number" ? user.rateWindowStart : 0;
    const count = typeof user.rateCount === "number" ? user.rateCount : 0;

    // Fenster abgelaufen (oder noch nie gesetzt) -> neues Fenster.
    if (now - windowStart >= RATE_WINDOW_MS) {
      transaction.update(userRef, { rateWindowStart: now, rateCount: 1 });
      return { allowed: true };
    }

    if (count >= limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowStart + RATE_WINDOW_MS - now) / 1000)
      );
      return { allowed: false, reason: "rate_limited", retryAfterSeconds };
    }

    transaction.update(userRef, { rateCount: count + 1 });
    return { allowed: true };
  });
}

// Liest das Nutzerdokument und prueft NUR (kein Schreibzugriff), ob eine
// Anfrage ueberhaupt gestartet werden darf. Wird VOR dem Gemini-Aufruf
// aufgerufen, damit ein bereits erschoepftes Kontingent keine unnoetigen
// Gemini-Kosten verursacht.
// Gleiche Default-Werte wie im "createUserDocument"-Auth-Trigger in
// index.js -- bewusst dupliziert statt importiert, um keine Abhaengigkeit
// zwischen den beiden Dateien fuer nur ein paar Zeilen einzufuehren.
// BUGFIX (2026-08-25, gefunden beim systematischen Nachpruefen nach
// Boris' Latenz-Meldung): referenzierte bisher "config.defaultFreeRequestsLimit",
// obwohl "config" in dieser Datei nirgends importiert ist -- ein
// ReferenceError bei jedem Aufruf fuer einen brandneuen Nutzer, dessen
// Dokument noch nicht vom Auth-Trigger angelegt wurde (siehe Kommentar bei
// checkQuota unten). Trat in dieser Session vermutlich nicht auf, weil die
// eigenen Testaufrufe vor checkQuota lange genug warteten, bis der Trigger
// das Dokument laengst angelegt hatte -- bei einem echten Nutzer mit
// schnellerer erster Anfrage waere es ein sofortiger 500er gewesen statt
// des vom Aufrufer erwarteten Fallback-Dokuments. Fix: config als
// Parameter durchreichen, wie es checkQuota selbst schon bekommt.
function defaultUserDoc(config) {
  return {
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    ageVerified: false,
    freeRequestsUsed: 0,
    freeRequestsLimit: config.defaultFreeRequestsLimit,
    isTester: false,
    dailyCount: 0,
    dailyCountDate: null,
    // Monatsdeckel (neu 2026-09-01) -- gleiche Bauart wie die Tageszaehler.
    monthlyCount: 0,
    monthlyCountMonth: null,
    // Minuten-Limit (neu 2026-09-01), siehe checkRateLimit.
    rateWindowStart: 0,
    rateCount: 0,
    isPro: false,
    accountLinked: false,
    memoryNotes: [],
  };
}

async function checkQuota(db, uid, config) {
  const userRef = db.collection("users").doc(uid);
  let snap = await userRef.get();

  // Selbstheilung gegen ein echtes Wettlauf-Problem (gefunden 2026-08-22,
  // Boris' Bericht "nach frischer Installation antwortet der Bot gar
  // nicht mehr", live reproduziert): "createUserDocument" ist ein Firebase
  // Auth v1-Trigger (.auth.user().onCreate), der asynchron NACH dem
  // eigentlichen Anmelde-Vorgang laeuft -- bei einer ganz frischen
  // Installation kann die allererste Chat-Anfrage schneller bei dieser
  // Function ankommen, als der Trigger das Nutzerdokument angelegt hat.
  // Bisher fuehrte das zu einem harten "user_not_found"-Abbruch, obwohl
  // der Nutzer voellig legitim war. Fix: Dokument hier defensiv selbst
  // anlegen (idempotent per "create()", das bei einem inzwischen doch
  // schon existierenden Dokument einfach fehlschlaegt und ignoriert wird
  // -- kein Ueberschreiben eines zwischenzeitlich vom echten Trigger
  // angelegten oder bereits genutzten Dokuments).
  if (!snap.exists) {
    try {
      await userRef.create(defaultUserDoc(config));
    } catch (err) {
      // Wurde zwischen unserem get() und create() doch schon vom
      // Auth-Trigger angelegt (echtes Race) -- kein Fehler, einfach
      // gleich neu lesen.
      console.error("checkQuota: userRef.create() failed for uid", uid, "code:", err.code, "message:", err.message);
    }
    snap = await userRef.get();
    if (!snap.exists) {
      console.error("checkQuota: still no doc after create+reread for uid", uid);
    }
  }

  if (!snap.exists) {
    // Auch nach dem eigenen Anlage-Versuch nicht vorhanden -- dann liegt
    // tatsaechlich ein anderes Problem vor (z. B. ungueltige uid), nicht
    // nur Trigger-Verzoegerung.
    return { allowed: false, reason: "user_not_found" };
  }

  const user = snap.data();

  // Testphase-Schalter (Boris, 2026-08-22): Er und Freunde sollen die App
  // "auf Biegen und Brechen" mit mehreren hundert Anfragen testen koennen,
  // ohne nach 15 Gratis-/20 Tages-Anfragen ausgesperrt zu werden. Statt
  // einzelne Nutzer manuell hochzusetzen, ein zentraler Schalter in
  // config.js (quotaEnabled) -- vor dem echten Launch wieder auf true
  // zuruecksetzen. Nutzerdokument wird trotzdem normal gelesen/
  // zurueckgegeben (isPro/memoryNotes werden weiterhin gebraucht).
  if (config.quotaEnabled === false) {
    return { allowed: true, user };
  }

  const today = todayUtc();
  const dailyCountToday = user.dailyCountDate === today ? user.dailyCount : 0;

  if (dailyCountToday >= config.dailyRequestLimit) {
    return { allowed: false, reason: "daily_limit_reached" };
  }

  // Monatsdeckel (neu 2026-09-01, Boris Teil 1 Punkt 2). Wie der Tagesdeckel
  // ausdruecklich AUCH fuer Pro-Nutzer -- beide sind Missbrauchsbremsen,
  // keine Portionierung des bezahlten Angebots.
  const month = monthUtc();
  const monthlyCountThisMonth =
    user.monthlyCountMonth === month ? user.monthlyCount || 0 : 0;

  if (monthlyCountThisMonth >= config.monthlyRequestLimit) {
    return { allowed: false, reason: "monthly_limit_reached" };
  }

  if (!user.isPro && user.freeRequestsUsed >= user.freeRequestsLimit) {
    return { allowed: false, reason: "free_quota_exhausted" };
  }

  // Nutzerdokument mit zurueckgeben, statt es in index.js ein zweites Mal
  // zu lesen -- wird fuer die Pro-Gedaechtnis-Funktion gebraucht (isPro,
  // memoryNotes), siehe recordSuccessfulRequest weiter unten.
  return { allowed: true, user };
}

// Obergrenze fuer gespeicherte Gedaechtnis-Notizen pro Nutzer (siehe
// Prompt-Abschnitt 25). Bewusst klein gehalten -- das haelt den
// [GEDAECHTNIS]-Block, der bei jeder weiteren Anfrage erneut als Tokens
// mitgeschickt wird, dauerhaft klein statt mit der Nutzungsdauer zu
// wachsen (Kostengrund, siehe Chat mit Boris 2026-08-18).
const MAX_MEMORY_NOTES = 15;

// Wird NUR nach einer erfolgreichen, validierten Gemini-Antwort
// aufgerufen. Erhoeht dailyCount (mit Tages-Reset) und, falls kein
// Pro-Nutzer, freeRequestsUsed -- alles in einer atomaren Transaktion.
// memoryNote wird nur fuer Pro-Nutzer gespeichert (Gedaechtnis-Feature
// ist bewusst ein Pro-Vorteil, siehe Prompt-Abschnitt 25 / CLAUDE.md).
async function recordSuccessfulRequest(db, uid, memoryNote, config) {
  const userRef = db.collection("users").doc(uid);
  const today = todayUtc();

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(userRef);
    if (!snap.exists) {
      return;
    }
    const user = snap.data();

    const update = {};

    // Waehrend der Testphase (siehe checkQuota oben, config.quotaEnabled)
    // bewusst NICHT mitzaehlen -- sonst waeren Boris/Freunde nach dem
    // spaeteren Wiedereinschalten sofort blockiert, weil ihr Kontingent
    // im Hintergrund schon laengst aufgebraucht waere.
    if (config.quotaEnabled !== false) {
      const newDailyCount = user.dailyCountDate === today ? user.dailyCount + 1 : 1;
      update.dailyCount = newDailyCount;
      update.dailyCountDate = today;
      // Monatszaehler analog (neu 2026-09-01).
      const month = monthUtc();
      update.monthlyCount =
        user.monthlyCountMonth === month ? (user.monthlyCount || 0) + 1 : 1;
      update.monthlyCountMonth = month;
      if (!user.isPro) {
        update.freeRequestsUsed = user.freeRequestsUsed + 1;
      }
    }
    if (user.isPro && memoryNote) {
      const existingNotes = Array.isArray(user.memoryNotes) ? user.memoryNotes : [];
      update.memoryNotes = [...existingNotes, memoryNote].slice(-MAX_MEMORY_NOTES);
    }

    // Firestore's update() throws if the map is empty (kann waehrend der
    // Testphase passieren: quotaEnabled=false UND kein Pro-Gedaechtnis-
    // Eintrag -- dann bleibt update leer). Einfach ueberspringen statt
    // faelschlich als "Gemini-Aufruf fehlgeschlagen" zu erscheinen.
    if (Object.keys(update).length > 0) {
      transaction.update(userRef, update);
    }
  });
}

module.exports = {
  checkQuota,
  checkRateLimit,
  recordSuccessfulRequest,
  MAX_MEMORY_NOTES,
};
