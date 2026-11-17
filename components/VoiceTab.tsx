/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { VoiceState } from "@vencord/discord-types";
import { ChannelStore, TextInput, useRef, useState, useStateFromStores, VoiceStateStore } from "@webpack/common";

import { settings } from "../settings";
import { useData } from "../store";
import { avatarUrl, channelName, cl, displayName, goToChannel, joinVoice } from "../utils";

const sameStates = (a: VoiceState[], b: VoiceState[]) => a.length === b.length && a.every((s, i) => s === b[i]);

function VoiceTabInner() {
    const { guildId } = settings.store;
    const [query, setQuery] = useState("");
    const [watchedOnly, setWatchedOnly] = useState(false);
    const watched = useData(d => d.watched);
    const clickTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

    const states = useStateFromStores(
        [VoiceStateStore],
        () => Object.values(VoiceStateStore.getVoiceStates(guildId) ?? {}),
        [guildId],
        sameStates
    );

    const q = query.trim().toLowerCase();
    const groups = new Map<string, VoiceState[]>();
    for (const s of states) {
        if (!s.channelId) continue;
        if (watchedOnly && !watched[s.userId]) continue;
        if (q && !s.userId.includes(q) && !displayName(s.userId).toLowerCase().includes(q)) continue;
        groups.set(s.channelId, [...groups.get(s.channelId) ?? [], s]);
    }
    const channels = [...groups.keys()].sort((a, b) => (ChannelStore.getChannel(a)?.position ?? 0) - (ChannelStore.getChannel(b)?.position ?? 0));

    // Un clic ouvre le salon, un double-clic le rejoint : on attend 250 ms avant de décider
    function onClick(channelId: string) {
        clearTimeout(clickTimer.current);
        clickTimer.current = setTimeout(() => goToChannel(channelId), 250);
    }
    function onDoubleClick(channelId: string) {
        clearTimeout(clickTimer.current);
        joinVoice(channelId);
    }

    return (
        <div className={cl("list")}>
            <div className={cl("toolbar")}>
                <div className={cl("grow")}><TextInput placeholder="Rechercher un pseudo ou un ID" value={query} onChange={setQuery} /></div>
                <label className={cl("check")}>
                    <input type="checkbox" checked={watchedOnly} onChange={e => setWatchedOnly(e.currentTarget.checked)} />
                    Surveillés seulement
                </label>
            </div>
            <div className={cl("muted")}>Clic : ouvrir le salon · Double-clic : rejoindre le vocal</div>
            {channels.length === 0 && <div className={cl("empty")}>Personne en vocal{q || watchedOnly ? " pour ce filtre" : ""}.</div>}
            {channels.map(channelId => (
                <div key={channelId} className={cl("card")}>
                    <button
                        className={cl("voice-channel")}
                        onClick={() => onClick(channelId)}
                        onDoubleClick={() => onDoubleClick(channelId)}
                    >
                        🔊 {channelName(channelId)} <span className={cl("muted")}>({groups.get(channelId)!.length})</span>
                    </button>
                    <div className={cl("voice-members")}>
                        {groups.get(channelId)!.map(s => (
                            <div key={s.userId} className={cl("voice-member", watched[s.userId] && "voice-member-watched")} title={s.userId}>
                                <img className={cl("avatar", "avatar-sm")} src={avatarUrl(s.userId, 32)} alt="" />
                                <span>{watched[s.userId] && "👁 "}{displayName(s.userId)}</span>
                                {(s.selfMute || s.mute) && <span title="Micro coupé">🎙️🚫</span>}
                                {(s.selfDeaf || s.deaf) && <span title="Casque coupé">🎧🚫</span>}
                                {s.selfStream && <span className={cl("badge", "badge-live")}>EN DIRECT</span>}
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

export const VoiceTab = ErrorBoundary.wrap(VoiceTabInner);
