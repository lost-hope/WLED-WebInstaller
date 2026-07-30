# tools/

Scripts to (re)generate the bootloader / partition-table files in
[bin/boot/](../bin/boot/). See that folder's README first for what each
output file actually is - this one only covers how to produce them.

Nothing here runs as part of serving the site; these are maintainer tools,
run by hand whenever a new WLED release needs a new flash-size variant, a
new board's partition layout, or an upstream partition-table change picked
up.

## Setup

```bash
pip install esptool
```

`gen_boot_images.py`'s `partitions` subcommand has no dependencies (it's a
from-scratch reimplementation of ESP-IDF's partition-table binary format).
The `bootloader` and `merge` subcommands shell out to `esptool` in-process,
since it - not this script - owns the ESP image checksum/SHA-256 format.
Tested against esptool 5.3.1.

## Building a reference `bootloader.bin` from WLED source

Both the `bootloader` and `merge` subcommands need a real, chip-matched
`bootloader.bin` as input (see their sections below). The bootloader isn't
WLED-specific - it comes from the Arduino-ESP32 core, compiled as part of
any PlatformIO build for that chip - so the easiest source is just building
WLED itself once per chip:

```bash
git clone https://github.com/wled/WLED.git
cd WLED
pio run -e <env>
```

The output appears at `.pio/build/<env>/bootloader.bin` (and
`.pio/build/<env>/partitions.bin`, if you want to sanity-check a partition
CSV against a real build instead of using the `partitions` subcommand).

`<env>` just needs to target the right **chip**, not match the WLED release
variant/flash-size you're actually generating files for - the bootloader
doesn't change between WLED's Plain/Audioreactive/Ethernet/etc. builds, and
its flash-size field gets rewritten by `gen_boot_images.py` anyway. Picking
any env for that chip from `platformio.ini` works; as of this writing these
are the ones matching the chips/sizes used in `bin/boot/`:

| Chip | Env in WLED's `platformio.ini` |
|---|---|
| ESP32 | `esp32dev` |
| ESP32-C3 | `esp32c3dev` |
| ESP32-S2 | `lolin_s2_mini` |
| ESP32-S3 (4MB qspi) | `esp32s3_4M_qspi` |
| ESP32-S3 (8MB opi) | `esp32s3dev_8MB_opi` |
| ESP32-S3 (16MB opi) | `esp32s3dev_16MB_opi` |
| ESP32-S3 (32MB) | `esp32S3_wroom2_32MB` |

Env names do move around between WLED releases - run `pio run -e nonexistent`
(it'll fail and list all valid envs) or check `platformio.ini` directly if
one of the above no longer exists. `pio` is PlatformIO Core's CLI
(`pip install platformio`, or use the one bundled with the PlatformIO IDE/VS
Code extension if you already have it installed for firmware work).

Like ESP32-S3, ESP32/ESP32-C3/ESP32-S2 now support 4MB/8MB/16MB in this
repo too - building any one flash size per chip is enough, since
`gen_boot_images.py` re-flags that single reference bootloader for the
other sizes rather than needing a separate build per size.

### Alternative: extracting a reference bootloader from an existing merged image

For ESP32 and ESP32-C3 specifically, there's a second way to get a
reference bootloader without a PlatformIO build at all: `bin/boot/`
already ships a real bootloader for these chips, flattened inside the
4MB merged images (see [bin/boot/README.md](../bin/boot/README.md)). You
can slice it back out and feed that to `bootloader`/`merge` instead:

```bash
python - <<'PYEOF'
from pathlib import Path
# ESP32 ROM loads the bootloader at 0x1000; ESP32-C3 loads it at 0x0.
# Both merged images have their partition table starting at 0x8000.
Path("slice_esp32.bin").write_bytes(Path("bin/boot/esp32_bootloader_v4.bin").read_bytes()[0x1000:0x8000])
Path("slice_c3.bin").write_bytes(Path("bin/boot/esp32-c3_bootloader_v2.bin").read_bytes()[0x0:0x8000])
PYEOF
```

This is exactly how `bootloader_esp32_8m.bin`/`_16m.bin` and
`bootloader_c3_8m.bin`/`_16m.bin` were produced - verified by re-flagging
the slice back to 4MB and comparing it byte-for-byte against the original
embedded bootloader before trusting it as a source for other sizes. The
slice includes some trailing `0xFF` padding (the gap up to where the
partition table used to start), which `esptool` carries through into its
output untouched - harmless when flashed, just a few KB larger than a
freshly-built `bootloader.bin` would be. Prefer a real PlatformIO build
when you have one handy; this is a fallback for when you don't.

## `partitions` - build a partition table from a CSV

```bash
python tools/gen_boot_images.py partitions tools/partition_tables/s3_8m.csv \
    -o bin/boot/partitions_s3_8m.bin
```

[`partition_tables/`](partition_tables/) holds one CSV per `partitions_*.bin`
in `bin/boot/`, reverse-engineered from those files and verified to
reproduce them byte-for-byte (the 8MB/16MB CSVs for ESP32/ESP32-C3/ESP32-S2
are plain copies of the ESP32-S3 8MB/16MB layout - the partition table
format doesn't depend on chip family, only flash size). Standard ESP-IDF
partition-table CSV format: `Name, Type, SubType, Offset, Size`. To change a
layout (e.g. resize `spiffs`), edit the CSV and re-run this command - don't
hand-edit the `.bin`.

To add a new flash-size/board layout: copy the closest existing CSV, adjust
offsets/sizes, run the command above, and wire the new file into
`CHIP_CONFIG` / `HUB75_LAYOUTS` in [../app.js](../app.js).

## `bootloader` - re-flag a bootloader for a different flash size

```bash
python tools/gen_boot_images.py bootloader esp32s3 <path-to-bootloader.bin> \
    --flash-size 4MB --offset 0x0 -o bin/boot/bootloader_s3_4m.bin
```

`<path-to-bootloader.bin>` is a bootloader produced by actually building
WLED (or any Arduino-ESP32 sketch) for the target chip - e.g.
`.pio/build/<env>/bootloader.bin` after a PlatformIO build, for whichever
flash size you have a board/env for. You do not need one build per flash
size: this command takes that single reference bootloader and rewrites its
flash-size header field for every other size, recomputing the checksum and
appended SHA-256 digest to match (this is exactly what `esptool.py
write_flash` does at flash time - here it's done ahead of time, since ESP
Web Tools flashes bootloader files as-is). Verified to reproduce
`bootloader_s3_4m.bin` and `bootloader_s3_16m.bin` byte-for-byte starting
from `bootloader_s3.bin` (the 8MB build). Same command for other chips,
just change `--chip`, `--offset`, and the source:

```bash
python tools/gen_boot_images.py bootloader esp32s2 bin/boot/bootloader_s2.bin \
    --flash-size 8MB --offset 0x1000 -o bin/boot/bootloader_s2_8m.bin
```

**`--offset` must be this chip's real bootloader flash offset** - `0x1000`
for ESP32/ESP32-S2, `0x0` for ESP32-S3/ESP32-C3 (and most other newer
chips) - not just "0x0 because that's where the output file's byte 0
goes." `esptool`'s `merge-bin` only patches the flash-size/checksum/hash
fields of the image it finds *at that chip's canonical bootloader offset*;
give it the wrong offset and it silently copies the input through
**unpatched, with no error or warning** - which is exactly the bug that
originally shipped `bootloader_esp32_8m.bin`/`_16m.bin` and
`bootloader_s2_8m.bin`/`_16m.bin` still internally flagged as 4MB, and
caused a boot loop on real 8MB ESP32 hardware (the ROM loads the still-4MB
bootloader fine, then the mismatch between what it thinks the flash size is
and the actual 8MB partition table crashes it before it can print anything).
Passing a nonzero `--offset` also makes `merge-bin` prepend that many
`0xFF` padding bytes to the output (since it assumes it's building a full
image starting at address 0) - this command strips that padding back off
afterwards so the file's byte 0 is still the real bootloader, ready to be
flashed starting at that offset as its own manifest part.

Valid `--flash-size` values: `1MB`, `2MB`, `4MB`, `8MB`, `16MB`, `32MB`.

## `merge` - build a single-file boot image (bootloader + partitions + otadata)

Used for ESP32 and ESP32-C3, which flash one merged part at offset `0x0`
instead of separate bootloader/partition-table parts (see
[bin/boot/README.md](../bin/boot/README.md#merged-boot-images-bootloader--partition-table--ota-data-in-one-file)):

```bash
python tools/gen_boot_images.py merge esp32 --flash-size 4MB \
    -o bin/boot/esp32_bootloader_v4.bin \
    0x1000:<path-to-bootloader.bin> \
    0x8000:bin/boot/partitions_c3_4m.bin \
    0xe000:bin/boot/boot_app0.bin
```

```bash
python tools/gen_boot_images.py merge esp32c3 --flash-size 4MB \
    -o bin/boot/esp32-c3_bootloader_v2.bin \
    0x0:<path-to-c3-bootloader.bin> \
    0x8000:bin/boot/partitions_c3_4m.bin \
    0xe000:bin/boot/boot_app0.bin
```

`<path-to-bootloader.bin>` / `<path-to-c3-bootloader.bin>` again come from an
actual PlatformIO/Arduino build for that chip - note the bootloader offset
differs (`0x1000` for classic ESP32, `0x0` for ESP32-C3, since that's where
each chip's ROM loader expects it). `boot_app0.bin` is the standard
Arduino-ESP32 OTA-select seed file and doesn't need regenerating - copy it
from an existing Arduino-ESP32 install
(`~/.arduino15/packages/esp32/hardware/esp32/<ver>/tools/partitions/boot_app0.bin`)
or a PlatformIO one (`~/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin`)
if you ever need a fresh copy.

`--flash-size` here plays the same role as in the `bootloader` subcommand:
`merge-bin` patches the bootloader segment's flash-size field to match
before flattening everything into one file.

## Why not just commit `.pio/build/<env>/{bootloader,partitions}.bin` directly?

You can, for the flash size you actually built - that's the natural source
of a reference bootloader for the `bootloader`/`merge` commands above, and
partition tables can equally be produced by an ESP-IDF/PlatformIO build
rather than by the `partitions` subcommand. This script exists mainly for
the flash-size fan-out (one real build covering the other declared flash
sizes without spinning up N boards/envs) and so the partition CSVs are
tracked as reviewable source rather than only as opaque binaries.
