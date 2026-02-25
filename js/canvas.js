/**
 * Canvas management and rendering utilities
 */

import { state } from './state.js';

/**
 * Update canvas internal resolution based on container size
 */
export function updateCanvasResolution(canvas, container) {
  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  state.viewport.canvasWidth = rect.width;
  state.viewport.canvasHeight = rect.height;

  return { width: rect.width, height: rect.height };
}

/**
 * Clear canvas
 */
export function clearCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/**
 * Setup canvas event listeners
 */
export function setupCanvasListeners(canvas, handlers) {
  if (handlers.onMouseDown) canvas.addEventListener('mousedown', handlers.onMouseDown);
  if (handlers.onMouseMove) canvas.addEventListener('mousemove', handlers.onMouseMove);
  if (handlers.onMouseUp) canvas.addEventListener('mouseup', handlers.onMouseUp);
  if (handlers.onWheel) canvas.addEventListener('wheel', handlers.onWheel);
  if (handlers.onTouchStart) canvas.addEventListener('touchstart', handlers.onTouchStart);
  if (handlers.onTouchMove) canvas.addEventListener('touchmove', handlers.onTouchMove);
  if (handlers.onTouchEnd) canvas.addEventListener('touchend', handlers.onTouchEnd);
}

/**
 * Get mouse/touch position relative to canvas
 */
export function getCanvasPosition(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

/**
 * Constrain value between min and max
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Draw grid and labels on canvas
 */
export function drawGrid(ctx, width, height, timeStart, timeEnd, minFreq, maxFreq, scaleMode) {
  if (!state.ui.gridEnabled) return;

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.font = '11px monospace';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';

  // Time grid (vertical lines)
  const timeRange = timeEnd - timeStart;
  const timeStep = getTimeStep(timeRange);

  for (let t = Math.ceil(timeStart / timeStep) * timeStep; t <= timeEnd; t += timeStep) {
    const x = ((t - timeStart) / timeRange) * width;
    if (x >= 0 && x <= width) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      if (state.ui.labelsEnabled) {
        ctx.fillText(t.toFixed(2) + 's', x + 2, 12);
      }
    }
  }

  // Frequency grid (horizontal lines)
  const freqStep = getFreqStep(minFreq, maxFreq, scaleMode);
  const freqs = generateFrequencyTicks(minFreq, maxFreq, scaleMode, freqStep);

  freqs.forEach((freq) => {
    const ratio = mapFreqToRatio(freq, minFreq, maxFreq, scaleMode);
    const y = height - ratio * height; // Inverted Y

    if (y >= 0 && y <= height) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      if (state.ui.labelsEnabled) {
        ctx.fillText(formatFreq(freq), 2, y - 2);
      }
    }
  });

  ctx.restore();
}

/**
 * Get appropriate time step for grid
 */
function getTimeStep(timeRange) {
  if (timeRange <= 1) return 0.1;
  if (timeRange <= 5) return 0.5;
  if (timeRange <= 10) return 1;
  if (timeRange <= 30) return 5;
  if (timeRange <= 60) return 10;
  return 30;
}

/**
 * Get appropriate frequency step for grid
 */
function getFreqStep(minFreq, maxFreq, scaleMode) {
  const range = maxFreq - minFreq;

  if (scaleMode === 0) {
    // Linear
    if (range <= 100) return 10;
    if (range <= 1000) return 100;
    if (range <= 5000) return 500;
    return 1000;
  } else {
    // Log-based scales
    return 0; // Will use octaves in generateFrequencyTicks
  }
}

/**
 * Generate frequency tick marks
 */
function generateFrequencyTicks(minFreq, maxFreq, scaleMode, step) {
  const ticks = [];

  if (scaleMode === 0) {
    // Linear
    for (let f = Math.ceil(minFreq / step) * step; f <= maxFreq; f += step) {
      ticks.push(f);
    }
  } else {
    // Log scales - use octaves
    let f = minFreq;
    while (f <= maxFreq) {
      ticks.push(f);
      f *= 2;
    }

    // Add intermediate ticks
    const intermediate = [];
    ticks.forEach((f, i) => {
      if (i < ticks.length - 1) {
        const nextF = ticks[i + 1];
        intermediate.push(f * 1.5);
      }
    });

    ticks.push(...intermediate);
    ticks.sort((a, b) => a - b);
  }

  return ticks.filter((f) => f >= minFreq && f <= maxFreq);
}

/**
 * Map frequency to ratio (0-1) based on scale mode
 */
function mapFreqToRatio(freq, minFreq, maxFreq, scaleMode) {
  switch (scaleMode) {
    case 0: // Linear
      return (freq - minFreq) / (maxFreq - minFreq);
    case 1: // Log
      return (Math.log(freq) - Math.log(minFreq)) / (Math.log(maxFreq) - Math.log(minFreq));
    case 2: // Mel
      return (hzToMel(freq) - hzToMel(minFreq)) / (hzToMel(maxFreq) - hzToMel(minFreq));
    default:
      return (freq - minFreq) / (maxFreq - minFreq);
  }
}

function hzToMel(hz) {
  return 2595 * Math.log10(1 + hz / 700);
}

/**
 * Format frequency for display
 */
function formatFreq(freq) {
  if (freq >= 1000) {
    return (freq / 1000).toFixed(1) + 'k';
  }
  return freq.toFixed(0);
}
