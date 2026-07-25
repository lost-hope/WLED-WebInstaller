# WLED Web Installer

A static, GitHub-Pages-friendly web installer for [WLED](https://github.com/wled/WLED), built on
[ESP Web Tools](https://esphome.github.io/esp-web-tools/).

No build step and no server component: `index.html` fetches the release list straight from the
GitHub Releases API at page-load time and generates an install manifest on the fly for whichever
version / variant / flash size combination the user picks.

## Features

- Always up to date - versions come live from the [wled/WLED releases](https://github.com/wled/WLED/releases) API, no manual manifest maintenance.
- Variant selection (Plain, Audioreactive, Ethernet, ESP8266 CPU frequency test, ESP32 V4, DEBUG, HUB75 Matrix) - unavailable variants for the selected version are hidden automatically.
- Flash size selection (1MB / 2MB / 4MB / 8MB / 16MB) for boards that ship multiple binaries (ESP32-S3, ESP8266) - unavailable sizes for the selected version/variant are hidden automatically.
- HUB75 layout selection (board/pinout picker) when the HUB75 Matrix variant is selected.
- Multi-language UI, loaded dynamically from `lang/` - see [Localization](#localization).

## Local development

Any static file server works, e.g.:

```
npx serve .
```

Then open the printed local URL in Chrome or Edge (Web Serial is required).

## Deploying

Push to a repository and enable GitHub Pages for it (Settings -> Pages -> Deploy from branch).
No build step is required - the repository root is the site.

## Localization

`lang/languages.json` maps each supported language code to its display name, and
`lang/<code>.json` holds that language's strings. Both are fetched at runtime - `i18n.js` never
hardcodes a language list.

To add a language:

1. Copy `lang/en.json` to `lang/<code>.json` (e.g. `lang/de.json`) and translate the values.
2. Add one line to `lang/languages.json`: `"<code>": "<Native display name>"`.

That's it - the language selector and every `data-i18n` element on the page pick it up on next
load, no code changes required. Missing keys in a translation silently fall back to English.

## Files

- `index.html`, `style.css` - page markup/styling.
- `app.js` - release fetching, manifest generation, UI wiring.
- `i18n.js` - loads `lang/` and applies translations.
- `lang/` - one JSON file per language, plus `languages.json` listing them.
- `bin/boot/` - chip bootloaders and partition tables needed to flash bare chips (WLED release assets only contain the application binary).

## License

MIT, see `LICENSE`.
