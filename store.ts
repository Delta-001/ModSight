/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { useEffect, useReducer } from "@webpack/common";

const DATA_KEY = "ModSight_data";
export const ATTACHMENT_PREFIX = "ModSight_att_";
const SAVE_DELAY = 500;
export const MAX_VOICE_HISTORY = 200;

export interface VoiceSession {
    channelId: string;
    joinedAt: number;
    leftAt?: number;
}

export interface WatchEntry {
    userId: string;
    reason: string;
    addedAt: number;
    /** Dernier pseudo vu, pour détecter les changements */
    nick?: string;
    lastActivity?: number;
    /** Salon vocal actuel connu, pour savoir ce qui a changé au prochain évènement */
    voiceChannelId?: string | null;
    voiceHistory: VoiceSession[];
}

export interface AttachmentRef {
    id: string;
    filename: string;
    url: string;
    mime: string;
    size: number;
    stored: boolean;
}

export interface CapturedMessage {
    id: string;
    channelId: string;
    authorId: string;
    authorName: string;
    content: string;
    timestamp: number;
    edited: boolean;
    attachments: AttachmentRef[];
    target?: boolean;
    deleted?: boolean;
}

export interface Evidence {
    id: string;
    createdAt: number;
    guildId: string;
    channelId: string;
    messageId: string;
    userId: string;
    userName: string;
    messages: CapturedMessage[];
    /** Enregistrée automatiquement après la suppression du message */
    deleted?: boolean;
}

export type SanctionStatus = "pending" | "approved" | "rejected";

export interface SanctionRecord {
    id: string;
    createdAt: number;
    userId: string;
    userName: string;
    categoryId: string;
    categoryName: string;
    color: string;
    /** Action du palier appliqué (Warn, Mute…) et numéro de l'infraction pour ce motif */
    actionName?: string;
    level?: number;
    duration: string;
    reason: string;
    command: string;
    /** Données de commande slash à coller, présentes pour les catégories en mode slash */
    slashPayload?: string;
    report: string;
    evidenceIds: string[];
    status: SanctionStatus;
}

export interface ModSightData {
    version: 1;
    watched: Record<string, WatchEntry>;
    evidence: Evidence[];
    sanctions: SanctionRecord[];
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const defaults = (): ModSightData => ({ version: 1, watched: {}, evidence: [], sanctions: [] });

let data = defaults();
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

export const getData = () => data;
export const isLoaded = () => loaded;

function emit() {
    for (const listener of listeners) listener();
}

export function updateData(updater: (prev: ModSightData) => Partial<ModSightData>) {
    data = { ...data, ...updater(data) };
    emit();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushData, SAVE_DELAY);
}

export function flushData() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (loaded) return DataStore.set(DATA_KEY, data);
}

export async function loadData() {
    const saved = await DataStore.get<Partial<ModSightData>>(DATA_KEY);
    data = { ...defaults(), ...saved, version: 1 };
    loaded = true;
    emit();
}

/** Remplace toutes les données (import) et sauvegarde immédiatement */
export async function replaceData(next: ModSightData) {
    data = { ...defaults(), ...next, version: 1 };
    emit();
    await flushData();
}

export function useData<T>(selector: (d: ModSightData) => T): T {
    const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
    useEffect(() => {
        listeners.add(forceUpdate);
        return () => void listeners.delete(forceUpdate);
    }, []);
    return selector(data);
}

// Liste de surveillance

export function setWatched(userId: string, reason: string, nick: string, voiceChannelId: string | null) {
    updateData(d => ({
        watched: {
            ...d.watched,
            [userId]: d.watched[userId]
                ? { ...d.watched[userId], reason }
                : { userId, reason, addedAt: Date.now(), nick, voiceChannelId, voiceHistory: [] }
        }
    }));
}

export function unwatch(userId: string) {
    updateData(d => {
        const { [userId]: _, ...watched } = d.watched;
        return { watched };
    });
}

export function patchWatched(userId: string, patch: (w: WatchEntry) => Partial<WatchEntry>) {
    updateData(d => {
        const entry = d.watched[userId];
        if (!entry) return {};
        return { watched: { ...d.watched, [userId]: { ...entry, ...patch(entry) } } };
    });
}

// Sanctions

/** Sanctions validées d'un membre : sert au calcul de la récidive */
export const countApproved = (d: ModSightData, userId: string) =>
    d.sanctions.filter(s => s.userId === userId && s.status === "approved").length;

export function upsertSanction(record: SanctionRecord) {
    updateData(d => {
        const exists = d.sanctions.some(s => s.id === record.id);
        return {
            sanctions: exists
                ? d.sanctions.map(s => s.id === record.id ? { ...record, status: s.status } : s)
                : [record, ...d.sanctions]
        };
    });
}

/** Rattache une preuve capturée après coup à une sanction */
export function addSanctionEvidence(id: string, evidenceId: string) {
    updateData(d => ({
        sanctions: d.sanctions.map(s => s.id === id && !s.evidenceIds.includes(evidenceId) ? { ...s, evidenceIds: [...s.evidenceIds, evidenceId] } : s)
    }));
}

export function setSanctionStatus(id: string, status: SanctionStatus) {
    updateData(d => ({ sanctions: d.sanctions.map(s => s.id === id ? { ...s, status } : s) }));
}
