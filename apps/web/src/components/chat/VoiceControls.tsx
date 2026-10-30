import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";
import type { EnvironmentId, ThreadId, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { MicIcon, MicOffIcon, SquareIcon } from "lucide-react";
import { Button } from "../ui/button";
import { threadEnvironment } from "../../state/threads";
import { voiceMode, useVoiceState } from "../../voice/voiceMode";
import { resolveShortcutCommand } from "../../keybindings";
import { isCommandPaletteOpen } from "../../commandPaletteBus";

export function VoiceControls(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly disabled: boolean;
  readonly keybindings: ResolvedKeybindingsConfig;
}) {
  const state = useVoiceState();
  const permitted = useAtomValue(
    threadEnvironment.voiceSession.permissionAtom(props.environmentId),
  );
  const current =
    state.target?.environmentId === props.environmentId && state.target.threadId === props.threadId;
  const active = current && state.phase !== "idle";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Release microphone capture when its owning thread changes or unmounts.
  useEffect(
    () => () => {
      const target = voiceMode.getState().target;
      if (target?.environmentId === props.environmentId && target.threadId === props.threadId)
        voiceMode.stop();
    },
    [props.environmentId, props.threadId],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Stop microphone capture when the environment revokes operate permission.
  useEffect(() => {
    if (active && !permitted) voiceMode.stop();
  }, [active, permitted]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Attach voice shortcuts to the browser's global keydown event.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || isCommandPaletteOpen()) return;
      const command = resolveShortcutCommand(event, props.keybindings);
      if (command === "voice.toggle" && (active || (permitted && !props.disabled))) {
        event.preventDefault();
        if (active) voiceMode.stop();
        else void voiceMode.start({ environmentId: props.environmentId, threadId: props.threadId });
      } else if (command === "voice.toggleMute" && active) {
        event.preventDefault();
        voiceMode.toggleMute();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [active, permitted, props.disabled, props.environmentId, props.threadId, props.keybindings]);
  return (
    <div className="flex min-w-0 flex-col gap-2 px-3 py-2">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={
            !active && (props.disabled || !permitted || typeof RTCPeerConnection === "undefined")
          }
          onClick={() =>
            active
              ? voiceMode.stop()
              : void voiceMode.start({
                  environmentId: props.environmentId,
                  threadId: props.threadId,
                })
          }
        >
          {active ? <SquareIcon /> : <MicIcon />}
          {active ? "Stop voice" : "Start voice"}
        </Button>
        {active ? (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={state.muted}
            onClick={voiceMode.toggleMute}
          >
            {state.muted ? <MicOffIcon /> : <MicIcon />}
            {state.muted ? "Unmute" : "Mute"}
          </Button>
        ) : null}
        {active ? (
          <span role="status" className="text-xs text-muted-foreground">
            {state.phase === "connecting" ? "Connecting..." : "Listening"}
          </span>
        ) : null}
      </div>
      {current && state.error ? (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      ) : null}
      {active && state.userCaption ? (
        <p className="max-h-20 overflow-auto text-sm">You: {state.userCaption}</p>
      ) : null}
      {active && state.assistantCaption ? (
        <p className="max-h-20 overflow-auto text-sm text-muted-foreground">
          Voice: {state.assistantCaption}
        </p>
      ) : null}
    </div>
  );
}
