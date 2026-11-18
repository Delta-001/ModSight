/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Message } from "@vencord/discord-types";
import { showToast, UserStore } from "@webpack/common";

import { getStoredAttachment, Native } from "./capture";
import type { WebhookFile } from "./native";
import { settings } from "./settings";
import { Evidence, SanctionRecord } from "./store";
import { avatarUrl, channelName, displayName, formatDate, messageLink } from "./utils";
import { WEBHOOK_PATTERN } from "./webhook";

export type RelayKind = "messages" | "deleted" | "voice" | "members" | "watchlist" | "sanctions" | "evidence";

export const RELAY_KINDS: [RelayKind, string][] = [
    ["messages", "Messages des surveillés (chaque message)"],
    ["deleted", "Messages supprimés des surveillés"],
    ["voice", "Vocal : arrivée, changement de salon, départ"],
    ["members", "Pseudo modifié, arrivée et départ du serveur"],
    ["watchlist", "Ajout et retrait de la liste de surveillance"],
    ["sanctions", "Sanctions validées ou refusées"],
    ["evidence", "Preuves capturées (texte complet et fichiers)"]
];

const COLORS: Record<RelayKind, number> = {
    messages: 0x5865f2,
    deleted: 0xf23f43,
    voice: 0x23a55a,
    members: 0xf0b232,
    watchlist: 0xeb459e,
    sanctions: 0x9b59b6,
    evidence: 0x00a8fc
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

/** Un message à poster : des embeds regroupables, ou un message complet avec texte et fichiers */
interface Post {
    kind: RelayKind;
    userId: string;
    embeds: Embed[];
    content?: string;
    files?: WebhookFile[];
}

// Limites des webhooks Discord : 10 embeds et 6000 caractères par message, environ 30 messages par minute et par salon
const MAX_EMBEDS = 10;
const MAX_CHARS = 5500;
const SEND_INTERVAL = 2100;
const MAX_QUEUE = 500;
// Fichiers acceptés par un webhook sur un serveur sans boost
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 9;

interface Queue {
    id: string;
    url: string;
    /** Réglage « un fil par membre » dont dépend cette file : "default" ou le type d'évènement */
    slot: string;
    /** Mode « un fil par membre » : membre du fil et titre du fil à créer */
    userId?: string;
    threadName?: string;
    posts: Post[];
    timer?: ReturnType<typeof setTimeout>;
    sending: boolean;
}

/** Une file par webhook, ou par webhook et membre en mode fil : chaque file part dans l'ordre */
const queues = new Map<string, Queue>();
let lastErrorToast = 0;

/** Webhook d'un type d'évènement : son salon dédié, sinon le salon par défaut ; null si rien n'est configuré */
export function webhookFor(kind: RelayKind) {
    const own = settings.store.relayWebhooks[kind];
    const url = own || settings.store.webhookUrl;
    if (!Native || !WEBHOOK_PATTERN.test(url)) return null;
    const slot = own ? kind : "default";
    return { url, slot, threaded: !!settings.store.relayThreads[slot] };
}

function setSlotThreaded(slot: string, threaded: boolean) {
    settings.store.relayThreads = { ...settings.store.relayThreads, [slot]: threaded };
}

// Fils créés par membre, par webhook : « idWebhook:idMembre » → id du fil
const THREADS_KEY = "ModSight_threads";
let threads: Record<string, string> | undefined;

const threadKey = (url: string, userId: string) => `${url.match(/webhooks\/(\d+)/)?.[1]}:${userId}`;

async function getThreads() {
    return threads ??= await DataStore.get<Record<string, string>>(THREADS_KEY) ?? {};
}

function setThread(key: string, threadId: string | undefined) {
    if (!threads) return;
    if (threadId) threads[key] = threadId;
    else delete threads[key];
    DataStore.set(THREADS_KEY, threads);
}

// Codes d'erreur de Discord
// Fil supprimé, archivé ou verrouillé : on en crée un nouveau
const THREAD_GONE = new Set([10003, 50083, 160005]);
// Forum sans fil précisé, et fil demandé hors d'un forum
const FORUM_NEEDS_THREAD = 220001;
const NOT_A_FORUM = 220003;
const FORUM_NEEDS_TAG = 40067;

const embedSize = (e: Embed) =>
    e.title.length + (e.description?.length ?? 0) + (e.author?.name.length ?? 0) + (e.footer?.text.length ?? 0)
    + (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);

const clip = (text: string, max: number) => text.length > max ? text.slice(0, max - 1) + "…" : text;

const body = (post: Pick<Post, "content" | "embeds">) => ({ username: "ModSight", content: post.content, embeds: post.embeds, allowed_mentions: { parse: [] } });

function schedule(queue: Queue, delay: number) {
    if (!queue.timer && !queue.sending) queue.timer = setTimeout(() => flush(queue), delay);
}

/** Regroupe les posts d'embeds seuls dans la limite d'un message ; un post avec fichiers part seul */
function takeBatch(posts: Post[]) {
    const taken = [posts.shift()!];
    const first = taken[0];
    if (first.content || first.files?.length) return { merged: first, taken };
    const embeds = [...first.embeds];
    let chars = embeds.reduce((n, e) => n + embedSize(e), 0);
    while (posts.length && !posts[0].content && !posts[0].files?.length) {
        const next = posts[0].embeds;
        const size = next.reduce((n, e) => n + embedSize(e), 0);
        if (embeds.length + next.length > MAX_EMBEDS || chars + size > MAX_CHARS) break;
        taken.push(posts.shift()!);
        embeds.push(...next);
        chars += size;
    }
    return { merged: { ...first, embeds }, taken };
}

/** Le mode fil d'un salon a changé : renvoie les posts de la file selon le nouveau réglage */
function reroute(queue: Queue, taken: Post[]) {
    queues.delete(queue.id);
    clearTimeout(queue.timer);
    for (const post of [...taken, ...queue.posts]) enqueue(post);
}

async function flush(queue: Queue) {
    queue.timer = undefined;
    if (!queue.posts.length || !Native) return;

    const { merged, taken } = takeBatch(queue.posts);
    queue.sending = true;
    const key = queue.userId && threadKey(queue.url, queue.userId);
    const threadId = key ? (await getThreads())[key] : undefined;
    const createThread = !!key && !threadId;
    const res = await Native.postWebhook(
        queue.url,
        { ...body(merged), thread_name: createThread ? queue.threadName : undefined },
        merged.files,
        { wait: createThread, threadId }
    ).catch(e => ({ ok: false as const, error: String(e?.message ?? e), code: undefined, retryAfter: undefined }));
    queue.sending = false;

    if (res.ok) {
        if (key && createThread && res.channelId) setThread(key, res.channelId);
    } else if (res.retryAfter || (threadId && res.code && THREAD_GONE.has(res.code))) {
        if (!res.retryAfter) setThread(key!, undefined);
        queue.posts.unshift(merged);
        return schedule(queue, (res.retryAfter ?? 0) * 1000);
    } else if (res.code === FORUM_NEEDS_THREAD && !queue.userId) {
        // Le salon est un forum : un webhook n'y écrit que dans un fil
        setSlotThreaded(queue.slot, true);
        showToast({ text: "Journal ModSight : ce salon est un forum, « un fil par membre » est activé." });
        return reroute(queue, taken);
    } else if (res.code === NOT_A_FORUM && queue.userId) {
        setSlotThreaded(queue.slot, false);
        showToast({ text: "Journal ModSight : ce salon n'est pas un forum, « un fil par membre » est désactivé." });
        return reroute(queue, taken);
    } else if (Date.now() - lastErrorToast > 300_000) {
        lastErrorToast = Date.now();
        const hint = res.code === FORUM_NEEDS_TAG
            ? " Le forum exige un tag : décoche « Exiger des tags » dans les réglages du forum."
            : " Vérifie l'URL du webhook.";
        showToast({ text: `Journal ModSight : envoi refusé (${res.error}).${hint}` });
    }
    if (queue.posts.length) schedule(queue, SEND_INTERVAL);
}

function enqueue(post: Post) {
    const target = webhookFor(post.kind);
    if (!target) return false;
    const id = target.threaded ? `${target.url}#${post.userId}` : target.url;
    let queue = queues.get(id);
    if (!queue) {
        queue = { id, url: target.url, slot: target.slot, posts: [], sending: false };
        if (target.threaded) Object.assign(queue, { userId: post.userId, threadName: clip(`${displayName(post.userId)} · ${post.userId}`, 100) });
        queues.set(id, queue);
    }
    queue.posts.push(post);
    if (queue.posts.length > MAX_QUEUE) queue.posts.splice(0, queue.posts.length - MAX_QUEUE);
    schedule(queue, 0);
    return true;
}

function memberAuthor(userId: string) {
    const user = UserStore.getUser(userId);
    const name = displayName(userId);
    return { name: user && user.username !== name ? `${name} (@${user.username})` : name, icon_url: avatarUrl(userId, 64) };
}

function decorate(kind: RelayKind, userId: string, embed: Embed): Embed {
    return {
        ...embed,
        title: clip(embed.title, 256),
        description: embed.description && clip(embed.description, 4000),
        color: COLORS[kind],
        timestamp: new Date().toISOString(),
        author: memberAuthor(userId),
        footer: { text: `ID ${userId}` }
    };
}

/** Ajoute un évènement au journal, s'il est configuré et que ce type est activé */
function relay(kind: RelayKind, userId: string, embed: Embed) {
    if (settings.store.relayEvents[kind] === false) return;
    enqueue({ kind, userId, embeds: [decorate(kind, userId, { ...embed, description: embed.description && clip(embed.description, 2000) })] });
}

export function clearRelay() {
    for (const queue of queues.values()) clearTimeout(queue.timer);
    queues.clear();
}

/** Envoie un message de test, hors file d'attente ; corrige le mode fil si Discord indique un forum (ou l'inverse) */
export async function sendRelayTest(url: string, label: string, slot: string) {
    if (!Native) return { ok: false as const, error: "Disponible uniquement dans l'application Discord" };
    const me = UserStore.getCurrentUser();
    const message = body({
        embeds: [{
            title: "✅ Journal ModSight connecté",
            description: `Ce salon recevra : ${label}.${me ? `\nConfiguré par @${me.username}.` : ""}`,
            color: COLORS.watchlist,
            timestamp: new Date().toISOString()
        }]
    });
    // Un forum n'accepte un webhook qu'avec un fil
    const post = (threaded: boolean) => Native!.postWebhook(url, { ...message, thread_name: threaded ? "Test ModSight" : undefined });

    const threaded = !!settings.store.relayThreads[slot];
    const res = await post(threaded);
    if (!res.ok && (res.code === FORUM_NEEDS_THREAD || res.code === NOT_A_FORUM)) {
        setSlotThreaded(slot, !threaded);
        return post(!threaded);
    }
    return res;
}

/** Salon visé par un webhook, d'après Discord */
export function getWebhookChannel(url: string) {
    return Native?.getWebhookInfo(url) ?? Promise.resolve(null);
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

const time = (ts: number) => new Date(ts).toLocaleString("fr-FR");

/** Transcription complète d'une preuve, jointe en .txt */
function transcript(e: Evidence, sanction?: string) {
    const lines = [
        `Preuve ModSight — ${e.userName} (ID ${e.userId})`,
        `Salon : ${channelName(e.channelId)} (${e.channelId})`,
        `Message : ${messageLink(e.guildId, e.channelId, e.messageId)}`,
        `Capturée le ${formatDate(e.createdAt)}${e.deleted ? " (message supprimé, enregistré automatiquement)" : ""}`,
        ...(sanction ? [`Sanction : ${sanction}`] : []),
        ""
    ];
    for (const m of e.messages) {
        const flags = [m.target && "MESSAGE VISÉ", m.edited && "modifié", m.deleted && "supprimé"].filter(Boolean).join(", ");
        lines.push(`[${time(m.timestamp)}] ${m.authorName} (${m.authorId})${flags ? ` [${flags}]` : ""}`);
        if (m.content) lines.push(m.content);
        for (const a of m.attachments) lines.push(`  📎 ${a.filename} — ${a.url}`);
        lines.push("");
    }
    return lines.join("\n");
}

/**
 * Envoie une preuve dans son salon : ID du membre dans le texte (cherchable), extrait, transcription .txt et fichiers stockés.
 * Avec force, ignore l'interrupteur « Preuves » (envoi manuel). Renvoie false si aucun salon n'est configuré
 */
export async function relayEvidence(e: Evidence, { sanction, force = false }: { sanction?: string; force?: boolean; } = {}) {
    if (!webhookFor("evidence") || (!force && settings.store.relayEvents.evidence === false)) return false;

    const files: WebhookFile[] = [{
        name: `preuve-${e.userId}-${new Date(e.createdAt).toISOString().slice(0, 10)}.txt`,
        mime: "text/plain;charset=utf-8",
        bytes: new TextEncoder().encode(transcript(e, sanction))
    }];
    const skipped: string[] = [];
    let total = files[0].bytes.byteLength;
    for (const a of e.messages.flatMap(m => m.attachments)) {
        const stored = a.stored ? await getStoredAttachment(a.id) : undefined;
        const size = stored?.bytes.byteLength ?? 0;
        if (!stored || size > MAX_FILE_BYTES || total + size > MAX_FILE_BYTES || files.length > MAX_FILES) {
            skipped.push(`[${a.filename}](${a.url})`);
            continue;
        }
        files.push({ name: a.filename, mime: stored.mime, bytes: stored.bytes });
        total += size;
    }

    const target = e.messages.find(m => m.target) ?? e.messages[0];
    const embed = decorate("evidence", e.userId, {
        title: `📸 Preuve${e.deleted ? " (message supprimé)" : ""} dans ${channelName(e.channelId)}`,
        url: messageLink(e.guildId, e.channelId, e.messageId),
        description: target?.content || "(pièce jointe)",
        fields: [
            { name: "Membre", value: `<@${e.userId}> · ${e.userId}` },
            { name: "Contexte", value: `${e.messages.length} message(s), dans le fichier .txt`, inline: true },
            ...(sanction ? [{ name: "Sanction", value: clip(sanction, 1000) }] : []),
            ...(skipped.length ? [{ name: "Fichiers non joints (trop lourds ou non stockés)", value: clip(skipped.join("\n"), 1000) }] : [])
        ]
    });

    // L'ID en texte brut : la recherche Discord du salon retrouve toutes les preuves d'un membre
    return enqueue({ kind: "evidence", userId: e.userId, content: `Preuve · ID membre : ${e.userId}`, embeds: [embed], files });
}
