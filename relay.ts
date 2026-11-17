/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Message } from "@vencord/discord-types";
import { showToast, UserStore } from "@webpack/common";

import { Native } from "./capture";
import { settings } from "./settings";
import { SanctionRecord } from "./store";
import { avatarUrl, channelName, displayName, messageLink } from "./utils";
import { WEBHOOK_PATTERN } from "./webhook";

export type RelayKind = "messages" | "deleted" | "voice" | "members" | "watchlist" | "sanctions";

export const RELAY_KINDS: [RelayKind, string][] = [
    ["messages", "Messages des surveillés (chaque message)"],
    ["deleted", "Messages supprimés des surveillés"],
    ["voice", "Vocal : arrivée, changement de salon, départ"],
    ["members", "Pseudo modifié, arrivée et départ du serveur"],
    ["watchlist", "Ajout et retrait de la liste de surveillance"],
    ["sanctions", "Sanctions validées ou refusées"]
];

const COLORS: Record<RelayKind, number> = {
    messages: 0x5865f2,
    deleted: 0xf23f43,
    voice: 0x23a55a,
    members: 0xf0b232,
    watchlist: 0xeb459e,
    sanctions: 0x9b59b6
};

interface Embed {
    title: string;
    description?: string;
    url?: string;
    color?: number;
    timestamp?: string;
    author?: { name: string; icon_url?: string; };
    footer?: { text: string; };
    fields?: { name: string; value: string; inline?: boolean; }[];
}

// Limites des webhooks Discord : 10 embeds et 6000 caractères par message, environ 30 messages par minute
const MAX_EMBEDS = 10;
const MAX_CHARS = 5500;
const SEND_INTERVAL = 2100;
const MAX_QUEUE = 500;

const queue: Embed[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let sending = false;
let lastErrorToast = 0;

const isConfigured = () => !!Native && WEBHOOK_PATTERN.test(settings.store.webhookUrl);

const embedSize = (e: Embed) =>
    e.title.length + (e.description?.length ?? 0) + (e.author?.name.length ?? 0) + (e.footer?.text.length ?? 0)
    + (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);

const clip = (text: string, max: number) => text.length > max ? text.slice(0, max - 1) + "…" : text;

const body = (embeds: Embed[]) => ({ username: "ModSight", embeds, allowed_mentions: { parse: [] } });

function schedule(delay: number) {
    if (!timer && !sending) timer = setTimeout(flush, delay);
}

async function flush() {
    timer = undefined;
    if (!queue.length) return;
    if (!isConfigured()) return void (queue.length = 0);

    const batch: Embed[] = [];
    let chars = 0;
    while (queue.length && batch.length < MAX_EMBEDS && (batch.length === 0 || chars + embedSize(queue[0]) <= MAX_CHARS)) {
        chars += embedSize(queue[0]);
        batch.push(queue.shift()!);
    }

    sending = true;
    const res = await Native!.postWebhook(settings.store.webhookUrl, body(batch));
    sending = false;

    if (!res.ok && res.retryAfter) {
        queue.unshift(...batch);
        return schedule(res.retryAfter * 1000);
    }
    if (!res.ok && Date.now() - lastErrorToast > 300_000) {
        lastErrorToast = Date.now();
        showToast({ text: `Journal ModSight : envoi refusé (${res.error}). Vérifie l'URL du webhook.` });
    }
    if (queue.length) schedule(SEND_INTERVAL);
}

/** Ajoute un évènement au journal, s'il est configuré et que ce type est activé */
function relay(kind: RelayKind, userId: string, embed: Embed) {
    if (!isConfigured() || !settings.store.relayEvents[kind]) return;
    const user = UserStore.getUser(userId);
    const name = displayName(userId);
    queue.push({
        ...embed,
        title: clip(embed.title, 256),
        description: embed.description && clip(embed.description, 2000),
        color: COLORS[kind],
        timestamp: new Date().toISOString(),
        author: { name: user && user.username !== name ? `${name} (@${user.username})` : name, icon_url: avatarUrl(userId, 64) },
        footer: { text: `ID ${userId}` }
    });
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    schedule(0);
}

export function clearRelay() {
    clearTimeout(timer);
    timer = undefined;
    queue.length = 0;
}

/** Envoie un message de test, hors file d'attente */
export function sendRelayTest() {
    if (!Native) return Promise.resolve({ ok: false as const, error: "Disponible uniquement dans l'application Discord" });
    const me = UserStore.getCurrentUser();
    return Native.postWebhook(settings.store.webhookUrl, body([{
        title: "✅ Journal ModSight connecté",
        description: `Les évènements des membres surveillés arriveront dans ce salon.${me ? `\nConfiguré par @${me.username}.` : ""}`,
        color: COLORS.watchlist,
        timestamp: new Date().toISOString()
    }]));
}

const attachmentLines = (message: Message) =>
    (message.attachments ?? []).map(a => `📎 [${a.filename}](${a.url})`).join("\n");

export function relayMessage(message: Message, guildId: string) {
    relay("messages", message.author.id, {
        title: `💬 Message dans ${channelName(message.channel_id)}`,
        url: messageLink(guildId, message.channel_id, message.id),
        description: [message.content, attachmentLines(message)].filter(Boolean).join("\n") || "(intégration)"
    });
}

export function relayDeleted(userId: string, channelId: string, content: string) {
    relay("deleted", userId, {
        title: `🗑 Message supprimé dans ${channelName(channelId)}`,
        description: (content || "(pièce jointe)") + "\n\n*Enregistré comme preuve dans ModSight.*"
    });
}

export function relayVoice(userId: string, prev: string | null, next: string | null) {
    const title = !prev ? `🔊 A rejoint ${channelName(next)}`
        : !next ? `🔇 A quitté ${channelName(prev)}`
            : `🔀 ${channelName(prev)} → ${channelName(next)}`;
    relay("voice", userId, { title });
}

export function relayMember(userId: string, title: string, description?: string) {
    relay("members", userId, { title, description });
}

export function relayWatch(userId: string, added: boolean, reason?: string) {
    relay("watchlist", userId, {
        title: added ? "👁 Ajouté à la surveillance" : "👁 Retiré de la surveillance",
        description: reason || undefined
    });
}

export function relaySanction(s: SanctionRecord, status: "approved" | "rejected") {
    const me = UserStore.getCurrentUser();
    relay("sanctions", s.userId, {
        title: `${status === "approved" ? "⚖️ Sanction validée" : "✖️ Sanction refusée"} : ${s.categoryName}`,
        description: s.command ? "```\n" + clip(s.command, 1800) + "\n```" : undefined,
        fields: [
            s.actionName && { name: "Action", value: s.actionName, inline: true },
            s.duration && { name: "Durée", value: s.duration, inline: true },
            s.level && { name: "Niveau", value: String(s.level), inline: true },
            s.reason && { name: "Raison", value: clip(s.reason, 1000) },
            me && { name: "Modérateur", value: `@${me.username}`, inline: true }
        ].filter(f => !!f)
    });
}
