// app.js - WLED Web Installer
//
// Fetches available WLED releases from the GitHub Releases API, builds
// esp-web-tools manifests on the fly (as blob URLs) for every combination of
// version x variant x flash size, and wires up the page's controls.
//
// No build step, no server component - everything below runs directly in
// the browser so the page can be hosted as-is on GitHub Pages.

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------

  const GITHUB_RELEASES_URL = 'https://api.github.com/repos/wled/WLED/releases';
  const CORS_PROXY = 'https://proxy.corsfix.com/?';
  const CACHE_KEY = 'wled_webinstaller_releases_cache';
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  const MAX_STABLE_RELEASES = 8;
  const MAX_BETA_RELEASES = 2;

  // Base URL for locally-hosted bootloader / partition-table files. These
  // are chip-specific (and, for the ESP32-S3, flash-size specific) and are
  // shared across all WLED versions.
  const bootBase = new URL('bin/boot/', window.location.href).href;

  // ---------------------------------------------------------------------
  // Chip boot configuration
  // ---------------------------------------------------------------------
  // Describes the boot-stage parts (bootloader / partition table) that must
  // be flashed before the WLED firmware itself. The firmware part is always
  // appended last, at firmwareOffset.
  //
  // `flashSizes` is only present for chips whose bootParts can vary by flash
  // size - it drives the flash-size selector in the UI even though WLED
  // itself ships a single firmware asset for these chips (see resolveSuffix
  // / getFlashSizeAvailability, which fall back to a chip's declared
  // `flashSizes` when its VARIANTS entry is a plain string rather than a
  // per-size suffix map).

  const CHIP_CONFIG = {
    'ESP32': {
      chipFamily: 'ESP32',
      defaultFlashSize: '4MB',
      flashSizes: ['4MB', '8MB', '16MB'],
      // 4MB keeps using the original merged all-in-one boot image
      // (bootloader + partition table + otadata flattened into one file,
      // flashed at offset 0 - see bin/boot/README.md). 8MB/16MB use a
      // bootloader re-flagged for that size paired with a separate,
      // larger partition table instead, the same way ESP32-S3 already
      // does below.
      bootParts: (flashSizeId) => {
        const files = {
          '8MB': { bootloader: 'bootloader_esp32_8m.bin', partitions: 'partitions_esp32_8m.bin' },
          '16MB': { bootloader: 'bootloader_esp32_16m.bin', partitions: 'partitions_esp32_16m.bin' }
        };
        const f = files[flashSizeId];
        if (!f) return [{ path: bootBase + 'esp32_bootloader_v4.bin', offset: 0 }];
        return [
          { path: bootBase + f.bootloader, offset: 4096 },
          { path: bootBase + f.partitions, offset: 32768 }
        ];
      },
      firmwareOffset: 65536
    },
    'ESP32-C3': {
      chipFamily: 'ESP32-C3',
      defaultFlashSize: '4MB',
      flashSizes: ['4MB', '8MB', '16MB'],
      // Same split as ESP32 above: 4MB is the original merged image, 8MB/16MB
      // are a re-flagged bootloader + separate partition table.
      bootParts: (flashSizeId) => {
        const files = {
          '8MB': { bootloader: 'bootloader_c3_8m.bin', partitions: 'partitions_c3_8m.bin' },
          '16MB': { bootloader: 'bootloader_c3_16m.bin', partitions: 'partitions_c3_16m.bin' }
        };
        const f = files[flashSizeId];
        if (!f) return [{ path: bootBase + 'esp32-c3_bootloader_v2.bin', offset: 0 }];
        return [
          { path: bootBase + f.bootloader, offset: 0 },
          { path: bootBase + f.partitions, offset: 32768 }
        ];
      },
      firmwareOffset: 65536
    },
    'ESP32-S2': {
      chipFamily: 'ESP32-S2',
      defaultFlashSize: '4MB',
      flashSizes: ['4MB', '8MB', '16MB'],
      bootParts: (flashSizeId) => {
        const files = {
          '4MB': { bootloader: 'bootloader_s2.bin', partitions: 'partitions_s2_4m.bin' },
          '8MB': { bootloader: 'bootloader_s2_8m.bin', partitions: 'partitions_s2_8m.bin' },
          '16MB': { bootloader: 'bootloader_s2_16m.bin', partitions: 'partitions_s2_16m.bin' }
        };
        const f = files[flashSizeId] || files['4MB'];
        return [
          { path: bootBase + f.bootloader, offset: 4096 },
          { path: bootBase + f.partitions, offset: 32768 }
        ];
      },
      firmwareOffset: 65536
    },
    'ESP32-S3': {
      chipFamily: 'ESP32-S3',
      defaultFlashSize: '8MB',
      // esp-web-tools flashes bootloader images as-is (it never patches the
      // flash-size field the way `esptool.py write_flash` does), so we need
      // one pre-patched+re-signed bootloader per flash size rather than
      // reusing a single 8MB-labeled one for every board.
      bootParts: (flashSizeId) => {
        const files = {
          '4MB': { bootloader: 'bootloader_s3_4m.bin', partitions: 'partitions_s3_4m.bin' },
          '8MB': { bootloader: 'bootloader_s3.bin', partitions: 'partitions_s3_8m.bin' },
          '16MB': { bootloader: 'bootloader_s3_16m.bin', partitions: 'partitions_s3_16m.bin' }
        };
        const f = files[flashSizeId] || files['8MB'];
        return [
          { path: bootBase + f.bootloader, offset: 0 },
          { path: bootBase + f.partitions, offset: 32768 }
        ];
      },
      firmwareOffset: 65536
    },
    'ESP8266': {
      chipFamily: 'ESP8266',
      defaultFlashSize: '4MB',
      bootParts: () => [],
      firmwareOffset: 0
    }
  };

  // Flash sizes shown in the UI, in display order. Not every chip supports
  // every size - see VARIANTS below.
  const FLASH_SIZES = [
    { id: '1MB', label: '1MB' },
    { id: '2MB', label: '2MB' },
    { id: '4MB', label: '4MB' },
    { id: '8MB', label: '8MB' },
    { id: '16MB', label: '16MB' }
  ];
  const DEFAULT_FLASH_SIZE = '4MB';

  // ---------------------------------------------------------------------
  // HUB75 layouts
  // ---------------------------------------------------------------------
  // Each HUB75 build targets one specific board/pinout combination rather
  // than a chip family with a flash-size choice, so it doesn't fit the
  // VARIANTS model below - a layout fully determines chip, flash size and
  // boot parts all at once. flashSizeLabel is display-only.

  const HUB75_LAYOUTS = [
    {
      id: 'esp32_default',
      label: 'ESP32 (default pinout)',
      chip: 'ESP32',
      suffix: '_ESP32_HUB75.bin',
      flashSizeLabel: '4MB',
      bootParts: () => CHIP_CONFIG['ESP32'].bootParts('4MB'),
      firmwareOffset: CHIP_CONFIG['ESP32'].firmwareOffset
    },
    {
      id: 'esp32_forum',
      label: 'ESP32 (forum pinout)',
      chip: 'ESP32',
      suffix: '_ESP32_HUB75_forum_pinout.bin',
      flashSizeLabel: '4MB',
      bootParts: () => CHIP_CONFIG['ESP32'].bootParts('4MB'),
      firmwareOffset: CHIP_CONFIG['ESP32'].firmwareOffset
    },
    {
      id: 'hdwf2',
      label: 'Huidu HD-WF2',
      chip: 'ESP32-S3',
      suffix: '_ESP32-S3_HD-WF2.bin',
      // Physically a 4MB board; WLED's own build config for it (uncommonly)
      // inherits an 8MB-declared bootloader paired with a scaled-down 4MB
      // partition table, so we match that exact pairing here rather than
      // "correct" it - it's what upstream actually ships and tests.
      flashSizeLabel: '4MB',
      bootParts: () => [
        { path: bootBase + 'bootloader_s3.bin', offset: 0 },
        { path: bootBase + 'partitions_s3_hdwf2.bin', offset: 32768 }
      ],
      firmwareOffset: 65536
    },
    {
      id: 'matrixportal',
      label: 'Adafruit MatrixPortal S3',
      chip: 'ESP32-S3',
      suffix: '_ESP32-S3_Adafruit_Matrixportal.bin',
      flashSizeLabel: '8MB',
      bootParts: () => CHIP_CONFIG['ESP32-S3'].bootParts('8MB'),
      firmwareOffset: 65536
    },
    {
      id: 'moonhub',
      label: 'MOONHUB / LilyGO T7-S3',
      chip: 'ESP32-S3',
      suffix: '_ESP32-S3_16MB_opi_HUB75.bin',
      flashSizeLabel: '16MB',
      bootParts: () => CHIP_CONFIG['ESP32-S3'].bootParts('16MB'),
      firmwareOffset: 65536
    },
    {
      id: 'waveshare',
      label: 'Waveshare ESP32-S3-RGB-Matrix',
      chip: 'ESP32-S3',
      suffix: '_ESP32-S3_Waveshare_HUB75.bin',
      flashSizeLabel: '32MB',
      bootParts: () => [
        { path: bootBase + 'bootloader_s3_32m.bin', offset: 0 },
        { path: bootBase + 'partitions_s3_32m.bin', offset: 32768 }
      ],
      firmwareOffset: 65536
    }
  ];
  const DEFAULT_HUB75_LAYOUT = HUB75_LAYOUTS[0].id;

  // ---------------------------------------------------------------------
  // Variant definitions
  // ---------------------------------------------------------------------
  // Each variant maps chip families to the asset-name suffix used in GitHub
  // release assets. A chip entry is either:
  //   - a plain string:              one asset, flash size is irrelevant
  //   - a { flashSizeId: suffix }    map: the chip ships multiple binaries
  //                                   for different flash sizes
  //
  // Chips that have no entry for a given variant are simply left out of the
  // generated manifest for that variant (e.g. "audio" is ESP32-only).

  const VARIANTS = {
    normal: {
      'ESP32':    '_ESP32.bin',
      'ESP32-C3': '_ESP32-C3.bin',
      'ESP32-S2': '_ESP32-S2.bin',
      'ESP32-S3': { '4MB': '_ESP32-S3_4M_qspi.bin', '8MB': '_ESP32-S3_8MB_opi.bin', '16MB': '_ESP32-S3_16MB_opi.bin' },
      'ESP8266':  { '1MB': '_ESP01.bin', '2MB': '_ESP02.bin', '4MB': '_ESP8266.bin' }
    },
    ethernet: {
      'ESP32': '_ESP32_Ethernet.bin'
    },
    audio: {
      'ESP32': '_ESP32_audioreactive.bin'
    },
    test: {
      'ESP8266': { '1MB': '_ESP01_160.bin', '2MB': '_ESP02_160.bin', '4MB': '_ESP8266_160.bin' }
    },
    v4: {
      'ESP32': '_ESP32_V4.bin'
    },
    debug: {
      'ESP32': '_ESP32_DEBUG.bin'
    }
  };

  // Maps variant names to the DOM ids used for their radio inputs. "hub75"
  // is handled outside the VARIANTS table (see HUB75_LAYOUTS above) but its
  // radio button follows the same enable/disable convention as the rest.
  const VARIANT_IDS = ['normal', 'ethernet', 'audio', 'test', 'v4', 'debug', 'hub75'];

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  /** Return true when a chip entry has a flash-size selection axis. */
  function hasFlashAxis(entry) {
    return entry !== null && typeof entry === 'object';
  }

  /** Resolve the asset suffix for a chip, given the globally selected flash size. */
  function resolveSuffix(entry, chip, flashSizeId) {
    if (!hasFlashAxis(entry)) return entry;
    return entry[flashSizeId] || entry[CHIP_CONFIG[chip].defaultFlashSize];
  }

  /** Find a release asset whose name ends with `suffix` (ignore .gz files). */
  function findAsset(assets, suffix) {
    if (!suffix) return null;
    return assets.find(function (a) {
      return a.name.endsWith(suffix) && !a.name.endsWith('.gz');
    }) || null;
  }

  /** Extract the WLED version string from asset filenames (for nightly). */
  function extractVersionFromAssets(assets) {
    for (let i = 0; i < assets.length; i++) {
      const m = assets[i].name.match(/^WLED_(.+?)_(ESP\d|ESP8)/);
      if (m) return m[1];
    }
    return 'unknown';
  }

  /** Build the human-friendly release label shown in the version dropdown. */
  function getDisplayVersion(release) {
    if (release.tag_name === 'nightly') {
      return extractVersionFromAssets(release.assets) + ' Nightly';
    }
    return release.tag_name.replace(/^v/, '');
  }

  /** Build the version string stored in generated manifests. */
  function getManifestVersion(release, variantName) {
    let ver = release.tag_name === 'nightly'
      ? extractVersionFromAssets(release.assets)
      : release.tag_name.replace(/^v/, '');
    if (variantName !== 'normal') ver += ' ' + variantName;
    return ver;
  }

  /** Classify a release into release/beta/nightly buckets. */
  function categorize(release) {
    if (release.tag_name === 'nightly') return 'nightly';
    if (release.prerelease) return 'beta';
    return 'release';
  }

  // ---------------------------------------------------------------------
  // Manifest generation
  // ---------------------------------------------------------------------

  /**
   * Build an esp-web-tools manifest object for the given release + variant +
   * flash size. Returns null if no matching assets are found at all.
   */
  function generateManifest(release, variantName, flashSizeId) {
    const chipEntries = VARIANTS[variantName];
    const version = getManifestVersion(release, variantName);
    const builds = [];

    for (const chip in chipEntries) {
      const suffix = resolveSuffix(chipEntries[chip], chip, flashSizeId);
      const asset = findAsset(release.assets, suffix);
      if (!asset) continue;

      const config = CHIP_CONFIG[chip];
      const parts = config.bootParts(flashSizeId);
      parts.push({
        path: CORS_PROXY + asset.browser_download_url,
        offset: config.firmwareOffset
      });

      builds.push({ chipFamily: config.chipFamily, parts: parts });
    }

    if (builds.length === 0) return null;

    return {
      name: 'WLED',
      version: version,
      home_assistant_domain: 'wled',
      new_install_prompt_erase: true,
      builds: builds
    };
  }

  /**
   * Build a manifest for a single HUB75 layout (one specific board). Unlike
   * generateManifest(), this always produces at most one build entry, since
   * a layout already fully determines the chip.
   */
  function generateHub75Manifest(release, layoutId) {
    const layout = HUB75_LAYOUTS.find(function (l) { return l.id === layoutId; });
    if (!layout) return null;

    const asset = findAsset(release.assets, layout.suffix);
    if (!asset) return null;

    const parts = layout.bootParts();
    parts.push({
      path: CORS_PROXY + asset.browser_download_url,
      offset: layout.firmwareOffset
    });

    return {
      name: 'WLED',
      version: getManifestVersion(release, 'hub75'),
      home_assistant_domain: 'wled',
      new_install_prompt_erase: true,
      builds: [{ chipFamily: layout.chip, parts: parts }]
    };
  }

  /** Convert a manifest object into a blob URL consumable by esp-web-tools. */
  function createManifestUrl(manifest) {
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    return URL.createObjectURL(blob);
  }

  /**
   * For a given release + variant, figure out which chips are actually
   * available at each flash size (i.e. a matching release asset exists).
   * A chip's VARIANTS entry is either a per-size suffix map (the chip ships
   * multiple firmware binaries, e.g. ESP32-S3) or a single fixed suffix (one
   * binary covers every flash size, e.g. ESP32) - in the latter case the
   * available sizes come from CHIP_CONFIG[chip].flashSizes instead, since
   * the same firmware asset is paired with different boot files depending
   * on the chosen size. The row itself is only shown when at least one chip
   * in this variant has a real choice to make.
   */
  function getFlashSizeAvailability(release, variantName) {
    const chipEntries = VARIANTS[variantName];

    function fixedSizes(chip) {
      return (CHIP_CONFIG[chip] && CHIP_CONFIG[chip].flashSizes) || [];
    }

    const axisChips = Object.keys(chipEntries).filter(function (chip) {
      return hasFlashAxis(chipEntries[chip]) || fixedSizes(chip).length > 1;
    });

    const chipsBySize = {};
    FLASH_SIZES.forEach(function (fs) { chipsBySize[fs.id] = []; });

    Object.keys(chipEntries).forEach(function (chip) {
      const entry = chipEntries[chip];
      if (hasFlashAxis(entry)) {
        Object.keys(entry).forEach(function (sizeId) {
          if (findAsset(release.assets, entry[sizeId])) chipsBySize[sizeId].push(chip);
        });
      } else if (findAsset(release.assets, entry)) {
        fixedSizes(chip).forEach(function (sizeId) { chipsBySize[sizeId].push(chip); });
      }
    });

    return { hasAxis: axisChips.length > 0, chipsBySize: chipsBySize };
  }

  // ---------------------------------------------------------------------
  // Dropdown population
  // ---------------------------------------------------------------------

  /**
   * Create a single <option> element for a release. All variant x flash-size
   * manifests are pre-generated as blob URLs and stashed in a JSON blob on
   * the option's dataset so the UI code can look them up synchronously.
   */
  function createOption(release) {
    const opt = document.createElement('option');
    opt.textContent = getDisplayVersion(release);

    const manifests = {}; // variant -> flashSizeId -> manifest URL ('' for a size that falls back)
    const availability = {}; // variant -> { hasAxis, availability }
    let hasPlain = false;

    for (const variantName in VARIANTS) {
      manifests[variantName] = {};
      FLASH_SIZES.forEach(function (fs) {
        const manifest = generateManifest(release, variantName, fs.id);
        if (manifest) manifests[variantName][fs.id] = createManifestUrl(manifest);
      });
      availability[variantName] = getFlashSizeAvailability(release, variantName);
      if (Object.keys(manifests[variantName]).length > 0) {
        if (variantName === 'normal') hasPlain = true;
      } else {
        delete manifests[variantName];
      }
    }

    manifests.hub75 = {};
    const hub75Availability = {};
    HUB75_LAYOUTS.forEach(function (layout) {
      const manifest = generateHub75Manifest(release, layout.id);
      hub75Availability[layout.id] = !!manifest;
      if (manifest) manifests.hub75[layout.id] = createManifestUrl(manifest);
    });
    if (Object.keys(manifests.hub75).length === 0) delete manifests.hub75;

    if (!hasPlain) return null;

    opt._manifests = manifests;
    opt._flashAvailability = availability;
    opt._hub75Availability = hub75Availability;
    opt._release = release;
    return opt;
  }

  /** Populate the release dropdown with grouped options and generated manifests. */
  function populateDropdown(releases) {
    const sel = document.getElementById('ver');

    const groups = { release: [], beta: [], nightly: [] };
    releases.forEach(function (r) {
      if (r.draft || !r.assets || r.assets.length === 0) return;
      groups[categorize(r)].push(r);
    });

    if (groups.release.length > MAX_STABLE_RELEASES) {
      groups.release = groups.release.slice(0, MAX_STABLE_RELEASES);
    }
    if (groups.beta.length > MAX_BETA_RELEASES) {
      groups.beta = groups.beta.slice(0, MAX_BETA_RELEASES);
    }

    const fragment = document.createDocumentFragment();
    const labels = { release: 'Release', beta: 'Beta', nightly: 'Nightly' };

    ['release', 'beta', 'nightly'].forEach(function (key) {
      if (groups[key].length === 0) return;
      const grp = document.createElement('optgroup');
      grp.label = labels[key];
      groups[key].forEach(function (r) {
        const opt = createOption(r);
        if (opt) grp.appendChild(opt);
      });
      if (grp.children.length > 0) fragment.appendChild(grp);
    });

    if (fragment.children.length === 0) {
      showLoadError();
      return;
    }

    sel.innerHTML = '';
    sel.appendChild(fragment);
  }

  // ---------------------------------------------------------------------
  // Caching (sessionStorage, 5-minute TTL)
  // ---------------------------------------------------------------------

  /** Read cached GitHub release metadata if it is still within TTL. */
  function getCachedReleases() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (Date.now() - data.timestamp < CACHE_TTL) return data.releases;
    } catch (e) { /* ignore */ }
    return null;
  }

  /** Persist GitHub release metadata in sessionStorage with a timestamp. */
  function cacheReleases(releases) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), releases: releases }));
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------
  // UI wiring
  // ---------------------------------------------------------------------

  /** Get the currently selected release <option> element. */
  function currentOption() {
    const sel = document.getElementById('ver');
    return sel.options[sel.selectedIndex];
  }

  /** Get the selected firmware variant id from the variant radio group. */
  function selectedVariant() {
    const checked = document.querySelector('input[name="version"]:checked');
    return checked ? checked.value : 'normal';
  }

  /** Get the selected flash-size id from the flash-size radio group. */
  function selectedFlashSize() {
    const checked = document.querySelector('input[name="flashsize"]:checked');
    return checked ? checked.value : DEFAULT_FLASH_SIZE;
  }

  /** Get the selected HUB75 layout id from the layout radio group. */
  function selectedLayout() {
    const checked = document.querySelector('input[name="layout"]:checked');
    return checked ? checked.value : DEFAULT_HUB75_LAYOUT;
  }

  /** Enable/disable + show/hide the variant radio buttons for the current release. */
  function updateVariantAvailability(opt) {
    VARIANT_IDS.forEach(function (id) {
      const input = document.getElementById(id);
      const label = document.getElementById(id + '_label');
      const available = !!(opt._manifests && opt._manifests[id]);
      input.disabled = !available;
      label.classList.toggle('disabled__label', !available);
      label.classList.toggle('radio__label', available);
    });
  }

  /**
   * Enable/disable + show/hide the flash-size radio buttons, and hide the
   * whole row if irrelevant. The buttons themselves only ever show the
   * size (e.g. "8MB") - which chips that size applies to is rendered in
   * the small chart below instead, so the buttons stay a fixed, compact
   * width regardless of how many chips share a size.
   */
  function updateFlashSizeAvailability(opt, variantName) {
    const row = document.getElementById('flashSizeRow');
    const info = opt._flashAvailability ? opt._flashAvailability[variantName] : null;

    if (!info || !info.hasAxis) {
      row.hidden = true;
      return;
    }
    row.hidden = false;

    FLASH_SIZES.forEach(function (fs) {
      const input = document.getElementById('fs_' + fs.id);
      const label = document.getElementById('fs_' + fs.id + '_label');
      const chartRow = document.getElementById('fsChart_' + fs.id);
      const chartChips = document.getElementById('fsChart_' + fs.id + '_chips');
      const chips = info.chipsBySize[fs.id];
      const available = chips.length > 0;
      input.disabled = !available;
      label.classList.toggle('disabled__label', !available);
      label.classList.toggle('radio__label', available);
      label.textContent = fs.label;
      chartRow.hidden = !available;
      chartChips.textContent = chips.join(', ');
    });

    // If the currently checked size is no longer available, fall back to the
    // default, or to whichever size is available if even that is missing.
    const checkedInput = document.getElementById('fs_' + selectedFlashSize());
    if (checkedInput.disabled) {
      const fallback = document.getElementById('fs_' + DEFAULT_FLASH_SIZE);
      const target = fallback.disabled ? document.querySelector('#flashSizeRow input:not(:disabled)') : fallback;
      if (target) target.checked = true;
    }
  }

  /**
   * Enable/disable the HUB75 layout radio buttons and hide/show the whole
   * row if irrelevant. Buttons only show the board name - the chip + flash
   * size each one needs is rendered in the chart below instead, same
   * treatment as the flash-size buttons above.
   */
  function updateLayoutAvailability(opt) {
    const info = opt._hub75Availability || {};

    HUB75_LAYOUTS.forEach(function (layout) {
      const input = document.getElementById('layout_' + layout.id);
      const label = document.getElementById('layout_' + layout.id + '_label');
      const chartRow = document.getElementById('layoutChart_' + layout.id);
      const available = !!info[layout.id];
      input.disabled = !available;
      label.classList.toggle('disabled__label', !available);
      label.classList.toggle('radio__label', available);
      label.textContent = layout.label;
      chartRow.hidden = !available;
    });

    const checkedInput = document.getElementById('layout_' + selectedLayout());
    if (checkedInput.disabled) {
      const fallback = document.querySelector('#layoutRow input:not(:disabled)');
      if (fallback) fallback.checked = true;
    }
  }

  /** Show/update whichever secondary row (flash size, or HUB75 layout) applies to the current variant. */
  function updateSecondaryRow(opt, variantName) {
    const flashRow = document.getElementById('flashSizeRow');
    const layoutRow = document.getElementById('layoutRow');

    if (variantName === 'hub75') {
      flashRow.hidden = true;
      updateLayoutAvailability(opt);
      layoutRow.hidden = false;
    } else {
      layoutRow.hidden = true;
      updateFlashSizeAvailability(opt, variantName);
    }
  }

  /** Apply current release/variant/size selections and set install manifest URL. */
  function setManifest() {
    const opt = currentOption();
    if (!opt || !opt._manifests) return;

    updateVariantAvailability(opt);
    let variantName = selectedVariant();
    if (!opt._manifests[variantName]) {
      resetVariant();
      variantName = 'normal';
    }
    updateSecondaryRow(opt, variantName);

    let manifestUrl;
    if (variantName === 'hub75') {
      const layoutId = selectedLayout();
      manifestUrl = opt._manifests.hub75[layoutId]
        || opt._manifests.hub75[Object.keys(opt._manifests.hub75)[0]];
    } else {
      const flashSizeId = selectedFlashSize();
      manifestUrl = opt._manifests[variantName][flashSizeId]
        || opt._manifests[variantName][Object.keys(opt._manifests[variantName])[0]];
    }

    document.getElementById('inst').setAttribute('manifest', manifestUrl);
    document.getElementById('verstr').textContent = opt.text;
  }

  /** Reset variant selection to the default "normal" option. */
  function resetVariant() {
    document.getElementById('normal').checked = true;
  }

  /** Switch to the unsupported-browser panel when install is unavailable. */
  function checkSupported() {
    if (document.getElementById('inst').hasAttribute('install-unsupported')) unsupported();
  }

  /** Show unsupported-browser message and hide flasher UI. */
  function unsupported() {
    document.getElementById('flasher').hidden = true;
    document.getElementById('unsupported').hidden = false;
  }

  /** Reveal troubleshooting instructions for serial/WebSerial issues. */
  function showSerialHelp() {
    document.getElementById('showSerialHelp').hidden = true;
    document.getElementById('serialHelp').hidden = false;
  }

  /** Show a release-loading failure panel. */
  function showLoadError() {
    document.getElementById('flasher').hidden = true;
    document.getElementById('loadError').hidden = false;
  }

  /** Show a CORS-proxy blocked panel when firmware bytes cannot be fetched. */
  function showProxyBlocked() {
    document.getElementById('flasher').hidden = true;
    document.getElementById('proxyBlocked').hidden = false;
  }

  /** Recompute selected manifest after release changes. */
  function applySelection() {
    resetVariant();
    setManifest();
  }

  // ---------------------------------------------------------------------
  // CORS proxy health check
  // ---------------------------------------------------------------------
  // GitHub release assets have no CORS headers, so every firmware download
  // goes through CORS_PROXY. That proxy only serves domains that have been
  // registered with it - an unregistered domain gets back a small JSON
  // error instead of the firmware, which esp-web-tools would otherwise
  // happily flash as-is. Check once per page load, on a real asset URL, and
  // refuse to enable Install until we know real firmware bytes come back.

  let proxyHealthChecked = false;

  /** Pick a real firmware asset URL for verifying CORS proxy behavior. */
  function getHealthCheckUrl(release) {
    const chipEntries = VARIANTS.normal;
    for (const chip in chipEntries) {
      const suffix = resolveSuffix(chipEntries[chip], chip, DEFAULT_FLASH_SIZE);
      const asset = findAsset(release.assets, suffix);
      if (asset) return CORS_PROXY + asset.browser_download_url;
    }
    return null;
  }

  /** Validate that the CORS proxy returns actual firmware bytes. */
  function checkProxyHealth(release) {
    if (proxyHealthChecked) return;
    proxyHealthChecked = true;

    const url = getHealthCheckUrl(release);
    if (!url) {
      showProxyBlocked();
      return;
    }

    fetch(url, { headers: { 'Range': 'bytes=0-1024' } })
      .then(function (res) {
        if (!res.ok && res.status !== 206) throw new Error('CORS proxy responded with ' + res.status);
        return res.arrayBuffer().then(function (buf) {
          if (buf.byteLength === 0) throw new Error('CORS proxy returned empty response');
          const view = new Uint8Array(buf);
          if (view[0] !== 0xE9) throw new Error('CORS proxy returned invalid firmware data (no ESP image magic byte)');
          document.getElementById('installBtn').disabled = false;
          document.getElementById('proxyChecking').hidden = true;
        });
      })
      .catch(function (err) {
        console.warn('CORS proxy health check failed - firmware downloads are likely blocked for this domain.', err);
        showProxyBlocked();
      });
  }

  /** Run the one-time proxy check against the currently selected release. */
  function runInitialProxyCheck() {
    const opt = currentOption();
    if (opt && opt._release) checkProxyHealth(opt._release);
  }

  /** Load releases from cache/API, build UI options, and apply default selection. */
  function loadReleases() {
    const cached = getCachedReleases();
    if (cached) {
      populateDropdown(cached);
      applySelection();
      runInitialProxyCheck();
      return;
    }

    fetch(GITHUB_RELEASES_URL + '?per_page=30')
      .then(function (res) {
        if (!res.ok) throw new Error('GitHub API responded with ' + res.status);
        return res.json();
      })
      .then(function (releases) {
        cacheReleases(releases);
        populateDropdown(releases);
        applySelection();
        runInitialProxyCheck();
      })
      .catch(function (err) {
        console.warn('Failed to load WLED releases from the GitHub API.', err);
        showLoadError();
      });
  }

  // ---------------------------------------------------------------------
  // Build info (footer)
  // ---------------------------------------------------------------------
  // Shows when this copy of index.html/app.js was last built, so you can
  // tell a stale cached/deployed copy from a fresh one at a glance. Reads
  // build-info.json, a small file regenerated from git state by
  // tools/update_build_info.py (see tools/README.md) - not present until
  // that's been run at least once, so this fails silently (footer just
  // stays hidden) rather than showing an error on a fresh checkout.

  /** Fetch build-info.json (if present) and render it in the footer. */
  function loadBuildInfo() {
    fetch('build-info.json')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (info) {
        const date = new Date(info.builtAt);
        const formatted = isNaN(date) ? info.builtAt : date.toLocaleString();
        document.getElementById('buildInfoValue').textContent =
          formatted + ' (' + info.commit + (info.dirty ? '+' : '') + ')';
        document.getElementById('buildInfo').hidden = false;
      })
      .catch(function () { /* build-info.json not generated yet - stay hidden */ });
  }

  // ---------------------------------------------------------------------
  // Wire up DOM events once the document is ready
  // ---------------------------------------------------------------------

  /** Initialize page state and wire all UI event listeners. */
  function init() {
    checkSupported();
    if (typeof i18nInit === 'function') i18nInit();
    loadBuildInfo();

    document.getElementById('ver').addEventListener('change', applySelection);
    document.getElementById('versionGroup').addEventListener('change', setManifest);
    document.getElementById('flashSizeRow').addEventListener('change', setManifest);
    document.getElementById('layoutRow').addEventListener('change', setManifest);
    document.getElementById('showSerialHelp').addEventListener('click', showSerialHelp);

    loadReleases();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
