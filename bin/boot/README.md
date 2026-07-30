# bin/boot/

A WLED release asset (e.g. `WLED_0.15.0_ESP32.bin`) is the **application only**
- it does not contain a 2nd-stage bootloader or a partition table, and flashing
it alone to a bare/erased chip will not boot. Real hardware also needs, at
minimum:

- a **2nd-stage bootloader** (ESP32 ROM loads this first; it in turn loads the
  application),
- a **partition table** (tells the bootloader where the app, NVS, SPIFFS, etc.
  live in flash),
- and usually **OTA select data** ("otadata" - tells the bootloader which of
  the two OTA app slots to boot).

Upstream WLED doesn't publish these separately per chip/flash-size as release
assets, so this repo ships its own copies here and [app.js](../../app.js)
flashes them alongside the firmware binary, at the correct offsets, as
additional parts of the same [ESP Web Tools](https://esphome.github.io/esp-web-tools/)
manifest. See `CHIP_CONFIG` / `HUB75_LAYOUTS` in app.js for exactly which
files are used for which chip/flash-size combination.

There are two different shapes of file in this folder - see below.

## Separate bootloader + partition-table files

Used for ESP32-S2 and ESP32-S3 at every flash size, and for classic ESP32 /
ESP32-C3 at 8MB/16MB (their 4MB size instead uses the merged image described
below). Flashed as two distinct manifest parts:

| File | Chip | Flash size | Offset | What it is |
|---|---|---|---|---|
| `bootloader_s2.bin` | ESP32-S2 | 4MB | `0x1000` | 2nd-stage bootloader |
| `partitions_s2_4m.bin` | ESP32-S2 | 4MB | `0x8000` | Partition table |
| `bootloader_s2_8m.bin` | ESP32-S2 | 8MB | `0x1000` | 2nd-stage bootloader, flagged for 8MB flash |
| `partitions_s2_8m.bin` | ESP32-S2 | 8MB | `0x8000` | Partition table |
| `bootloader_s2_16m.bin` | ESP32-S2 | 16MB | `0x1000` | 2nd-stage bootloader, flagged for 16MB flash |
| `partitions_s2_16m.bin` | ESP32-S2 | 16MB | `0x8000` | Partition table |
| `bootloader_s3_4m.bin` | ESP32-S3 | 4MB | `0x0` | 2nd-stage bootloader, flagged for 4MB flash |
| `partitions_s3_4m.bin` | ESP32-S3 | 4MB | `0x8000` | Partition table |
| `bootloader_s3.bin` | ESP32-S3 | 8MB | `0x0` | 2nd-stage bootloader, flagged for 8MB flash |
| `partitions_s3_8m.bin` | ESP32-S3 | 8MB | `0x8000` | Partition table |
| `bootloader_s3_16m.bin` | ESP32-S3 | 16MB | `0x0` | 2nd-stage bootloader, flagged for 16MB flash |
| `partitions_s3_16m.bin` | ESP32-S3 | 16MB | `0x8000` | Partition table |
| `bootloader_s3_32m.bin` | ESP32-S3 | 32MB | `0x0` | 2nd-stage bootloader, flagged for 32MB flash |
| `partitions_s3_32m.bin` | ESP32-S3 | 32MB | `0x8000` | Partition table |
| `partitions_s3_hdwf2.bin` | ESP32-S3 (Huidu HD-WF2) | 4MB | `0x8000` | Partition table (paired with `bootloader_s3.bin`, not `_s3_4m`) |
| `bootloader_esp32_8m.bin` | ESP32 | 8MB | `0x1000` | 2nd-stage bootloader, flagged for 8MB flash |
| `partitions_esp32_8m.bin` | ESP32 | 8MB | `0x8000` | Partition table |
| `bootloader_esp32_16m.bin` | ESP32 | 16MB | `0x1000` | 2nd-stage bootloader, flagged for 16MB flash |
| `partitions_esp32_16m.bin` | ESP32 | 16MB | `0x8000` | Partition table |
| `bootloader_c3_8m.bin` | ESP32-C3 | 8MB | `0x0` | 2nd-stage bootloader, flagged for 8MB flash |
| `partitions_c3_8m.bin` | ESP32-C3 | 8MB | `0x8000` | Partition table |
| `bootloader_c3_16m.bin` | ESP32-C3 | 16MB | `0x0` | 2nd-stage bootloader, flagged for 16MB flash |
| `partitions_c3_16m.bin` | ESP32-C3 | 16MB | `0x8000` | Partition table |

Note there's no `boot_app0.bin`-equivalent part flashed for any of these -
same reasoning as below: blank `otadata` falls back to booting `ota_0`.

**Why so many near-identical bootloader files per chip:** an ESP32-family
bootloader image header has the flash size baked into it (one nibble of one
byte). The chip's ROM reads that field to configure SPI flash before it can
even find the partition table, so a bootloader built/flagged for the wrong
flash size can fail to boot. `esptool.py write_flash` normally patches this
field for you at flash time to match whatever `--flash_size` you pass it -
but ESP Web Tools (which this site uses, since it flashes over Web Serial
from the browser) does **not** do that patching, it writes each manifest
part's bytes as-is. So instead of one bootloader that gets patched at flash
time, this repo ships one pre-patched-and-re-signed bootloader per flash
size per chip. Within a chip family, these files are byte-identical except
for that flash-size field and (on chips that have it) the SHA-256 digest
ESP-IDF appends over the image, which necessarily changes when the
flash-size field does. See [tools/](../../tools/) for the script that
produces these from a single reference bootloader.

`partitions_s3_hdwf2.bin` is paired with the plain 8MB-flagged
`bootloader_s3.bin` rather than a size-matched one - this looks wrong (the
board is physically 4MB) but it's what WLED's own upstream build config for
that board does, so it's replicated here rather than "corrected".

`bootloader_esp32_8m.bin`/`_16m.bin` and `bootloader_c3_8m.bin`/`_16m.bin`
are a few KB larger than their same-size ESP32-S2/S3 counterparts. They were
bootstrapped by extracting the bootloader region out of the existing merged
images below (see [tools/README.md](../../tools/README.md)) rather than from
a fresh PlatformIO build, which leaves some harmless trailing `0xFF`
padding in the file (flash that would be blank either way) instead of being
trimmed to the exact image length. Functionally identical either way; a
from-source build would just produce a smaller file.

## Merged boot images (bootloader + partition table + OTA data in one file)

Used for ESP32 and ESP32-C3 **at 4MB only** (their 8MB/16MB variants use the
separate-files form above instead). Flashed as a **single** manifest part at
offset `0x0`, immediately followed by the firmware at offset `0x10000`
(65536):

| File | Chip | Flash size | Offset | Contents |
|---|---|---|---|---|
| `esp32_bootloader_v4.bin` | ESP32 | 4MB | `0x0` | bootloader @ `0x1000` + partition table @ `0x8000` + otadata @ `0xe000`, flattened into one 64KB file |
| `esp32-c3_bootloader_v2.bin` | ESP32-C3 | 4MB | `0x0` | bootloader @ `0x0` + partition table @ `0x8000` + otadata @ `0xe000`, flattened into one 64KB file |

Everything between and around those pieces is `0xFF` (erased-flash) padding.
The partition table embedded in both files is the same 4MB layout as
`partitions_c3_4m.bin` / `partitions_s2_4m.bin` / `partitions_s3_4m.bin`
(`nvs`, `otadata`, `app0`, `app1`, `spiffs`). This merged form predates
8MB/16MB support for these two chips and is kept as-is at 4MB rather than
converted to match the separate-files form, to avoid touching a working,
already-shipped path.

## `boot_app0.bin`

The standard Arduino-ESP32 OTA-select seed file (8192 bytes) that gets
written to the `otadata` partition (offset `0xe000`, size `0x2000`) to tell
the bootloader "boot from OTA slot 0 (`app0`)". It's the same file
Arduino/PlatformIO writes at that offset for every ESP32 Arduino project, and
it's also exactly what's embedded at offset `0xe000` inside the two merged
images above.

It is **not currently referenced by app.js** for any of the separate-files
manifests (ESP32-S2, ESP32-S3, or the ESP32/ESP32-C3 8MB/16MB variants) -
only the two 4MB merged ESP32/ESP32-C3 images include it. This is not a bug:
when `otadata` is left blank/erased, the ESP-IDF bootloader falls back to
booting the first valid OTA slot (`ota_0`) by default, so writing it
explicitly is a nice-to-have (a deterministic OTA state from the first boot)
rather than a requirement. It's kept here in case a future manifest wants to
flash it more broadly.

## Regenerating these files

See [../../tools/](../../tools/) for a script that rebuilds every file in
this folder from source (partition-table CSVs plus a bootloader built for
one reference flash size), along with the reasoning and the exact commands.
