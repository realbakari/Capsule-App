import { describe, expect, it } from "vitest";
import {
  BROWSER_DEVICES,
  browserDevice,
  browserDeviceLabel,
  cssSelectorFor,
  elementToMarkdown,
  type SelectorNode,
} from "./browser-inspect.js";

interface FakeNode extends SelectorNode {
  children: FakeNode[];
  parentElement: FakeNode | null;
}

function el(tagName: string, attrs: { id?: string; classes?: string[] } = {}, children: FakeNode[] = []): FakeNode {
  const node: FakeNode = { tagName: tagName.toUpperCase(), id: attrs.id ?? "", classList: attrs.classes ?? [], parentElement: null, children };
  for (const child of children) child.parentElement = node;
  return node;
}

/* A tiny matcher for the selector forms cssSelectorFor emits, so the test sees what a browser would count. */
function counter(root: FakeNode) {
  const all: FakeNode[] = [];
  const walk = (node: FakeNode) => { all.push(node); node.children.forEach(walk); };
  walk(root);
  const matchStep = (node: FakeNode, step: string): boolean => {
    if (step.startsWith("#")) return node.id === step.slice(1);
    const [, tag, classes = "", nth] = /^([a-z0-9]+)((?:\.[\w-]+)*)(?::nth-of-type\((\d+)\))?$/.exec(step) ?? [];
    if (!tag || node.tagName.toLowerCase() !== tag) return false;
    if (classes && !classes.slice(1).split(".").every((name) => Array.from(node.classList).includes(name))) return false;
    if (nth) {
      const same = node.parentElement ? node.parentElement.children.filter((item) => item.tagName === node.tagName) : [node];
      return same.indexOf(node) + 1 === Number(nth);
    }
    return true;
  };
  const matches = (node: FakeNode, steps: string[]): boolean => {
    if (!matchStep(node, steps.at(-1)!)) return false;
    if (steps.length === 1) return true;
    return Boolean(node.parentElement && matches(node.parentElement, steps.slice(0, -1)));
  };
  return (selector: string) => all.filter((node) => matches(node, selector.split(" > "))).length;
}

const identity = (value: string) => value;

describe("cssSelectorFor", () => {
  it("uses a unique id", () => {
    const target = el("button", { id: "save" });
    const root = el("html", {}, [el("body", {}, [target])]);
    expect(cssSelectorFor(target, counter(root), identity)).toBe("#save");
  });

  it("uses tag and classes when they are unique", () => {
    const target = el("button", { classes: ["primary", "large", "extra"] });
    const root = el("html", {}, [el("body", {}, [el("button", { classes: ["secondary"] }), target])]);
    expect(cssSelectorFor(target, counter(root), identity)).toBe("button.primary.large");
  });

  it("walks up to the nearest ancestor with a unique id", () => {
    const target = el("li");
    const root = el("html", {}, [el("body", {}, [el("ul", { id: "menu" }, [el("li"), target]), el("ul", {}, [el("li"), el("li")])])]);
    const selector = cssSelectorFor(target, counter(root), identity);
    expect(selector).toBe("#menu > li:nth-of-type(2)");
    expect(counter(root)(selector)).toBe(1);
  });

  it("falls back to a full path that matches exactly one element", () => {
    const target = el("span");
    const root = el("html", {}, [el("body", {}, [el("div", {}, [el("span")]), el("div", {}, [el("p"), target])])]);
    const selector = cssSelectorFor(target, counter(root), identity);
    expect(selector).toBe("html > body > div:nth-of-type(2) > span");
    expect(counter(root)(selector)).toBe(1);
  });

  it("ignores a duplicated id and class names a selector cannot hold", () => {
    const target = el("div", { id: "dup", classes: ["1bad", "w-[10px]"] });
    const root = el("html", {}, [el("body", {}, [el("div", { id: "dup" }), target])]);
    expect(cssSelectorFor(target, counter(root), identity)).toBe("html > body > div:nth-of-type(2)");
  });

  it("survives a selector the page refuses to count", () => {
    const target = el("a", { id: "x" });
    const root = el("html", {}, [el("body", {}, [target])]);
    const count = (selector: string) => { if (selector === "#x") throw new Error("bad"); return counter(root)(selector); };
    expect(cssSelectorFor(target, count, identity)).toBe("html > body > a");
  });

  it("stays self-contained so the picker can inline its source", () => {
    const rebuilt = new Function(`return (${cssSelectorFor.toString()})`)() as typeof cssSelectorFor;
    const target = el("button", { id: "go" });
    expect(rebuilt(target, counter(el("html", {}, [target])), identity)).toBe("#go");
  });
});

describe("browser devices", () => {
  it("offers Responsive, iPhone, iPad and Desktop", () => {
    expect(BROWSER_DEVICES.map((device) => device.id)).toEqual(["responsive", "iphone", "ipad", "desktop"]);
  });

  it("gives every fixed device a size and pixel ratio, and leaves Responsive to the panel", () => {
    for (const device of BROWSER_DEVICES.filter((item) => item.id !== "responsive")) {
      expect(device.width! > 0 && device.height! > 0 && device.scale! >= 1, device.id).toBe(true);
    }
    expect(browserDevice("responsive")?.width).toBeUndefined();
    expect(browserDevice("responsive")?.scale).toBeUndefined();
    expect(browserDevice("iphone")?.mobile).toBe(true);
    expect(browserDevice("desktop")?.mobile).toBe(false);
    expect(browserDevice("watch")).toBeUndefined();
  });

  it("labels the current size", () => {
    expect(browserDeviceLabel(browserDevice("iphone")!)).toBe("iPhone · 393 × 852 @3x");
    expect(browserDeviceLabel(browserDevice("responsive")!, { width: 612.4, height: 780 })).toBe("Responsive · 612 × 780");
    expect(browserDeviceLabel(browserDevice("responsive")!)).toBe("Responsive");
  });
});

describe("elementToMarkdown", () => {
  it("names the selector, keeps set styles and fences the HTML", () => {
    const text = elementToMarkdown({
      url: "http://localhost:3000/", title: "Home", selector: "#save", tag: "button",
      html: "<button id=\"save\">Save ```</button>", htmlTruncated: true,
      styles: { display: "flex", "box-shadow": "none", color: "rgb(0, 0, 0)" },
      rect: { x: 0, y: 0, width: 80.4, height: 32 },
    });
    expect(text).toContain("# Page element: #save");
    expect(text).toContain("Page: Home (http://localhost:3000/)");
    expect(text).toContain("- display: flex");
    expect(text).not.toContain("box-shadow");
    expect(text).toContain("## HTML (truncated)");
    expect(text).toContain("````html");
    expect(text).toContain("Size: 80 × 32 CSS px");
  });
});
