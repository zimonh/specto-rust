/**
 * Main application entry point
 * Clean, modular spectrogram application
 */

import init, {
  initThreadPool,
  load_audio_bytes,
  load_audio_pcm_mono_f32,
  get_spectrogram_info,
  unload_spectrogram,
  set_multiband_config,
  enable_multiband,
} from '../pkg/specto.js';

import { state, resetState } from './state.js';
import { updateCanvasResolution, setupCanvasListeners, clearCanvas } from './canvas.js';
import { renderFullViewport, invalidateCache } from './renderer.js';
import { initAudioContext, playAudio, pauseAudio, stopAudio, togglePlayback } from './playback.js';
import { TileCache } from '../tileCache.js';
import { MultiBandManager } from '../multiband.js';

// DOM elements
const canvas = document.getElementById('spectrogramCanvas');
const overlayCanvas = document.getElementById('overlayCanvas');
const playbackCanvas = document.getElementById('playbackCanvas');
const scrollContainer = document.getElementById('scrollContainer');

/**
 * Initialize the application
 */
export async function initApp() {
  console.log('[main] Initializing application...');

  // Initialize WASM
  try {
    await init();
    await initThreadPool(navigator.hardwareConcurrency);
    console.log('[main] WASM initialized');
  } catch (err) {
    console.error('[main] WASM init failed:', err);
    return;
  }

  // Initialize tile cache
  state.tileCache = new TileCache();

  // Setup canvases
  updateCanvasResolution(canvas, scrollContainer);
  updateCanvasResolution(overlayCanvas, scrollContainer);
  updateCanvasResolution(playbackCanvas, scrollContainer);

  // Setup UI
  setupEventListeners();

  // Initialize multiband manager
  const multiBandManager = new MultiBandManager();
  multiBandManager.onChange((config) => {
    console.log('[multiband] Config changed, enabled:', config.enabled);
    if (state.spectrogramId !== null) {
      try {
        if (config.enabled) {
          set_multiband_config(state.spectrogramId, true, config.bandsArray);
          console.log('[multiband] Updated WASM with', config.bands.length, 'bands');
        } else {
          enable_multiband(state.spectrogramId, false);
          console.log('[multiband] Disabled in WASM');
        }
        invalidateCache();
        requestAnimationFrame(() => renderFullViewport(canvas, overlayCanvas));
      } catch (err) {
        console.error('[multiband] Failed to apply config:', err);
      }
    }
  });

  // Store in state for access
  state.multiBandManager = multiBandManager;

  console.log('[main] Application ready');
}

/**
 * Load audio file
 */
export async function loadAudioFile(file) {
  console.log('[main] Loading audio file:', file.name);

  try {
    // Unload previous spectrogram
    if (state.spectrogramId !== null) {
      unload_spectrogram(state.spectrogramId);
      resetState();
    }

    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    // Get file extension
    const ext = file.name.split('.').pop().toLowerCase();

    // Default FFT settings
    const fftSize = 2048;
    const hopSize = 512;

    // Try WASM decoder first
    let spectrogramId;
    try {
      spectrogramId = load_audio_bytes(data, ext, fftSize, hopSize);
    } catch (err) {
      console.warn('[main] WASM decoder failed, trying browser decoder:', err);

      // Fallback to browser decoder
      const audioCtx = initAudioContext();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));

      // Convert to mono PCM
      const len = audioBuffer.length;
      const ch = audioBuffer.numberOfChannels;
      const mono = new Float32Array(len);

      for (let c = 0; c < ch; c++) {
        const channelData = audioBuffer.getChannelData(c);
        for (let i = 0; i < len; i++) {
          mono[i] += channelData[i];
        }
      }
      for (let i = 0; i < len; i++) {
        mono[i] /= Math.max(1, ch);
      }

      spectrogramId = load_audio_pcm_mono_f32(mono, audioBuffer.sampleRate, fftSize, hopSize);

      state.audioBuffer = audioBuffer;
    }

    // Store spectrogram info
    state.spectrogramId = spectrogramId;
    state.spectrogramInfo = get_spectrogram_info(spectrogramId);
    state.audioFileName = file.name;

    const [duration, sampleRate, numWindows, fftSize, hopSize] = state.spectrogramInfo;

    console.log('[main] Audio loaded:', {
      duration: duration.toFixed(2) + 's',
      sampleRate,
      numWindows,
      fftSize,
      hopSize,
    });

    // Set initial viewport
    state.viewport.timeStart = 0;
    state.viewport.timeEnd = Math.min(10, duration);

    // Render
    invalidateCache();
    requestAnimationFrame(() => renderFullViewport(canvas, overlayCanvas));

    return true;
  } catch (err) {
    console.error('[main] Failed to load audio:', err);
    alert('Failed to load audio file: ' + err.message);
    return false;
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // File input
  const fileInput = document.getElementById('audioFileInput');
  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        await loadAudioFile(file);
      }
    });
  }

  // Drag & drop
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) {
      await loadAudioFile(file);
    }
  });

  // Playback controls
  const playBtn = document.getElementById('playBtn');
  if (playBtn) {
    playBtn.addEventListener('click', togglePlayback);
  }

  const stopBtn = document.getElementById('stopBtn');
  if (stopBtn) {
    stopBtn.addEventListener('click', stopAudio);
  }

  // Window resize
  window.addEventListener('resize', () => {
    updateCanvasResolution(canvas, scrollContainer);
    updateCanvasResolution(overlayCanvas, scrollContainer);
    updateCanvasResolution(playbackCanvas, scrollContainer);

    if (state.spectrogramId) {
      invalidateCache();
      requestAnimationFrame(() => renderFullViewport(canvas, overlayCanvas));
    }
  });

  // Canvas interactions
  setupCanvasListeners(overlayCanvas, {
    onWheel: handleWheel,
    onMouseDown: handleMouseDown,
    onMouseMove: handleMouseMove,
    onMouseUp: handleMouseUp,
  });

  console.log('[main] Event listeners setup complete');
}

/**
 * Handle mouse wheel (zoom)
 */
function handleWheel(e) {
  e.preventDefault();

  const delta = e.deltaY > 0 ? 1.1 : 0.9;
  const { timeStart, timeEnd } = state.viewport;
  const duration = timeEnd - timeStart;
  const newDuration = Math.max(0.1, Math.min(duration * delta, getTotalDuration()));

  const mouseX = e.clientX - overlayCanvas.getBoundingClientRect().left;
  const mouseRatio = mouseX / state.viewport.canvasWidth;
  const mouseTime = timeStart + mouseRatio * duration;

  state.viewport.timeStart = Math.max(0, mouseTime - mouseRatio * newDuration);
  state.viewport.timeEnd = Math.min(getTotalDuration(), state.viewport.timeStart + newDuration);

  invalidateCache();
  requestAnimationFrame(() => renderFullViewport(canvas, overlayCanvas));
}

/**
 * Handle mouse down (pan start)
 */
function handleMouseDown(e) {
  state.zoom.dragActive = true;
  state.zoom.anchorX = e.clientX;
  state.zoom.anchorTimeStart = state.viewport.timeStart;
  state.zoom.anchorTimeEnd = state.viewport.timeEnd;
}

/**
 * Handle mouse move (pan)
 */
function handleMouseMove(e) {
  if (!state.zoom.dragActive) return;

  const dx = e.clientX - state.zoom.anchorX;
  const duration = state.zoom.anchorTimeEnd - state.zoom.anchorTimeStart;
  const dt = -(dx / state.viewport.canvasWidth) * duration;

  state.viewport.timeStart = Math.max(
    0,
    Math.min(state.zoom.anchorTimeStart + dt, getTotalDuration() - duration)
  );
  state.viewport.timeEnd = state.viewport.timeStart + duration;

  requestAnimationFrame(() => renderFullViewport(canvas, overlayCanvas));
}

/**
 * Handle mouse up (pan end)
 */
function handleMouseUp() {
  if (state.zoom.dragActive) {
    state.zoom.dragActive = false;
    invalidateCache();
  }
}

function getTotalDuration() {
  return state.spectrogramInfo ? state.spectrogramInfo[0] : 0;
}

// Start app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
