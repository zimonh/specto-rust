/* tslint:disable */
/* eslint-disable */
/**
 * Exposed function to cancel any ongoing fractal generation.
 */
export function cancel_generation(): void;
/**
 * Load audio data from MP3 bytes and create a sonogram renderer
 * Returns a unique ID for this sonogram
 */
export function load_audio_mp3(data: Uint8Array, fft_size: number, hop_size: number): number;
/**
 * Load audio data from bytes with an optional file extension hint.
 * Pass an empty string for `ext` to auto-detect.
 * Supports formats enabled in Cargo features (e.g., MP3, WAV, AIFF, OGG/Vorbis, FLAC, AAC/M4A).
 */
export function load_audio_bytes(data: Uint8Array, ext: string, fft_size: number, hop_size: number): number;
/**
 * Load already-decoded mono PCM (f32) samples with a specified sample rate.
 * This is used as a browser-decoder fallback for formats the WASM decoder can't handle.
 */
export function load_audio_pcm_mono_f32(samples: Float32Array, sample_rate: number, fft_size: number, hop_size: number): number;
/**
 * Get info about loaded sonogram
 */
export function get_spectrogram_info(id: number): Float64Array;
/**
 * Update FFT/hop parameters for an existing spectrogram without reloading audio.
 */
export function update_spectrogram_params(id: number, fft_size: number, hop_size: number): void;
/**
 * Set the desaturation amount (0.0 = full color, 1.0 = grayscale) for a spectrogram.
 */
export function set_desaturation_amount(id: number, amount: number): void;
/**
 * Store a flat multiband config array on the renderer (5 floats per band: min_hz, max_hz, fft_mult, gain, hop).
 */
export function set_multiband_config(id: number, bands: Float32Array): void;
/**
 * Retrieve the stored multiband config array for a spectrogram.
 */
export function get_multiband_config(id: number): Float32Array;
/**
 * Set hue offset (degrees) for the Circle-of-Fifths color scheme.
 */
export function set_fifths_hue_offset(id: number, degrees: number): void;
/**
 * Render a viewport of the sonogram
 * viewport_start: starting time window index
 * viewport_width: number of time windows to render (width in pixels)
 * height: height in pixels
 * min_freq_hz / max_freq_hz: frequency range
 * scale_mode: 0=Linear,1=Log,2=Mel,3=Bark,4=ERB,5=Period
 * gain_db / range_db: Audacity-like dB mapping (white at -gain, black at -gain-range)
 * freq_gain_db_per_dec: frequency pre-emphasis above 1 kHz (dB/dec)
 * window_type: 0=Hann,1=Hamming,2=Blackman,3=Rect,4=Blackman-Harris
 * zero_pad_factor: vertical interpolation factor (1=no padding)
 * color_scheme: 0=viridis, 1=hot, 2=grayscale, 3=spectral
 */
export function render_spectrogram_viewport(id: number, viewport_start: number, viewport_width: number, height: number, min_freq_hz: number, max_freq_hz: number, scale_mode: number, gain_db: number, range_db: number, freq_gain_db_per_dec: number, window_type: number, zero_pad_factor: number, color_scheme: number, bass_sharp: number): Uint8Array;
/**
 * Get top-K chord candidates for a given sonogram and window index.
 * Returns a flat array: [label_len, bytes..., score_f32, label_len, bytes..., score_f32, ...]
 */
export function get_chords(id: number, window_idx: number, window_type: number, zero_pad_factor: number, top_k: number): Uint8Array;
/**
 * Unload a sonogram from memory
 */
export function unload_spectrogram(id: number): void;
/**
 * Generates a fractal image as a flat vector of u8 pixels.
 *
 * Fractal type mapping:
 * - 0: Mandelbrot  
 * - 1: Julia  
 * - 2: Burning Ship  
 * - 3: Newton  
 * - 4: Multibrot  
 * - 5: Dynamic Exponent Fractal  
 * - 6: Phoenix
 */
export function generate_fractal(fractal_type: number, width: number, height: number, zoom: number, offset_x: number, offset_y: number, max_iter: number, julia_re: number, julia_im: number, color_value: number, fun_value: number, color_scheme: number, multibrot_exponent: number, phoenix_factor: number): Uint8Array;
export function initThreadPool(num_threads: number): Promise<any>;
export function wbg_rayon_start_worker(receiver: number): void;
export class wbg_rayon_PoolBuilder {
  private constructor();
  free(): void;
  mainJS(): string;
  numThreads(): number;
  receiver(): number;
  build(): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly cancel_generation: () => void;
  readonly load_audio_mp3: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly load_audio_bytes: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
  readonly load_audio_pcm_mono_f32: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
  readonly get_spectrogram_info: (a: number) => [number, number, number, number];
  readonly update_spectrogram_params: (a: number, b: number, c: number) => [number, number];
  readonly set_desaturation_amount: (a: number, b: number) => [number, number];
  readonly set_multiband_config: (a: number, b: number, c: number) => [number, number];
  readonly get_multiband_config: (a: number) => [number, number, number, number];
  readonly set_fifths_hue_offset: (a: number, b: number) => [number, number];
  readonly render_spectrogram_viewport: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => [number, number, number, number];
  readonly get_chords: (a: number, b: number, c: number, d: number, e: number) => [number, number];
  readonly unload_spectrogram: (a: number) => [number, number];
  readonly generate_fractal: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => [number, number];
  readonly __wbg_wbg_rayon_poolbuilder_free: (a: number, b: number) => void;
  readonly wbg_rayon_poolbuilder_mainJS: (a: number) => any;
  readonly wbg_rayon_poolbuilder_numThreads: (a: number) => number;
  readonly wbg_rayon_poolbuilder_receiver: (a: number) => number;
  readonly wbg_rayon_poolbuilder_build: (a: number) => void;
  readonly initThreadPool: (a: number) => any;
  readonly wbg_rayon_start_worker: (a: number) => void;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_export_2: WebAssembly.Table;
  readonly memory: WebAssembly.Memory;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_thread_destroy: (a?: number, b?: number, c?: number) => void;
  readonly __wbindgen_start: (a: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number }} module - Passing `SyncInitInput` directly is deprecated.
* @param {WebAssembly.Memory} memory - Deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number } | SyncInitInput, memory?: WebAssembly.Memory): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory, thread_stack_size?: number }} module_or_path - Passing `InitInput` directly is deprecated.
* @param {WebAssembly.Memory} memory - Deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory, thread_stack_size?: number } | InitInput | Promise<InitInput>, memory?: WebAssembly.Memory): Promise<InitOutput>;
