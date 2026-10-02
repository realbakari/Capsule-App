import { expect, it } from "vitest";
import { floatingPlacement } from "./floating-placement";
it("flips a low control upward and keeps its surface within a narrow viewport", () => {
  expect(floatingPlacement({ top: 550, bottom: 580, left: 280, right: 310 }, { width: 400, height: 250 }, { width: 320, height: 600 }, { align: "right" }))
    .toEqual({ left: 8, top: 294, maxWidth: 304, maxHeight: 536 });
});
it("keeps a header menu below its trigger and clips its height to available space", () => {
  expect(floatingPlacement({ top: 10, bottom: 40, left: 20, right: 100 }, { width: 200, height: 900 }, { width: 800, height: 500 }))
    .toEqual({ left: 20, top: 46, maxWidth: 784, maxHeight: 446 });
});
