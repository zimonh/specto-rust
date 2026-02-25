/**
 * Audio playback controls
 */

import { state, getTotalDuration } from './state.js';

/**
 * Initialize audio context
 */
export function initAudioContext() {
  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return state.audioContext;
}

/**
 * Play audio from current viewport time
 */
export function playAudio() {
  if (!state.audioBuffer || !state.audioContext) {
    console.warn('[playback] No audio loaded');
    return;
  }

  stopAudio(); // Stop any existing playback

  const ctx = state.audioContext;
  const source = ctx.createBufferSource();
  source.buffer = state.audioBuffer;
  source.connect(ctx.destination);

  const startTime = state.playbackPausedAt || state.viewport.timeStart;
  source.start(0, startTime);

  state.audioSource = source;
  state.playbackStartTime = ctx.currentTime - startTime;
  state.isPlaying = true;

  // Auto-stop at end
  source.onended = () => {
    state.isPlaying = false;
    state.playbackPausedAt = 0;
  };

  console.log('[playback] Playing from', startTime.toFixed(2), 's');
}

/**
 * Pause audio
 */
export function pauseAudio() {
  if (!state.isPlaying || !state.audioSource || !state.audioContext) return;

  const currentTime = state.audioContext.currentTime - state.playbackStartTime;
  state.playbackPausedAt = currentTime;

  state.audioSource.stop();
  state.audioSource = null;
  state.isPlaying = false;

  console.log('[playback] Paused at', currentTime.toFixed(2), 's');
}

/**
 * Stop audio
 */
export function stopAudio() {
  if (state.audioSource) {
    try {
      state.audioSource.stop();
    } catch (e) {
      // Ignore if already stopped
    }
    state.audioSource = null;
  }
  state.isPlaying = false;
  state.playbackPausedAt = 0;
}

/**
 * Toggle play/pause
 */
export function togglePlayback() {
  if (state.isPlaying) {
    pauseAudio();
  } else {
    playAudio();
  }
}

/**
 * Seek to time
 */
export function seekTo(time) {
  const wasPlaying = state.isPlaying;

  if (wasPlaying) {
    stopAudio();
  }

  state.playbackPausedAt = Math.max(0, Math.min(time, getTotalDuration()));

  if (wasPlaying) {
    playAudio();
  }
}

/**
 * Get current playback time
 */
export function getCurrentTime() {
  if (!state.audioContext) return 0;

  if (state.isPlaying) {
    return state.audioContext.currentTime - state.playbackStartTime;
  }

  return state.playbackPausedAt;
}
