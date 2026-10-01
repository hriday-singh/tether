import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { codeRefLabel, makeCodeRef, resolveCodeRef } from "./code-ref";

function docWith(text: string) {
  const doc = new Y.Doc();
  const ytext = doc.getText("code");
  ytext.insert(0, text);
  return ytext;
}

describe("code refs", () => {
  it("captures lines and snippet", () => {
    const ytext = docWith("a\nconst x = 1;\nconst y = 2;\nz");
    const from = 2;
    const to = ytext.toString().indexOf("z");
    const ref = makeCodeRef(ytext, from, to);
    expect(ref.snippet).toBe("const x = 1;\nconst y = 2;\n");
    // Trailing newline does not spill onto line 4.
    expect([ref.line, ref.endLine]).toEqual([2, 3]);
    expect(codeRefLabel(ref)).toBe("L2-3");
  });

  it("follows the code when text is inserted above it", () => {
    const ytext = docWith("one\ntwo\nthree");
    const ref = makeCodeRef(ytext, 4, 7); // "two"
    ytext.insert(0, "zero\n");
    const range = resolveCodeRef(ytext, ref);
    expect(range && ytext.toString().slice(range.from, range.to)).toBe("two");
  });

  it("keeps text typed at the edges outside the range", () => {
    const ytext = docWith("one two three");
    const ref = makeCodeRef(ytext, 4, 7);
    ytext.insert(7, "X");
    ytext.insert(4, "Y");
    const range = resolveCodeRef(ytext, ref);
    expect(range && ytext.toString().slice(range.from, range.to)).toBe("two");
  });

  it("resolves across replicas", () => {
    const a = docWith("shared code here");
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a.doc!));
    const ref = makeCodeRef(a, 7, 11);
    const range = resolveCodeRef(b.getText("code"), ref);
    expect(
      range && b.getText("code").toString().slice(range.from, range.to),
    ).toBe("code");
  });

  it("returns null once the code is deleted or the anchor is garbage", () => {
    const ytext = docWith("keep drop keep");
    const ref = makeCodeRef(ytext, 5, 9);
    ytext.delete(5, 4);
    expect(resolveCodeRef(ytext, ref)).toBeNull();
    expect(resolveCodeRef(ytext, { ...ref, from: "!!" })).toBeNull();
  });
});
