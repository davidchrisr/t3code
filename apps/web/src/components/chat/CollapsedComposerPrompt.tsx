import {
  assistantCitationLabel,
  collectAssistantCitations,
} from "@t3tools/shared/assistantCitations";
import { QuoteIcon } from "lucide-react";
import { Fragment } from "react";

import { ContextChip, ContextChipLabel } from "../ContextChip";

export function CollapsedComposerPrompt({ prompt }: { prompt: string }) {
  const citations = collectAssistantCitations(prompt);
  return (
    <>
      {citations.map((match, index) => (
        <Fragment key={match.start}>
          {prompt.slice(citations[index - 1]?.end ?? 0, match.start)}
          <ContextChip kind="citation">
            <QuoteIcon aria-hidden="true" />
            <ContextChipLabel>{assistantCitationLabel(match.citation)}</ContextChipLabel>
          </ContextChip>
        </Fragment>
      ))}
      {prompt.slice(citations.at(-1)?.end ?? 0)}
    </>
  );
}
