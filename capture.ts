/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { PluginNative } from "@utils/types";
import { Message, MessageAttachment } from "@vencord/discord-types";
import { MessageStore, showToast } from "@webpack/common";

import { migrateCategories, settings } from "./settings";
import { ATTACHMENT_PREFIX, AttachmentRef, CapturedMessage, Evidence, getData, ModSightData, newId, replaceData, updateData } from "./store";
import { displayName } from "./utils";

export const Native = VencordNative.pluginHelpers.ModSight as PluginNative<typeof import("./native")> | undefined;

interface StoredAttachment {
    mime: string;
    bytes: Uint8Array;
}

const attachmentKey = (id: string) => ATTACHMENT_PREFIX + id;

// Pièces jointes

async function storeAttachment(att: MessageAttachment): Promise<AttachmentRef> {
    const ref: AttachmentRef = {
        id: att.id,
        filename: att.filename,
        url: att.url,
        mime: att.content_type ?? "application/octet-stream",
        size: att.size,
        stored: false
    };
    const maxBytes = Math.max(0, settings.store.maxAttachmentMb) * 1024 * 1024;
    if (!Native || att.size > maxBytes) return ref;

    const res = await Native.downloadAttachment(att.url, maxBytes).catch(() => null);
    if (!res?.ok) return ref;

    await DataStore.set(attachmentKey(att.id), { mime: att.content_type ?? res.mime, bytes: res.bytes } satisfies StoredAttachment);
    return { ...ref, mime: att.content_type ?? res.mime, stored: true };
}

const blobUrls = new Map<string, Promise<string | null>>();

/** URL blob: d'une pièce jointe stockée, mise en cache jusqu'à l'arrêt du plugin */
export function getAttachmentUrl(id: string) {
    let url = blobUrls.get(id);
    if (!url) {
        url = DataStore.get<StoredAttachment>(attachmentKey(id)).then(stored =>
            stored ? URL.createObjectURL(new Blob([stored.bytes as BlobPart], { type: stored.mime })) : null
        );
        blobUrls.set(id, url);
    }
    return url;
}

export function revokeAttachmentUrls() {
    for (const url of blobUrls.values()) url.then(u => u && URL.revokeObjectURL(u));
    blobUrls.clear();
}

// Capture

function toCaptured(message: Message, attachments: AttachmentRef[], guildId: string): CapturedMessage {
    return {
        id: message.id,
        channelId: message.channel_id,
        authorId: message.author.id,
        authorName: displayName(message.author.id, guildId),
        content: message.content,
        timestamp: new Date(message.timestamp as any).getTime(),
        // Les messages bruts de MESSAGE_CREATE utilisent edited_timestamp, ceux de MessageStore editedTimestamp
        edited: !!(message.editedTimestamp ?? (message as any).edited_timestamp),
        attachments
    };
}

async function captureMessages(messages: Message[], guildId: string, targetId: string) {
    return Promise.all(messages.map(async m => ({
        ...toCaptured(m, await Promise.all((m.attachments ?? []).map(storeAttachment)), guildId),
        target: m.id === targetId || undefined
    })));
}

const inProgress = new Set<string>();

/** Capture le message et son contexte depuis MessageStore, pièces jointes comprises */
export async function captureEvidence(message: Message, guildId: string) {
    if (inProgress.has(message.id) || getData().evidence.some(e => e.messageId === message.id && !e.deleted)) {
        showToast({ text: "Ce message est déjà enregistré comme preuve." });
        return;
    }
    inProgress.add(message.id);
    try {
        const all: Message[] = MessageStore.getMessages(message.channel_id)?._array ?? [message];
        const index = all.findIndex(m => m.id === message.id);
        const n = Math.max(0, settings.store.contextSize);
        const slice = index === -1 ? [message] : all.slice(Math.max(0, index - n), index + n + 1);

        showToast({ text: "Capture en cours…" });
        const evidence: Evidence = {
            id: newId(),
            createdAt: Date.now(),
            guildId,
            channelId: message.channel_id,
            messageId: message.id,
            userId: message.author.id,
            userName: displayName(message.author.id, guildId),
            messages: await captureMessages(slice, guildId, message.id)
        };
        updateData(d => ({ evidence: [evidence, ...d.evidence] }));

        const failed = evidence.messages.flatMap(m => m.attachments).filter(a => !a.stored).length;
        showToast({ text: failed ? `Preuve enregistrée (${failed} pièce(s) jointe(s) non stockée(s))` : "Preuve enregistrée" });
    } finally {
        inProgress.delete(message.id);
    }
}

// Messages des membres surveillés gardés en mémoire, pour retrouver ceux qui sont supprimés

const MAX_CACHED = 200;
const recentMessages = new Map<string, { message: Message; guildId: string; }>();

export function cacheWatchedMessage(message: Message, guildId: string) {
    recentMessages.set(message.id, { message, guildId });
    if (recentMessages.size > MAX_CACHED) recentMessages.delete(recentMessages.keys().next().value!);
}

export function clearMessageCache() {
    recentMessages.clear();
}

/** Marque les copies d'un message supprimé et l'enregistre comme preuve s'il vient d'un membre surveillé */
export async function onMessageDeleted(id: string, channelId: string, guildId: string): Promise<Evidence | null> {
    const { evidence, watched } = getData();
    if (evidence.some(e => e.messages.some(m => m.id === id))) {
        updateData(d => ({
            evidence: d.evidence.map(e => e.messages.some(m => m.id === id)
                ? { ...e, messages: e.messages.map(m => m.id === id ? { ...m, deleted: true } : m) }
                : e)
        }));
    }

    const message = recentMessages.get(id)?.message ?? MessageStore.getMessage(channelId, id);
    recentMessages.delete(id);
    if (!message || !watched[message.author.id] || evidence.some(e => e.messageId === id)) return null;

    const [captured] = await captureMessages([message], guildId, id);
    const entry: Evidence = {
        id: newId(),
        createdAt: Date.now(),
        guildId,
        channelId,
        messageId: id,
        userId: message.author.id,
        userName: displayName(message.author.id, guildId),
        messages: [{ ...captured, deleted: true }],
        deleted: true
    };
    updateData(d => ({ evidence: [entry, ...d.evidence] }));
    return entry;
}

/** Supprime une preuve et les pièces jointes qu'aucune autre preuve n'utilise */
export async function deleteEvidence(id: string) {
    const target = getData().evidence.find(e => e.id === id);
    if (!target) return;
    const rest = getData().evidence.filter(e => e.id !== id);
    const used = new Set(rest.flatMap(e => e.messages.flatMap(m => m.attachments.map(a => a.id))));
    const orphans = target.messages.flatMap(m => m.attachments).filter(a => a.stored && !used.has(a.id)).map(a => a.id);

    updateData(() => ({ evidence: rest }));
    await DataStore.delMany(orphans.map(attachmentKey));
}

// Export / import

// Réglages repris par l'export : configuration complète, pour passer d'un ordinateur à l'autre
const CONFIG_KEYS = [
    "guildId", "sanctionChannelId", "contextSize", "maxAttachmentMb",
    "notifyMessages", "notifyVoice", "notifyMembers", "notifyDeleted",
    "actions", "categories", "reportTemplate"
] as const;

type Config = Partial<Record<typeof CONFIG_KEYS[number], any>>;

/** Fichier ModSight : réglages, données, ou les deux (un modèle de motifs ne contient que config.categories) */
interface ExportFile {
    modsight: 1;
    exportedAt?: number;
    config?: Config;
    data?: ModSightData;
    attachments?: Record<string, { mime: string; base64: string; }>;
}

function toBase64(bytes: Uint8Array) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

function fromBase64(base64: string) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

export async function exportAll(): Promise<string> {
    const data = getData();
    const ids = [...new Set(data.evidence.flatMap(e => e.messages.flatMap(m => m.attachments.filter(a => a.stored).map(a => a.id))))];
    const stored = await DataStore.getMany<StoredAttachment | undefined>(ids.map(attachmentKey));
    const attachments: ExportFile["attachments"] = {};
    ids.forEach((id, i) => {
        const s = stored[i];
        if (s) attachments[id] = { mime: s.mime, base64: toBase64(s.bytes) };
    });
    const config: Config = {};
    for (const key of CONFIG_KEYS) config[key] = settings.store[key];
    const file: ExportFile = { modsight: 1, exportedAt: Date.now(), config: JSON.parse(JSON.stringify(config)), data, attachments };
    return JSON.stringify(file);
}

const isData = (d: any): d is ModSightData =>
    !!d && Array.isArray(d.evidence) && Array.isArray(d.sanctions) && typeof d.watched === "object";

/** Lit un fichier ModSight ; lève une erreur s'il n'en est pas un */
export function parseExport(text: string): ExportFile {
    const file = JSON.parse(text) as ExportFile;
    const hasConfig = !!file?.config && typeof file.config === "object";
    if (file?.modsight !== 1 || (!hasConfig && !isData(file.data)) || (file.data && !isData(file.data)))
        throw new Error("Ce fichier n'est pas un fichier ModSight.");
    if (file.config?.categories && !(Array.isArray(file.config.categories) && file.config.categories.every((c: any) => Array.isArray(c?.steps))))
        throw new Error("Les motifs de ce fichier sont mal formés.");
    return file;
}

/** Ce que l'import va remplacer, pour la fenêtre de confirmation */
export function describeImport(file: ExportFile) {
    const parts: string[] = [];
    const { config, data } = file;
    if (config?.categories) parts.push(`${config.categories.length} motif(s)`);
    if (config?.actions) parts.push(`${config.actions.length} action(s)`);
    if (config && CONFIG_KEYS.some(k => k !== "categories" && k !== "actions" && k in config)) parts.push("les réglages (serveur, salon, notifications…)");
    if (data) parts.push(`${Object.keys(data.watched).length} surveillé(s), ${data.evidence.length} preuve(s), ${data.sanctions.length} sanction(s)`);
    return parts.join(", ");
}

/** Remplace, partie par partie, ce que contient le fichier : réglages présents, puis données */
export async function importAll(file: ExportFile) {
    if (file.config) {
        const store = settings.store as Record<string, unknown>;
        for (const key of CONFIG_KEYS) if (key in file.config) store[key] = file.config[key];
        migrateCategories();
    }
    if (file.data) {
        const oldKeys = (await DataStore.keys()).filter(k => typeof k === "string" && k.startsWith(ATTACHMENT_PREFIX));
        await DataStore.delMany(oldKeys);
        await DataStore.setMany(Object.entries(file.attachments ?? {}).map(([id, a]) => [attachmentKey(id), { mime: a.mime, bytes: fromBase64(a.base64) }]));
        revokeAttachmentUrls();
        clearMessageCache();
        await replaceData(file.data);
    }
}
