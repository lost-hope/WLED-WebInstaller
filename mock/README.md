# mock/

Lets you test the installer's full chip/variant support - including
ESP32-C6/-C5/-P4 - **before** WLED's nightly CI actually publishes
matching release assets. Right now nightly is disabled upstream, so none
of these exist on the real
[WLED releases page](https://github.com/wled/WLED/releases) yet.

## What's here

- `releases.json` - a fixture shaped exactly like the GitHub releases API
  response `app.js` normally fetches: one `nightly` release listing every
  asset below.
- `bin/*.bin` - **real, fully compiled WLED firmware** (version
  `17.0.0-devV5`), built locally from WLED's `main` branch with
  PlatformIO, one binary per env. Not stub/placeholder files - these are
  genuine builds and will actually boot if flashed to matching hardware.
  Covers every chip/variant this installer currently wires up:

  | Chip | Variants built |
  |---|---|
  | ESP32 | normal, Ethernet, debug, Wrover (PSRAM), HUB75 (default + forum pinout) |
  | ESP32-C3 | normal (DIO), QIO override |
  | ESP32-S2 | normal |
  | ESP32-S3 | 4MB/QSPI, 8MB (none/QSPI/OPI), 16MB/OPI, HUB75 (HD-WF2, Adafruit MatrixPortal, MoonHub, Waveshare) |
  | ESP32-C6 | 4MB |
  | ESP32-C5 | 4MB, 8MB/QSPI+PSRAM |
  | ESP32-P4 | 16MB (experimental) |

  (ESP8266 variants aren't included - out of scope for this fixture.)

## How to use it

Serve the repo root with any static server (the fixture's asset paths are
relative to it) and open the page with a `mockReleases` query param
pointing at the fixture:

```bash
cd WLED-WebInstaller   # repo root
python -m http.server 8080
# then open:
# http://localhost:8080/index.html?mockReleases=mock/releases.json
```

`?mockReleases=...` is read once at page load (see `loadReleases()` in
`app.js`) and completely bypasses the real GitHub API and its
sessionStorage cache - edit `releases.json` and reload to see changes
immediately, no cache to clear.

Since these are real firmware builds, flashing them over Web Serial
should produce a working WLED device on matching hardware, not just
exercise the installer's own UI/manifest-generation logic.
