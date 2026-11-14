# HS11 Scale

A static web app that reads stored measurements from a **Lenovo HS11** smart
scale over **Web Bluetooth**, keeps a history in the browser, and shows trends
and body-composition estimates. No build step: plain HTML, CSS and ES modules,
served as-is by GitHub Pages. Installable to the Android home screen.

> **Status:** the protocol parser, body-composition maths and sync logic are
> unit-tested, and the UI has been exercised against a mocked
> `navigator.bluetooth`. It has **not yet been tested against a real HS11**.

## Features

- **Today**: latest weight with change since the previous reading and a
  sparkline, BMI on a WHO band scale, and your chosen metrics with their changes
- **Trends**: any metric over 7D / 30D / 90D / 1Y / All, with a hover and
  keyboard crosshair, plus change, average, lowest and highest for the range
- **History**: readings grouped by month; tap one for every metric or to delete it.
  CSV export and clear
- **Settings** (all editable, saved as you type): profile (height, age, sex),
  body-fat formula and calibration offset, which metrics to show, accent colour,
  clearing the scale's memory (`F2 01`), and the raw hex log of every packet
- Sync stored readings (`F2 00`), de-duplicated across syncs and kept in `localStorage`
- Light and dark themes, bottom tab bar on phones, installable to the home screen
- `?demo` mode with a pretend scale that speaks the same byte protocol

## Browser support

Web Bluetooth works in Chrome / Edge on Android, Windows, macOS and ChromeOS.
It does **not** work in Firefox or any browser on iOS. The page must be served
over HTTPS or from `localhost`.

## Protocol (Lenovo HS11, Chipsea CST34M97)

Source: <https://gist.github.com/bendtherules/4f90fb0eba6f2ffd4847d8ab448c0eb1>

| Item | UUID |
|---|---|
| Service | `0000fff0-0000-1000-8000-00805f9b34fb` |
| Command (write) | `0000fff1-0000-1000-8000-00805f9b34fb` |
| Data (notify) | `0000fff4-0000-1000-8000-00805f9b34fb` |

The scale does not advertise the service, so the app calls
`requestDevice({ acceptAllDevices: true, optionalServices: [0xfff0] })`.

- Write `F2 00` → the scale notifies its stored measurements.
- Write `F2 01` → the scale deletes them.
- Notifications carry one or more 10-byte records. Records starting `F2 00` are skipped.
  A final 2-byte `F2 00` marks the end of data.

Record layout:

| Byte | Meaning |
|---|---|
| b0 | year = `(b0 >> 4) + 2017`, month = `b0 & 0x0F` (1–12) |
| b1–b4 | day, hour, minute, second |
| b5 | high nibble: scale type (always `F`); low nibble: weight high bits |
| b6 | weight low byte — weight kg = `(((b5 & 0x0F) << 8) + b6) × 0.1` |
| b7–b9 | impedance = `b7 + (b8 << 8) + (b9 << 16)`, assumed tenths of an ohm |

Example: `67 1F 0F 1E 3B F2 E0 7A 12 00` → 31 Jul 2023 15:30:59, 73.6 kg, impedance 4730 (473.0 Ω).

Timestamps are the scale's local clock and are stored without a time zone.

## Code layout

```
index.html, styles.css, manifest.webmanifest, sw.js, icons/
src/domain/          pure: no DOM, no Bluetooth — fully unit-tested
  protocol.js          bytes ⇄ measurements, commands, UUIDs
  bodyComposition.js   BMI, body fat (Sun 2003 BIA / Deurenberg 1991), water, muscle, BMR
  metrics.js           metric registry and formatting
  insights.js          time ranges, summaries, month grouping, BMI band
  history.js           merge/dedupe, storage parsing, CSV
  settings.js          defaults and validation
src/bluetooth/
  scaleSync.js         read/delete conversations over a ScaleTransport (+ packet-log decorator)
  webBluetoothTransport.js   the real Web Bluetooth adapter
  demoTransport.js     pretend scale for ?demo
src/ui/              DOM wiring; chart geometry and colour contrast (pure, tested); localStorage
test/                node:test suites + a FakeTransport
```

Bluetooth sits behind a four-method `ScaleTransport` interface
(`connect`, `write`, `subscribe`, `disconnect`), so the sync logic is tested
against an in-memory fake.

## Run locally

Web Bluetooth only works in a secure context, and `http://localhost` counts.
Any static server works:

```sh
python3 -m http.server 8080
# open http://localhost:8080          (real scale)
# open http://localhost:8080/?demo    (no scale needed)
```

To use your phone with a dev server on your computer, connect it over USB and
use Chrome's port forwarding (`chrome://inspect` → *Port forwarding*,
`8080 → localhost:8080`), then open `http://localhost:8080` on the phone.

## Tests

Requires Node 20+ (no dependencies to install):

```sh
npm test
```

## Deploy to GitHub Pages

Deployment is automated by `.github/workflows/pages.yml`: every push to
`main` runs the tests and, if they pass, publishes the site files (not the
tests or README) to Pages. It can also be run by hand from the *Actions* tab.

One-time setup: *Settings → Pages → Build and deployment → Source*:
**GitHub Actions**.

The site is then at `https://<user>.github.io/<repo>/`. All paths are
relative, so the project sub-path works.

On Android Chrome, use *Add to Home screen* / *Install app*.

If you add or rename files, update the list in `sw.js` and bump `CACHE`;
new top-level files also need adding to the copy step in `pages.yml`.

## Caveats

- Body-composition values are population-formula estimates, not medical
  measurements. The impedance unit (tenths of an ohm) is an assumption from
  the protocol notes; values outside 150–1500 Ω are ignored.
- A reading with impedance `0` (e.g. wearing socks) gives weight and BMI only.
