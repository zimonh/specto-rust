import init, {
  initThreadPool,
  load_audio_mp3,
  load_audio_bytes,
  load_audio_pcm_mono_f32,
  get_spectrogram_info,
  render_spectrogram_viewport,
  unload_spectrogram,
  update_spectrogram_params,
  set_fifths_hue_offset,
  set_desaturation_amount,
  set_multiband_config,
  get_multiband_config,
} from './pkg/specto.js';

import { MultiBandManager } from './multiband.js';
import { TileCache } from './tileCache.js';

const canvas = document.getElementById('spectrogramCanvas');
const ctx = canvas.getContext('2d');
const overlayCanvas = document.getElementById('overlayCanvas');
const overlayCtx = overlayCanvas.getContext('2d');
const playbackCanvas = document.getElementById('playbackCanvas');
const playbackCtx = playbackCanvas.getContext('2d');
const tooltip = document.getElementById('tooltip');
const tooltipTime = document.getElementById('tooltipTime');
const tooltipFreq = document.getElementById('tooltipFreq');
const tooltipAmp = document.getElementById('tooltipAmp');
const tooltipNote = document.getElementById('tooltipNote');

let cssWidth = 1000;
let cssHeight = 800;
let width = canvas.width;
let height = canvas.height;

// Update the canvas's internal resolution.
function updateCanvasResolution() {
  width = canvas.width;
  height = canvas.height;
  overlayCanvas.width = canvas.width;
  overlayCanvas.height = canvas.height;
  playbackCanvas.width = canvas.width;
  playbackCanvas.height = canvas.height;
}

// Monitor container resize and update canvas resolution
const scrollContainer = document.getElementById('scrollContainer');
const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const containerWidth = entry.contentRect.width;
    const containerHeight = entry.contentRect.height;

    // Update canvas resolution to match container size
    canvas.width = Math.floor(containerWidth);
    canvas.height = Math.floor(containerHeight);
    overlayCanvas.width = canvas.width;
    overlayCanvas.height = canvas.height;
    playbackCanvas.width = canvas.width;
    playbackCanvas.height = canvas.height;

    cssWidth = containerWidth;
    cssHeight = containerHeight;
    width = canvas.width;
    height = canvas.height;

    // Pause tiling while resizing; render non-tiling until user stops
    tilesPaused = true;
    resizeActive = true;
    invalidateTileCache();
    if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
    resizeDebounceTimer = setTimeout(() => {
      resizeActive = false;
      tilesPaused = false;
      if (!tileRAF) tileRAF = requestAnimationFrame(processTileQueue);
      renderSpectrogram();
    }, RESIZE_DEBOUNCE_MS);

    // Re-render spectrogram if loaded
    if (spectrogramId !== null) {
      renderSpectrogram();
    }
  }
});

resizeObserver.observe(scrollContainer);

// Floating controls toggling
const controlsPanel = document.getElementById('controls');
const settingsToggleBtn = document.getElementById('settingsToggle');
const closeControlsBtn = document.getElementById('settingsCollapse');
const controlsBackdrop = document.getElementById('controlsBackdrop');
function openControls() {
  controlsPanel.classList.add('open');
  if (controlsBackdrop) controlsBackdrop.classList.add('open');
  if (settingsToggleBtn) settingsToggleBtn.style.display = 'none';
  document.body.classList.add('controls-open');
  try {
    localStorage.setItem('controlsOpen', '1');
  } catch {}
}
function closeControls() {
  controlsPanel.classList.remove('open');
  if (controlsBackdrop) controlsBackdrop.classList.remove('open');
  if (settingsToggleBtn) settingsToggleBtn.style.display = 'block';
  document.body.classList.remove('controls-open');
  try {
    localStorage.setItem('controlsOpen', '0');
  } catch {}
}
if (settingsToggleBtn)
  settingsToggleBtn.addEventListener('click', () => {
    if (controlsPanel.classList.contains('open')) closeControls();
    else openControls();
  });
if (closeControlsBtn) closeControlsBtn.addEventListener('click', closeControls);
if (controlsBackdrop) controlsBackdrop.addEventListener('click', closeControls);
// Restore state on load
try {
  if (localStorage.getItem('controlsOpen') === '1') openControls();
} catch {}

// Remember time zoom value across reloads
try {
  const savedZoom = parseFloat(localStorage.getItem('timeZoom') || 'NaN');
  const z = document.getElementById('timeZoom');
  const zv = document.getElementById('timeZoomValue');
  if (!Number.isNaN(savedZoom)) {
    timeZoom = Math.max(0.01, Math.min(16, savedZoom));
  }
  if (z) z.value = String(zoomToSlider(timeZoom));
  if (zv) zv.textContent = `${timeZoom.toFixed(2)}x`;
} catch {}

// Draw time and frequency markers
// Canvas is now: X-axis = frequency (left to right), Y-axis = time (top to bottom)
function drawMarkers() {
  if (!spectrogramInfo) return;
  if (!showGrid) {
    overlayCtx.clearRect(0, 0, width, height);
    return;
  }

  // Standard orientation: width=time, height=frequency
  const canvasWidth = width; // pixels
  const canvasHeight = height; // frequency bins

  overlayCtx.clearRect(0, 0, canvasWidth, canvasHeight);

  const [duration, sampleRate, numWindows] = spectrogramInfo;

  overlayCtx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  overlayCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  overlayCtx.font = '12px monospace';
  overlayCtx.lineWidth = 1;

  // Draw time markers (X-axis - horizontal, bottom)
  const visibleWindows = width / Math.max(0.01, timeZoom);
  const startTime = (scrollOffset * hopSizeParam) / sampleRate;
  const endTime = ((scrollOffset + visibleWindows) * hopSizeParam) / sampleRate;
  const timeRange = endTime - startTime;
  const timeStep = Math.max(
    0.5,
    Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, timeRange / 5))))
  );

  const firstTimeMark = Math.ceil(startTime / timeStep) * timeStep;
  for (let t = firstTimeMark; t <= endTime; t += timeStep) {
    const x = ((t - startTime) / Math.max(1e-9, timeRange)) * canvasWidth;
    if (x >= 0 && x <= canvasWidth) {
      // Draw tick mark at bottom
      overlayCtx.beginPath();
      overlayCtx.moveTo(x, canvasHeight - 20);
      overlayCtx.lineTo(x, canvasHeight);
      overlayCtx.stroke();

      // Draw grid line
      overlayCtx.beginPath();
      overlayCtx.moveTo(x, 0);
      overlayCtx.lineTo(x, canvasHeight - 20);
      overlayCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      overlayCtx.stroke();
      overlayCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';

      // Draw time label with dark shadow for readability
      const timeLabel = t.toFixed(2) + 's';
      overlayCtx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      overlayCtx.shadowBlur = 4;
      overlayCtx.shadowOffsetX = 1;
      overlayCtx.shadowOffsetY = 1;
      overlayCtx.fillText(timeLabel, x + 3, canvasHeight - 5);
      overlayCtx.shadowColor = 'transparent';
      overlayCtx.shadowBlur = 0;
      overlayCtx.shadowOffsetX = 0;
      overlayCtx.shadowOffsetY = 0;
    }
  }

  // Draw frequency markers (Y-axis - vertical, left side)
  let freqMarkers = [];

  if (scaleModeParam === 1) {
    // Logarithmic frequency markers (1-2-5 per decade)
    const logMin = Math.log10(Math.max(1, minFreqParam));
    const logMax = Math.log10(Math.max(1, maxFreqParam));
    for (let exp = Math.floor(logMin); exp <= Math.ceil(logMax); exp++) {
      const base = Math.pow(10, exp);
      for (let mult of [1, 2, 5]) {
        const freq = base * mult;
        if (freq >= Math.max(1, minFreqParam) && freq <= maxFreqParam) {
          freqMarkers.push(freq);
        }
      }
    }
  } else if (scaleModeParam === 0) {
    // Linear frequency markers
    const freqRange = maxFreqParam - minFreqParam;
    const freqStep = Math.max(
      100,
      Math.pow(10, Math.floor(Math.log10(freqRange / 5)))
    );
    const firstFreqMark = Math.ceil(minFreqParam / freqStep) * freqStep;
    for (let f = firstFreqMark; f <= maxFreqParam; f += freqStep) {
      freqMarkers.push(f);
    }
  } else {
    // Psychoacoustic scales: place markers at equal ratios
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const ratio = i / steps;
      const f = mapRatioToFreq(
        ratio,
        minFreqParam,
        maxFreqParam,
        scaleModeParam
      );
      freqMarkers.push(f);
    }
  }

  // Draw all frequency markers
  for (let f of freqMarkers) {
    // Calculate Y position based on scale type
    const nyquist = Math.max(
      1,
      Math.min(spectrogramInfo ? spectrogramInfo[1] / 2 : 22050, maxFreqParam)
    );
    const minClamped = Math.max(0, Math.min(minFreqParam, nyquist));
    const maxClamped = Math.max(0, Math.min(maxFreqParam, nyquist));
    const ratio = mapFreqToRatio(f, minClamped, maxClamped, scaleModeParam);
    const y = canvasHeight - ratio * canvasHeight;

    if (y >= 0 && y <= canvasHeight) {
      // Draw tick mark on left
      overlayCtx.beginPath();
      overlayCtx.moveTo(0, y);
      overlayCtx.lineTo(20, y);
      overlayCtx.stroke();

      // Draw grid line
      overlayCtx.beginPath();
      overlayCtx.moveTo(20, y);
      overlayCtx.lineTo(canvasWidth, y);
      overlayCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      overlayCtx.stroke();
      overlayCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';

      // Draw frequency label with dark shadow for readability
      const freqLabel =
        f >= 1000 ? (f / 1000).toFixed(1) + 'kHz' : f.toFixed(0) + 'Hz';
      overlayCtx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      overlayCtx.shadowBlur = 4;
      overlayCtx.shadowOffsetX = 1;
      overlayCtx.shadowOffsetY = 1;
      overlayCtx.fillText(freqLabel, 25, y + 4);
      overlayCtx.shadowColor = 'transparent';
      overlayCtx.shadowBlur = 0;
      overlayCtx.shadowOffsetX = 0;
      overlayCtx.shadowOffsetY = 0;
    }
  }
}

// Mapping helpers matching Rust
function mapRatioToFreq(ratio, fmin, fmax, scaleMode) {
  switch (scaleMode) {
    case 1: {
      const lo = Math.log(Math.max(1, fmin));
      const hi = Math.log(Math.max(1, fmax));
      return Math.exp(lo + ratio * (hi - lo));
    }
    case 2: {
      // Mel
      const mmin = 2595.0 * Math.log10(1.0 + Math.max(0, fmin) / 700.0);
      const mmax = 2595.0 * Math.log10(1.0 + fmax / 700.0);
      const m = mmin + ratio * (mmax - mmin);
      return 700.0 * (10 ** (m / 2595.0) - 1.0);
    }
    case 3: {
      // Bark (Traunmüller approx inverse via Zwicker-like)
      const bmin =
        13.0 * Math.atan(0.00076 * Math.max(0, fmin)) +
        3.5 * Math.atan((Math.max(0, fmin) / 7500.0) ** 2);
      const bmax =
        13.0 * Math.atan(0.00076 * fmax) +
        3.5 * Math.atan((fmax / 7500.0) ** 2);
      const b = bmin + ratio * (bmax - bmin);
      const zc = Math.max(0.001, Math.min(26.279, b + 0.53));
      return (1960.0 * zc) / (26.81 - zc);
    }
    case 4: {
      // ERB-rate
      const emin = 21.4 * Math.log10(1.0 + 0.00437 * Math.max(0, fmin));
      const emax = 21.4 * Math.log10(1.0 + 0.00437 * fmax);
      const e = emin + ratio * (emax - emin);
      return (10 ** (e / 21.4) - 1.0) / 0.00437;
    }
    case 5: {
      // Period
      const pmin = 1.0 / Math.max(1.0, fmax);
      const pmax = 1.0 / Math.max(1.0, fmin);
      const p = pmin + ratio * (pmax - pmin);
      return 1.0 / p;
    }
    default: // Linear
      return fmin + ratio * (fmax - fmin);
  }
}

function mapFreqToRatio(freq, fmin, fmax, scaleMode) {
  switch (scaleMode) {
    case 1: {
      const lo = Math.log(Math.max(1, fmin));
      const hi = Math.log(Math.max(1, fmax));
      return (Math.log(Math.max(1, freq)) - lo) / (hi - lo);
    }
    case 2: {
      // Mel
      const mel = 2595.0 * Math.log10(1.0 + freq / 700.0);
      const mmin = 2595.0 * Math.log10(1.0 + Math.max(0, fmin) / 700.0);
      const mmax = 2595.0 * Math.log10(1.0 + fmax / 700.0);
      return (mel - mmin) / (mmax - mmin);
    }
    case 3: {
      // Bark (Traunmüller)
      const bark =
        13.0 * Math.atan(0.00076 * freq) +
        3.5 * Math.atan((freq / 7500.0) ** 2);
      const bmin =
        13.0 * Math.atan(0.00076 * Math.max(0, fmin)) +
        3.5 * Math.atan((Math.max(0, fmin) / 7500.0) ** 2);
      const bmax =
        13.0 * Math.atan(0.00076 * fmax) +
        3.5 * Math.atan((fmax / 7500.0) ** 2);
      return (bark - bmin) / (bmax - bmin);
    }
    case 4: {
      // ERB-rate
      const erb = 21.4 * Math.log10(1.0 + 0.00437 * freq);
      const emin = 21.4 * Math.log10(1.0 + 0.00437 * Math.max(0, fmin));
      const emax = 21.4 * Math.log10(1.0 + 0.00437 * fmax);
      return (erb - emin) / (emax - emin);
    }
    case 5: {
      // Period
      const p = 1.0 / Math.max(1.0, freq);
      const pmin = 1.0 / Math.max(1.0, fmax);
      const pmax = 1.0 / Math.max(1.0, fmin);
      return (p - pmin) / (pmax - pmin);
    }
    default: // Linear
      return (freq - fmin) / (fmax - fmin);
  }
}

// ============================================================
// SPECTROGRAM MODE
// ============================================================

let spectrogramId = null;
let spectrogramInfo = null;
let scrollOffset = 0;
let audioFileData = null;

// Audio playback
let audioContext = null;
let audioBuffer = null;
let audioSource = null;
let isPlaying = false;
let playbackStartTime = 0;
let playbackPauseTime = 0;
let animationFrameId = null;
let followPlayback = false;

// Smooth scrolling
let targetScrollOffset = 0;
let currentScrollOffset = 0;
let scrollAnimationFrame = null;
let cachedPixels = null;
let cachedScrollOffset = -1;

// Spectrogram parameters
let fftSizeParam = 2048;
let hopSizeParam = 512;
let minFreqParam = 50;
let maxFreqParam = 12850;
// Display params — actual startup values come from DEFAULT_SETTINGS applied in run()
let gainDbParam = -20.5;
let rangeDbParam = 64;
let freqGainDbPerDecParam = 0.0;
let bassSharpParam = 0.0;
let spectoColorSchemeParam = 4;
let scaleModeParam = 1;
let windowTypeParam = 0;
let zeroPadFactorParam = 1;

// Multi-band FFT parameters (now managed by MultiBandManager)
let multiBandManager = null;

// Get spectrogram controls
const audioFileInput = document.getElementById('audioFile');
const reloadAudioBtn = document.getElementById('reloadAudio');
const playPauseBtn = document.getElementById('playPause');
const fftSizeSlider = document.getElementById('fftSize');
const hopSizeSlider = document.getElementById('hopSize');
const minFreqSlider = document.getElementById('minFreq');
const maxFreqSlider = document.getElementById('maxFreq');
const gainDbSlider = document.getElementById('gainDb');
const rangeDbSlider = document.getElementById('rangeDb');
const freqGainDbPerDecSlider = document.getElementById('freqGainDbPerDec');
const bassSharpSlider = document.getElementById('bassSharp');
const bassSharpValue = document.getElementById('bassSharpValue');
const spectoColorSchemeSelect = document.getElementById('spectoColorScheme');
const fifthsHueOffsetWrap = document.getElementById('fifthsHueOffsetWrap');
const fifthsHueOffsetSlider = document.getElementById('fifthsHueOffset');
const fifthsHueOffsetValue = document.getElementById('fifthsHueOffsetValue');
const desaturationAmountSlider = document.getElementById('desaturationAmount');
const desaturationAmountValue = document.getElementById(
  'desaturationAmountValue'
);
const scaleModeSelect = document.getElementById('scaleMode');
const windowTypeSelect = document.getElementById('windowType');
const zeroPadFactorSlider = document.getElementById('zeroPadFactor');
const followPlaybackCheckbox = document.getElementById('followPlayback');

// Multi-band controls (handled by MultiBandManager)
// Initialization happens in run() function

// ------------------------------------------------------------
// Tile cache to avoid re-rendering from WASM when panning
// ------------------------------------------------------------
const TILE_WIDTH = 256;
let timeZoom = 1.0; // pixels per time window
const MAX_TILES = 256; // LRU cap
const tileCache = new TileCache(MAX_TILES, TILE_WIDTH); // Resizable tile manager
let currentViewportCenterTile = 0;
let tilesPaused = false; // pause enqueue/process while zoom-dragging
let tileRAF = null; // requestAnimationFrame id for the tile loop
let placeholderTileCanvas = null; // reused transparent placeholder
let interactionBurstUntil = 0; // ms timestamp for eager updates
let wheelZoomDebounceTimer = null;
const WHEEL_ZOOM_DEBOUNCE_MS = 180;
// Window resize debounce; while active we render non-tiling
let resizeActive = false;
let resizeDebounceTimer = null;
const RESIZE_DEBOUNCE_MS = 200;

function markInteraction() {
  interactionBurstUntil = performance.now() + 180; // ~180ms eager window
}

// Non-tiling live render mode during zoom drags
let zoomDragActive = false;

function paramsKey() {
  return [
    spectrogramId,
    fftSizeParam,
    hopSizeParam,
    minFreqParam,
    maxFreqParam,
    scaleModeParam,
    gainDbParam,
    rangeDbParam,
    freqGainDbPerDecParam,
    windowTypeParam,
    zeroPadFactorParam,
    spectoColorSchemeParam,
    `bass=${bassSharpParam.toFixed(2)}`,
    height,
    `zoom=${timeZoom.toFixed(2)}`,
  ].join('|');
}

function invalidateTileCache() {
  // Smooth invalidate: move current tiles to ghost cache for fade-out effect
  // This lets old tiles fade out while new ones render to avoid flicker
  cachedPixels = null;
  const ghostCount = tileCache.invalidate();
  console.log(
    '[tile] Cache invalidated, keeping',
    ghostCount,
    'ghost tiles for fade-out'
  );
}

function getPlaceholderTile() {
  if (!placeholderTileCanvas || placeholderTileCanvas.height !== height) {
    placeholderTileCanvas = document.createElement('canvas');
    placeholderTileCanvas.width = TILE_WIDTH;
    placeholderTileCanvas.height = height;
    const pctx = placeholderTileCanvas.getContext('2d');
    pctx.clearRect(0, 0, TILE_WIDTH, height);
  }
  return placeholderTileCanvas;
}

function enqueueTile(tileIndex) {
  if (tilesPaused || zoomDragActive) return; // don't enqueue during paused resize
  const paramHash = paramsKey();
  const key = tileCache.generateKey(paramHash, tileIndex);
  const enqueued = tileCache.enqueue(tileIndex, key);
  if (enqueued && !tileRAF) {
    tileRAF = requestAnimationFrame(processTileQueue);
  }
}

function generateTile(tileIndex, key) {
  try {
    const windowsPerTile = Math.max(
      1,
      Math.floor(TILE_WIDTH / Math.max(0.01, timeZoom))
    );
    const windowStart = Math.max(
      0,
      Math.floor((tileIndex * TILE_WIDTH) / Math.max(0.01, timeZoom))
    );
    const pixels = render_spectrogram_viewport(
      spectrogramId,
      windowStart,
      windowsPerTile,
      height,
      minFreqParam,
      maxFreqParam,
      scaleModeParam,
      gainDbParam,
      rangeDbParam,
      freqGainDbPerDecParam,
      windowTypeParam,
      zeroPadFactorParam,
      spectoColorSchemeParam,
      bassSharpParam
    );

    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = TILE_WIDTH;
    tileCanvas.height = height;
    const tctx = tileCanvas.getContext('2d');
    const srcWidth = Math.max(
      1,
      Math.floor(TILE_WIDTH / Math.max(0.01, timeZoom))
    );
    const imageData = new ImageData(
      new Uint8ClampedArray(pixels),
      srcWidth,
      height
    );
    tctx.imageSmoothingEnabled = false;
    const tmp = document.createElement('canvas');
    tmp.width = srcWidth;
    tmp.height = height;
    const tmpctx = tmp.getContext('2d');
    tmpctx.putImageData(imageData, 0, 0);
    tctx.drawImage(tmp, 0, 0, srcWidth, height, 0, 0, TILE_WIDTH, height);

    tileCache.set(key, tileCanvas, paramsKey());
  } catch (err) {
    console.warn('[tiles] generation failed for', key, err);
  }
}

function processTileQueue() {
  if (tilesPaused || zoomDragActive) {
    tileRAF = null;
    return;
  }
  tileRAF = null;
  // If user is actively interacting, raise the budget for faster perceived response
  const now = performance.now();
  const budgetMs = now < interactionBurstUntil ? 14 : 8;
  const start = performance.now();
  while (tileCache.hasPending() && performance.now() - start < budgetMs) {
    const item = tileCache.dequeue();
    if (item) {
      const { tileIndex, key } = item;
      generateTile(tileIndex, key);
    }
  }
  // Clean up ghost tiles that have finished fading
  tileCache.cleanupGhosts(now);
  // If there are more tiles, schedule next frame
  if (tileCache.hasPending()) tileRAF = requestAnimationFrame(processTileQueue);
  // Trigger a repaint so new tiles swap in
  if (spectrogramId !== null) renderSpectrogram();
}

function getOrCreateTileCanvas(tileIndex) {
  // This is now only used for prefetching during renderSpectrogram
  const paramHash = paramsKey();
  const key = tileCache.generateKey(paramHash, tileIndex);
  const existing = tileCache.get(key);
  if (existing) {
    return existing;
  }
  enqueueTile(tileIndex);
  // Prefetch: return placeholder, actual render logic handles ghosts
  return getPlaceholderTile();
}

// Update spectrogram parameter displays
const timeZoomSlider = document.getElementById('timeZoom');
const showGridCheckbox = document.getElementById('showGrid');
const exportPngBtn = document.getElementById('exportPng');
const fftPow2Checkbox = document.getElementById('fftPow2');
// Mouse anchor tracking for zoom
let lastMouseCanvasX = null;
let isMouseOverCanvas = false;
function sliderToZoom(v) {
  // Map slider [0..1] to zoom [0.01..16] logarithmically
  const minZ = 0.01,
    maxZ = 16;
  const t = Math.min(1, Math.max(0, v));
  const logMin = Math.log(minZ),
    logMax = Math.log(maxZ);
  return Math.exp(logMin + t * (logMax - logMin));
}
function zoomToSlider(z) {
  const minZ = 0.01,
    maxZ = 16;
  const clamped = Math.min(maxZ, Math.max(minZ, z));
  const logMin = Math.log(minZ),
    logMax = Math.log(maxZ);
  return (Math.log(clamped) - logMin) / (logMax - logMin);
}
if (timeZoomSlider) {
  let lastZoomRAF = null;
  let pendingZoom = null;
  function anchorAwareAdjustScroll(oldZ, newZ) {
    if (!spectrogramId || !spectrogramInfo) return;
    const [duration, sampleRate, numWindows] = spectrogramInfo;
    const anchorRatio = 0.1; // 10% from left
    const visibleOld = width / Math.max(0.01, oldZ);
    const visibleNew = width / Math.max(0.01, newZ);
    let anchorWindow;
    if (isPlaying) {
      const currentTime = getCurrentPlaybackTime();
      anchorWindow = (currentTime * sampleRate) / hopSizeParam;
      scrollOffset = anchorWindow - anchorRatio * visibleNew;
    } else if (isMouseOverCanvas && lastMouseCanvasX != null) {
      anchorWindow = scrollOffset + lastMouseCanvasX / Math.max(0.01, oldZ);
      scrollOffset = anchorWindow - lastMouseCanvasX / Math.max(0.01, newZ);
    } else {
      anchorWindow = scrollOffset + anchorRatio * visibleOld;
      scrollOffset = anchorWindow - anchorRatio * visibleNew;
    }
    const maxScroll = Math.max(0, numWindows - Math.floor(visibleNew));
    scrollOffset = Math.max(0, Math.min(maxScroll, scrollOffset));
    currentScrollOffset = scrollOffset;
    targetScrollOffset = scrollOffset;
  }

  const applyZoom = (z, oldZ) => {
    timeZoom = z;
    const v = document.getElementById('timeZoomValue');
    if (v) v.textContent = `${timeZoom.toFixed(2)}x`;
    try {
      localStorage.setItem('timeZoom', String(timeZoom));
    } catch {}
    anchorAwareAdjustScroll(oldZ, timeZoom);
    invalidateTileCache();
    if (spectrogramId !== null) renderSpectrogram();
  };
  const onZoomChange = () => {
    markInteraction();
    const newZ = sliderToZoom(parseFloat(timeZoomSlider.value));
    const oldZ = timeZoom;
    applyZoom(newZ, oldZ);
  };
  timeZoomSlider.addEventListener('pointerdown', () => {
    zoomDragActive = true;
    tilesPaused = true;
  });
  timeZoomSlider.addEventListener('input', onZoomChange);
  timeZoomSlider.addEventListener('pointerup', () => {
    zoomDragActive = false;
    tilesPaused = false;
    if (!tileRAF) tileRAF = requestAnimationFrame(processTileQueue);
    renderSpectrogram();
  });
  timeZoomSlider.addEventListener('change', onZoomChange);
}

// 50% zoom checkbox
const zoom50Checkbox = document.getElementById('zoom50');
if (zoom50Checkbox) {
  const ZOOM_50 = 0.5;
  const ZOOM_DEFAULT = 1.0;
  zoom50Checkbox.addEventListener('change', () => {
    const oldZ = timeZoom;
    const newZ = zoom50Checkbox.checked ? ZOOM_50 : ZOOM_DEFAULT;
    timeZoom = newZ;
    if (timeZoomSlider) timeZoomSlider.value = String(zoomToSlider(newZ));
    const v = document.getElementById('timeZoomValue');
    if (v) v.textContent = `${newZ.toFixed(2)}x`;
    try { localStorage.setItem('timeZoom', String(newZ)); } catch {}
    invalidateTileCache();
    if (spectrogramId !== null) renderSpectrogram();
  });
}


// Show/hide grid & labels
let showGrid = true;
if (showGridCheckbox) {
  try {
    const saved = localStorage.getItem('showGrid');
    if (saved != null) showGrid = saved === '1';
  } catch {}
  showGridCheckbox.checked = showGrid;
  showGridCheckbox.addEventListener('change', () => {
    showGrid = showGridCheckbox.checked;
    try {
      localStorage.setItem('showGrid', showGrid ? '1' : '0');
    } catch {}
    drawMarkers();
  });
}

// Spectrum playhead: glowing line colored by pitch (circle of fifths)
let spectrumPlayhead = false;
const spectrumPlayheadCheckbox = document.getElementById('spectrumPlayhead');
if (spectrumPlayheadCheckbox) {
  try {
    const saved = localStorage.getItem('spectrumPlayhead');
    if (saved != null) spectrumPlayhead = saved === '1';
  } catch {}
  spectrumPlayheadCheckbox.checked = spectrumPlayhead;
  spectrumPlayheadCheckbox.addEventListener('change', () => {
    spectrumPlayhead = spectrumPlayheadCheckbox.checked;
    try {
      localStorage.setItem('spectrumPlayhead', spectrumPlayhead ? '1' : '0');
    } catch {}
  });
}

// Export full spectrogram as PNG. Splits into multiple PNGs when exceeding canvas limits.
async function exportFullPng() {
  if (!spectrogramId || !spectrogramInfo) return;
  const [duration, sampleRate, numWindows] = spectrogramInfo;
  const totalWidth = Math.max(1, Math.floor(numWindows));

  // Conservative canvas limits (Chrome/Firefox typical). Also respect total pixel area.
  const MAX_DIM = 16384; // max canvas dimension
  const MAX_AREA = 268435456; // ~16k * 16k pixels
  const safeSegWidth = Math.max(
    1,
    Math.min(MAX_DIM, Math.floor(MAX_AREA / Math.max(1, height)))
  );

  const segments = Math.ceil(totalWidth / safeSegWidth);
  const CHUNK = 2048; // render in viewport-size chunks per segment

  for (let s = 0; s < segments; s++) {
    const segStart = s * safeSegWidth;
    const segWidth = Math.min(safeSegWidth, totalWidth - segStart);

    const out = document.createElement('canvas');
    out.width = segWidth;
    out.height = height;
    const octx = out.getContext('2d');

    for (let local = 0; local < segWidth; local += CHUNK) {
      const win = Math.min(CHUNK, segWidth - local);
      const start = segStart + local;
      const pixels = render_spectrogram_viewport(
        spectrogramId,
        start,
        win,
        height,
        minFreqParam,
        maxFreqParam,
        scaleModeParam,
        gainDbParam,
        rangeDbParam,
        freqGainDbPerDecParam,
        windowTypeParam,
        zeroPadFactorParam,
        spectoColorSchemeParam,
        bassSharpParam
      );
      const img = new ImageData(new Uint8ClampedArray(pixels), win, height);
      const tmp = document.createElement('canvas');
      tmp.width = win;
      tmp.height = height;
      tmp.getContext('2d').putImageData(img, 0, 0);
      octx.drawImage(tmp, local, 0);
    }

    const url = out.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download =
      segments > 1 ? `spectrogram_${s + 1}of${segments}.png` : 'spectrogram.png';
    a.click();
  }
}
if (exportPngBtn) exportPngBtn.addEventListener('click', exportFullPng);

// Optional power-of-two snapping for FFT size
function updateHopSliderMax() {
  if (!multiBandManager) return;
  const maxFftMult = multiBandManager.getMaxFftMultiplier();
  const maxHop = maxFftMult * hopSizeParam;
  if (hopSizeSlider) hopSizeSlider.max = String(maxHop);
}

function nearestPow2(n) {
  const x = Math.max(1, Math.floor(n));
  const p = Math.round(Math.log2(x));
  return Math.max(1, 1 << p);
}

if (hopSizeSlider) hopSizeSlider.addEventListener('input', () => {
  markInteraction();
  document.getElementById('hopSizeValue').textContent = hopSizeSlider.value;
  const oldHopSize = hopSizeParam;
  hopSizeParam = parseInt(hopSizeSlider.value);

  // Adjust scroll position to maintain current time position
  if (spectrogramId !== null && oldHopSize !== hopSizeParam) {
    try {
      update_spectrogram_params(spectrogramId, fftSizeParam, hopSizeParam);
      spectrogramInfo = get_spectrogram_info(spectrogramId);
    } catch (e) {
      console.warn(
        '[spectrogram] update_spectrogram_params failed; falling back to math only',
        e
      );
    }
    const [_, sampleRate] = spectrogramInfo; // eslint-disable-line no-unused-vars
    const currentTime = (scrollOffset * oldHopSize) / sampleRate;
    const newScrollOffset = (currentTime * sampleRate) / hopSizeParam;
    scrollOffset = Math.floor(newScrollOffset);
    currentScrollOffset = scrollOffset;
    targetScrollOffset = scrollOffset;

    // Treat hop-size change as a display zoom change: keep the same seconds visible
    // visible_secs = (width / timeZoom) * hop / sampleRate =>
    // timeZoom' = timeZoom * hop_new / hop_old
    const ratio = hopSizeParam / oldHopSize;
    const label = document.getElementById('timeZoomValue');
    // Keep visible seconds constant: timeZoom' = timeZoom * hop_new / hop_old
    timeZoom = Math.min(16, Math.max(0.01, timeZoom * ratio));
    // Update the slider (0..1 domain) using log mapping
    const z = document.getElementById('timeZoom');
    if (z) z.value = String(zoomToSlider(timeZoom));
    if (label) label.textContent = `${timeZoom.toFixed(2)}x`;
  }
  if (multiBandManager) {
    multiBandManager.setHopSize(hopSizeParam);
    multiBandManager.bands.forEach((b) =>
      multiBandManager.updateFftSizeDisplay(b)
    );
    updateHopSliderMax();
    if (spectrogramId !== null) multiBandManager.triggerChange();
  }
  invalidateTileCache();
  if (spectrogramId !== null) renderSpectrogram();
});

minFreqSlider.addEventListener('input', () => {
  markInteraction();
  document.getElementById('minFreqValue').textContent = minFreqSlider.value;
  minFreqParam = parseFloat(minFreqSlider.value);
  invalidateTileCache();
  if (spectrogramId !== null) renderSpectrogram();
});

maxFreqSlider.addEventListener('input', () => {
  markInteraction();
  document.getElementById('maxFreqValue').textContent = maxFreqSlider.value;
  maxFreqParam = parseFloat(maxFreqSlider.value);
  invalidateTileCache();
  if (spectrogramId !== null) renderSpectrogram();
});

gainDbSlider.addEventListener('input', () => {
  markInteraction();
  document.getElementById('gainDbValue').textContent = parseFloat(
    gainDbSlider.value
  ).toFixed(1);
  gainDbParam = parseFloat(gainDbSlider.value);
  invalidateTileCache();
  if (spectrogramId !== null) renderSpectrogram();
});

rangeDbSlider.addEventListener('input', () => {
  markInteraction();
  document.getElementById('rangeDbValue').textContent = parseFloat(
    rangeDbSlider.value
  ).toFixed(0);
  rangeDbParam = parseFloat(rangeDbSlider.value);
  invalidateTileCache();
  if (spectrogramId !== null) renderSpectrogram();
});

freqGainDbPerDecSlider.addEventListener('input', () => {
  markInteraction();
  document.getElementById('freqGainDbPerDecValue').textContent = parseFloat(
    freqGainDbPerDecSlider.value
  ).toFixed(1);
  freqGainDbPerDecParam = parseFloat(freqGainDbPerDecSlider.value);
  invalidateTileCache();
  if (spectrogramId !== null) renderSpectrogram();
});

if (bassSharpSlider) {
  bassSharpSlider.addEventListener('input', () => {
    markInteraction();
    const pct = parseInt(bassSharpSlider.value);
    if (bassSharpValue) bassSharpValue.textContent = `${pct}%`;
    bassSharpParam = Math.max(0, Math.min(1, pct / 100));
    invalidateTileCache();
    if (spectrogramId !== null) renderSpectrogram();
  });
}

if (spectoColorSchemeSelect) spectoColorSchemeSelect.addEventListener('change', () => {
  spectoColorSchemeParam = parseInt(spectoColorSchemeSelect.value);
  // Show/Hide hue offset control only for circle-of-fifths scheme (4)
  if (fifthsHueOffsetWrap)
    fifthsHueOffsetWrap.classList.toggle('hidden', spectoColorSchemeParam !== 4);
  // Apply current hue offset to WASM renderer if active
  if (
    spectrogramId !== null &&
    spectoColorSchemeParam === 4 &&
    fifthsHueOffsetSlider
  ) {
    try {
      set_fifths_hue_offset(
        spectrogramId,
        parseFloat(fifthsHueOffsetSlider.value)
      );
    } catch {}
  }
  invalidateTileCache();
  if (spectrogramId !== null) renderSpectrogram();
});

// Persist + propagate hue offset to WASM via color_value (degrees)
if (fifthsHueOffsetSlider) {
  try {
    const saved = parseInt(localStorage.getItem('fifthsHueOffset') || '0');
    if (!Number.isNaN(saved)) fifthsHueOffsetSlider.value = String(saved);
    if (fifthsHueOffsetValue)
      fifthsHueOffsetValue.textContent = `${saved}\u00B0`;
  } catch {}
  fifthsHueOffsetSlider.addEventListener('input', () => {
    const deg = parseInt(fifthsHueOffsetSlider.value);
    if (fifthsHueOffsetValue) fifthsHueOffsetValue.textContent = `${deg}\u00B0`;
    try {
      localStorage.setItem('fifthsHueOffset', String(deg));
    } catch {}
    // Send live to WASM if circle-of-fifths is active
    if (spectrogramId !== null && spectoColorSchemeParam === 4) {
      try {
        set_fifths_hue_offset(spectrogramId, deg);
      } catch {}
    }
    invalidateTileCache();
    if (spectrogramId !== null) renderSpectrogram();
  });
}

// Desaturation amount slider
if (desaturationAmountSlider) {
  try {
    const saved = parseFloat(
      localStorage.getItem('desaturationAmount') || '0.6'
    );
    if (!Number.isNaN(saved)) desaturationAmountSlider.value = String(saved);
    if (desaturationAmountValue)
      desaturationAmountValue.textContent = saved.toFixed(2);
  } catch {}
  desaturationAmountSlider.addEventListener('input', () => {
    const amount = parseFloat(desaturationAmountSlider.value);
    if (desaturationAmountValue)
      desaturationAmountValue.textContent = amount.toFixed(2);
    try {
      localStorage.setItem('desaturationAmount', String(amount));
    } catch {}
    if (spectrogramId !== null) {
      try {
        set_desaturation_amount(spectrogramId, amount);
      } catch {}
    }
    invalidateTileCache();
    if (spectrogramId !== null) renderSpectrogram();
  });
}

scaleModeSelect.addEventListener('change', () => {
  scaleModeParam = parseInt(scaleModeSelect.value);
  invalidateTileCache();
  if (spectrogramId !== null) renderSpectrogram();
});

windowTypeSelect.addEventListener('change', () => {
  windowTypeParam = parseInt(windowTypeSelect.value);
  invalidateTileCache();
  if (spectrogramId !== null) renderSpectrogram();
});

zeroPadFactorSlider.addEventListener('input', () => {
  zeroPadFactorParam = parseInt(zeroPadFactorSlider.value);
  document.getElementById('zeroPadFactorValue').textContent =
    `${zeroPadFactorParam}x`;
  invalidateTileCache();
  if (spectrogramId !== null) renderSpectrogram();
});

followPlaybackCheckbox.addEventListener('change', () => {
  followPlayback = followPlaybackCheckbox.checked;
});

// Multi-band FFT controls are now handled by MultiBandManager
// Initialization happens in run() function

// Store current file name and mime for format detection
let currentFileName = null;
let currentMimeType = null;
function detectExtension(name) {
  if (!name) return '';
  const dot = name.lastIndexOf('.');
  if (dot < 0) return '';
  return name.slice(dot + 1).toLowerCase();
}
function mimeToExt(mime) {
  switch ((mime || '').toLowerCase()) {
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/wav':
    case 'audio/x-wav':
    case 'audio/wave':
      return 'wav';
    case 'audio/aiff':
    case 'audio/x-aiff':
    case 'audio/aifc':
    case 'audio/x-aifc':
      return 'aiff';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/vorbis':
      return 'oga';
    case 'audio/flac':
      return 'flac';
    case 'audio/mp4':
    case 'audio/aac':
    case 'audio/x-m4a':
      return 'm4a';
    default:
      return '';
  }
}

// Load audio file
audioFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    console.log('[spectrogram] Loading audio file:', file.name);
    currentFileName = file.name;
    currentMimeType = file.type || null;
    const arrayBuffer = await file.arrayBuffer();
    audioFileData = new Uint8Array(arrayBuffer);
    await loadAudioData();
  } catch (err) {
    console.error('[spectrogram] Error loading audio:', err);
    alert('Failed to load audio: ' + err);
  }
});

// Reload audio with new FFT/hop settings
reloadAudioBtn.addEventListener('click', async () => {
  if (audioFileData) {
    // Save current position and zoom before reload
    const savedScrollOffset = scrollOffset;
    const savedTimeZoom = timeZoom;
    const savedScrollRatio = spectrogramInfo
      ? scrollOffset / Math.max(1, spectrogramInfo[2])
      : 0;

    await loadAudioData();

    // Restore position after reload
    if (spectrogramInfo) {
      // Use ratio to maintain relative position
      const newOffset = Math.floor(savedScrollRatio * spectrogramInfo[2]);
      scrollOffset = Math.max(0, Math.min(newOffset, spectrogramInfo[2] - 1));
      currentScrollOffset = scrollOffset;
      targetScrollOffset = scrollOffset;

      // Restore zoom
      timeZoom = savedTimeZoom;
      const z = document.getElementById('timeZoom');
      const zv = document.getElementById('timeZoomValue');
      if (z) z.value = String(zoomToSlider(timeZoom));
      if (zv) zv.textContent = `${timeZoom.toFixed(2)}x`;

      // Update display
      renderSpectrogram();
    }
  }
});

function readStr(view, offset, len) {
  let s = '';
  for (let i = 0; i < len; i++)
    s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

function readBE80Extended(view, offset) {
  // Decode 80-bit IEEE extended (AIFF) to Number (approx)
  const exp = view.getUint16(offset, false);
  const sign = (exp & 0x8000) !== 0;
  const e = exp & 0x7fff;
  let hi = view.getUint32(offset + 2, false); // top 32 bits of mantissa
  let lo = view.getUint32(offset + 6, false); // next 32 bits
  // Assemble 64-bit mantissa: integer bit + 63-bit fraction
  const mantHi = BigInt(hi);
  const mantLo = BigInt(lo);
  let mant = (mantHi << 32n) | mantLo; // 64 bits
  // Convert to double: mant / 2^63
  const two63 = 9223372036854775808n; // 2^63
  const mantD = Number(mant) / Number(two63);
  if (e === 0 && mant === 0n) return 0;
  const value = (sign ? -1 : 1) * Math.pow(2, e - 16383) * mantD;
  return value;
}

function ulawByteToF32(u8) {
  let u = ~u8 & 0xff;
  const sign = u & 0x80;
  let exponent = (u >> 4) & 0x07;
  let mantissa = u & 0x0f;
  let sample = ((mantissa << 4) + 0x08) << (exponent + 3);
  sample -= 132; // bias
  if (sign) sample = -sample;
  return Math.max(-32768, Math.min(32767, sample)) / 32768.0;
}

function alawByteToF32(a8) {
  let a = a8 ^ 0x55;
  let sign = a & 0x80;
  let exponent = (a >> 4) & 0x07;
  let mantissa = a & 0x0f;
  let sample;
  if (exponent > 0) {
    sample = ((mantissa << 4) + 0x108) << (exponent - 1);
  } else {
    sample = (mantissa << 4) + 8;
  }
  if (sign) sample = -sample;
  return Math.max(-32768, Math.min(32767, sample)) / 32768.0;
}

function parseAiffToMonoF32(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (readStr(view, 0, 4) !== 'FORM') throw new Error('Not AIFF/AIFC');
  const formType = readStr(view, 8, 4);
  if (formType !== 'AIFF' && formType !== 'AIFC')
    throw new Error('Unsupported FORM ' + formType);
  let offset = 12;
  let numChannels = 0;
  let numSampleFrames = 0;
  let sampleSize = 0;
  let sampleRate = 0;
  let compType = 'NONE';
  let ssndOffset = -1;
  let ssndSize = -1;
  let ssndDataStart = -1;

  while (offset + 8 <= view.byteLength) {
    const id = readStr(view, offset, 4);
    const size = view.getUint32(offset + 4, false);
    const chunkStart = offset + 8;
    if (id === 'COMM') {
      numChannels = view.getUint16(chunkStart, false);
      numSampleFrames = view.getUint32(chunkStart + 2, false);
      sampleSize = view.getUint16(chunkStart + 6, false);
      sampleRate = readBE80Extended(view, chunkStart + 8);
      if (formType === 'AIFC') {
        compType = readStr(view, chunkStart + 18, 4);
      }
    } else if (id === 'SSND') {
      const offsetBytes = view.getUint32(chunkStart, false);
      /* const blockSize = */ view.getUint32(chunkStart + 4, false);
      ssndOffset = offsetBytes;
      ssndSize = size - 8; // exclude offset+blockSize fields
      ssndDataStart = chunkStart + 8 + offsetBytes;
    }
    offset = chunkStart + ((size + 1) & ~1); // even-padding
  }

  if (
    numChannels < 1 ||
    numSampleFrames < 1 ||
    !sampleRate ||
    ssndDataStart < 0
  ) {
    throw new Error('AIFF missing required chunks');
  }

  if (compType !== 'NONE' && compType !== 'sowt') {
    throw new Error('AIFC compression ' + compType + ' not supported');
  }

  // Determine encoded bytes per sample depending on compression
  const isPCM = compType === 'NONE' || compType === 'sowt';
  const isULaw = compType.toLowerCase() === 'ulaw';
  const isALaw = compType.toLowerCase() === 'alaw';

  let bytesPerSamplePCM = Math.ceil(sampleSize / 8);
  if (isPCM) {
    if (
      bytesPerSamplePCM !== 1 &&
      bytesPerSamplePCM !== 2 &&
      bytesPerSamplePCM !== 3
    ) {
      throw new Error('Unsupported PCM depth ' + sampleSize);
    }
  }

  const encBytesPerSample = isPCM
    ? bytesPerSamplePCM
    : isULaw || isALaw
      ? 1
      : 0;
  if (encBytesPerSample === 0) {
    throw new Error('AIFC compression ' + compType + ' not supported');
  }

  const frameBytes = encBytesPerSample * numChannels;
  const dataBytes = numSampleFrames * frameBytes;
  if (ssndDataStart + dataBytes > view.byteLength) {
    throw new Error('AIFF data truncated');
  }

  const mono = new Float32Array(numSampleFrames);
  let p = ssndDataStart;
  const little = compType === 'sowt';

  // Downmix by averaging channels per frame
  for (let f = 0; f < numSampleFrames; f++) {
    let acc = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      const base = p + ch * encBytesPerSample;
      let s = 0;
      if (isPCM) {
        if (bytesPerSamplePCM === 1) {
          s = (view.getUint8(base) - 128) / 128; // 8-bit unsigned PCM
        } else if (bytesPerSamplePCM === 2) {
          s = little
            ? view.getInt16(base, true) / 32768
            : view.getInt16(base, false) / 32768;
        } else {
          // 24-bit signed PCM
          const b0 = view.getUint8(base + (little ? 0 : 0));
          const b1 = view.getUint8(base + (little ? 1 : 1));
          const b2 = view.getUint8(base + (little ? 2 : 2));
          let val = little
            ? b0 | (b1 << 8) | (b2 << 16)
            : (b0 << 16) | (b1 << 8) | b2;
          if (val & 0x800000) val |= 0xff000000; // sign-extend
          s = val / 8388608; // 2^23
        }
      } else if (isULaw) {
        s = ulawByteToF32(view.getUint8(base));
      } else if (isALaw) {
        s = alawByteToF32(view.getUint8(base));
      }
      acc += s;
    }
    mono[f] = acc / numChannels;
    p += frameBytes;
  }

  return { pcm: mono, sampleRate: Math.round(sampleRate) };
}

async function loadAudioData() {
  await ensureWasm();
  // Compute extension hint once so both probe and fallback paths can use it
  let extHint = detectExtension(currentFileName || '');
  if (!extHint) extHint = mimeToExt(currentMimeType || '');
  extHint = (extHint || '').toLowerCase();
  try {
    // Stop playback if playing
    stopPlayback();

    // Unload previous spectrogram and clear all caches
    if (spectrogramId !== null) {
      unload_spectrogram(spectrogramId);
      spectrogramId = null;
    }

    // Clear the tile cache completely (active and ghost tiles)
    tileCache.clear();

    console.log(
      '[spectrogram] Decoding audio with FFT size:',
      fftSizeParam,
      'hop:',
      hopSizeParam
    );
    const startTime = performance.now();
    // Prefer generic loader with extension hint; fall back to MP3-only for backwards compat.
    try {
      spectrogramId = load_audio_bytes(
        audioFileData,
        extHint,
        fftSizeParam,
        hopSizeParam
      );
    } catch (e1) {
      console.warn(
        '[spectrogram] WASM decode failed, attempting browser decode fallback:',
        e1
      );
      // Browser decode fallback: use WebAudio to decode and downmix to mono.
      await decodeAudioForPlayback();
      if (audioBuffer) {
        const sr = audioBuffer.sampleRate;
        const ch = audioBuffer.numberOfChannels;
        const len = audioBuffer.length;
        const mono = new Float32Array(len);
        for (let c = 0; c < ch; c++) {
          const data = audioBuffer.getChannelData(c);
          for (let i = 0; i < len; i++) mono[i] += data[i];
        }
        for (let i = 0; i < len; i++) mono[i] /= Math.max(1, ch);
        spectrogramId = load_audio_pcm_mono_f32(
          mono,
          sr,
          fftSizeParam,
          hopSizeParam
        );
      } else if (
        extHint === 'aif' ||
        extHint === 'aiff' ||
        extHint === 'aifc'
      ) {
        // Manual AIFF/AIFC PCM fallback for unsupported COMP types like 'sowt'
        try {
          const { pcm, sampleRate } = parseAiffToMonoF32(audioFileData.buffer);
          spectrogramId = load_audio_pcm_mono_f32(
            pcm,
            sampleRate,
            fftSizeParam,
            hopSizeParam
          );
        } catch (pe) {
          console.warn('[spectrogram] AIFF manual parse failed:', pe);
          throw e1;
        }
      } else {
        throw e1;
      }
    }
    console.log(
      '[spectrogram] Audio loaded, ID:',
      spectrogramId,
      'time:',
      (performance.now() - startTime).toFixed(1),
      'ms'
    );

    spectrogramInfo = get_spectrogram_info(spectrogramId);
    const welcomeOverlay = document.getElementById('welcomeOverlay');
    if (welcomeOverlay) welcomeOverlay.style.display = 'none';
    const loadingToast = document.getElementById('loadingToast');
    if (loadingToast) {
      loadingToast.style.opacity = '1';
      setTimeout(() => { loadingToast.style.opacity = '0'; }, 3000);
    }

    // Apply saved hue offset for circle-of-fifths scheme, if any
    try {
      const saved = parseFloat(
        localStorage.getItem('fifthsHueOffset') || 'NaN'
      );
      if (!Number.isNaN(saved)) set_fifths_hue_offset(spectrogramId, saved);
    } catch {}

    const [duration, sampleRate, numWindows, fftSize, hopSize] = spectrogramInfo;

    console.log('[spectrogram] Info:', {
      duration: duration.toFixed(2) + 's',
      sampleRate: sampleRate + ' Hz',
      numWindows,
      fftSize,
      hopSize,
    });

    // Decode audio for playback using Web Audio API
    await decodeAudioForPlayback();

    scrollOffset = 0;
    currentScrollOffset = 0;
    targetScrollOffset = 0;
    cachedPixels = null;
    playbackPauseTime = 0;

    // Apply multiband config before final render (triggerChange handles set_multiband_config + render)
    if (multiBandManager) {
      multiBandManager.triggerChange();
    } else {
      renderSpectrogram();
    }
  } catch (err) {
    console.error('[spectrogram] Error:', err);
    alert('Failed to process audio: ' + err);
  }
}

async function decodeAudioForPlayback() {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Try native decode first
    const arrayBufferCopy = audioFileData.buffer.slice(0);
    try {
      audioBuffer = await audioContext.decodeAudioData(arrayBufferCopy);
      playPauseBtn.disabled = false;
      console.log('[audio] Audio decoded for playback');
      return;
    } catch (webaudioErr) {
      // Manual AIFF/AIFC fallback: build AudioBuffer from parsed PCM
      let ext = detectExtension(currentFileName || '');
      if (!ext) ext = mimeToExt(currentMimeType || '');
      ext = (ext || '').toLowerCase();
      if (ext === 'aif' || ext === 'aiff' || ext === 'aifc') {
        try {
          const { pcm, sampleRate } = parseAiffToMonoF32(audioFileData.buffer);
          const buf = audioContext.createBuffer(1, pcm.length, sampleRate);
          buf.getChannelData(0).set(pcm);
          audioBuffer = buf;
          playPauseBtn.disabled = false;
          console.log('[audio] Using manual AIFF/AIFC PCM for playback');
          return;
        } catch (manualErr) {
          console.warn(
            '[audio] Manual AIFF/AIFC playback fallback failed:',
            manualErr
          );
          throw webaudioErr;
        }
      } else {
        throw webaudioErr;
      }
    }
  } catch (err) {
    console.error('[audio] Failed to decode audio for playback:', err);
    playPauseBtn.disabled = true;
  }
}

function stopPlayback() {
  if (audioSource) {
    audioSource.stop();
    audioSource.disconnect();
    audioSource = null;
  }
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  isPlaying = false;
  playPauseBtn.textContent = 'Play';
  const topBar = document.getElementById('topBar');
  if (topBar) topBar.style.opacity = '1';
}

function getCurrentPlaybackTime() {
  if (!isPlaying) return playbackPauseTime;
  return playbackPauseTime + (audioContext.currentTime - playbackStartTime);
}

function updatePlaybackLine() {
  const currentTime = getCurrentPlaybackTime();
  if (!spectrogramInfo) return;
  const [duration, sampleRate, numWindows] = spectrogramInfo;

  // Follow playback mode: keep playhead at 20% from the left of the visible window range (in windows)
  if (isPlaying && followPlayback) {
    const currentWindow = (currentTime * sampleRate) / hopSizeParam;
    const vw = Math.floor(width / Math.max(0.01, timeZoom));
    const targetOffset = currentWindow - vw * 0.2;
    const maxScroll = Math.max(0, numWindows - vw);
    const clampedTarget = Math.max(0, Math.min(maxScroll, targetOffset));

    // Smooth scroll to follow position
    smoothScrollTo(clampedTarget);
  }

  // Clear only the playback canvas (super fast!)
  playbackCtx.clearRect(0, 0, width, height);

  // Draw playback line on separate canvas
  const visibleWindows = width / Math.max(0.01, timeZoom);
  const startTime = (scrollOffset * hopSizeParam) / sampleRate;
  const endTime = ((scrollOffset + visibleWindows) * hopSizeParam) / sampleRate;

  if (currentTime >= startTime && currentTime <= endTime) {
    const x = Math.floor(
      ((currentTime - startTime) / (endTime - startTime)) * width
    );

    if (spectrumPlayhead && x >= 0 && x < width) {
      // Draw spectrum-colored playhead by sampling the spectrogram canvas column
      try {
        const columnData = ctx.getImageData(x, 0, 1, height);
        const pixels = columnData.data;

        // Draw glow layers using fillRect for better performance
        // Massive outer glow (very loud stuff)
        for (let y = 0; y < height; y++) {
          const pixelIndex = y * 4;
          const red = pixels[pixelIndex];
          const green = pixels[pixelIndex + 1];
          const blue = pixels[pixelIndex + 2];

          const brightness = (red + green + blue) / 765; // 0–1
          if (brightness < 0.08) continue;

          // Much more aggressive response
          const baseAlpha = Math.min(1, 0.15 + Math.pow(brightness, 1.2) * 3.5);

          // Multi-layer glow for intensity + softness
          // Wide → narrow, low → high alpha
          const layers = [
            { spread: 50, alpha: 0.2 },
            { spread: 32, alpha: 0.5 },
            { spread: 12, alpha: 0.55 },
            { spread: 8, alpha: 0.9 },
          ];

          for (const layer of layers) {
            playbackCtx.fillStyle = `rgba(${red}, ${green}, ${blue}, ${(baseAlpha * layer.alpha).toFixed(3)})`;

            playbackCtx.fillRect(x - layer.spread, y, layer.spread * 2 + 1, 1);
          }
        }
        // Medium glow
        for (let y = 0; y < height; y++) {
          const i = y * 4;
          const r = pixels[i],
            g = pixels[i + 1],
            b = pixels[i + 2];
          const brightness = (r + g + b) / 765;
          if (brightness < 0.08) continue;
          const glowAlpha = Math.pow(brightness, 1.5) * 0.6;
          playbackCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${glowAlpha.toFixed(2)})`;
          playbackCtx.fillRect(x - 4, y, 9, 1);
        }

        // Inner glow
        for (let y = 0; y < height; y++) {
          const i = y * 4;
          const r = pixels[i],
            g = pixels[i + 1],
            b = pixels[i + 2];
          const brightness = (r + g + b) / 765;
          if (brightness < 0.04) continue;
          playbackCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${(brightness * 0.8).toFixed(2)})`;
          playbackCtx.fillRect(x - 2, y, 5, 1);
        }

        // Sharp center line
        for (let y = 0; y < height; y++) {
          const i = y * 4;
          const r = pixels[i],
            g = pixels[i + 1],
            b = pixels[i + 2];
          if (r + g + b < 15) continue;
          playbackCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          playbackCtx.fillRect(x - 1, y, 3, 1);
        }
      } catch (e) {
        // Fallback to red line if canvas read fails
        playbackCtx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
        playbackCtx.lineWidth = 2;
        playbackCtx.beginPath();
        playbackCtx.moveTo(x, 0);
        playbackCtx.lineTo(x, height);
        playbackCtx.stroke();
      }
    } else {
      // Standard red playhead line
      playbackCtx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
      playbackCtx.lineWidth = 2;
      playbackCtx.beginPath();
      playbackCtx.moveTo(x, 0);
      playbackCtx.lineTo(x, height);
      playbackCtx.stroke();
    }
  }

  if (isPlaying) {
    // Check if playback has finished
    if (currentTime >= duration) {
      stopPlayback();
      playbackPauseTime = 0;
      updatePlaybackLine();
    } else {
      animationFrameId = requestAnimationFrame(updatePlaybackLine);
    }
  }
}

playPauseBtn.addEventListener('click', () => {
  if (!audioBuffer) return;

  if (isPlaying) {
    // Pause
    stopPlayback();
    playbackPauseTime = getCurrentPlaybackTime();
  } else {
    // Play
    const [duration] = spectrogramInfo;

    if (playbackPauseTime >= duration) {
      playbackPauseTime = 0;
    }

    audioSource = audioContext.createBufferSource();
    audioSource.buffer = audioBuffer;
    audioSource.connect(audioContext.destination);
    audioSource.start(0, playbackPauseTime);

    playbackStartTime = audioContext.currentTime;
    isPlaying = true;
    playPauseBtn.textContent = 'Pause';
    const topBar = document.getElementById('topBar');
    if (topBar) topBar.style.opacity = '0';

    audioSource.onended = () => {
      if (isPlaying) {
        stopPlayback();
        playbackPauseTime = 0;
        updatePlaybackLine();
      }
    };

    updatePlaybackLine();
  }
});

// Smooth scroll animation
function smoothScrollTo(target) {
  if (!spectrogramInfo) return;
  const [duration, sampleRate, numWindows] = spectrogramInfo;
  const visibleWindows = Math.floor(width / Math.max(0.01, timeZoom));
  const maxScroll = Math.max(0, numWindows - visibleWindows);
  targetScrollOffset = Math.max(0, Math.min(maxScroll, target));

  if (!scrollAnimationFrame) {
    scrollAnimationFrame = requestAnimationFrame(animateScroll);
  }
}

function animateScroll() {
  // Smooth interpolation
  const diff = targetScrollOffset - currentScrollOffset;
  if (Math.abs(diff) < 0.5) {
    currentScrollOffset = targetScrollOffset;
    scrollOffset = currentScrollOffset;
    scrollAnimationFrame = null;
    renderSpectrogram();
    return;
  }

  currentScrollOffset += diff * 0.2; // Smooth easing
  scrollOffset = Math.floor(currentScrollOffset);
  renderSpectrogram();
  scrollAnimationFrame = requestAnimationFrame(animateScroll);
}

function renderSpectrogram() {
  if (spectrogramId === null) return;

  try {
    // Use tiled cache: figure out visible tiles and composite from cached canvases
    const startTile = Math.floor((scrollOffset * timeZoom) / TILE_WIDTH);
    const endTile = Math.floor(
      (scrollOffset * timeZoom + width - 1) / TILE_WIDTH
    );
    const xOffsetInFirstTile =
      Math.floor(scrollOffset * timeZoom) - startTile * TILE_WIDTH;

    // Clear frame
    ctx.clearRect(0, 0, width, height);

    // Clean up ghost tiles while rendering
    tileCache.cleanupGhosts();

    // During zoom-drag, render in non-tiled mode for stability
    if (zoomDragActive) {
      const visibleWindows = Math.floor(width / Math.max(0.01, timeZoom));
      const windowStart = Math.max(0, Math.floor(scrollOffset));
      const pixels = render_spectrogram_viewport(
        spectrogramId,
        windowStart,
        visibleWindows,
        height,
        minFreqParam,
        maxFreqParam,
        scaleModeParam,
        gainDbParam,
        rangeDbParam,
        freqGainDbPerDecParam,
        windowTypeParam,
        zeroPadFactorParam,
        spectoColorSchemeParam,
        bassSharpParam
      );
      const img = new ImageData(
        new Uint8ClampedArray(pixels),
        visibleWindows,
        height
      );
      const tmp = document.createElement('canvas');
      tmp.width = visibleWindows;
      tmp.height = height;
      tmp.getContext('2d').putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, visibleWindows, height, 0, 0, width, height);
      drawMarkers();
      if (!isPlaying) updatePlaybackLine();
      return; // skip tiled path while dragging
    }

    // Track viewport center tile to prioritize generation
    currentViewportCenterTile = Math.floor(
      (scrollOffset * timeZoom + width / 2) / TILE_WIDTH
    );

    const now = performance.now();
    let drawX = -xOffsetInFirstTile;
    for (let tile = startTile; tile <= endTile; tile++) {
      const paramHash = paramsKey();
      const key = tileCache.generateKey(paramHash, tile);
      const activeTile = tileCache.get(key);

      // Check if we have a ghost tile (invalidated, still fading)
      const ghostTile = tileCache.getGhostByIndex(tile);

      const sx = 0;
      const sy = 0;
      const sWidth = TILE_WIDTH;
      const sHeight = height;
      const dx = Math.floor(drawX);
      const dy = 0;
      const dWidth = TILE_WIDTH;
      const dHeight = height;

      // Render logic: prioritize active > unreplaced ghost > placeholder
      if (activeTile) {
        // Draw the new active tile
        ctx.drawImage(
          activeTile,
          sx,
          sy,
          sWidth,
          sHeight,
          dx,
          dy,
          dWidth,
          dHeight
        );

        // If ghost exists, fade it out on top (smooth transition)
        if (ghostTile) {
          const opacity = tileCache.getGhostOpacity(ghostTile, now);
          if (opacity > 0) {
            ctx.globalAlpha = opacity;
            ctx.drawImage(
              ghostTile.canvas,
              sx,
              sy,
              sWidth,
              sHeight,
              dx,
              dy,
              dWidth,
              dHeight
            );
            ctx.globalAlpha = 1.0;
          }
        }
      } else if (ghostTile && ghostTile.fadeStartTime === null) {
        // No active tile, but have an unreplaced ghost (still waiting for new tile)
        // Show ghost and enqueue the new tile
        ctx.drawImage(
          ghostTile.canvas,
          sx,
          sy,
          sWidth,
          sHeight,
          dx,
          dy,
          dWidth,
          dHeight
        );
        enqueueTile(tile);
      } else {
        // No active tile, ghost is either fading or missing
        // Show placeholder and enqueue
        ctx.drawImage(
          getPlaceholderTile(),
          sx,
          sy,
          sWidth,
          sHeight,
          dx,
          dy,
          dWidth,
          dHeight
        );
        enqueueTile(tile);
      }

      drawX += TILE_WIDTH;
    }

    // Prefetch tiles around viewport (AFTER visible tiles) to keep panning smooth
    // This ensures visible tiles are in the queue first
    const PREFETCH_BEFORE = 1;
    const PREFETCH_AFTER = 2;
    for (let t = startTile - PREFETCH_BEFORE; t < startTile; t++) {
      if (t >= 0) enqueueTile(t);
    }
    for (let t = endTile + 1; t <= endTile + PREFETCH_AFTER; t++) {
      if (t >= 0) enqueueTile(t);
    }

    // Draw markers on overlay (only when viewport changes)
    drawMarkers();

    // Update playback line (lightweight, separate canvas)
    if (!isPlaying) {
      updatePlaybackLine();
    }
  } catch (err) {
    console.error('[spectrogram] Render error:', err);
  }
}

// Wheel: default = pan horizontally; hold Shift for zoom (vertical)
canvas.addEventListener(
  'wheel',
  (e) => {
    if (spectrogramId === null) return;
    e.preventDefault();

    // If Shift is held and vertical scroll dominates, enter zoom mode
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const canvasX = (x / rect.width) * width;
    isMouseOverCanvas = true;
    lastMouseCanvasX = canvasX;
    if (e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      zoomDragActive = true;
      tilesPaused = true;
      const zoomFactor = Math.pow(1.1, -e.deltaY / 100);
      const newZoom = Math.min(16, Math.max(0.01, timeZoom * zoomFactor));
      if (newZoom !== timeZoom) {
        const oldZ = timeZoom;
        timeZoom = newZoom;
        const z = document.getElementById('timeZoom');
        if (z) z.value = String(zoomToSlider(timeZoom));
        const zv = document.getElementById('timeZoomValue');
        if (zv) zv.textContent = `${timeZoom.toFixed(2)}x`;
        try {
          localStorage.setItem('timeZoom', String(timeZoom));
        } catch {}
        anchorAwareAdjustScroll(oldZ, timeZoom);
        invalidateTileCache();
        renderSpectrogram();
      }
      // Debounce end of wheel gesture; resume tiling after quiet period
      if (wheelZoomDebounceTimer) clearTimeout(wheelZoomDebounceTimer);
      wheelZoomDebounceTimer = setTimeout(() => {
        zoomDragActive = false;
        tilesPaused = false;
        if (!tileRAF) tileRAF = requestAnimationFrame(processTileQueue);
        renderSpectrogram();
      }, WHEEL_ZOOM_DEBOUNCE_MS);
      return;
    }

    // Otherwise, horizontal/trackpad scroll in windows (no Shift)
    const scrollAmount = e.deltaX !== 0 ? e.deltaX : e.deltaY;
    const stepWindows = Math.max(1, Math.round(50 / Math.max(0.01, timeZoom)));
    const delta = scrollAmount > 0 ? stepWindows : -stepWindows;
    smoothScrollTo(targetScrollOffset + delta);
  },
  { passive: false }
);

// Mouse drag for panning
let isDraggingSpectrogram = false;
let dragStartX = 0;
let dragStartScroll = 0;

// Double-click to start playback from timestamp
let lastClickTime = 0;
let lastClickX = 0;

canvas.addEventListener('dblclick', (e) => {
  if (spectrogramId === null) return;

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const canvasX = (x / rect.width) * width;

  const [duration, sampleRate, numWindows] = spectrogramInfo;
  const visibleWindows = width / Math.max(0.01, timeZoom);
  const startTime = (scrollOffset * hopSizeParam) / sampleRate;
  const endTime = ((scrollOffset + visibleWindows) * hopSizeParam) / sampleRate;
  const clickedTime = startTime + (canvasX / width) * (endTime - startTime);

  // Stop current playback and start from clicked position
  stopPlayback();
  playbackPauseTime = Math.max(0, Math.min(duration, clickedTime));
  updatePlaybackLine();

  // Start playback
  playPauseBtn.click();
});

canvas.addEventListener('mousedown', (e) => {
  if (spectrogramId === null) return;
  if (e.button !== 0) return;

  // Check if user clicked to seek playback position
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const canvasX = (x / rect.width) * width;

  const [duration, sampleRate, numWindows] = spectrogramInfo;
  const visibleWindows = width / Math.max(0.01, timeZoom);
  const startTime = (scrollOffset * hopSizeParam) / sampleRate;
  const endTime = ((scrollOffset + visibleWindows) * hopSizeParam) / sampleRate;
  const clickedTime = startTime + (canvasX / width) * (endTime - startTime);

  // If user clicks within 10px of playback line, or if shift is held, seek to that position
  const currentTime = getCurrentPlaybackTime();
  const currentX = ((currentTime - startTime) / (endTime - startTime)) * width;
  const distanceToLine = Math.abs((x / rect.width) * width - currentX);

  if (e.shiftKey || distanceToLine < 10) {
    // Seek to clicked position
    const wasPlaying = isPlaying;
    stopPlayback();
    playbackPauseTime = Math.max(0, Math.min(duration, clickedTime));
    updatePlaybackLine();

    if (wasPlaying) {
      // Resume playback from new position
      playPauseBtn.click();
    }
    return;
  }

  isDraggingSpectrogram = true;
  dragStartX = e.clientX;
  dragStartScroll = scrollOffset;
});

canvas.addEventListener('mousemove', (e) => {
  if (!isDraggingSpectrogram) return;

  const [duration, sampleRate, numWindows] = spectrogramInfo;
  const maxScroll = Math.max(
    0,
    numWindows - Math.floor(width / Math.max(0.01, timeZoom))
  );

  const dx = dragStartX - e.clientX;
  const scrollDelta = (dx / cssWidth) * (width / Math.max(0.01, timeZoom));
  const newScroll = Math.max(
    0,
    Math.min(maxScroll, dragStartScroll + scrollDelta)
  );

  // Direct update for dragging (no smooth scroll)
  scrollOffset = newScroll;
  currentScrollOffset = newScroll;
  targetScrollOffset = newScroll;
  cachedPixels = null; // Invalidate cache during drag

  renderSpectrogram();
});

canvas.addEventListener('mouseup', () => {
  isDraggingSpectrogram = false;
});

canvas.addEventListener('mouseleave', () => {
  isDraggingSpectrogram = false;
  tooltip.style.display = 'none';
});

// Convert frequency to musical note
function freqToNote(freq) {
  if (freq <= 0) return 'N/A';

  // A4 = 440 Hz
  const A4 = 440;
  const noteNames = [
    'C',
    'C#',
    'D',
    'D#',
    'E',
    'F',
    'F#',
    'G',
    'G#',
    'A',
    'A#',
    'B',
  ];

  // Calculate semitones from A4
  const semitones = 12 * Math.log2(freq / A4);
  const noteNumber = Math.round(semitones) + 69; // MIDI note number (A4 = 69)

  const octave = Math.floor(noteNumber / 12) - 1;
  const noteIndex = noteNumber % 12;

  // Calculate cents (how far off from the exact note)
  const exactSemitones = 12 * Math.log2(freq / A4) + 69;
  const cents = Math.round((exactSemitones - noteNumber) * 100);
  const centsStr = cents > 0 ? `+${cents}` : cents.toString();

  return `${noteNames[noteIndex]}${octave} (${centsStr}¢)`;
}

// Hover tooltip for frequency and amplitude inspection
// Standard orientation: X = time, Y = frequency
canvas.addEventListener('mousemove', (e) => {
  isMouseOverCanvas = true;
  if (!spectrogramId || isDraggingSpectrogram) return;

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // Standard dimensions
  const canvasWidth = width; // time windows
  const canvasHeight = height; // frequency bins

  // Convert CSS coordinates to canvas coordinates
  const canvasX = (x / rect.width) * canvasWidth;
  const canvasY = (y / rect.height) * canvasHeight;

  if (
    canvasX >= 0 &&
    canvasX < canvasWidth &&
    canvasY >= 0 &&
    canvasY < canvasHeight
  ) {
    const [duration, sampleRate, numWindows] = spectrogramInfo;

    // Calculate time at this X position (left = start, right = end)
    const windowIdx = Math.floor(
      scrollOffset + canvasX / Math.max(0.01, timeZoom)
    );
    const time = ((windowIdx * hopSizeParam) / sampleRate).toFixed(3);

    // Calculate frequency at this Y position using current scale
    const freqRatio = (canvasHeight - canvasY) / canvasHeight;
    const freq = mapRatioToFreq(
      freqRatio,
      minFreqParam,
      maxFreqParam,
      scaleModeParam
    );

    // Get pixel color to estimate amplitude
    const pixelData = ctx.getImageData(
      Math.floor(canvasX),
      Math.floor(canvasY),
      1,
      1
    ).data;
    // Rough amplitude estimation from brightness
    const brightness = (pixelData[0] + pixelData[1] + pixelData[2]) / (3 * 255);
    const ampDb = (brightness * 100 - 100).toFixed(1);

    // Update tooltip
    tooltipTime.textContent = `Time: ${time}s`;
    tooltipFreq.textContent = `Freq: ${freq.toFixed(0)}Hz`;
    tooltipNote.textContent = `Note: ${freqToNote(freq)}`;
    tooltipAmp.textContent = `Amp: ${ampDb}dB`;

    // Position tooltip
    tooltip.style.display = 'block';
    tooltip.style.left = e.clientX - rect.left + 15 + 'px';
    tooltip.style.top = e.clientY - rect.top + 15 + 'px';
  } else {
    tooltip.style.display = 'none';
  }
});

overlayCanvas.addEventListener('mouseleave', () => {
  isMouseOverCanvas = false;
  try {
    updatePlaybackLine();
  } catch {}
});
canvas.addEventListener('mouseleave', () => {
  isMouseOverCanvas = false;
  try {
    updatePlaybackLine();
  } catch {}
});

// ============================================================
// APP INITIALIZATION
// ============================================================

let wasmInitPromise = null;
async function ensureWasm() {
  if (!wasmInitPromise) {
    wasmInitPromise = (async () => {
      try {
        // Preferred: let wasm-pack loader resolve path relative to specto.js
        await init();
      } catch (e) {
        console.warn(
          '[wasm] init() without args failed; trying explicit URL',
          e
        );
        // Fallback: explicit URL relative to this script
        await init(new URL('./pkg/specto_bg.wasm', import.meta.url));
      }
      await initThreadPool(navigator.hardwareConcurrency);
    })();
  }
  return wasmInitPromise;
}

async function run() {
  await ensureWasm();
  updateCanvasResolution();

  // Initialize Multi-Band Manager first (applySettings needs it for multiband config)
  multiBandManager = new MultiBandManager();

  // Apply defaults — edit DEFAULT_SETTINGS at the bottom of this file to change startup values
  applySettings({ settings: DEFAULT_SETTINGS });
  updateHopSliderMax();
  multiBandManager.onChange((config) => {
    markInteraction();
    console.log(
      '[multiband] onChange triggered, bands:',
      config.bands.length,
      'spectrogramId:',
      spectrogramId
    );
    updateHopSliderMax();
    if (spectrogramId !== null) {
      try {
        set_multiband_config(spectrogramId, new Float32Array(config.bandsArray));
        console.log(
          '[multiband] Updated WASM with',
          config.bands.length,
          'bands'
        );
        console.log('[multiband] Invalidating tile cache and re-rendering...');
        invalidateTileCache();
        renderSpectrogram();
        console.log('[multiband] Re-render complete');
      } catch (e) {
        console.warn('[multiband] Failed to update config:', e);
      }
    } else {
      console.log('[multiband] Skipped update - no spectrogram loaded');
    }
  });

  // Sync hop size number input with slider
  const hopSizeNumber = document.getElementById('hopSizeNumber');
  if (hopSizeNumber && hopSizeSlider) {
    hopSizeNumber.addEventListener('input', () => {
      const val = parseInt(hopSizeNumber.value);
      if (!isNaN(val) && val >= 64 && val <= 5000) {
        hopSizeSlider.value = val;
        hopSizeSlider.dispatchEvent(new Event('input'));
      }
    });

    // Update number input when slider changes
    hopSizeSlider.addEventListener('input', () => {
      hopSizeNumber.value = hopSizeSlider.value;
    });
  }

  // Try to load default audio file
  try {
    const response = await fetch('./chop.mp3');
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      audioFileData = new Uint8Array(arrayBuffer);
      console.log('[spectrogram] Auto-loading default audio file');
      currentFileName = 'chop.mp3';
      await loadAudioData();
    }
  } catch (err) {
    console.log('[spectrogram] No default audio file, waiting for user upload');
  }
}

// Keyboard controls
document.addEventListener('keydown', (e) => {
  // Spacebar to play/pause
  if (e.code === 'Space' && audioBuffer) {
    e.preventDefault();
    playPauseBtn.click();
  }
});

// ============================================================
// TAB NAVIGATION
// ============================================================
const settingsTabs = document.querySelectorAll('.settings-tab');
const tabContents = document.querySelectorAll('.tab-content');

settingsTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const targetTab = tab.dataset.tab;

    // Update tab buttons
    settingsTabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');

    // Update tab content
    tabContents.forEach((content) => {
      content.classList.toggle('hidden', content.id !== `tab-${targetTab}`);
    });

    // Save active tab
    try {
      localStorage.setItem('activeSettingsTab', targetTab);
    } catch {}
  });
});

// Restore active tab
try {
  const savedTab = localStorage.getItem('activeSettingsTab');
  if (savedTab) {
    const tabBtn = document.querySelector(
      `.settings-tab[data-tab="${savedTab}"]`
    );
    if (tabBtn) tabBtn.click();
  }
} catch {}

// ============================================================
// SETTINGS EXPORT/IMPORT
// ============================================================
function gatherSettings() {
  return {
    version: 2, // Bumped version for multiband support
    name: 'specto-settings',
    timestamp: new Date().toISOString(),
    settings: {
      fftSize: fftSizeParam,
      hopSize: hopSizeParam,
      windowType: windowTypeParam,
      zeroPadFactor: zeroPadFactorParam,
      minFreq: minFreqParam,
      maxFreq: maxFreqParam,
      scaleMode: scaleModeParam,
      colorScheme: spectoColorSchemeParam,
      fifthsHueOffset: fifthsHueOffsetSlider
        ? parseInt(fifthsHueOffsetSlider.value)
        : 0,
      gainDb: gainDbParam,
      rangeDb: rangeDbParam,
      freqGainDbPerDec: freqGainDbPerDecParam,
      timeZoom: timeZoom,
      showGrid: showGrid,
      followPlayback: followPlayback,
      fftPow2: fftPow2Checkbox ? fftPow2Checkbox.checked : false,
      multiband: multiBandManager ? multiBandManager.exportConfig() : null,
    },
  };
}

function applySettings(config) {
  if (!config || !config.settings) return;
  const s = config.settings;

  // FFT Size
  if (s.fftSize !== undefined) {
    fftSizeParam = s.fftSize;
    if (fftSizeSlider) fftSizeSlider.value = String(s.fftSize);
    const fftVal = document.getElementById('fftSizeValue');
    if (fftVal) fftVal.textContent = String(s.fftSize);
  }

  // Hop Size
  if (s.hopSize !== undefined) {
    hopSizeParam = s.hopSize;
    if (hopSizeSlider) hopSizeSlider.value = String(s.hopSize);
    const hopVal = document.getElementById('hopSizeValue');
    if (hopVal) hopVal.textContent = String(s.hopSize);
    if (multiBandManager) multiBandManager.setHopSize(hopSizeParam);
  }

  // Window Type
  if (s.windowType !== undefined) {
    windowTypeParam = s.windowType;
    if (windowTypeSelect) windowTypeSelect.value = String(s.windowType);
    const mtNote = document.getElementById('multitaperNote');
    if (mtNote) mtNote.classList.toggle('hidden', s.windowType !== 5);
  }

  // Zero Padding
  if (s.zeroPadFactor !== undefined) {
    zeroPadFactorParam = s.zeroPadFactor;
    if (zeroPadFactorSlider)
      zeroPadFactorSlider.value = String(s.zeroPadFactor);
    const zpVal = document.getElementById('zeroPadFactorValue');
    if (zpVal) zpVal.textContent = `${s.zeroPadFactor}x`;
  }

  // Frequency Range
  if (s.minFreq !== undefined) {
    minFreqParam = s.minFreq;
    if (minFreqSlider) minFreqSlider.value = String(s.minFreq);
    const minVal = document.getElementById('minFreqValue');
    if (minVal) minVal.textContent = String(s.minFreq);
  }
  if (s.maxFreq !== undefined) {
    maxFreqParam = s.maxFreq;
    if (maxFreqSlider) maxFreqSlider.value = String(s.maxFreq);
    const maxVal = document.getElementById('maxFreqValue');
    if (maxVal) maxVal.textContent = String(s.maxFreq);
  }

  // Scale Mode
  if (s.scaleMode !== undefined) {
    scaleModeParam = s.scaleMode;
    if (scaleModeSelect) scaleModeSelect.value = String(s.scaleMode);
  }

  // Color Scheme
  if (s.colorScheme !== undefined) {
    spectoColorSchemeParam = s.colorScheme;
    if (spectoColorSchemeSelect)
      spectoColorSchemeSelect.value = String(s.colorScheme);
    if (fifthsHueOffsetWrap)
      fifthsHueOffsetWrap.classList.toggle('hidden', s.colorScheme !== 4);
  }

  // Fifths Hue Offset
  if (s.fifthsHueOffset !== undefined && fifthsHueOffsetSlider) {
    fifthsHueOffsetSlider.value = String(s.fifthsHueOffset);
    if (fifthsHueOffsetValue)
      fifthsHueOffsetValue.textContent = `${s.fifthsHueOffset}°`;
    if (spectrogramId !== null && spectoColorSchemeParam === 4) {
      try {
        set_fifths_hue_offset(spectrogramId, s.fifthsHueOffset);
      } catch {}
    }
  }

  // Gain & Range
  if (s.gainDb !== undefined) {
    gainDbParam = s.gainDb;
    if (gainDbSlider) gainDbSlider.value = String(s.gainDb);
    const gainVal = document.getElementById('gainDbValue');
    if (gainVal) gainVal.textContent = s.gainDb.toFixed(1);
  }
  if (s.rangeDb !== undefined) {
    rangeDbParam = s.rangeDb;
    if (rangeDbSlider) rangeDbSlider.value = String(s.rangeDb);
    const rangeVal = document.getElementById('rangeDbValue');
    if (rangeVal) rangeVal.textContent = String(s.rangeDb);
  }

  // Frequency Gain
  if (s.freqGainDbPerDec !== undefined) {
    freqGainDbPerDecParam = s.freqGainDbPerDec;
    if (freqGainDbPerDecSlider)
      freqGainDbPerDecSlider.value = String(s.freqGainDbPerDec);
    const fgVal = document.getElementById('freqGainDbPerDecValue');
    if (fgVal) fgVal.textContent = s.freqGainDbPerDec.toFixed(1);
  }

  // Time Zoom
  if (s.timeZoom !== undefined) {
    timeZoom = s.timeZoom;
    if (timeZoomSlider) timeZoomSlider.value = String(zoomToSlider(s.timeZoom));
    const zoomVal = document.getElementById('timeZoomValue');
    if (zoomVal) zoomVal.textContent = `${s.timeZoom.toFixed(2)}x`;
  }

  // Show Grid
  if (s.showGrid !== undefined) {
    showGrid = s.showGrid;
    if (showGridCheckbox) showGridCheckbox.checked = s.showGrid;
  }

  // Follow Playback
  if (s.followPlayback !== undefined) {
    followPlayback = s.followPlayback;
    if (followPlaybackCheckbox)
      followPlaybackCheckbox.checked = s.followPlayback;
  }

  // FFT Power of 2
  if (s.fftPow2 !== undefined && fftPow2Checkbox) {
    fftPow2Checkbox.checked = s.fftPow2;
  }

  // Multi-band configuration
  if (s.multiband !== undefined && multiBandManager) {
    multiBandManager.importConfig(s.multiband);
  }

  // Invalidate cache and re-render
  invalidateTileCache();
  if (spectrogramId !== null) {
    try {
      update_spectrogram_params(spectrogramId, fftSizeParam, hopSizeParam);
      spectrogramInfo = get_spectrogram_info(spectrogramId);
    } catch {}
    renderSpectrogram();
  }
}

// Export Settings Button
const exportSettingsBtn = document.getElementById('exportSettings');
if (exportSettingsBtn) {
  exportSettingsBtn.addEventListener('click', () => {
    const config = gatherSettings();
    const json = JSON.stringify(config, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);
    a.href = url;
    a.download = `specto-settings-${timestamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

// Import Settings Button
const importSettingsBtn = document.getElementById('importSettingsBtn');
const importSettingsInput = document.getElementById('importSettings');
if (importSettingsBtn && importSettingsInput) {
  importSettingsBtn.addEventListener('click', () => {
    importSettingsInput.click();
  });

  importSettingsInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const config = JSON.parse(text);
      applySettings(config);
      console.log('[settings] Imported settings from', file.name);
    } catch (err) {
      console.error('[settings] Failed to import settings:', err);
      alert('Failed to import settings: ' + err.message);
    }

    // Reset input so same file can be re-imported
    importSettingsInput.value = '';
  });
}

// ============================================================
// DEFAULT SETTINGS — edit this object to change startup defaults
// ============================================================
const DEFAULT_SETTINGS = {
  fftSize: 2048,
  hopSize: 512,
  windowType: 0,
  zeroPadFactor: 1,
  minFreq: 50,
  maxFreq: 12850,
  scaleMode: 1,
  colorScheme: 4,
  fifthsHueOffset: 251,
  gainDb: -20.5,
  rangeDb: 64,
  freqGainDbPerDec: 0,
  timeZoom: 1,
  showGrid: false,
  followPlayback: true,
  fftPow2: false,
  multiband: {
    bands: [
      { min: 20,   max: 80,    fftMultiplier: 40, gain: 0.2, hopMultiplier: 6 },
      { min: 80,   max: 265,   fftMultiplier: 26, gain: 0.5, hopMultiplier: 1 },
      { min: 265,  max: 2270,  fftMultiplier: 16, gain: 0.8, hopMultiplier: 1 },
      { min: 2270, max: 4280,  fftMultiplier: 4,  gain: 1.0, hopMultiplier: 1 },
      { min: 4280, max: 22000, fftMultiplier: 1,  gain: 1.3, hopMultiplier: 1 },
    ],
  },
};

// Quick Presets
const presets = {
  default: DEFAULT_SETTINGS,
  color: {
    hopSize: 2304,
    windowType: 0,
    zeroPadFactor: 5,
    minFreq: 0,
    maxFreq: 18650,
    scaleMode: 4,
    colorScheme: 4,
    fifthsHueOffset: 300,
    gainDb: 37,
    rangeDb: 27,
    freqGainDbPerDec: 24,
    timeZoom: 2.5,
    showGrid: false,
    followPlayback: false,
    multiband: {
      bands: [
        { min: 0, max: 80, fftMultiplier: 14, gain: 2.5, hopMultiplier: 4 },
        { min: 80, max: 350, fftMultiplier: 5, gain: 1.8, hopMultiplier: 2 },
        { min: 350, max: 1500, fftMultiplier: 2, gain: 1.2, hopMultiplier: 1 },
        {
          min: 1500,
          max: 24000,
          fftMultiplier: 1,
          gain: 1.0,
          hopMultiplier: 1,
        },
      ],
    },
  },
};

document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const presetName = btn.dataset.preset;
    const preset = presets[presetName];
    if (preset) {
      applySettings({ settings: preset });
      console.log('[settings] Applied preset:', presetName);
    }
  });
});

run();
