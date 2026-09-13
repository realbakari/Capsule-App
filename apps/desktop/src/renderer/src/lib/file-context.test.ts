import { expect, it } from "vitest";
import { fileMentionTarget, parentFolder } from "./file-context";

it.each([
  ["C:\\Work\\App\\src\\main.ts", "C:/Work/App/src"],
  ["C:\\note.txt", "C:/"],
  ["\\\\server\\share\\note.txt", "//server/share"],
  ["/work/app/src/main.ts", "/work/app/src"],
  ["/note.txt", "/"],
])("finds the parent of %s", (file, parent) => {
  expect(parentFolder(file)).toBe(parent);
});

it("makes Windows and Unix mentions relative only to their owning folder", () => {
  expect(fileMentionTarget("C:\\Work\\App", "c:\\work\\app\\src\\main.ts")).toBe("src/main.ts");
  expect(fileMentionTarget("C:\\Work\\App", "C:\\Work\\Application\\main.ts")).toBe("main.ts");
  expect(fileMentionTarget("/work/app", "/work/app/src/main.ts")).toBe("src/main.ts");
  expect(fileMentionTarget("/work/App", "/work/app/src/main.ts")).toBe("main.ts");
  expect(fileMentionTarget("/", "/work/note.txt")).toBe("work/note.txt");
  expect(fileMentionTarget("C:\\", "C:\\work\\note.txt")).toBe("work/note.txt");
});
