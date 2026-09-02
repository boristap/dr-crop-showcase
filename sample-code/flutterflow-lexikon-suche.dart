// Auszug aus dem FlutterFlow-DSL des Projekts (dsl/edit.dart, rund 14.800
// Zeilen). Gezeigt wird ein zusammenhaengender Ausschnitt: die Verdrahtung
// der Lexikon-Suche.
//
// Der Ausschnitt steht hier, weil er zwei Dinge zeigt, die man selten sieht:
// Erstens wird die App deklarativ per Skript gebaut, nicht im Editor
// zusammengeklickt -- jede Aenderung ist damit versionierbar und
// nachvollziehbar. Zweitens erklaeren die Kommentare jeweils, WARUM etwas so
// ist, und nennen den konkreten Vorfall, aus dem die Regel entstand.
//
// Hier konkret: eine gemeldete Fehlfunktion ("man kann nicht suchen"), deren
// Ursache nicht der fehlende Knopf war, sondern eine dekorative Lupe ohne
// Tap-Handler -- und ein zwei Sekunden hinterherhinkender Zustandswert, der
// die Suche mit leerem Begriff ausgeloest haette.

  // "Pflanze analysieren"-Button, nur an dieser Stelle bisher uebersehen.
  // Fix nach demselben bewaehrten Muster: `ensureActions` ersetzt die
  // onTap/onSubmit-Kette direkt am existierenden Knoten, mit dem bereits
  // vorhandenen, gut getesteten Helfer (der den echten Backend-Aufruf samt
  // Erfolgs-/Fehlerbehandlung unveraendert mitbringt -- nur die fehlende
  // Leer-Pruefung kommt neu dazu).
  //
  // NACHTRAG 2026-08-29 -- DEBOUNCE-FIX, hier statt weiter oben:
  // Dieser Block ist die LETZTE Verdrahtung dieser beiden Knoten im
  // Skript und gewinnt damit gegen jeden frueheren `ensureActions`-Aufruf
  // auf denselben Trigger (erster Reparaturversuch weiter oben wurde
  // genau hier still ueberschrieben -- im generierten Code nachgeprueft).
  // Deshalb muss der Debounce-Fix HIER stehen, nicht oben.
  //
  // `State(lexikonQuery)` durch den direkten Widget-Zugriff ersetzt:
  // FlutterFlow legt auf jedes TextField-`onChanged` eine feste
  // 2000-ms-EasyDebounce, `lexikonQuery` hinkt dem Feld also zwei Sekunden
  // hinterher. Wer tippt und sofort sucht, loeste die Suche mit leerem
  // Begriff aus -> Leer-Sperre bzw. scheinbar "nichts passiert".
  app.editPage(ff.Pages.lexikonPage, (page) {
    final widgets = ff.Pages.lexikonPage.widgets;
    final liveQuery = WidgetState(
      widgets.byKey('TextField_2bdo22iz').single,
      WidgetStateProperty.text,
    );
    page.ensureActions(
      page.findByKey('TextField_2bdo22iz'),
      triggerType: FFActionTriggerType.ON_TEXTFIELD_SUBMIT,
      actions: lexikonSearchActions(liveQuery, 'lexikonSearchFieldResult'),
    );

    // Echter antippbarer Such-Ausloeser (2026-09-01, Boris live: "wenn man
    // das Suchfeld ausfuellt kann man nicht suchen da es keinen Knopf dafuer
    // gibt"). Die Lupe IM Feld (siehe mutateNode unten, leadingIconValue)
    // ist rein dekorativ -- FFInputDecoration erlaubt dort nur ein Icon,
    // keinen Tap-Handler (siehe Kommentar dort: "erste Sackgasse"). Bislang
    // lief die Suche ausschliesslich ueber die Enter-Taste der
    // Bildschirmtastatur (ON_TEXTFIELD_SUBMIT oben) -- fuer die meisten
    // Nutzer nicht auffindbar, genau das hat Boris beim Live-Test getroffen.
    // Fix: ein echter Knopf direkt neben dem Feld. Boris' fruehere Vorgabe
    // "Lösche jegliche separaten Suchen-Buttons" (2026-08-31) bezog sich auf
    // den alten, textbeschrifteten, akzentfarbenen "Suchen"-Button -- ein
    // reines Icon in derselben dunkelgruenen Farbe wie die Lupe im Feld
    // faellt nicht als "separater Knopf" in diesem Sinne auf.
    // Gleiche liveQuery wie beim Enter-Pfad (NICHT State(lexikonQuery) --
    // das haengt wegen FlutterFlows fest verdrahteter 2000-ms-Debounce auf
    // onChanged bis zu zwei Sekunden hinterher, siehe Kommentar oben beim
    // Debounce-Fix. Sonst waere genau der schon einmal gefixte Bug hier neu
    // eingefuehrt worden.
    page.ensureReplaced(
      page.findByName('LexikonSearchTriggerBtn'),
      Container(
        name: 'LexikonSearchTriggerBtn',
        padding: 10,
        onTap: lexikonSearchActions(liveQuery, 'lexikonSearchTriggerResult'),
        child: Icon('search', size: 22, color: Colors.hex(0xFF1A4331)),
      ),
    );
  });