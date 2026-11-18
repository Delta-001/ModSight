/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile as cpExecFile } from "child_process";
import { IpcMainInvokeEvent } from "electron";
import { existsSync } from "fs";
import { readdir } from "fs/promises";
import { join } from "path";
import { promisify } from "util";

import { WEBHOOK_PATTERN } from "./webhook";

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

export type WebhookResult =
    | { ok: true; /** Salon (ou fil) où le message a été posté, avec wait */ channelId?: string; }
    | { ok: false; error: string; /** Code d'erreur JSON de Discord */ code?: number; retryAfter?: number; };

export interface WebhookFile {
    name: string;
    mime: string;
    bytes: Uint8Array;
}

export interface WebhookOptions {
    /** Attend la réponse de Discord pour connaître le fil créé */
    wait?: boolean;
    /** Fil existant où poster */
    threadId?: string;
}

/** Poste sur un webhook Discord : c'est le webhook qui écrit, pas le compte de l'utilisateur (ni cookie ni jeton) */
export async function postWebhook(_: IpcMainInvokeEvent, url: string, body: unknown, files: WebhookFile[] = [], { wait, threadId }: WebhookOptions = {}): Promise<WebhookResult> {
    if (!WEBHOOK_PATTERN.test(url)) return { ok: false, error: "URL de webhook invalide" };
    const target = new URL(url);
    if (wait) target.searchParams.set("wait", "true");
    if (threadId && /^\d+$/.test(threadId)) target.searchParams.set("thread_id", threadId);

    let payload: string | FormData = JSON.stringify(body);
    if (files.length) {
        const form = new FormData();
        form.append("payload_json", payload);
        files.forEach((f, i) => form.append(`files[${i}]`, new Blob([f.bytes as BlobPart], { type: f.mime }), f.name));
        payload = form;
    }

    try {
        const res = await fetch(target, {
            method: "POST",
            headers: files.length ? undefined : { "Content-Type": "application/json" },
            body: payload,
            credentials: "omit",
            redirect: "error"
        });
        const json = await res.json().catch(() => null);
        if (res.status === 429) return { ok: false, error: "Trop de messages", retryAfter: Number(json?.retry_after) || 2 };
        if (res.status === 413) return { ok: false, error: "Fichiers trop volumineux pour ce salon" };
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}${json?.message ? " " + json.message : ""}`, code: json?.code };
        return { ok: true, channelId: json?.channel_id };
    } catch (e: any) {
        return { ok: false, error: String(e?.message ?? e) };
    }
}

/** Salon d'un webhook : lecture publique de Discord avec le jeton du webhook, sans compte */
export async function getWebhookInfo(_: IpcMainInvokeEvent, url: string): Promise<{ channelId: string; name: string; } | null> {
    if (!WEBHOOK_PATTERN.test(url)) return null;
    try {
        const res = await fetch(url, { credentials: "omit", redirect: "error" });
        if (!res.ok) return null;
        const json = await res.json();
        return { channelId: String(json.channel_id), name: String(json.name ?? "") };
    } catch {
        return null;
    }
}

// Mise à jour du plugin : git pull dans son dossier puis recompilation de Vencord, comme le fait l'updater de Vencord

const execFile = promisify(cpExecFile);
const VENCORD_DIR = join(__dirname, "..");

// Discord lancé depuis le Finder n'hérite pas du PATH du terminal
if (process.platform === "darwin") process.env.PATH = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`;

const run = (cwd: string, command: string, ...args: string[]) =>
    execFile(command, args, { cwd, timeout: 300_000 }).then(r => r.stdout.trim());

const errorText = (e: any) => String(e?.stderr || e?.message || e).trim().split("\n").slice(0, 8).join("\n");

/** Dossier git de ModSight dans src/userplugins, quel que soit son nom (lien symbolique compris) */
async function findPluginDir() {
    const root = join(VENCORD_DIR, "src", "userplugins");
    for (const name of await readdir(root).catch(() => [] as string[])) {
        const dir = join(root, name);
        if (!existsSync(join(dir, ".git"))) continue;
        const origin = await run(dir, "git", "remote", "get-url", "origin").catch(() => "");
        if (/modsight/i.test(origin)) return dir;
    }
    throw new Error("Dossier git de ModSight introuvable dans src/userplugins. Le plugin doit avoir été installé avec git clone.");
}

export interface UpdateCommit {
    hash: string;
    message: string;
}

export type UpdateCheck =
    | { ok: true; repo: string; current: string; commits: UpdateCommit[]; }
    | { ok: false; error: string; };

export async function checkUpdate(): Promise<UpdateCheck> {
    try {
        const dir = await findPluginDir();
        await run(dir, "git", "fetch", "--quiet", "origin");
        const log = await run(dir, "git", "log", "HEAD..@{u}", "--pretty=format:%h %s");
        return {
            ok: true,
            repo: (await run(dir, "git", "remote", "get-url", "origin")).replace(/\.git$/, ""),
            current: await run(dir, "git", "rev-parse", "--short", "HEAD"),
            commits: log ? log.split("\n").map(line => ({ hash: line.slice(0, line.indexOf(" ")), message: line.slice(line.indexOf(" ") + 1) })) : []
        };
    } catch (e) {
        return { ok: false, error: errorText(e) };
    }
}

export type UpdateResult =
    | { ok: true; needsRestart: boolean; }
    | { ok: false; error: string; };

export async function applyUpdate(): Promise<UpdateResult> {
    let dir: string;
    let changed: string[];
    try {
        dir = await findPluginDir();
        const before = await run(dir, "git", "rev-parse", "HEAD");
        await run(dir, "git", "pull", "--ff-only", "--quiet");
        changed = (await run(dir, "git", "diff", "--name-only", before, "HEAD")).split("\n");
    } catch (e) {
        return { ok: false, error: "Échec de git pull :\n" + errorText(e) };
    }

    try {
        const args = ["scripts/build/build.mjs"];
        if (IS_DEV) args.push("--dev");
        const { stderr } = await execFile("node", args, { cwd: VENCORD_DIR, timeout: 300_000 });
        if (stderr.includes("Build failed")) return { ok: false, error: "Échec de la compilation :\n" + errorText({ stderr }) };
    } catch (e) {
        return { ok: false, error: "Échec de la compilation :\n" + errorText(e) };
    }

    // native.ts tourne dans le processus principal : il faut redémarrer Discord pour le recharger
    return { ok: true, needsRestart: changed.includes("native.ts") };
}
