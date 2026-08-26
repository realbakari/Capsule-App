import { describe, expect, it } from "vitest";
import {
  addFolderToProject,
  folderBasename,
  isAttachedFolder,
  makePrimaryFolder,
  projectFolderList,
  removeFolderFromProject,
} from "./folders.js";

describe("project folders", () => {
  it("lists the primary folder first and drops duplicate extras", () => {
    expect(
      projectFolderList({
        workingDirectory: "/Users/me/app/",
        extraFolders: ["/Users/me/docs", "/Users/me/app", "/Users/me/docs/"],
      }),
    ).toEqual(["/Users/me/app", "/Users/me/docs"]);
  });

  it("treats an attached folder as the primary when none exists yet", () => {
    expect(addFolderToProject({}, "/Users/me/site")).toEqual({
      workingDirectory: "/Users/me/site",
      extraFolders: [],
    });
  });

  it("keeps git/cwd on the primary when adding another folder", () => {
    expect(
      addFolderToProject({ workingDirectory: "/Users/me/app" }, "/Users/me/docs"),
    ).toEqual({
      workingDirectory: "/Users/me/app",
      extraFolders: ["/Users/me/docs"],
    });
  });

  it("promotes the next extra folder when the primary is removed", () => {
    expect(
      removeFolderFromProject(
        { workingDirectory: "/Users/me/app", extraFolders: ["/Users/me/docs"] },
        "/Users/me/app/",
      ),
    ).toEqual({
      workingDirectory: "/Users/me/docs",
      extraFolders: [],
    });
  });

  it("makes an extra folder the primary and demotes the previous one", () => {
    expect(
      makePrimaryFolder(
        { workingDirectory: "/Users/me/app", extraFolders: ["/Users/me/docs"] },
        "/Users/me/docs",
      ),
    ).toEqual({
      workingDirectory: "/Users/me/docs",
      extraFolders: ["/Users/me/app"],
    });
  });

  it("recognizes attached folders and names them", () => {
    const project = { workingDirectory: "/Users/me/Open Source/Capsule" };
    expect(isAttachedFolder(project, "/Users/me/Open Source/Capsule/")).toBe(true);
    expect(isAttachedFolder(project, "/tmp")).toBe(false);
    expect(folderBasename(project.workingDirectory)).toBe("Capsule");
  });
});
