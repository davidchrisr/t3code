#!/usr/bin/env node

process.stderr.write(
  "npm CLI bootstrap is disabled in T3 Fork. Use the desktop app or a locally built fork CLI.\n",
);
process.exitCode = 1;
