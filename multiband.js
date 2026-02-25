// Dynamic Multi-Band FFT Management
export class MultiBandManager {
  constructor() {
    this.bands = [];
    this.hopSize = 512;
    this.container = document.getElementById('bandsContainer');
    this.addButton = document.getElementById('addBand');
    this.onChangeCallback = null;

    this.init();
  }

  setHopSize(hopSize) {
    this.hopSize = hopSize;
  }

  init() {
    // Initialize with default 3-band configuration
    // fftMultiplier: low=32 (→16384), mid=8 (→4096), high=4 (→2048) at hop=512
    this.addBand(20, 80, 32, 1.0, 4);
    this.addBand(80, 350, 8, 1.0, 2);
    this.addBand(350, 24000, 4, 1.0, 1);

    // Add button click handler
    if (this.addButton) {
      this.addButton.addEventListener('click', () => {
        const lastBand = this.bands[this.bands.length - 1];
        const newMin = lastBand ? lastBand.max : 0;
        const newMax = Math.min(newMin + 1000, 22000);
        this.addBand(newMin, newMax, 4, 1.0, 1);
      });
    }
  }

  addBand(minFreq = 0, maxFreq = 1000, fftMultiplier = 4, gain = 1.0, hopMultiplier = 1) {
    const bandIndex = this.bands.length;
    const band = {
      index: bandIndex,
      min: minFreq,
      max: maxFreq,
      fftMultiplier: fftMultiplier,
      gain: gain,
      hopMultiplier: hopMultiplier,
      element: null,
    };

    // Create band UI
    const bandDiv = document.createElement('div');
    bandDiv.className = 'band-item';
    bandDiv.id = `band-${bandIndex}`;

    bandDiv.innerHTML = `
      <div class="band-header">
        <h4>Band ${bandIndex + 1}</h4>
        ${bandIndex >= 1 ? `<button class="btn-remove" data-index="${bandIndex}">Remove</button>` : ''}
      </div>
      <div class="band-controls">
        <div class="band-control">
          <label>
            Min Frequency: <span id="band${bandIndex}-min-value">${minFreq}</span> Hz
          </label>
          <input
            type="range"
            id="band${bandIndex}-min"
            min="0"
            max="22000"
            step="5"
            value="${minFreq}"
            class="w-full"
            ${bandIndex > 0 ? 'disabled' : ''}
          />
          <input
    type="number"
    id="band${bandIndex}-min-input"
    min="0"
    max="22000"
    step="1"
    value="${minFreq}"
    class="w-full mt-1"
    ${bandIndex > 0 ? 'disabled' : ''}
  />
        </div>
        <div class="band-control">
          <label>
            Max Frequency: <span id="band${bandIndex}-max-value">${maxFreq}</span> Hz
          </label>
          <input
            type="range"
            id="band${bandIndex}-max"
            min="0"
            max="22000"
            step="5"
            value="${maxFreq}"
            class="w-full"
          />
  <input
    type="number"
    id="band${bandIndex}-max-input"
    min="0"
    max="22000"
    step="1"
    value="${maxFreq}"
    class="w-full mt-1"
  />
        </div>
        <div class="band-control">
          <label>
            FFT Multiplier: <span id="band${bandIndex}-fft-value">${fftMultiplier}</span>×
            <span class="text-xs text-gray-400">(FFT size: <span id="band${bandIndex}-fft-size-display">${fftMultiplier}</span>)</span>
          </label>
          <input
            type="number"
            id="band${bandIndex}-fft"
            min="1"
            step="1"
            value="${fftMultiplier}"
            class="w-full"
          />
          <div class="help-text">Higher = better frequency resolution (FFT size = hop × multiplier)</div>
        </div>
        <div class="band-control">
          <label>
            Gain (Brightness): <span id="band${bandIndex}-gain-value">${gain.toFixed(2)}</span>
          </label>
          <input
            type="range"
            id="band${bandIndex}-gain"
            min="0"
            max="3"
            step="0.1"
            value="${gain}"
            class="w-full"
          />
          <div class="help-text">Adjust brightness for this frequency range</div>
        </div>
        <div class="band-control">
          <label>
            Hop Multiplier: <span id="band${bandIndex}-hop-value">${hopMultiplier}</span>
          </label>
          <input
            type="number"
            id="band${bandIndex}-hop"
            min="1"
            step="1"
            value="${hopMultiplier}"
            class="w-full"
          />
          <div class="help-text">Compute FFT every Nth column (higher = faster, less time resolution)</div>
        </div>
      </div>
    `;

    band.element = bandDiv;
    this.container.appendChild(bandDiv);
    this.bands.push(band);

    // Wire up event listeners
    this.wireUpBand(band);

    // Update linked ranges
    this.updateLinkedRanges();

    return band;
  }

  updateFftSizeDisplay(band) {
    const display = document.getElementById(`band${band.index}-fft-size-display`);
    if (display) {
      display.textContent = Math.round(this.hopSize * band.fftMultiplier);
    }
  }

  wireUpBand(band) {
    const i = band.index;

    // Min frequency
    const minSlider = document.getElementById(`band${i}-min`);
    const minValue = document.getElementById(`band${i}-min-value`);
    if (minSlider && minValue) {
      minSlider.addEventListener('input', () => {
        band.min = parseFloat(minSlider.value);
        minValue.textContent = band.min;
        this.updateLinkedRanges();
        this.triggerChange();
      });
    }

    // Max frequency
    const maxSlider = document.getElementById(`band${i}-max`);
    const maxValue = document.getElementById(`band${i}-max-value`);
    if (maxSlider && maxValue) {
      maxSlider.addEventListener('input', () => {
        band.max = parseFloat(maxSlider.value);
        maxValue.textContent = band.max;
        this.updateLinkedRanges();
        this.triggerChange();
      });
    }

    // FFT Multiplier
    const fftInput = document.getElementById(`band${i}-fft`);
    const fftValue = document.getElementById(`band${i}-fft-value`);
    if (fftInput && fftValue) {
      fftInput.addEventListener('input', () => {
        band.fftMultiplier = Math.max(1, parseInt(fftInput.value) || 1);
        fftInput.value = band.fftMultiplier;
        fftValue.textContent = band.fftMultiplier;
        this.updateFftSizeDisplay(band);
        this.triggerChange();
      });
    }

    // Gain
    const gainSlider = document.getElementById(`band${i}-gain`);
    const gainValue = document.getElementById(`band${i}-gain-value`);
    if (gainSlider && gainValue) {
      gainSlider.addEventListener('input', () => {
        band.gain = parseFloat(gainSlider.value);
        gainValue.textContent = band.gain.toFixed(2);
        this.triggerChange();
      });
    }

    // Hop Multiplier
    const hopInput = document.getElementById(`band${i}-hop`);
    const hopValue = document.getElementById(`band${i}-hop-value`);
    if (hopInput && hopValue) {
      hopInput.addEventListener('input', () => {
        band.hopMultiplier = Math.max(1, parseInt(hopInput.value) || 1);
        hopInput.value = band.hopMultiplier;
        hopValue.textContent = band.hopMultiplier;
        this.triggerChange();
      });
    }

    // Remove button
    const removeBtn = band.element.querySelector('.btn-remove');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        this.removeBand(band.index);
      });
    }

    // Update fft size display with current hop size
    this.updateFftSizeDisplay(band);
  }

  removeBand(index) {
    const bandIndex = this.bands.findIndex((b) => b.index === index);
    if (bandIndex === -1 || this.bands.length <= 1) return;

    const band = this.bands[bandIndex];
    band.element.remove();
    this.bands.splice(bandIndex, 1);

    this.updateLinkedRanges();
    this.triggerChange();
  }

  updateLinkedRanges() {
    // Link min of band N+1 to max of band N
    for (let i = 0; i < this.bands.length - 1; i++) {
      const currentBand = this.bands[i];
      const nextBand = this.bands[i + 1];

      nextBand.min = currentBand.max;

      const nextMinSlider = document.getElementById(`band${nextBand.index}-min`);
      const nextMinValue = document.getElementById(`band${nextBand.index}-min-value`);

      if (nextMinSlider) {
        nextMinSlider.value = nextBand.min;
        nextMinSlider.disabled = true;
      }
      if (nextMinValue) {
        nextMinValue.textContent = nextBand.min;
      }
    }
  }

  getMaxFftMultiplier() {
    return this.bands.reduce((m, b) => Math.max(m, b.fftMultiplier), 1);
  }

  getBandsArray() {
    // Returns flat array: [min1, max1, fftSize1, gain1, hop1, ...]
    // fftSize = hopSize * fftMultiplier
    const result = [];
    for (const band of this.bands) {
      const fftSize = Math.round(this.hopSize * band.fftMultiplier);
      result.push(band.min, band.max, fftSize, band.gain, band.hopMultiplier);
    }
    return result;
  }

  onChange(callback) {
    this.onChangeCallback = callback;
  }

  triggerChange() {
    if (this.onChangeCallback) {
      this.onChangeCallback({
        bands: this.bands,
        bandsArray: this.getBandsArray(),
      });
    }
  }

  // For presets
  setBands(bandsArray) {
    while (this.bands.length > 0) {
      const band = this.bands[0];
      band.element.remove();
      this.bands.shift();
    }

    // Support legacy fftSize format (5-value with absolute fftSize) by converting to multiplier
    const stride = bandsArray.length % 5 === 0 ? 5 : 4;
    for (let i = 0; i < bandsArray.length; i += stride) {
      const min = bandsArray[i] || 0;
      const max = bandsArray[i + 1] || 1000;
      const fftSizeOrMult = bandsArray[i + 2] || 4;
      const gain = bandsArray[i + 3] || 1.0;
      const hop = stride === 5 ? (bandsArray[i + 4] || 1) : 1;
      // If value looks like an absolute fft size (>100), convert to multiplier
      const fftMult = fftSizeOrMult > 100
        ? Math.max(1, Math.round(fftSizeOrMult / this.hopSize))
        : fftSizeOrMult;
      this.addBand(min, max, fftMult, gain, hop);
    }
  }

  // Export config for presets
  exportConfig() {
    return {
      bands: this.bands.map((b) => ({
        min: b.min,
        max: b.max,
        fftMultiplier: b.fftMultiplier,
        gain: b.gain,
        hopMultiplier: b.hopMultiplier,
      })),
    };
  }

  // Import config from presets
  importConfig(config) {
    if (!config) return;

    if (config.bands && Array.isArray(config.bands)) {
      while (this.bands.length > 0) {
        const band = this.bands[0];
        band.element.remove();
        this.bands.shift();
      }

      for (const bandConfig of config.bands) {
        // Support legacy fftSize field by converting to multiplier
        let fftMult = bandConfig.fftMultiplier;
        if (fftMult === undefined && bandConfig.fftSize !== undefined) {
          fftMult = Math.max(1, Math.round(bandConfig.fftSize / this.hopSize));
        }
        this.addBand(
          bandConfig.min || 0,
          bandConfig.max || 1000,
          fftMult || 4,
          bandConfig.gain || 1.0,
          bandConfig.hopMultiplier || 1
        );
      }
    }
  }
}
