import { describe, it, expect } from 'vitest';
import { MAX_STAGE_ZOOM, STAGE_NAMES_ZOOM, wheelZoom, zoomStep } from './stageZoom';

// #956: the zoom of the picture in the marks dialog.

describe('the steps of the picture zoom', () => {
  it('goes up level by level to the most, and down to the fitted picture', () => {
    const up: number[] = [1];
    while (up[up.length - 1]! < MAX_STAGE_ZOOM) up.push(zoomStep(up[up.length - 1]!, 1));
    expect(up).toEqual([1, 1.5, 2, 3, 4, 6, 8]);
    expect(zoomStep(MAX_STAGE_ZOOM, 1)).toBe(MAX_STAGE_ZOOM);
    const down: number[] = [MAX_STAGE_ZOOM];
    while (down[down.length - 1]! > 1) down.push(zoomStep(down[down.length - 1]!, -1));
    expect(down).toEqual([8, 6, 4, 3, 2, 1.5, 1]);
    expect(zoomStep(1, -1)).toBe(1);
  });

  it('finds the next level from a zoom between two, as the wheel leaves it', () => {
    expect(zoomStep(2.4, 1)).toBe(3);
    expect(zoomStep(2.4, -1)).toBe(2);
  });

  it('names every point of a dense map from the third level up', () => {
    expect(STAGE_NAMES_ZOOM).toBe(3);
    expect(zoomStep(2, 1)).toBe(STAGE_NAMES_ZOOM);
  });
});

describe('the wheel zoom', () => {
  it('grows when the wheel goes up, shrinks when it goes down, and is capped for a mouse notch', () => {
    expect(wheelZoom(-10)).toBeGreaterThan(1);
    expect(wheelZoom(10)).toBeLessThan(1);
    expect(wheelZoom(0)).toBe(1);
    expect(wheelZoom(-100)).toBeCloseTo(wheelZoom(-30), 10);
    expect(wheelZoom(-30)).toBeLessThan(1.4);
  });
});
