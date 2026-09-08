import { describe, expect, it } from 'vitest';

import { boxMoved, captureBox, CssBoxRange } from './capture-box';

describe('captureBox', () => {
  describe('negative cases', () => {
    it('refuses anything unparseable rather than falling back to a box nobody asked for', () => {
      expect(captureBox(new URLSearchParams('box=360'))).toBeNull();
      expect(captureBox(new URLSearchParams('box=360*640'))).toBeNull();
      expect(captureBox(new URLSearchParams('box=wide'))).toBeNull();
      expect(captureBox(new URLSearchParams('box='))).toBeNull();
    });

    it('refuses a box no phone lays out, either way', () => {
      expect(captureBox(new URLSearchParams('box=0x0'))).toBeNull();
      expect(captureBox(new URLSearchParams('box=1x600'))).toBeNull();
      expect(captureBox(new URLSearchParams('box=9000x600'))).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('is absent when nothing is asked for, which is what an operator gets', () => {
      expect(captureBox(new URLSearchParams(''))).toBeNull();
    });

    it('reads the box a filed row will name', () => {
      expect(captureBox(new URLSearchParams('box=360x320'))).toEqual({ height: 320, width: 360 });
      expect(captureBox(new URLSearchParams('surface=720x640&box=360x320'))).toEqual({ height: 320, width: 360 });
    });
  });
});

describe('CssBoxRange', () => {
  describe('negative cases', () => {
    it('carries zeros before layout rather than a size it invented', () => {
      const range = new CssBoxRange();

      expect(range.extremes()).toEqual({ heightMax: 0, heightMin: 0, widthMax: 0, widthMin: 0 });
      expect(boxMoved(range.extremes())).toBe(false);
    });

    it('ignores the observer firing at 0 — a zero minimum would report a collapse on every capture', () => {
      const range = new CssBoxRange();
      range.note(0, 0);
      range.note(360, 320);
      range.note(0, 320);

      expect(range.extremes()).toEqual({ heightMax: 320, heightMin: 320, widthMax: 360, widthMin: 360 });
      expect(boxMoved(range.extremes())).toBe(false);
    });

    it('says the window mixed two boxes when the chrome collapsed and came back', () => {
      const range = new CssBoxRange();
      range.note(360, 320);
      range.note(360, 609);
      range.note(360, 320);

      expect(range.extremes()).toEqual({ heightMax: 609, heightMin: 320, widthMax: 360, widthMin: 360 });
      expect(boxMoved(range.extremes())).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('holds one box as one box, however many times the observer fires', () => {
      const range = new CssBoxRange();
      range.note(360, 320);
      range.note(360, 320);

      expect(boxMoved(range.extremes())).toBe(false);
    });

    it('tracks both axes independently — a rotation moves one and not the other', () => {
      const range = new CssBoxRange();
      range.note(360, 640);
      range.note(740, 360);

      expect(range.extremes()).toEqual({ heightMax: 640, heightMin: 360, widthMax: 740, widthMin: 360 });
    });
  });
});
