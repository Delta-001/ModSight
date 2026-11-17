/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";

const ALLOWED_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

export type DownloadResult =
    | { ok: true; mime: string; bytes: Uint8Array; }
    | { ok: false; error: string; };

function isAllowed(raw: string) {
    try {
        const url = new URL(raw);
        return url.protocol === "https:" && ALLOWED_HOSTS.has(url.hostname);
    } catch {
        return false;
    }
}

/** Télécharge une pièce jointe du CDN Discord (les liens signés expirent), sans cookie ni jeton */
export async function downloadAttachment(_: IpcMainInvokeEvent, url: string, maxBytes: number): Promise<DownloadResult> {
    if (!isAllowed(url)) return { ok: false, error: "Hôte non autorisé" };
    try {
        const res = await fetch(url, { redirect: "follow", credentials: "omit" });
        if (!isAllowed(res.url)) return { ok: false, error: "Redirection non autorisée" };
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

        const length = Number(res.headers.get("content-length"));
        if (length > maxBytes) return { ok: false, error: "Fichier trop volumineux" };

        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength > maxBytes) return { ok: false, error: "Fichier trop volumineux" };

        return { ok: true, mime: res.headers.get("content-type") ?? "application/octet-stream", bytes };
    } catch (e: any) {
        return { ok: false, error: String(e?.message ?? e) };
    }
}
