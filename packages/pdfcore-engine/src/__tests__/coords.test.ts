import { describe, it, expect } from "vitest";
import {
  rectToBox,
  boxToRect,
  screenToPdfPoint,
  pdfToScreenPoint,
  screenBoxToPdf,
  pdfBoxToScreen,
  pointInRect,
  type ViewTransform,
} from "../coords/index.js";

const t: ViewTransform = { page: { width: 612, height: 792 }, scale: 2 };

describe("coords — the one shared transform", () => {
  it("rect ↔ box round-trips", () => {
    const box = rectToBox([72, 680, 372, 698]);
    expect(box).toEqual({ x: 72, y: 680, w: 300, h: 18 });
    expect(boxToRect(box)).toEqual([72, 680, 372, 698]);
  });

  it("point screen ↔ pdf round-trips (y-flip + scale)", () => {
    const pdf = { x: 100, y: 700 };
    const screen = pdfToScreenPoint(pdf, t);
    // scale 2, page height 792: y = (792-700)*2 = 184
    expect(screen).toEqual({ x: 200, y: 184 });
    expect(screenToPdfPoint(screen, t)).toEqual(pdf);
  });

  it("box screen ↔ pdf round-trips", () => {
    const pdfBox = { x: 72, y: 680, w: 300, h: 18 };
    const screen = pdfBoxToScreen(pdfBox, t);
    expect(screenBoxToPdf(screen, t)).toEqual(pdfBox);
  });

  it("pointInRect hit-tests in PDF space", () => {
    expect(pointInRect({ x: 100, y: 690 }, [72, 680, 372, 698])).toBe(true);
    expect(pointInRect({ x: 400, y: 690 }, [72, 680, 372, 698])).toBe(false);
  });

  describe("rotation (/Rotate pages)", () => {
    const page = { width: 612, height: 792 };
    const pdf = { x: 100, y: 700 };

    it("maps points for each rotation the way pdf.js draws the canvas", () => {
      // The screen axes follow the page AS DRAWN (rotated clockwise), so a 90/270
      // rotation swaps which PDF axis maps to which screen axis.
      expect(pdfToScreenPoint(pdf, { page, scale: 1, rotation: 0 })).toEqual({
        x: 100,
        y: 92,
      });
      expect(pdfToScreenPoint(pdf, { page, scale: 1, rotation: 90 })).toEqual({
        x: 700,
        y: 100,
      });
      expect(pdfToScreenPoint(pdf, { page, scale: 1, rotation: 180 })).toEqual({
        x: 512,
        y: 700,
      });
      expect(pdfToScreenPoint(pdf, { page, scale: 1, rotation: 270 })).toEqual({
        x: 92,
        y: 512,
      });
    });

    it("point screen ↔ pdf round-trips at every rotation and scale", () => {
      for (const rotation of [0, 90, 180, 270] as const) {
        const tr = { page, scale: 2, rotation };
        const screen = pdfToScreenPoint(pdf, tr);
        expect(screenToPdfPoint(screen, tr)).toEqual(pdf);
      }
    });

    it("box screen ↔ pdf round-trips and swaps w/h at 90/270", () => {
      const pdfBox = { x: 72, y: 680, w: 300, h: 18 };
      const t90 = { page, scale: 1, rotation: 90 as const };
      const screen = pdfBoxToScreen(pdfBox, t90);
      // Under a 90° rotation the on-screen box is 18 wide × 300 tall.
      expect(screen.w).toBeCloseTo(18);
      expect(screen.h).toBeCloseTo(300);
      expect(screenBoxToPdf(screen, t90)).toEqual(pdfBox);
    });
  });
});
