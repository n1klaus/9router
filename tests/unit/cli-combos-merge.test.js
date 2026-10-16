import { describe, it, expect } from "vitest";
import { mergeRenameCarry } from "../../cli/src/cli/menus/combos.js";

describe("mergeRenameCarry", () => {
  it("returns override unchanged when target is undefined", () => {
    const override = { a: 1 };
    expect(mergeRenameCarry(override, undefined)).toBe(override);
  });

  it("returns override unchanged when target is a string", () => {
    const override = { a: 1 };
    expect(mergeRenameCarry(override, "x")).toBe(override);
  });

  it("returns override unchanged when target is an array", () => {
    const override = { a: 1 };
    const target = [1, 2];
    expect(mergeRenameCarry(override, target)).toBe(override);
  });

  it("returns override unchanged when target is null", () => {
    const override = { a: 1 };
    expect(mergeRenameCarry(override, null)).toBe(override);
  });

  it("lets target keys win on overlap", () => {
    expect(mergeRenameCarry({ a: 1, b: 1 }, { b: 2, c: 3 })).toEqual({
      a: 1,
      b: 2,
      c: 3,
    });
  });

  it("unions disjoint keys", () => {
    expect(mergeRenameCarry({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it("does not mutate either input", () => {
    const override = { a: 1 };
    const target = { b: 2 };
    const overrideSnap = { ...override };
    const targetSnap = { ...target };
    const out = mergeRenameCarry(override, target);
    expect(override).toEqual(overrideSnap);
    expect(target).toEqual(targetSnap);
    expect(out).toEqual({ a: 1, b: 2 });
    expect(out).not.toBe(override);
    expect(out).not.toBe(target);
  });
});
