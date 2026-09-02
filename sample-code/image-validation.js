// Serverseitige Bildpruefung (Arbeitsschritt 13). Die 1024x1024-Begrenzung
// im FlutterFlow-Client ist nur UX -- diese Pruefung hier ist laut
// Arbeitsanleitung die tatsaechliche Grenze, deshalb hier nochmal echt
// gegen die Pixel-Aufloesung geprueft, nicht nur gegen die Dateigroesse.

const { imageSize } = require("image-size");

const MAX_DIMENSION_PX = 1024;
const MAX_BASE64_LENGTH = 8_000_000; // grobe Vorabgrenze, ~6 MB Rohbild
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
// Obergrenze fuer gleichzeitig eingereichte Fotos (z. B. Pflanze aus
// mehreren Blickwinkeln oder Blatt-Ober-/Unterseite). Urspruenglich 3
// (Entscheidung 2026-08-17), am 2026-08-22 auf Boris' Wunsch auf 10
// erhoeht (Galerie-Mehrfachauswahl).
//
// 2026-09-01 auf 4 gesenkt (Boris, Teil 1 Punkt 4). Hintergrund: ein Foto
// in Maximalgroesse (1024x1024) kostet gemessene 1.089 Token, 10 Fotos
// also rund 10.900 Token allein fuer Bilder -- bei einem Verkaufspreis von
// 6,99 EUR/Monat der groesste einzelne Ausreisser-Posten. Vier Fotos decken
// die realen Faelle ab (Pflanze gesamt, Blatt oben, Blatt unten, Detail).
const MAX_IMAGES = 4;

class ImageValidationError extends Error {}

function validateSingleImage(image) {
  // BUGFIX (2026-08-28, Code-Review): ein Array-Eintrag von "images", der
  // selbst kein Objekt ist (z. B. null -- destructuring von null/undefined
  // wirft in JS immer, unabhaengig vom Feldnamen), erzeugte hier bisher
  // einen rohen TypeError statt eines ImageValidationError. In index.js
  // wird nur ImageValidationError als 400 behandelt, alles andere wird
  // per "throw err" weitergereicht und landet unbehandelt ausserhalb jedes
  // Try/Catch im diagnose-Handler -- der Request haengt dann bis zum
  // 120s-Funktionstimeout statt eine saubere Fehlermeldung zu bekommen
  // (gleiches Symptom wie die bereits behobenen "haengt endlos"-Bugs).
  if (!image || typeof image !== "object") {
    throw new ImageValidationError("Ungueltiger Bild-Eintrag in 'images'.");
  }
  const { data, mimeType } = image;

  if (typeof data !== "string" || data.length === 0) {
    throw new ImageValidationError("Bilddaten fehlen oder sind leer.");
  }
  if (data.length > MAX_BASE64_LENGTH) {
    throw new ImageValidationError("Bild ist zu gross.");
  }
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new ImageValidationError(
      `Nicht unterstuetzter Bildtyp: ${mimeType}`
    );
  }

  let buffer;
  try {
    buffer = Buffer.from(data, "base64");
  } catch (err) {
    throw new ImageValidationError("Bilddaten sind kein gueltiges Base64.");
  }

  let dimensions;
  try {
    dimensions = imageSize(buffer);
  } catch (err) {
    throw new ImageValidationError("Bild konnte nicht gelesen werden.");
  }

  if (dimensions.width > MAX_DIMENSION_PX || dimensions.height > MAX_DIMENSION_PX) {
    throw new ImageValidationError(
      `Bild ueberschreitet die maximale Aufloesung von ${MAX_DIMENSION_PX}x${MAX_DIMENSION_PX}px (tatsaechlich ${dimensions.width}x${dimensions.height}px).`
    );
  }

  return { data, mimeType };
}

// images: Array<{ data: string (base64), mimeType: string }> | undefined
// Gibt bei fehlenden Bildern ein leeres Array zurueck (bewusst kein
// leeres Bildfeld an Gemini durchreichen -- sonst Fehler 400, siehe
// geminiClient.js).
function validateImages(images) {
  if (!images) {
    return [];
  }
  if (!Array.isArray(images)) {
    throw new ImageValidationError("Feld 'images' muss ein Array sein.");
  }
  if (images.length > MAX_IMAGES) {
    throw new ImageValidationError(
      `Es koennen hoechstens ${MAX_IMAGES} Fotos gleichzeitig gesendet werden.`
    );
  }
  return images.map(validateSingleImage);
}

module.exports = {
  validateImages,
  ImageValidationError,
  MAX_DIMENSION_PX,
  MAX_IMAGES,
};
