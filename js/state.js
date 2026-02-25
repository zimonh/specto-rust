/**
 * Application state management
 * Central store for all spectrogram state
 */

export const state = {
  // Audio data
  spectrogramId: null,
  spectrogramInfo: null,
  audioBuffer: null,
  audioFileName: '',

  // Playback
  audioContext: null,
  audioSource: null,
  playbackStartTime: 0,
  playbackPausedAt: 0,
  isPlaying: false,

  // Viewport state
  viewport: {
    timeStart: 0,
    timeEnd: 10,
    scrollX: 0,
    scrollY: 0,
    canvasWidth: 1000,
    canvasHeight: 1000,
  },

  // Zoom/pan state
  zoom: {
    dragActive: false,
    anchorX: 0,
    anchorTimeStart: 0,
    anchorTimeEnd: 0,
  },

  // UI state
  ui: {
    gridEnabled: true,
    labelsEnabled: true,
    timeZoom: 1.0,
    resizeDebounceActive: false,
    interacted: false,
  },

  // Render parameters (overridable from UI)
  renderParams: {},

  // Multiband manager
  multiBandManager: null,

  // Tile cache
  tileCache: null,
};

/**
 * Get computed viewport width in time units
 */
export function getViewportDuration() {
  return state.viewport.timeEnd - state.viewport.timeStart;
}

/**
 * Get total spectrogram duration
 */
export function getTotalDuration() {
  return state.spectrogramInfo ? state.spectrogramInfo[0] : 0;
}

/**
 * Get sample rate
 */
export function getSampleRate() {
  return state.spectrogramInfo ? state.spectrogramInfo[1] : 48000;
}

/**
 * Get number of windows
 */
export function getNumWindows() {
  return state.spectrogramInfo ? state.spectrogramInfo[2] : 0;
}

/**
 * Reset state (for cleanup)
 */
export function resetState() {
  if (state.audioSource) {
    state.audioSource.stop();
    state.audioSource = null;
  }
  state.isPlaying = false;
  state.playbackStartTime = 0;
  state.playbackPausedAt = 0;
}
