/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { openUserProfile } from "@utils/discord";
import { showToast, useState, useStateFromStores, VoiceStateStore } from "@webpack/common";

import { relayWatch } from "../relay";
import { settings } from "../settings";
import { unwatch, useData, WatchEntry } from "../store";
import { avatarUrl, channelName, cl, displayName, formatDate, goToChannel, timeAgo } from "../utils";
import { openSanctionModal } from "./SanctionModal";

function VoiceStatus({ userId }: { userId: string; }) {
    const vs = useStateFromStores([VoiceStateStore], () => VoiceStateStore.getVoiceState(settings.store.guildId, userId));
    if (!vs?.channelId) return <span className={cl("muted")}>Pas en vocal</span>;

    const { channelId } = vs;
    return (
        <span className={cl("voice-status")}>
            <button className={cl("link")} onClick={() => goToChannel(channelId)}>🔊 {channelName(channelId)}</button>
            {(vs.selfMute || vs.mute) && <span title="Micro coupé">🎙️🚫</span>}
            {(vs.selfDeaf || vs.deaf) && <span title="Casque coupé">🎧🚫</span>}
            {vs.selfStream && <span className={cl("badge", "badge-live")}>EN DIRECT</span>}
        </span>
    );
}

function WatchedRow({ entry }: { entry: WatchEntry; }) {
    const [open, setOpen] = useState(false);
    const name = displayName(entry.userId);

    return (
        <div className={cl("card")}>
            <div className={cl("row")}>
                <img className={cl("avatar")} src={avatarUrl(entry.userId)} alt="" />
                <div className={cl("grow")}>
                    <div className={cl("row-title")}>
                        <strong>{name}</strong>
                        <span className={cl("muted")}>{entry.userId}</span>
                    </div>
                    <div className={cl("muted")}>{entry.reason ? `Motif : ${entry.reason}` : "Aucun motif"}</div>
                    <div className={cl("row-meta")}>
                        <VoiceStatus userId={entry.userId} />
                        <span className={cl("muted")}>
                            Dernière activité : {entry.lastActivity ? timeAgo(entry.lastActivity) : "aucune depuis l'ajout"}
                        </span>
                    </div>
                </div>
                <div className={cl("actions")}>
                    <Button size="small" variant="dangerSecondary" onClick={() => openSanctionModal({ userId: entry.userId })}>Sanction</Button>
                    <Button size="small" variant="secondary" onClick={() => openUserProfile(entry.userId).catch(() => showToast({ text: "Profil introuvable" }))}>Profil</Button>
                    <Button
                        size="small"
                        variant="secondary"
                        onClick={() => { unwatch(entry.userId); relayWatch(entry.userId, false); showToast({ text: `${name} n'est plus surveillé` }); }}
                    >
                        Retirer
                    </Button>
                </div>
            </div>
            <button className={cl("link", "toggle")} onClick={() => setOpen(!open)}>
                {open ? "▾" : "▸"} Historique vocal ({entry.voiceHistory.length})
            </button>
            {open && (
                <div className={cl("history")}>
                    {entry.voiceHistory.length === 0 && <div className={cl("muted")}>Aucun passage en vocal enregistré.</div>}
                    {[...entry.voiceHistory].reverse().map(s => (
                        <div key={s.joinedAt + s.channelId} className={cl("history-row")}>
                            <button className={cl("link")} onClick={() => goToChannel(s.channelId)}>{channelName(s.channelId)}</button>
                            <span className={cl("muted")}>
                                {formatDate(s.joinedAt)} → {s.leftAt ? formatDate(s.leftAt) : "en cours"}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function WatchedTabInner() {
    const watched = useData(d => Object.values(d.watched).sort((a, b) => (b.lastActivity ?? b.addedAt) - (a.lastActivity ?? a.addedAt)));

    if (!watched.length) {
        return <div className={cl("empty")}>Personne n'est surveillé. Clic droit sur un membre → « Surveiller ».</div>;
    }
    return <div className={cl("list")}>{watched.map(e => <WatchedRow key={e.userId} entry={e} />)}</div>;
}

export const WatchedTab = ErrorBoundary.wrap(WatchedTabInner);
