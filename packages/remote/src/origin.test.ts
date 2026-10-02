import { expect, it } from "vitest";
import { publicOrigin, secureControl, trustedOrigin } from "./origin";

it("accepts only an exact HTTPS proxy origin without credentials or path", () => {
  expect(publicOrigin("https://capsule.example/")).toBe("https://capsule.example");
  for (const url of ["http://capsule.example", "https://user:secret@capsule.example", "https://capsule.example/path", "https://capsule.example/?token=x"]) expect(() => publicOrigin(url)).toThrow();
});
it("checks the socket address, not caller-supplied forwarding headers", () => {
  expect(secureControl("https://capsule.example", "http://127.0.0.1:5000", "https://capsule.example", "127.0.0.1")).toBe(true);
  expect(secureControl("https://capsule.example", "http://127.0.0.1:5000", "https://capsule.example", "192.168.1.5")).toBe(false);
  expect(secureControl(undefined, "http://127.0.0.1:5000", undefined, "127.0.0.1")).toBe(false);
  expect(trustedOrigin("https://capsule.example.evil.test", "http://127.0.0.1:5000", "https://capsule.example")).toBe(false);
});
