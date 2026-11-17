/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, showToast, TextInput, useState, VoiceStateStore } from "@webpack/common";

import { settings } from "../settings";
import { setWatched } from "../store";
import { cl, displayName } from "../utils";

function WatchReasonModal({ modalProps, userId }: { modalProps: RenderModalProps; userId: string; }) {
    const [reason, setReason] = useState("");
    const name = displayName(userId);

    function confirm() {
        setWatched(userId, reason.trim(), name, VoiceStateStore.getVoiceState(settings.store.guildId, userId)?.channelId ?? null);
        showToast({ text: `${name} est maintenant surveillé` });
        modalProps.onClose();
    }

    return (
        <Modal
            {...modalProps}
            size="sm"
            title={`Surveiller ${name}`}
            actions={[
                { text: "Annuler", variant: "secondary", onClick: modalProps.onClose },
                { text: "Surveiller", variant: "primary", onClick: confirm }
            ]}
        >
            <div className={cl("label")}>Motif (facultatif)</div>
            <TextInput
                autoFocus
                placeholder="Ex. : suspicion d'arnaque en MP"
                value={reason}
                onChange={setReason}
                onKeyDown={e => e.key === "Enter" && confirm()}
            />
        </Modal>
    );
}

const Wrapped = ErrorBoundary.wrap(WatchReasonModal);

export function openWatchModal(userId: string) {
    openModal(props => <Wrapped modalProps={props} userId={userId} />);
}
