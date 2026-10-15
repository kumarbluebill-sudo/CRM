import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Inbox } from "lucide-react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

describe("ux polish primitives", () => {
  it("Button loading disables the button, marks it busy and shows a spinner", () => {
    const html = renderToStaticMarkup(h(Button, { loading: true }, "Save"));
    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("animate-spin");
  });
  it("Button without loading has no busy state", () => {
    const html = renderToStaticMarkup(h(Button, null, "Save"));
    expect(html).not.toContain("aria-busy");
    expect(html).not.toContain("animate-spin");
  });
  it("EmptyState renders an optional action", () => {
    const html = renderToStaticMarkup(
      h(EmptyState, { icon: Inbox, title: "Nothing", action: h("a", { href: "/x" }, "New") }),
    );
    expect(html).toContain('href="/x"');
  });
});
