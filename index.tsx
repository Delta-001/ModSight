/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { ApplicationCommandInputType } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { MemberListDecoratorFactory } from "@api/MemberListDecorators";
import { MessageDecorationProps } from "@api/MessageDecorations";
import { showNotification } from "@api/Notifications";
import ErrorBoundary from "@components/ErrorBoundary";
import { openUserProfile } from "@utils/discord";
import definePlugin from "@utils/types";
import { Channel, Guild, Message, User } from "@vencord/discord-types";
import { Menu, SelectedGuildStore, showToast, Tooltip, UserStore, useStateFromStores, VoiceStateStore } from "@webpack/common";

import { cacheWatchedMessage, captureEvidence, clearMessageCache, onMessageDeleted, revokeAttachmentUrls } from "./capture";
import { openPanel } from "./components/Panel";
import { openSanctionModal } from "./components/SanctionModal";
import { openWatchModal } from "./components/WatchReasonModal";
import { isModGuild, settings } from "./settings";
import { flushData, getData, isLoaded, loadData, MAX_VOICE_HISTORY, patchWatched, unwatch, useData, WatchEntry } from "./store";
import { avatarUrl, channelName, cl, displayName, goToChannel } from "./utils";

// Menus contextuels

const userMenu: NavContextMenuPatchCallback = (children, { user, guildId, channel }: { user?: User; guildId?: string; channel?: Channel; }) => {
    if (!user || !isModGuild(guildId ?? channel?.guild_id)) return;
    const watched = !!getData().watched[user.id];

    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem id="vc-ms-sanction" label="Préparer une sanction" action={() => openSanctionModal({ userId: user.id })} />
            <Menu.MenuItem
                id="vc-ms-watch"
                label={watched ? "Ne plus surveiller" : "Surveiller"}
                action={() => {
                    if (!watched) return openWatchModal(user.id);
                    unwatch(user.id);
                    showToast({ text: `${displayName(user.id)} n'est plus surveillé` });
                }}
            />
        </Menu.MenuGroup>
    );
};

const messageMenu: NavContextMenuPatchCallback = (children, { message, channel }: { message?: Message; channel?: Channel; }) => {
    const guildId = channel?.guild_id;
    if (!message || !guildId || !isModGuild(guildId)) return;

    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="vc-ms-sanction"
                label="Préparer une sanction"
                action={() => openSanctionModal({ userId: message.author.id, message: { id: message.id, channelId: message.channel_id } })}
            />
            <Menu.MenuItem id="vc-ms-capture" label="Capturer comme preuve" action={() => captureEvidence(message, guildId)} />
        </Menu.MenuGroup>
    );
};

const channelMenu: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (!channel?.guild_id || channel.isCategory() || channel.isVocal()) return;
    const current = settings.store.sanctionChannelId === channel.id;

    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="vc-ms-sanction-channel"
                label={current ? "ModSight : salon de sanction ✓" : "ModSight : salon de sanction"}
                action={() => {
                    settings.store.sanctionChannelId = channel.id;
                    showToast({ text: `Salon de sanction : #${channel.name}` });
                }}
            />
        </Menu.MenuGroup>
    );
};

const guildMenu: NavContextMenuPatchCallback = (children, { guild }: { guild?: Guild; }) => {
    if (!guild) return;
    const current = isModGuild(guild.id);

    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="vc-ms-guild"
                label={current ? "ModSight : serveur de modération ✓" : "ModSight : serveur de modération"}
                action={() => {
                    settings.store.guildId = guild.id;
                    syncVoiceStates();
                    showToast({ text: `Serveur de modération : ${guild.name}` });
                }}
            />
        </Menu.MenuGroup>
    );
};

// Notifications et suivi des membres surveillés

const lastMessageNotification = new Map<string, number>();

const openProfile = (userId: string) => openUserProfile(userId).catch(() => showToast({ text: "Profil introuvable" }));

function notify(userId: string, title: string, body: string, onClick: () => void) {
    showNotification({ title, body, icon: avatarUrl(userId, 128), onClick });
}

/** Aligne le salon vocal connu de chaque membre surveillé sur l'état réel, sans notifier */
function syncVoiceStates() {
    const { guildId } = settings.store;
    if (!guildId || !isLoaded()) return;
    const now = Date.now();
    for (const entry of Object.values(getData().watched)) {
        const current = VoiceStateStore.getVoiceState(guildId, entry.userId)?.channelId ?? null;
        const open = entry.voiceHistory.at(-1);
        const isOpen = open && !open.leftAt;
        if ((entry.voiceChannelId ?? null) === current && (!isOpen || open.channelId === current)) continue;

        patchWatched(entry.userId, w => {
            let history = w.voiceHistory;
            if (isOpen && open.channelId !== current) history = history.map(s => s === open ? { ...s, leftAt: now } : s);
            if (current && !(isOpen && open.channelId === current)) history = [...history, { channelId: current, joinedAt: now }];
            return { voiceChannelId: current, voiceHistory: history.slice(-MAX_VOICE_HISTORY) };
        });
    }
}

interface RawVoiceState {
    userId: string;
    channelId?: string | null;
    guildId?: string | null;
}

function onVoiceState(vs: RawVoiceState) {
    const entry = getData().watched[vs.userId];
    if (!entry) return;
    const prev = entry.voiceChannelId ?? null;

    let next: string | null;
    if (isModGuild(vs.guildId)) next = vs.channelId ?? null;
    // Parti dans le vocal d'un autre serveur : il a donc quitté celui-ci
    else if (prev && vs.channelId) next = null;
    else return;
    if (prev === next) return;

    const now = Date.now();
    patchWatched(vs.userId, w => {
        const history = w.voiceHistory.map(s => s.leftAt ? s : { ...s, leftAt: now });
        if (next) history.push({ channelId: next, joinedAt: now });
        return { voiceChannelId: next, voiceHistory: history.slice(-MAX_VOICE_HISTORY), lastActivity: now };
    });

    if (!settings.store.notifyVoice) return;
    const name = displayName(vs.userId);
    if (!prev && next) notify(vs.userId, `👁 ${name} a rejoint un vocal`, channelName(next), () => goToChannel(next));
    else if (prev && next) notify(vs.userId, `👁 ${name} a changé de vocal`, `${channelName(prev)} → ${channelName(next)}`, () => goToChannel(next));
    else if (prev) notify(vs.userId, `👁 ${name} a quitté le vocal`, channelName(prev), () => goToChannel(prev));
}

function memberEvent(guildId: string, user: { id: string; } | undefined, handler: (entry: WatchEntry) => void) {
    if (!isLoaded() || !user || !isModGuild(guildId)) return;
    const entry = getData().watched[user.id];
    if (entry) handler(entry);
}

// Décorations

function WatchBadge({ userId }: { userId: string; }) {
    const entry = useData(d => d.watched[userId]);
    if (!entry) return null;
    return (
        <Tooltip text={entry.reason ? `Surveillé : ${entry.reason}` : "Membre surveillé"}>
            {props => <span {...props} className={cl("eye")}>👁</span>}
        </Tooltip>
    );
}

const MessageDecoration = ErrorBoundary.wrap(({ message, channel }: MessageDecorationProps) => {
    const { guildId } = settings.use(["guildId"]);
    if (!message?.author || channel?.guild_id !== guildId || !guildId) return null;
    return <WatchBadge userId={message.author.id} />;
}, { noop: true });

const MemberListDecorator = ErrorBoundary.wrap(({ user, type }: Parameters<MemberListDecoratorFactory>[0]) => {
    const { guildId } = settings.use(["guildId"]);
    const currentGuild = useStateFromStores([SelectedGuildStore], () => SelectedGuildStore.getGuildId());
    if (type !== "guild" || !user || !guildId || currentGuild !== guildId) return null;
    return <WatchBadge userId={user.id} />;
}, { noop: true });

const PanelIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5Zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
    </svg>
);

const chatBarButton: ChatBarButtonFactory = ({ channel, isMainChat }) => {
    const { guildId } = settings.use(["guildId"]);
    if (!isMainChat || !guildId || channel?.guild_id !== guildId) return null;
    return (
        <ChatBarButton tooltip="Ouvrir ModSight" onClick={openPanel}>
            <PanelIcon />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "ModSight",
    description: "Outil de modération personnel : préparation de sanctions, surveillance de membres et capture de preuves, pour un seul serveur. N'agit jamais à ta place.",
    authors: [{ name: "Delta-001", id: 689779342343143424n }],
    settings,

    contextMenus: {
        "user-context": userMenu,
        "message": messageMenu,
        "channel-context": channelMenu,
        "thread-context": channelMenu,
        "guild-context": guildMenu
    },

    commands: [
        {
            name: "modsight",
            description: "Ouvre le panneau ModSight (commande locale, rien n'est envoyé)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: () => void openPanel()
        }
    ],

    chatBarButton: {
        icon: PanelIcon,
        render: chatBarButton
    },

    renderMessageDecoration: props => <MessageDecoration {...props} />,
    renderMemberListDecorator: props => <MemberListDecorator {...props} />,

    flux: {
        CONNECTION_OPEN() {
            syncVoiceStates();
        },

        MESSAGE_CREATE({ message, optimistic, guildId }: { message: Message; optimistic: boolean; guildId?: string; }) {
            if (optimistic || !isLoaded() || !isModGuild(guildId) || !message?.author) return;
            const entry = getData().watched[message.author.id];
            if (!entry) return;

            cacheWatchedMessage(message, guildId!);
            const now = Date.now();
            patchWatched(entry.userId, () => ({ lastActivity: now }));

            if (!settings.store.notifyMessages || now - (lastMessageNotification.get(entry.userId) ?? 0) < 60_000) return;
            lastMessageNotification.set(entry.userId, now);
            notify(
                entry.userId,
                `👁 ${displayName(entry.userId)} dans ${channelName(message.channel_id)}`,
                message.content?.slice(0, 200) || "(pièce jointe ou intégration)",
                () => goToChannel(message.channel_id, message.id)
            );
        },

        async MESSAGE_DELETE({ id, channelId, guildId }: { id: string; channelId: string; guildId?: string; }) {
            if (!isLoaded() || !isModGuild(guildId)) return;
            const evidence = await onMessageDeleted(id, channelId, guildId!);
            if (!evidence || !settings.store.notifyDeleted) return;
            notify(
                evidence.userId,
                `👁 Message supprimé : ${evidence.userName}`,
                `${channelName(channelId)} · ${evidence.messages[0]?.content.slice(0, 180) || "(pièce jointe)"} (enregistré comme preuve)`,
                () => goToChannel(channelId)
            );
        },

        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: RawVoiceState[]; }) {
            if (!isLoaded() || !settings.store.guildId) return;
            for (const vs of voiceStates) onVoiceState(vs);
        },

        GUILD_MEMBER_UPDATE({ guildId, user, nick }: { guildId: string; user: { id: string; username: string; global_name?: string | null; }; nick?: string | null; }) {
            memberEvent(guildId, user, entry => {
                const name = nick || user.global_name || user.username;
                if (!name || entry.nick === name) return;
                patchWatched(entry.userId, () => ({ nick: name, lastActivity: Date.now() }));
                if (entry.nick && settings.store.notifyMembers)
                    notify(entry.userId, "👁 Pseudo modifié", `${entry.nick} → ${name}`, () => openProfile(entry.userId));
            });
        },

        GUILD_MEMBER_ADD({ guildId, user }: { guildId: string; user: { id: string; }; }) {
            memberEvent(guildId, user, entry => {
                patchWatched(entry.userId, () => ({ lastActivity: Date.now() }));
                if (settings.store.notifyMembers)
                    notify(entry.userId, "👁 Retour sur le serveur", `${displayName(entry.userId)} a rejoint le serveur`, () => openProfile(entry.userId));
            });
        },

        GUILD_MEMBER_REMOVE({ guildId, user }: { guildId: string; user: { id: string; }; }) {
            memberEvent(guildId, user, entry => {
                patchWatched(entry.userId, () => ({ lastActivity: Date.now() }));
                if (settings.store.notifyMembers)
                    notify(entry.userId, "👁 Départ du serveur", `${entry.nick ?? displayName(entry.userId)} a quitté le serveur`, () => openProfile(entry.userId));
            });
        }
    },

    async start() {
        await loadData();
        // Au lancement de Discord, l'état vocal n'est connu qu'à CONNECTION_OPEN
        if (UserStore.getCurrentUser()) syncVoiceStates();
        window.addEventListener("beforeunload", flushData);
    },

    stop() {
        window.removeEventListener("beforeunload", flushData);
        flushData();
        revokeAttachmentUrls();
        clearMessageCache();
        lastMessageNotification.clear();
    }
});
