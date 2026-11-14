import { describe, expect, it } from "vitest";
import { favoriteOpenInApp, mergeOpenInApps, orderOpenInApps } from "./open-in.js";

describe("Open in list", () => {
  const system = [{ id: "/A.app", name: "A" }, { id: "/B.app", name: "B" }];

  it("drops removed system apps and does not repeat an added one the system reports", () => {
    const apps = mergeOpenInApps(system, [{ id: "/B.app", name: "B" }, { id: "/C.app", name: "C" }], ["/A.app"]);
    expect(apps.map((app) => [app.id, app.added])).toEqual([["/B.app", false], ["/C.app", true]]);
  });

  it("puts the favourite first and ignores a favourite that is gone", () => {
    const apps = mergeOpenInApps(system, [], []);
    expect(orderOpenInApps({ apps, favorite: "/B.app" }).map((app) => app.id)).toEqual(["/B.app", "/A.app"]);
    expect(favoriteOpenInApp({ apps, favorite: "/Gone.app" })).toBeUndefined();
  });
});
