import type { SavedReply } from "@t3tools/contracts/settings";
import { useNavigate } from "@tanstack/react-router";
import { MessageSquareTextIcon, SettingsIcon } from "lucide-react";

import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { useComposerMenuState } from "./useComposerMenuState";

export function ComposerSavedReplies({
  replies,
  disabled,
  hidden,
  size,
  onSend,
}: {
  replies: ReadonlyArray<SavedReply>;
  disabled: boolean;
  hidden: boolean;
  size: "xs" | "sm";
  onSend: (text: string) => void;
}) {
  const navigate = useNavigate();
  const menuProps = useComposerMenuProps();
  const [open, setOpen] = useComposerMenuState(hidden);

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <ComposerControl
                  size={size}
                  aria-label="Saved replies"
                  data-composer-saved-replies
                />
              }
            />
          }
        >
          <ComposerControlIcon icon={MessageSquareTextIcon} size={size} />
        </TooltipTrigger>
        <TooltipPopup side="top">Saved replies send immediately</TooltipPopup>
      </Tooltip>
      <MenuPopup align="start" {...menuProps}>
        {replies.length === 0 ? <MenuItem disabled>No saved replies yet</MenuItem> : null}
        {replies.map((reply) => (
          <MenuItem key={reply.id} disabled={disabled} onClick={() => onSend(reply.text)}>
            <span className="max-w-64 truncate">{reply.name}</span>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onClick={() => void navigate({ to: "/settings/chat", hash: "saved-replies" })}>
          <SettingsIcon />
          Manage replies
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
