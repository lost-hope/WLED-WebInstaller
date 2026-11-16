# Custom Firmware Tab - Design

## Intent & why

Power users have a compiled WLED firmware binary that isn't a published
GitHub release asset - either their own build with custom usermods, or
a test artifact downloaded from one of WLED's own GitHub Actions CI
runs. They want to flash it using this installer's existing
chip/flash-size/flash-mode-aware bootloader + partition-table handling,
without having to figure out flash offsets or source boot files
themselves.

## Goals

- A third UI mode, "Custom", alongside the existing Basic/Advanced,
  selected via the existing `uiModeRow` radio group.
- User supplies a firmware `.bin` via a local file input - nothing is
  uploaded anywhere, the file stays in the browser the whole time.
- User explicitly selects: chip (ESP8266, ESP32, ESP32-S2, ESP32-S3,
  ESP32-C3, ESP32-C5, ESP32-C6, ESP32-P4), flash size (chip-appropriate
  options only), flash mode (Dual/Quad/Octal - only the modes that are
  hardware-feasible for the selected chip).
- Reuses the existing bootloader/partition infrastructure
  (`CHIP_CONFIG`, `bin/boot/*`) wherever a real file already exists.
- Flash-mode options that are hardware-feasible but don't have a real
  bootloader file built yet are shown as explicitly disabled/"not
  available yet", not omitted silently and not hidden.
- Modes that are not hardware-feasible for a given chip at all (e.g.
  Octal on ESP32/C3/S2/ESP8266) are not shown as options for that chip,
  full stop - there's nothing to ever "finish" there.

## Non-goals (for this pass)

- HUB75 board-specific layouts (Waveshare / Adafruit MatrixPortal /
  MoonHub / HD-WF2) are not exposed in Custom mode. Those need their own
  special-cased bootloader/partition pairing beyond the general
  chip+size+mode axes (e.g. Waveshare's bootloader is paired with a
  specific octal config no other board uses), and weren't needed for
  either stated use case (own usermods, CI artifacts of the normal build
  matrix). Can be added later as a fourth axis if that need shows up.
- Memory type (PSRAM: Wrover/QSPI/OPI as a *firmware-asset* axis) is not
  shown. It never affects boot files at all - PSRAM init happens
  app-side, not in the 2nd-stage bootloader (see existing
  `MEMORY_TYPE_ASSETS` comment in `app.js`) - so once the firmware
  itself is already fixed by the uploaded file, this selector would be
  a no-op.
- Variant selection (Ethernet / Audio / V4 / Debug) is not shown. Those
  exist only to pick among different release assets for the *same*
  chip; moot once the user supplies their own single file.
- Confirming whether Dual and/or Octal are actually buildable on
  ESP32-C6/-C5/-P4 (and then building them if so) is explicit follow-up
  work, tracked separately. This pass ships the UI/data model with
  those combinations omitted entirely until that's resolved. (ESP32-S3
  Dual is not follow-up work - it's confirmed unbuildable with today's
  toolchain and won't appear in the UI at all, ever, unless that
  changes upstream.)

## Anti-goals

- Must never let a user select a hardware-impossible mode and generate
  a manifest that fails confusingly mid-flash - impossible combinations
  must not be selectable, not just "likely to fail".
- Must not touch or destabilize the existing release-driven Basic/
  Advanced flow (`setManifest()`, `opt._manifests`, the availability-
  chart functions) - Custom mode is additive, with its own independent
  code path.

## Constraints

Flash **size** is safely re-flaggable client-side from a single
canonical bootloader file (existing `patchBootloaderFlashSize()` /
`getPatchedBootloaderUrl()` in `app.js`) - this part of the existing
machinery is reused as-is.

Flash **mode** (Dual/Quad/Octal) is baked into the bootloader's
*compiled* SPI-flash-init code - every mode needs its own real built
file per chip, never header-patchable, and this was re-confirmed against
esptool's own source: its generic image-header `FLASH_MODES` dict is
`{qio, qout, dio, dout}` only - there is no generic "opi" header value at
all. Octal is a deeper compile-time ESP-IDF `memory_type` configuration,
not a flashable header field, consistent with how this repo already
treats `bootloader_s3_opi.bin` as "a real alternate PlatformIO build"
rather than something re-flaggable (see `bin/boot/README.md`).

Per-chip mode support, from this repo's already-committed files plus
known hardware limits of each chip:

| Chip | Dual | Quad | Octal |
|---|---|---|---|
| ESP8266 | n/a - flat image, no mode concept at all | | |
| ESP32 | have (`bootloader_esp32_8m.bin`) | have (`bootloader_esp32_8m_qio.bin`) | not possible (hardware) |
| ESP32-C3 | have (`bootloader_c3_8m.bin`) | have (`bootloader_c3_8m_qio.bin`) | not possible (hardware) |
| ESP32-S2 | have (`bootloader_s2_dio.bin`) | have (`bootloader_s2.bin`) | not possible (hardware) |
| ESP32-S3 | **not buildable at all** - confirmed via `bin/boot/README.md`'s "What's actually buildable" section: the precompiled Arduino-ESP32 v3.x `esp32-arduino-libs` only ships sdkconfig variants for QIO / QIO+octal-PSRAM / OPI on this chip, no plain DIO - omit from UI, not a "planned" slot | have (`bootloader_s3.bin`) | have (`bootloader_s3_opi.bin`) |
| ESP32-C6 | unverified - omit until confirmed feasible (same uncertainty as this chip's Octal column; `bin/boot/README.md` doesn't establish buildability for this chip's Dual either) | have, default (`bootloader_c6_4m.bin`) | unverified - omit until confirmed feasible |
| ESP32-C5 | unverified - omit until confirmed feasible | have, default (`bootloader_c5.bin`) | unverified - omit until confirmed feasible |
| ESP32-P4 | unverified - omit until confirmed feasible | have, default (`bootloader_p4_16m.bin`) | unverified - omit until confirmed feasible |

Note the correction from an earlier draft of this doc: ESP32-S3 Dual was
initially mis-classified as "need to build" (implying it's merely
unbuilt-but-feasible, i.e. `'planned'`). It's actually confirmed
unbuildable with today's toolchain, same tier as a hardware-impossible
mode - omitted from the UI entirely, not shown as a disabled "coming
soon" option. The same downgrade (from "need to build" to "unverified -
omit") applies to C6/C5/P4 Dual, since nothing in this repo actually
establishes those as buildable either - guessing feasibility either way
for three newer chips isn't something this doc should assert without
checking.

Flash sizes per chip (today's `CHIP_CONFIG`/`VARIANTS` data, to become
one explicit `flashSizes` array per chip - see Approach):

- ESP8266: 1MB / 2MB / 4MB
- ESP32, ESP32-C3, ESP32-S2: 4MB / 8MB / 16MB
- ESP32-S3: 4MB / 8MB / 16MB / 32MB
- ESP32-C6: 4MB (only)
- ESP32-C5: 4MB / 8MB
- ESP32-P4: 16MB (only)

## Approaches considered

1. **Reuse the existing `flashSizeRow`/`flashModeRow` DOM elements
   directly**, just repopulating their options for Custom mode.
   Rejected on closer look: those elements only have radios for the
   sizes/modes the release-driven flow has ever needed (1/2/4/8/16MB;
   Default/DIO/QIO) - no 32MB, no Octal. Custom mode needs both (for
   ESP32-S3). Adding those as new-but-normally-hidden static radios to
   the *shared* markup would mean the existing release-driven
   availability logic (`updateFlashSizeAvailability`,
   `updateFlashModeAvailability`, `forceBasicMode`) now has to actively
   know about and hide options that only make sense in Custom mode -
   directly against this doc's anti-goal of not touching that code.
2. **A fully separate, duplicated Custom-mode panel with its own
   from-scratch markup and CSS.** Visually and structurally safe, but
   throws away the existing styled/translated row pattern for no
   reason.
3. **Custom mode renders its own dedicated containers
   (`customFlashSizeRow`/`customFlashModeRow`), built fresh via JS from
   `CHIP_CONFIG` whenever the selected chip changes, reusing the same
   CSS classes as the existing rows for visual consistency** (chosen).
   Gets approach 2's isolation (nothing touches the release-driven
   availability functions) without approach 2's wasted restyling - same
   `radio`/`radio__input`/`radio__label` classes, same look, genuinely
   separate DOM and separate (much simpler) logic.
4. Retrofit the *existing* `setManifest()` / `updateFlashSizeAvailability()`
   / etc. functions to also cover the no-release Custom case. Rejected:
   those functions are built entirely around "is there a matching
   GitHub release asset for this combination", which doesn't apply here
   at all - forcing a second, unrelated availability model through the
   same functions would make both harder to follow, on top of the same
   missing-radio problem as option 1.

## The decided how

- `uiModeRow` gets a third radio option, "Custom" (new i18n keys,
  English first - other languages can follow later same as any other
  new string).
- A new container holds: the firmware file input, a chip `<select>`,
  and two freshly-rendered-per-chip groups (`customFlashSizeRow`,
  `customFlashModeRow`) using the existing `radio`/`radio__input`/
  `radio__label` CSS classes for visual consistency, but as their own
  DOM, independent of `flashSizeRow`/`flashModeRow`.
- No "Default" option in Custom mode - there's no release build to
  inherit a default from, unlike Advanced mode's flash-mode row. Modes
  are labeled plainly: "Dual (DIO)", "Quad (QIO)", "Octal (OPI)" -
  matching the DIO/QIO/OPI abbreviations already used elsewhere in this
  project (e.g. the existing `memOpi` / "PSRAM (S3 OPI)" label).
- `CHIP_CONFIG` gains, for every chip:
  - An explicit `flashSizes` array (added now even for chips where it's
    currently redundant for the release-driven path, e.g. ESP32-S3/-C5/
    ESP8266 - becomes the single source of truth Custom mode reads,
    independent of `VARIANTS`).
  - A `flashModes` descriptor listing which modes exist for that chip
    and their status: `'available'` (real file, wire it up) or
    `'planned'` (hardware-feasible, no file yet - render disabled with
    a short note). Modes that are hardware-impossible *or unverified*
    for a chip are simply absent from its descriptor, not listed with
    any status - per the corrected table above, this currently means
    ESP8266 has no entry at all (see below) and ESP32-S3 has exactly
    two entries (Quad, Octal - no Dual).
- ESP8266 is a real edge case, not covered by "every chip has at least
  one available mode": it has no flash-mode concept at all (flat image,
  `CHIP_CONFIG['ESP8266'].bootParts()` already returns `[]`). When
  ESP8266 is the selected chip, `customFlashModeRow` is hidden entirely
  rather than showing an empty or single-option group.
- A new `buildCustomManifest(chip, flashSizeId, flashModeId, firmwareFile)`
  function: resolves boot parts via the *existing*
  `CHIP_CONFIG[chip].bootParts(...)` (reused as-is, unmodified - for
  ESP8266 this is `[]`, flashModeId is simply unused), and the firmware
  part from `URL.createObjectURL(firmwareFile)` instead of a mirrored
  GitHub URL. This is the only new manifest-building path; everything
  release-driven stays untouched.
- Selecting a chip other than ESP8266 always lands on a usable default
  (every non-ESP8266 chip has at least one `'available'` flash mode
  today - Quad, per the corrected table above).

## What's left to the builder (this session, same conversation)

- Implement in `app.js` / `index.html` / `lang/en.json` as described
  above.
- Verify end-to-end with Playwright, using one of the real compiled
  binaries already on disk from the `nightly-chip-support` work (real
  ESP32/-C3/-S2/-S3/-C6/-C5/-P4 builds exist locally) as the "user-
  uploaded file" in a test, confirming the generated manifest has
  correct boot-part offsets for at least one `'available'` combination
  per chip.
- Leave every `'planned'` (not-yet-built) mode as explicit follow-up
  work for a later pass - not attempted here.
- Decide and document exactly which i18n keys are needed and add them to
  `lang/en.json` (other languages follow later, same as any other new
  string in this project).
