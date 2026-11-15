/**
 * HS11 Scale <-> Google Sheet bridge.
 *
 * Paste this into the sheet's Apps Script editor (Extensions > Apps Script),
 * then Deploy > New deployment > Web app, "Execute as: Me",
 * "Who has access: Anyone", and paste the web app link into the HS11 app.
 *
 * Anyone who has that link can read and change this sheet's Readings and
 * Profiles tabs, so treat the link like a password.
 */

var READINGS_TAB = 'Readings';
var PROFILES_TAB = 'Profiles';
var READING_HEADERS = ['Date', 'Weight (kg)', 'Impedance (raw)', 'Profile ID', 'Profile'];
var PROFILE_HEADERS = ['ID', 'Name', 'Height (cm)', 'Age', 'Sex', 'Formula', 'Calibration offset'];
// Columns kept as plain text so Sheets does not reinterpret dates and ids.
var READING_TEXT_COLUMNS = [1, 4, 5];
var PROFILE_TEXT_COLUMNS = [1, 2, 5, 6];

function doGet() {
  return json(snapshot());
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var body = JSON.parse(e.postData.contents);
    var rev = currentRev();
    // Another device wrote since this one read: make it merge again.
    if (Number(body.baseRev) !== rev) return json({ ok: false, conflict: true });

    // The app may send extra, read-only columns (calculated metrics) per reading.
    var extraHeaders = body.extraHeaders || [];
    writeTab(READINGS_TAB, READING_HEADERS.concat(extraHeaders), READING_TEXT_COLUMNS, (body.readings || []).map(function (r) {
      var extra = extraHeaders.map(function (_, i) {
        var value = (r.extra || [])[i];
        return value === null || value === undefined ? '' : value;
      });
      return [r.takenAt, r.weightKg, r.impedanceRaw, r.profileId || '', r.profileName || ''].concat(extra);
    }));
    writeTab(PROFILES_TAB, PROFILE_HEADERS, PROFILE_TEXT_COLUMNS, (body.profiles || []).map(function (p) {
      return [p.id, p.name, blankIfNull(p.heightCm), blankIfNull(p.age), p.sex || '', p.formula || '', p.calibrationOffset || 0];
    }));

    PropertiesService.getScriptProperties().setProperty('rev', String(rev + 1));
    return json({ ok: true, rev: rev + 1 });
  } finally {
    lock.releaseLock();
  }
}

function snapshot() {
  return {
    ok: true,
    rev: currentRev(),
    extraHeaders: headerRow(READINGS_TAB).slice(READING_HEADERS.length),
    readings: readTab(READINGS_TAB).map(function (row) {
      return {
        takenAt: timestampText(row[0]),
        weightKg: row[1],
        impedanceRaw: row[2] === '' ? 0 : row[2],
        profileId: String(row[3] || '') || null,
      };
    }),
    profiles: readTab(PROFILES_TAB).map(function (row) {
      return {
        id: String(row[0] || ''),
        name: String(row[1] || ''),
        heightCm: row[2] === '' ? null : row[2],
        age: row[3] === '' ? null : row[3],
        sex: String(row[4] || '') || null,
        formula: String(row[5] || ''),
        calibrationOffset: row[6] === '' ? 0 : row[6],
      };
    }),
  };
}

function currentRev() {
  return Number(PropertiesService.getScriptProperties().getProperty('rev') || 0);
}

/** Non-empty header cells of a tab; empty if the tab does not exist. */
function headerRow(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 1) return [];
  return sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(String)
    .filter(function (cell) { return cell !== ''; });
}

/** Data rows of a tab (without the header); empty if the tab does not exist. */
function readTab(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet
    .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
    .getValues()
    .filter(function (row) { return row.join('') !== ''; });
}

function writeTab(name, headers, textColumns, rows) {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.getSheetByName(name) || book.insertSheet(name);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  if (rows.length === 0) return;
  textColumns.forEach(function (column) {
    sheet.getRange(2, column, rows.length, 1).setNumberFormat('@');
  });
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

/** A date typed by hand becomes a Date cell; turn it back into the app's text form. */
function timestampText(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    var zone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    return Utilities.formatDate(value, zone, "yyyy-MM-dd'T'HH:mm:ss");
  }
  return String(value);
}

function blankIfNull(value) {
  return value === null || value === undefined ? '' : value;
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
