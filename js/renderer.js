/**
 * Spectrogram rendering orchestration
 */

import { state, getNumWindows } from './state.js';
import { render_spectrogram_viewport } from '../pkg/specto.js';

// Default render parameters
const defaultParams = {
  min_freq_hz: 20,
  max_freq_hz: 20000,
  scale_mode: 1, // Log
  gain_db: 80,
  range_db: 80,
  freq_gain_db_per_dec: 3.0,
  window_type: 0, // Hann
  zero_pad_factor: 4,
  color_scheme: 3, // Spectral
  bass_sharp: 0.0,
};

/**
 * Render the full spectrogram viewport
 */
export function renderFullViewport(canvas, overlayCanvas, params = {}) {
  if (!state.spectrogramId) return;

  const { timeStart, timeEnd, canvasWidth, canvasHeight } = state.viewport;
  const totalDuration = state.spectrogramInfo[0];
  const numWindows = getNumWindows();

  // Calculate viewport in window indices
  const windowStart = Math.floor((timeStart / totalDuration) * numWindows);
  const windowEnd = Math.ceil((timeEnd / totalDuration) * numWindows);
  const windowWidth = Math.max(1, windowEnd - windowStart);

  // Merge params with defaults and state overrides
  const renderParams = { ...defaultParams, ...params, ...state.renderParams };

  try {
    // Render from WASM
    const pixelData = render_spectrogram_viewport(
      state.spectrogramId,
      windowStart,
      windowWidth,
      canvasHeight,
      renderParams.min_freq_hz,
      renderParams.max_freq_hz,
      renderParams.scale_mode,
      renderParams.gain_db,
      renderParams.range_db,
      renderParams.freq_gain_db_per_dec,
      renderParams.window_type,
      renderParams.zero_pad_factor,
      renderParams.color_scheme,
      renderParams.bass_sharp
    );

    // Draw to canvas
    const imageData = new ImageData(
      new Uint8ClampedArray(pixelData),
      windowWidth,
      canvasHeight
    );

    const ctx = canvas.getContext('2d');
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = windowWidth;
    tempCanvas.height = canvasHeight;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.putImageData(imageData, 0, 0);

    // Scale to fit canvas
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(tempCanvas, 0, 0, canvasWidth, canvasHeight);

    // Draw overlays
    drawOverlays(overlayCanvas);
  } catch (err) {
    console.error('[renderer] Failed to render:', err);
  }
}

/**
 * Draw overlays (grid, playhead, etc.)
 */
function drawOverlays(overlayCanvas) {
  const ctx = overlayCanvas.getContext('2d');
  const { canvasWidth, canvasHeight, timeStart, timeEnd } = state.viewport;

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Draw grid if enabled
  if (state.ui.gridEnabled) {
    const renderParams = { ...defaultParams, ...state.renderParams };
    drawGrid(
      ctx,
      canvasWidth,
      canvasHeight,
      timeStart,
      timeEnd,
      renderParams.min_freq_hz,
      renderParams.max_freq_hz,
      renderParams.scale_mode
    );
  }

  // Draw playhead if playing
  if (state.isPlaying && state.audioContext) {
    const currentTime = state.audioContext.currentTime - state.playbackStartTime;
    const x = ((currentTime - timeStart) / (timeEnd - timeStart)) * canvasWidth;

    if (x >= 0 && x <= canvasWidth) {
      ctx.save();
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/**
 * Simple grid drawing (placeholder)
 */
function drawGrid(ctx, width, height, timeStart, timeEnd, minFreq, maxFreq, scaleMode) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;

  // Time grid (vertical lines)
  const timeRange = timeEnd - timeStart;
  const timeStep = timeRange > 30 ? 10 : timeRange > 10 ? 5 : 1;

  for (let t = Math.ceil(timeStart / timeStep) * timeStep; t <= timeEnd; t += timeStep) {
    const x = ((t - timeStart) / timeRange) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  // Frequency grid (horizontal lines)
  const freqStep = maxFreq > 10000 ? 2000 : 1000;
  for (let f = Math.ceil(minFreq / freqStep) * freqStep; f <= maxFreq; f += freqStep) {
    const ratio =
      scaleMode === 0
        ? (f - minFreq) / (maxFreq - minFreq)
        : (Math.log(f) - Math.log(minFreq)) / (Math.log(maxFreq) - Math.log(minFreq));
    const y = height - ratio * height;

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Invalidate tile cache (force re-render)
 */
export function invalidateCache() {
  if (state.tileCache) {
    state.tileCache.clear();
  }
}
