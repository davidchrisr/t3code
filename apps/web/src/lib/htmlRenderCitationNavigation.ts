import type { AssistantCitationTarget } from "../components/chat/AssistantCitationSource";

export const HTML_RENDER_CITATION_NAVIGATION_TIMEOUT_MS = 10_000;

export function failHtmlRenderCitationNavigation(
  request: AssistantCitationTarget | null | undefined,
  attachmentId: string,
) {
  if (
    !request ||
    request.citation.version !== 2 ||
    request.citation.htmlRender.attachmentId !== attachmentId
  )
    return false;
  const activation = request.activationRef.current;
  if (activation.dismissed || activation.scrolled) return false;
  activation.dismissed = true;
  request.onComplete();
  return true;
}

export function watchHtmlRenderCitationNavigation({
  request,
  attachmentId,
  onFailure,
}: {
  request: AssistantCitationTarget | null | undefined;
  attachmentId: string;
  onFailure: () => void;
}) {
  if (
    !request ||
    request.citation.version !== 2 ||
    request.citation.htmlRender.attachmentId !== attachmentId
  )
    return () => {};
  const activation = request.activationRef.current;
  if (activation.dismissed || activation.scrolled) return () => {};
  const deadline = (activation.htmlRenderDeadline ??=
    performance.now() + HTML_RENDER_CITATION_NAVIGATION_TIMEOUT_MS);
  const timeout = setTimeout(
    () => {
      if (failHtmlRenderCitationNavigation(request, attachmentId)) onFailure();
    },
    Math.max(0, deadline - performance.now()),
  );
  return () => clearTimeout(timeout);
}
