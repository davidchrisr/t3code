import { CLI_RELEASES_PAGE_URL } from "@t3tools/shared/cliRelease";
import { cn } from "~/lib/utils";

import { CommandBlock } from "./CommandBlock";

export function InstallT3Commands({
  command,
  className,
}: {
  readonly command: string;
  readonly className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-xs text-muted-foreground">
        Download and unpack the CLI archive for that computer from{" "}
        <a
          href={CLI_RELEASES_PAGE_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-2"
        >
          T3 Fork releases
        </a>
        .
      </p>
      <CommandBlock command={command} />
      <p className="text-xs text-muted-foreground">
        Run this with the fork's <code className="font-mono">t3</code> executable, using its full
        path if it is not on PATH.
      </p>
    </div>
  );
}
