import { EnvironmentId, ThreadId, type AssistantCitation } from "@t3tools/contracts";
import {
  injectHtmlRenderBootstrap,
  injectHtmlRenderCitationBootstrap,
} from "@t3tools/shared/htmlRender";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { HtmlRenderCitationControls } from "./HtmlRenderCitationControls";
import type { AssistantCitationTarget } from "./AssistantCitationSource";

const threadRef = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
};
const html =
  '<p id="label">Revenue is <strong>$42</strong>.</p><svg width="200" height="80"><rect id="bar" aria-label="Revenue: $42" width="42" height="60" fill="blue"></rect></svg>';

function Fixture({
  onCite,
  request,
  onHighlight,
  markup = html,
}: {
  onCite: (citation: AssistantCitation) => boolean;
  request?: AssistantCitationTarget;
  onHighlight?: (top: number) => void;
  markup?: string;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [loadGeneration, setLoadGeneration] = useState(0);
  return (
    <div className="relative">
      <iframe
        ref={frameRef}
        title="Revenue chart"
        // oxlint-disable-next-line react/iframe-missing-sandbox -- Isolated fixture needs scripts and DOM assertions.
        sandbox="allow-scripts allow-same-origin"
        onLoad={() => setLoadGeneration((generation) => generation + 1)}
        srcDoc={injectHtmlRenderCitationBootstrap(injectHtmlRenderBootstrap(markup))}
      />
      <HtmlRenderCitationControls
        key={loadGeneration}
        frameRef={frameRef}
        loaded={loadGeneration > 0}
        title="Revenue chart"
        threadRef={threadRef}
        context={{ attachmentId: "visual-one", onCite, request, onHighlight }}
      />
    </div>
  );
}

function requestFor(citation: AssistantCitation): AssistantCitationTarget {
  return {
    citation,
    key: "visual-request",
    activationRef: { current: { scrolled: false, dismissed: false } },
    onComplete: vi.fn(),
  };
}

describe("visualization citations", () => {
  it("quotes selected rendered text across nested elements", async () => {
    const onCite = vi.fn((_citation: AssistantCitation) => true);
    await using screen = await render(<Fixture onCite={onCite} />);
    const frame = page.frameLocator(screen.getByTitle("Revenue chart"));
    await expect.element(frame.getByText("Revenue is", { exact: false })).toBeVisible();
    const child = screen.container.querySelector("iframe")!.contentDocument!;
    const range = child.createRange();
    range.selectNodeContents(child.getElementById("label")!);
    const selection = child.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    await userEvent.click(frame.getByRole("button", { name: "Cite", exact: true }));
    await vi.waitFor(() => expect(onCite).toHaveBeenCalledOnce());
    expect(onCite.mock.calls[0]?.[0]).toEqual({
      version: 2,
      ...threadRef,
      text: "Revenue is $42.",
      start: 0,
      end: 15,
      prefix: "",
      suffix: "",
      htmlRender: { attachmentId: "visual-one", title: "Revenue chart" },
    });
  });

  it("picks a non-text SVG element and highlights its source when reopened", async () => {
    const onCite = vi.fn((_citation: AssistantCitation) => true);
    const onHighlight = vi.fn();
    await using screen = await render(<Fixture onCite={onCite} onHighlight={onHighlight} />);
    await userEvent.click(screen.getByRole("button", { name: "Cite element", exact: true }));
    const frame = page.frameLocator(screen.getByTitle("Revenue chart"));
    await userEvent.click(frame.getByLabelText("Revenue: $42"));
    await vi.waitFor(() => expect(onCite).toHaveBeenCalledOnce());
    const citation = onCite.mock.calls[0]![0];
    expect(citation).toMatchObject({
      version: 2,
      text: "Revenue: $42",
      htmlRender: { attachmentId: "visual-one", element: { selector: "#bar", tagName: "rect" } },
    });
    if (citation.version !== 2) throw new Error("Expected visualization citation");
    expect(citation.htmlRender.element?.markup).toContain('width="42"');
    await screen.rerender(
      <Fixture onCite={onCite} onHighlight={onHighlight} request={requestFor(citation)} />,
    );
    await vi.waitFor(() => expect(onHighlight).toHaveBeenCalledOnce());
    const child = screen.container.querySelector("iframe")!.contentDocument!;
    const outline = child.querySelector<HTMLElement>("div[data-t3-citation-ui]")!;
    expect(outline.style.display).toBe("block");
    expect(outline.getBoundingClientRect().width).toBe(42);
  });

  it("refuses to highlight a different element at a saved selector", async () => {
    const citation: AssistantCitation = {
      version: 2,
      ...threadRef,
      text: "Revenue: $42",
      start: 0,
      end: 12,
      prefix: "",
      suffix: "",
      htmlRender: {
        attachmentId: "visual-one",
        title: "Revenue chart",
        element: { selector: "#bar", tagName: "rect", markup: '<rect id="bar" width="10"></rect>' },
      },
    };
    const onHighlight = vi.fn();
    await using screen = await render(
      <Fixture onCite={() => true} onHighlight={onHighlight} request={requestFor(citation)} />,
    );
    await vi.waitFor(() => expect(onHighlight).toHaveBeenCalledWith(0));
    const child = screen.container.querySelector("iframe")!.contentDocument!;
    expect(child.querySelector("div[data-t3-citation-ui]")).toBeNull();
  });

  it("leaves normal links inert while picking an element", async () => {
    const onCite = vi.fn((_citation: AssistantCitation) => true);
    const onMessage = vi.fn((event: MessageEvent) => event.data?.method === "ui/open-link");
    const markup = '<a id="link" href="https://example.com">Read more</a>';
    await using screen = await render(<Fixture onCite={onCite} markup={markup} />);
    window.addEventListener("message", onMessage);
    using _listener = { [Symbol.dispose]: () => window.removeEventListener("message", onMessage) };
    await userEvent.click(screen.getByRole("button", { name: "Cite element", exact: true }));
    const frame = page.frameLocator(screen.getByTitle("Revenue chart"));
    await userEvent.click(frame.getByRole("link", { name: "Read more" }));
    await vi.waitFor(() => expect(onCite).toHaveBeenCalledOnce());
    expect(onMessage.mock.results.some((result) => result.value === true)).toBe(false);
  });
});
