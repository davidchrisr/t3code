import { useState } from "react";
import {
  MAX_SAVED_REPLIES,
  MAX_SAVED_REPLY_NAME_LENGTH,
  type SavedReply,
} from "@t3tools/contracts/settings";
import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@t3tools/contracts";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { randomUUID } from "~/lib/utils";

import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useScopedSettingsWriteAllowed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

export function SavedRepliesSettings() {
  const { scope } = useSettingsScope();
  const environmentScope = scope.kind === "environment" || scope.kind === "all";
  const savedReplies = useScopedSettings((settings) => settings.savedReplies);
  const [list, setList] = useState({
    source: savedReplies,
    confirmed: savedReplies,
    replies: savedReplies,
  });
  if (list.source !== savedReplies)
    setList({ source: savedReplies, confirmed: savedReplies, replies: savedReplies });
  const replies = list.replies;
  const mixed = useScopedSettingsMixed(["savedReplies"]);
  const canWrite = useScopedSettingsWriteAllowed();
  const updateSettings = useUpdateScopedSettings();
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<(SavedReply & { isNew: boolean }) | null>(null);
  const isNew = editing?.isNew ?? false;
  const deleted = editing !== null && !isNew && !replies.some((reply) => reply.id === editing.id);
  if ((mixed || !environmentScope) && editing !== null) setEditing(null);

  const saveReplies = async (next: readonly SavedReply[]) => {
    setSaving(true);
    setList({ ...list, replies: next });
    const saved = await updateSettings({ savedReplies: next });
    setList((current) =>
      saved
        ? current.source === savedReplies
          ? { ...current, confirmed: next }
          : current
        : { ...current, replies: current.confirmed },
    );
    setSaving(false);
    return saved;
  };

  return (
    <SettingsRow
      serverScoped
      settingKeys={["savedReplies"]}
      {...searchableSetting("saved-replies")}
      description="Reusable responses that send immediately when selected in the composer. Shared with all clients connected to this server."
    >
      {mixed || !environmentScope ? (
        <p className="mt-3 pb-3.5 text-sm text-muted-foreground">
          {mixed
            ? "Saved replies differ between servers. Select one server to edit its replies."
            : "Select a server to edit its shared replies."}
        </p>
      ) : (
        <div className="mt-3 grid max-w-2xl gap-2 pb-3.5">
          {replies.map((reply) => (
            <div key={reply.id} className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{reply.name}</div>
                <div className="truncate text-xs text-muted-foreground">{reply.text}</div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${reply.name}`}
                disabled={saving}
                onClick={() => setEditing({ ...reply, isNew: false })}
              >
                <PencilIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${reply.name}`}
                disabled={saving}
                onClick={() => void saveReplies(replies.filter((item) => item.id !== reply.id))}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={saving || replies.length >= MAX_SAVED_REPLIES}
              onClick={() => setEditing({ id: randomUUID(), name: "", text: "", isNew: true })}
            >
              <PlusIcon />
              Add reply
            </Button>
          </div>
        </div>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setEditing(null);
        }}
      >
        {editing ? (
          <DialogPopup>
            <DialogTitle>{isNew ? "Add saved reply" : "Edit saved reply"}</DialogTitle>
            <div className="mt-4 grid gap-3">
              <label className="grid gap-1.5 text-sm">
                Name
                <Input
                  aria-label="Reply name"
                  value={editing.name}
                  disabled={saving}
                  maxLength={MAX_SAVED_REPLY_NAME_LENGTH}
                  onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                />
              </label>
              {deleted ? (
                <p role="alert" className="text-sm text-muted-foreground">
                  This reply was deleted on another client. Cancel to return to the current list.
                </p>
              ) : null}
              <label className="grid gap-1.5 text-sm">
                Reply text
                <Textarea
                  aria-label="Reply text"
                  value={editing.text}
                  disabled={saving}
                  maxLength={PROVIDER_SEND_TURN_MAX_INPUT_CHARS}
                  rows={4}
                  onChange={(event) => setEditing({ ...editing, text: event.target.value })}
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" disabled={saving} onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button
                  disabled={
                    !editing.name.trim() ||
                    !editing.text.trim() ||
                    !canWrite ||
                    saving ||
                    deleted ||
                    (isNew && replies.length >= MAX_SAVED_REPLIES)
                  }
                  onClick={async () => {
                    const reply = { id: editing.id, name: editing.name.trim(), text: editing.text };
                    const saved = await saveReplies(
                      isNew
                        ? [...replies, reply]
                        : replies.map((item) => (item.id === reply.id ? reply : item)),
                    );
                    if (saved) setEditing(null);
                  }}
                >
                  Save reply
                </Button>
              </div>
            </div>
          </DialogPopup>
        ) : null}
      </Dialog>
    </SettingsRow>
  );
}
