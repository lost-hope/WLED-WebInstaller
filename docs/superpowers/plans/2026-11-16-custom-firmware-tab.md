# Custom Firmware Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third "Custom" UI mode alongside Basic/Advanced that lets a user flash their own firmware `.bin` (own usermods, or a WLED CI build artifact), picking chip/flash-size/flash-mode explicitly since none of that can be inferred from an arbitrary uploaded file.

**Architecture:** Reuse the existing `CHIP_CONFIG[chip].bootParts()` boot-file machinery as-is (one small, backward-compatible signature addition - see Task 1), but give Custom mode its own independent manifest-building path and its own freshly-rendered-per-chip size/mode selector containers, so it never touches the release-asset-driven `setManifest()`/availability-chart code that Basic/Advanced rely on.

**Tech Stack:** Vanilla JS (no build step, no framework), same as the rest of this repo. No test runner exists in this project - "tests" below are concrete Playwright `eval`/`console`/DOM-state checks run directly against a locally-served page, matching how every other feature in this repo has been verified so far.

**Spec:** `docs/superpowers/specs/2026-11-16-custom-firmware-tab-design.md`

## Deviation from the spec

The spec's Goals section describes a `'planned'` (hardware-feasible,
not-yet-built) status for flash modes, shown disabled in the UI. After
the spec's own corrected capability table, there are currently zero
modes in that state for any chip - every mode is either `'available'`
(real file) or omitted (impossible or unverified). This plan's
`flashModes` arrays therefore only ever list available modes; no
`'planned'`/disabled-option UI is built (YAGNI - there's nothing for it
to render today). If a future chip/mode combination becomes a genuine
"confirmed buildable, not yet built" case, re-introducing that status is
a small, separate follow-up, not blocked by anything here.

## Global Constraints

- No network call is ever made for the user's uploaded firmware file - it's wrapped in a `blob:` URL (`URL.createObjectURL`) and never leaves the browser.
- The existing release-driven flow (Basic/Advanced modes, every variant, every HUB75 layout) must produce byte-for-byte identical manifests after every task - verify with a regression check whenever `CHIP_CONFIG` changes.
- Reuse the existing `radio` / `radio__input` / `radio__label` CSS classes for all new Custom-mode controls - no new CSS.
- New user-facing strings go in `lang/en.json` only for this pass (other languages are a separate, later effort, consistent with every other string already added this way in this project).
- Reuse an existing i18n key instead of adding a near-duplicate one wherever the English text is identical (e.g. the existing `flashSize`/`flashMode` labels).

## Review Focus

- Switching to Custom mode and clicking Install with no file chosen yet must not crash or attempt a flash - the Install button stays disabled until a file is present (Task 4).
- Selecting ESP8266 as the chip must hide the flash-mode selector entirely (it has no flash-mode concept - flat image, zero boot parts) rather than show an empty or single, meaningless option (Task 3).
- Switching chips in Custom mode after picking a non-default size/mode for the previous chip must land on a valid default for the new chip, never carry over a now-invalid value (e.g. `32MB` selected for ESP32-S3, then switching to ESP32-C6 which only has `4MB`) (Task 3).
- Leaving Custom mode back to Basic/Advanced (and the reverse) must leave both flows in a correct, non-stuck state - the Install button's enabled/disabled state and the `manifest` attribute must reflect whichever mode is now active, not a stale value from the one just left (Task 4).
- The `CHIP_CONFIG` edits in Task 1 (new `explicitMode` bootParts parameter, ESP32-S3's size-branch fix) must not change any existing release-driven manifest - verified via an explicit before/after comparison, not just "it still runs" (Task 1).

---

### Task 1: Extend `CHIP_CONFIG` for Custom mode; fix latent ESP32-S3 32MB gap

**Files:**
- Modify: `app.js:139-311` (the `CHIP_CONFIG` object)

**Interfaces:**
- Produces: `CHIP_CONFIG[chip].flashSizes: string[]` (now present on every chip, not just ESP32/-C3/-S2); `CHIP_CONFIG[chip].flashModes: string[]` (subset of `'dio'|'qio'|'opi'`, empty array for ESP8266); `CHIP_CONFIG[chip].bootParts(flashSizeId, flashModeId, explicitMode?)` - existing signature gains an optional 3rd boolean parameter. Later tasks call `bootParts(size, mode, true)` to bypass the asset-gated `resolveFlashMode()` and use `mode` exactly as given.

Add these exact values (see spec's corrected capability table for the reasoning behind each):

```
ESP8266:    flashSizes: ['1MB', '2MB', '4MB']        flashModes: []
ESP32:      flashSizes: ['4MB', '8MB', '16MB']        flashModes: ['dio', 'qio']   (already has flashSizes)
ESP32-C3:   flashSizes: ['4MB', '8MB', '16MB']        flashModes: ['dio', 'qio']   (already has flashSizes)
ESP32-S2:   flashSizes: ['4MB', '8MB', '16MB']        flashModes: ['dio', 'qio']   (already has flashSizes)
ESP32-S3:   flashSizes: ['4MB', '8MB', '16MB', '32MB'] flashModes: ['qio', 'opi']  (flashSizes is new)
ESP32-C6:   flashSizes: ['4MB']                        flashModes: ['qio']          (flashSizes is new)
ESP32-C5:   flashSizes: ['4MB', '8MB']                 flashModes: ['qio']          (flashSizes is new - remove the now-stale "No flashSizes array needed" comment)
ESP32-P4:   flashSizes: ['16MB']                       flashModes: ['qio']          (flashSizes is new)
```

- [ ] **Step 1: Capture today's release-driven manifests for a regression baseline**

Before touching any code, with the page served locally and a mocked/cached release available (reuse the `?mockReleases=` fixture from `mock/releases.json`, or any cached real release), run via Playwright `eval` and save the output:
```js
// For each of: ESP32 normal/4MB/dio-default, ESP32-C3 normal/8MB/qio,
// ESP32-S2 normal/16MB, ESP32-S3 HUB75 "waveshare" layout
// -> fetch each opt._manifests[...] URL and record the full JSON.
```
Expected: four JSON blobs saved to compare against after Task 1's edits.

- [ ] **Step 2: Add `flashSizes` and `flashModes` arrays to every `CHIP_CONFIG` entry**

Exact values per the table above. `ESP8266.flashModes = []`.

- [ ] **Step 3: Add the `explicitMode` parameter to ESP32/-C3/-S2/-S3's `bootParts`**

In each of the four functions, change the one line that calls
`resolveFlashMode(chip, flashModeId)` to:
```js
const mode = explicitMode ? flashModeId : resolveFlashMode(chip, flashModeId);
```
and use `mode` (not the old inline `resolveFlashMode(...)` call) to index
`FLASH_MODE_BOOTLOADERS[chip]`. Add `explicitMode` as the function's 3rd
parameter in all four. ESP32-C5/-C6/-P4/ESP8266's `bootParts` are
unchanged (JS ignores extra call arguments; none of them call
`resolveFlashMode` today).

- [ ] **Step 4: Fix ESP32-S3's `bootParts` to handle `'32MB'` correctly**

Today's size branch only patches for `'4MB'`/`'16MB'` and silently falls
through to the native-8MB/no-patch branch for anything else, including
`'32MB'` - pairing a 32MB-sized firmware with the 8MB partition table,
which happens to be unreachable today only because no existing caller
ever requests S3+normal+32MB. Fix the condition and partition-file
selection:
```js
if (flashSizeId === '4MB' || flashSizeId === '16MB' || flashSizeId === '32MB') {
  const partitions = flashSizeId === '16MB' ? 'partitions_s3_16m.bin'
    : flashSizeId === '32MB' ? 'partitions_s3_32m.bin'
    : 'partitions_s3_4m.bin';
  return getPatchedBootloaderUrl(src, flashSizeId).then((url) => [
    { path: url, offset: 0 },
    { path: partitionBase + partitions, offset: 32768 }
  ]);
}
```
(`partitions_s3_32m.bin` already exists in `bin/boot/partitions/` - it's
what the Waveshare HUB75 layout already uses via its own separate
`bootParts`, unaffected by this change.)

- [ ] **Step 5: Re-run the Step 1 regression check and diff against the baseline**

Same four manifests, same method. Expected: byte-identical JSON to the
Step 1 baseline (the Waveshare HUB75 layout doesn't call
`CHIP_CONFIG['ESP32-S3'].bootParts` at all, so Step 4 can't affect it -
confirm that's still true by checking its manifest's bootloader/
partition paths didn't change either).

- [ ] **Step 6: New Playwright check - explicit mode bypasses gating**

Via `eval`, confirm (requires temporarily exposing `CHIP_CONFIG` on
`window` or testing through a thin temporary call site - remove any
scaffolding after confirming):
`CHIP_CONFIG['ESP32-S3'].bootParts('32MB', 'opi', true)` resolves to a
bootloader part whose URL, when fetched and run through
`esptool image_info`-equivalent inspection (or just checked for a
blob: URL being produced, since `bootloader_s3_opi.bin` is the only
source file requested when mode='opi'), and partition part
`.../partitions_s3_32m.bin`.

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "Extend CHIP_CONFIG with explicit flashSizes/flashModes and an explicit-mode bootParts path for Custom firmware mode; fix latent ESP32-S3 32MB partition mismatch"
```

---

### Task 2: Custom mode markup in `index.html`

**Files:**
- Modify: `index.html:71-215` (wrap the release-driven block; add the Custom radio option and new panel)

**Interfaces:**
- Produces these element ids for Task 3/4 to read/write:
  `custom` (radio input), `releaseDrivenPanel` (wraps existing `#ver`
  through `#layoutRow`), `customPanel`, `customFirmwareInput`,
  `customChipSelect`, `customFlashSizeOptions` (empty container, radios
  rendered into it by Task 3), `customFlashModeRow` (wraps the mode
  options container, hidden/shown by Task 3), `customFlashModeOptions`.

- [ ] **Step 1: Add the "Custom" radio option to `uiModeRow`**

After the existing `advanced` radio/label pair (`index.html:76-77`), add:
```html
<input class="radio__input" type="radio" value="custom" name="uimode" id="uimode_custom">
<label class="radio__label" for="uimode_custom" id="uimode_custom_label" data-i18n="uiModeCustom">Custom</label>
```

- [ ] **Step 2: Wrap the existing release-driven block in a new container**

Wrap `index.html:83` (`<select id="ver" ...>`) through the end of
`#layoutRow` and its trailing `<br>` (`index.html:215`) in:
```html
<div id="releaseDrivenPanel">
  ... existing content, unchanged ...
</div>
```

- [ ] **Step 3: Add the Custom panel, right after `releaseDrivenPanel`, before the install-button container**

```html
<div id="customPanel" hidden>
  <div class="row-hint" data-i18n="customHint">For your own compiled firmware - a custom usermods build, or a WLED CI build artifact. Pick the chip, flash size, and flash mode yourself; none of it is detected from the file.</div>
  <br>

  <div class="row-label" data-i18n="customFirmwareLabel">Firmware file:</div>
  <input type="file" id="customFirmwareInput" accept=".bin">
  <br><br>

  <div class="row-label" data-i18n="customChipLabel">Chip:</div>
  <select id="customChipSelect" class="btn"></select>
  <br><br>

  <div id="customFlashSizeRow">
    <div class="row-label" data-i18n="flashSize">Flash size:</div>
    <div class="radio" id="customFlashSizeOptions"></div>
  </div>
  <br>

  <div id="customFlashModeRow">
    <div class="row-label" data-i18n="flashMode">Flash mode:</div>
    <div class="radio" id="customFlashModeOptions"></div>
  </div>
  <br>
</div>
```

- [ ] **Step 4: Verify with Playwright**

Load the page, confirm via `eval`: `document.getElementById('customPanel')` and `document.getElementById('releaseDrivenPanel')` both exist; zero new console errors versus before this task.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add Custom mode markup: third uiMode option, release-driven panel wrapper, new custom firmware panel"
```

---

### Task 3: Populate the chip select and per-chip size/mode options

**Files:**
- Modify: `app.js` (new code, near the existing `FLASH_SIZES`/`FLASH_MODES` constants and `i18nInit`-style population functions)

**Interfaces:**
- Consumes: `CHIP_CONFIG[chip].flashSizes`, `CHIP_CONFIG[chip].flashModes` (Task 1).
- Produces: `populateCustomChipSelect()`, `renderCustomSizeAndModeOptions(chip)` - called by Task 4's chip-select change handler and once at init.

- [ ] **Step 1: Define the chip display order and flash-mode labels**

```js
const CUSTOM_CHIP_ORDER = ['ESP32', 'ESP32-C3', 'ESP32-S2', 'ESP32-S3', 'ESP32-C6', 'ESP32-C5', 'ESP32-P4', 'ESP8266'];
const CUSTOM_FLASH_MODE_LABELS = { dio: 'customFmDual', qio: 'customFmQuad', opi: 'customFmOctal' };
```
(i18n keys, not literal label text - resolved through the existing `i18n()`/`i18n_messages` lookup the same way every other label in this file is, at render time.)

- [ ] **Step 2: Write `populateCustomChipSelect()`**

Appends one `<option>` per `CUSTOM_CHIP_ORDER` entry (value = chip key,
text = chip key - e.g. `"ESP32-S3"` - no extra prettification needed,
matching how this repo already names chips everywhere else) to
`#customChipSelect`. Select `'ESP32'` by default. Call once at init and
wire its `change` event to `renderCustomSizeAndModeOptions`.

- [ ] **Step 3: Write `renderCustomSizeAndModeOptions(chip)`**

- Clears and rebuilds `#customFlashSizeOptions`: one radio+label pair
  per `CHIP_CONFIG[chip].flashSizes` entry, `name="customflashsize"`,
  `id="cfs_" + sizeId`, first one checked. If `flashSizes.length <= 1`,
  still render the single option (keeps the UI predictable) but it's
  effectively fixed.
- Clears and rebuilds `#customFlashModeOptions`: one radio+label pair
  per `CHIP_CONFIG[chip].flashModes` entry (`name="customflashmode"`,
  `id="cfm_" + modeId`, label text from `CUSTOM_FLASH_MODE_LABELS`),
  first one checked.
- Sets `document.getElementById('customFlashModeRow').hidden = CHIP_CONFIG[chip].flashModes.length === 0` (true only for ESP8266 today).
- Does **not** build or set any manifest - that's Task 4's job, called
  right after this from the same event handlers.

- [ ] **Step 4: Verify with Playwright**

For each of the 8 chips in `CUSTOM_CHIP_ORDER`: select it via the
dropdown, read back `#customFlashSizeOptions`/`#customFlashModeOptions`'
rendered option values, and assert they exactly match
`CHIP_CONFIG[chip].flashSizes`/`flashModes`. Specifically assert
`#customFlashModeRow`'s `hidden` is `true` only for `'ESP8266'` and
`false` for the other seven.

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "Populate Custom mode's chip select and per-chip flash size/mode options"
```

---

### Task 4: Manifest building, mode-switch wiring, Install button gating

**Files:**
- Modify: `app.js` (new `buildCustomManifest`/`applyCustomManifest` functions; extend the existing `uiModeRow` change handler)

**Interfaces:**
- Consumes: `CHIP_CONFIG[chip].bootParts(size, mode, true)` (Task 1), `CHIP_CONFIG[chip].firmwareOffset` (existing), `renderCustomSizeAndModeOptions` (Task 3), `createManifestUrl` (existing, reused as-is).
- Produces: `applyCustomManifest()` - rebuilds and applies the Custom-mode manifest from current file/chip/size/mode selections; called on every relevant `change`/`input` event inside `#customPanel`.

- [ ] **Step 1: Write `buildCustomManifest(chip, flashSizeId, flashModeId, file)`**

```js
async function buildCustomManifest(chip, flashSizeId, flashModeId, file) {
  const config = CHIP_CONFIG[chip];
  const parts = await config.bootParts(flashSizeId, flashModeId, true);
  parts.push({ path: URL.createObjectURL(file), offset: config.firmwareOffset });
  return {
    name: 'WLED',
    version: 'custom',
    home_assistant_domain: 'wled',
    new_install_prompt_erase: true,
    builds: [{ chipFamily: config.chipFamily, parts: parts }]
  };
}
```

- [ ] **Step 2: Write `applyCustomManifest()`**

Reads the current chip (`#customChipSelect.value`), checked size/mode
radio values, and `#customFirmwareInput.files[0]`. If no file is
selected yet: set `document.getElementById('installBtn').disabled = true`
and return early (do not build a manifest). Otherwise `await buildCustomManifest(...)`,
set it via `createManifestUrl` onto `#inst`'s `manifest` attribute (same
pattern as `setManifest()` uses today), and enable the Install button.

- [ ] **Step 3: Wire events**

- `#customFirmwareInput` `change` -> `applyCustomManifest()`.
- `#customChipSelect` `change` -> `renderCustomSizeAndModeOptions(chip)` then `applyCustomManifest()`.
- `#customFlashSizeOptions`/`#customFlashModeOptions` (event-delegated `change` on their parent, since their contents are rebuilt per chip) -> `applyCustomManifest()`.

- [ ] **Step 4: Extend the `uiModeRow` change handler**

Alongside whatever it already does for basic/advanced, add: when the
selected `uimode` is `'custom'`, hide `#releaseDrivenPanel`, show
`#customPanel`, call `renderCustomSizeAndModeOptions()` for the
currently-selected chip (in case this is the first time entering Custom
mode this page load), then `applyCustomManifest()` (which will
correctly leave Install disabled if no file is chosen yet). For any
other mode, hide `#customPanel`, show `#releaseDrivenPanel`, and call
the existing `setManifest()` so the release-driven Install state is
correct again (handles the "switched away and back" case from Review
Focus).

- [ ] **Step 5: Verify with Playwright - the full happy path, three chips**

For each of (a) `ESP32` / `4MB` / `dio` (re-flagged bootloader path),
(b) `ESP32-S3` / `32MB` / `opi` (the newly-fixed branch), (c) `ESP8266`
/ `2MB` (no mode row, zero boot parts): switch to Custom mode, pick the
chip/size/mode, attach one of the real compiled binaries already on
disk from the `nightly-chip-support` work as the file (e.g.
`wled-src/build_output/release/WLED_17.0.0-devV5_ESP32.bin` for (a)) via
a synthetic `DataTransfer`/`File`, and fetch+inspect the resulting
manifest JSON: confirm `builds[0].chipFamily`, every boot part's
`offset`, and that the last part's `path` is a `blob:` URL. Confirm
`#installBtn.disabled` is `false` only once a file is attached.

- [ ] **Step 6: Verify the Review Focus edge cases**

- No file attached -> Install stays disabled (re-check explicitly, not just inferred from Step 5).
- Select `ESP32-S3` + `32MB`, then switch chip to `ESP32-C6` -> confirm the now-rendered size options are exactly `['4MB']` and the checked value isn't a stale `'32MB'`.
- Switch to Custom, back to Advanced, back to Custom -> confirm `#installBtn.disabled` and the `manifest` attribute reflect the currently-active mode each time, not a leftover from the mode just left.

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "Wire up Custom mode manifest building, mode-switch panel toggling, and Install button gating"
```

---

### Task 5: i18n strings

**Files:**
- Modify: `lang/en.json`
- Modify: `index.html` (add any `data-i18n` attributes not already included inline in Task 2's markup - Task 2's snippet already includes them; this task is about the JSON values existing)

**Interfaces:**
- Produces: `uiModeCustom`, `customHint`, `customFirmwareLabel`, `customChipLabel`, `customFmDual`, `customFmQuad`, `customFmOctal` keys in `lang/en.json`. Reuses existing `flashSize`/`flashMode` keys (no new key for those two labels - see Global Constraints).

- [ ] **Step 1: Add the new keys to `lang/en.json`**

```json
"uiModeCustom": "Custom",
"customHint": "For your own compiled firmware - a custom usermods build, or a WLED CI build artifact. Pick the chip, flash size, and flash mode yourself; none of it is detected from the file.",
"customFirmwareLabel": "Firmware file:",
"customChipLabel": "Chip:",
"customFmDual": "Dual (DIO)",
"customFmQuad": "Quad (QIO)",
"customFmOctal": "Octal (OPI)"
```

- [ ] **Step 2: Optionally extend the existing `uiModeHint` text to mention Custom mode**

E.g. append one clause: "...or switch to Custom to flash your own firmware file." Purely additive to existing English text; other languages keep showing their current translation until someone updates them (same fallback behavior every other string in this project already relies on).

- [ ] **Step 3: Verify with Playwright**

Switch to Custom mode, confirm every element with a `data-i18n` attribute inside `#customPanel` (and the new `uimode_custom_label`) has non-empty `textContent` after page load - i.e. no key resolved to `undefined`/blank.

- [ ] **Step 4: Commit**

```bash
git add lang/en.json index.html
git commit -m "Add English strings for Custom mode"
```
