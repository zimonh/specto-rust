/**
 * TileCache - Manages spectrogram tile caching with ghost tile support for smooth invalidation
 *
 * The cache maintains three layers:
 * 1. Active tiles: Current tiles ready for display
 * 2. Ghost tiles: Invalidated tiles that fade out when replaced
 * 3. Generation queue: FIFO queue of tiles waiting to be generated
 */

export class TileCache {
  constructor(maxSize = 256, tileWidth = 256) {
    this.maxSize = maxSize;
    this.tileWidth = tileWidth;

    // Main cache: key -> { canvas, params }
    this.activeTiles = new Map();

    // Ghost tiles: old tiles that fade out when new ones replace them
    // key -> { canvas, generatedAt, fadeOutUntil }
    this.ghostTiles = new Map();

    // Secondary index for O(1) ghost lookup by tile index (integer)
    // tileIndex -> ghost object (most recent ghost for that index)
    this.ghostByIndex = new Map();

    // Pending generation tracking
    this.pendingTiles = new Set(); // keys currently being generated
    this.queue = []; // FIFO: { tileIndex, key }
  }

  /**
   * Get a tile's unique key based on parameters and index
   */
  generateKey(paramHash, tileIndex) {
    return `${paramHash}|${tileIndex}`;
  }

  /**
   * Check if a tile is already cached (active or pending)
   */
  has(key) {
    return this.activeTiles.has(key) || this.pendingTiles.has(key);
  }

  /**
   * Get an active tile canvas
   */
  get(key) {
    const tile = this.activeTiles.get(key);
    if (tile) {
      // Refresh LRU: move to end
      this.activeTiles.delete(key);
      this.activeTiles.set(key, tile);
      return tile.canvas;
    }
    return null;
  }

  /**
   * Get a ghost tile (fading out old tile while new one renders)
   */
  getGhost(key) {
    const ghost = this.ghostTiles.get(key);
    return ghost ? ghost.canvas : null;
  }

  /**
   * Find a ghost tile by index (ignoring param hash)
   * Used during rendering when params have changed but we still want to fade old tiles
   */
  getGhostByIndex(tileIndex) {
    return this.ghostByIndex.get(tileIndex) || null;
  }

  /**
   * Find any cached tile for a given index (from either active or ghost cache)
   * Useful for fallback rendering during cache invalidation
   */
  findByIndex(tileIndex) {
    const suffix = `|${tileIndex}`;

    // Check active cache first (most up-to-date)
    for (const [key, tile] of this.activeTiles.entries()) {
      if (key.endsWith(suffix)) {
        return tile.canvas;
      }
    }

    // Fall back to ghosts
    for (const [key, ghost] of this.ghostTiles.entries()) {
      if (key.endsWith(suffix)) {
        return ghost.canvas;
      }
    }

    return null;
  }

  /**
   * Store a generated tile in the active cache
   * If a ghost tile exists with this key, mark it to start fading
   */
  set(key, canvas, paramHash) {
    const now = performance.now();

    this.activeTiles.set(key, {
      canvas,
      paramHash,
      generatedAt: now,
    });

    // If there's a ghost with the OLD params for this tile index,
    // mark it to start fading (300ms fade duration)
    const tileIndex = parseInt(key.split('|').pop(), 10);
    const ghostTile = this.getGhostByIndex(tileIndex);
    if (ghostTile) {
      ghostTile.fadeStartTime = now; // Start fading now that replacement arrived
      ghostTile.fadeOutAt = now + 300; // 300ms fade duration
    }

    // Remove from pending
    this.pendingTiles.delete(key);

    // Enforce LRU limit
    while (this.activeTiles.size > this.maxSize) {
      const firstKey = this.activeTiles.keys().next().value;
      this.activeTiles.delete(firstKey);
    }
  }

  /**
   * Enqueue a tile for generation
   */
  enqueue(tileIndex, key) {
    if (this.has(key)) return false;

    this.pendingTiles.add(key);
    this.queue.push({ tileIndex, key });
    return true;
  }

  /**
   * Get the next tile to generate (FIFO)
   */
  dequeue() {
    if (this.queue.length === 0) return null;
    return this.queue.shift();
  }

  /**
   * Check if there are pending tiles
   */
  hasPending() {
    return this.queue.length > 0;
  }

  /**
   * Get queue size
   */
  queueSize() {
    return this.queue.length;
  }

  /**
   * Invalidate the cache, moving active tiles to ghost cache for fade-out effect
   * Ghost tiles will be cleaned up when their replacement tiles are ready
   */
  invalidate() {
    // Drop any old ghosts that haven't been replaced yet — they're stale from a
    // previous invalidation and would accumulate unboundedly across repeated settings changes.
    for (const [key, ghost] of this.ghostTiles.entries()) {
      if (ghost.fadeStartTime === null) {
        const idx = parseInt(key.split('|').pop(), 10);
        this.ghostTiles.delete(key);
        this.ghostByIndex.delete(idx);
      }
    }

    // Move all active tiles to ghost cache
    // No fade timer - ghosts stay visible until replaced, then fade on replacement
    const now = performance.now();
    for (const [key, tile] of this.activeTiles.entries()) {
      const idx = parseInt(key.split('|').pop(), 10);
      const ghost = {
        canvas: tile.canvas,
        generatedAt: now,
        fadeOutAt: now + 300,
        fadeStartTime: null,
      };
      this.ghostTiles.set(key, ghost);
      this.ghostByIndex.set(idx, ghost);
    }

    // Clear active cache and queue
    this.activeTiles.clear();
    this.queue.length = 0;
    this.pendingTiles.clear();

    return this.ghostTiles.size;
  }

  /**
   * Clean up ghost tiles that have finished fading out
   * Only removes ghosts that have been replaced and finished fading
   * Returns count of removed ghosts
   */
  cleanupGhosts(now = performance.now()) {
    let removed = 0;
    for (const [key, ghost] of this.ghostTiles.entries()) {
      if (ghost.fadeStartTime && now >= ghost.fadeOutAt) {
        const idx = parseInt(key.split('|').pop(), 10);
        this.ghostTiles.delete(key);
        // Only remove from index if it still points to this ghost
        if (this.ghostByIndex.get(idx) === ghost) {
          this.ghostByIndex.delete(idx);
        }
        removed++;
      }
    }
    return removed;
  }

  /**
   * Get fade opacity for a ghost tile (0 = invisible, 1 = visible)
   * Ghost stays fully opaque until its replacement tile arrives, then fades over 300ms
   * Accepts either a ghost object directly or a key
   */
  getGhostOpacity(ghostOrKey, now = performance.now()) {
    let ghost;
    if (typeof ghostOrKey === 'string') {
      ghost = this.ghostTiles.get(ghostOrKey);
    } else {
      ghost = ghostOrKey;
    }
    if (!ghost) return 0;

    // If fadeStartTime is not set, the replacement hasn't arrived yet
    // Ghost should be fully visible (opacity 1)
    if (!ghost.fadeStartTime) {
      return 1;
    }

    // Replacement has arrived, fade from 1 to 0
    const elapsed = now - ghost.fadeStartTime;
    const duration = ghost.fadeOutAt - ghost.fadeStartTime;
    const progress = Math.min(1, elapsed / duration);
    return Math.max(0, 1 - progress);
  }

  /**
   * Clear all tiles (active and ghost)
   */
  clear() {
    this.activeTiles.clear();
    this.ghostTiles.clear();
    this.ghostByIndex.clear();
    this.queue.length = 0;
    this.pendingTiles.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      active: this.activeTiles.size,
      ghosts: this.ghostTiles.size,
      pending: this.pendingTiles.size,
      queuedForGeneration: this.queue.length,
      maxSize: this.maxSize,
    };
  }
}
