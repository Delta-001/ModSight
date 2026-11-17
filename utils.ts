/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, GuildMemberStore, NavigationRouter, SelectedChannelStore, showToast, UserStore } from "@webpack/common";

import { settings } from "./settings";

export const cl = classNameFactory("vc-ms-");

/** Raccourci de collage affiché dans les messages : Cmd+V sur Mac, Ctrl+V ailleurs */
export const PASTE_KEY = navigator.platform.toLowerCase().includes("mac") ? "Cmd+V" : "Ctrl+V";

const { selectVoiceChannel } = findByPropsLazy("selectVoiceChannel", "selectChannel");

export const TEMPLATE_VARIABLES: [string, string][] = [
    ["{id}", "ID du membre"],
    ["{mention}", "Mention du membre (<@id>)"],
    ["{pseudo}", "Pseudo sur le serveur"],
    ["{durée}", "Durée choisie"],
    ["{raison}", "Raison"],
    ["{preuves}", "Liens des messages cochés comme preuves"],
    ["{message}", "Lien du message d'origine"],
    ["{salon}", "Salon du message d'origine"],
    ["{catégorie}", "Nom du motif"],
    ["{action}", "Action du palier (Warn, Mute…)"],
    ["{niveau}", "Numéro de l'infraction pour ce motif (1, 2, 3…)"],
    ["{commande}", "Commande finale (rapport uniquement)"],
    ["{récidive}", "Nombre de sanctions validées"],
    ["{date}", "Date du jour"]
];

/** Remplace les variables {nom}. Une variable vide disparaît et les espaces en double sont nettoyés, ligne par ligne */
export function fillTemplate(template: string, vars: Record<string, string>) {
    return template
        .split("\n")
        .map(line => line
            .replace(/\{([^{}\s]+)\}/g, (match, key: string) => {
                // Les accents tapés au clavier peuvent arriver décomposés (é = e + ´)
                const name = key.normalize("NFC");
                return name in vars ? vars[name] : match;
            })
            .replace(/[ \t]{2,}/g, " ")
            .trim())
        .join("\n")
        .trim();
}

export function displayName(userId: string, guildId = settings.store.guildId) {
    const user = UserStore.getUser(userId);
    return GuildMemberStore.getNick(guildId, userId) ?? user?.globalName ?? user?.username ?? userId;
}

export function avatarUrl(userId: string, size = 64) {
    return UserStore.getUser(userId)?.getAvatarURL(settings.store.guildId, size) ?? "https://cdn.discordapp.com/embed/avatars/0.png";
}

export function channelName(channelId: string | null | undefined) {
    const channel = channelId ? ChannelStore.getChannel(channelId) : undefined;
    return channel ? `#${channel.name}` : "salon inconnu";
}

export const messageLink = (guildId: string, channelId: string, messageId: string) =>
    `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

export function goToChannel(channelId: string, messageId?: string) {
    const guildId = ChannelStore.getChannel(channelId)?.guild_id ?? settings.store.guildId;
    NavigationRouter.transitionTo(`/channels/${guildId}/${channelId}${messageId ? "/" + messageId : ""}`);
}

export function joinVoice(channelId: string) {
    selectVoiceChannel(channelId);
}

export const formatDate = (ts: number) =>
    new Date(ts).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const formatDay = (ts: number) => new Date(ts).toLocaleDateString("fr-FR");

export function timeAgo(ts: number) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return "à l'instant";
    const m = Math.round(s / 60);
    if (m < 60) return `il y a ${m} min`;
    const h = Math.round(m / 60);
    if (h < 48) return `il y a ${h} h`;
    return `il y a ${Math.round(h / 24)} j`;
}

export const daysSince = (ts: number) => Math.floor((Date.now() - ts) / 86_400_000);

function waitForChannel(channelId: string, timeout = 5000) {
    return new Promise<boolean>(resolve => {
        const start = Date.now();
        const check = () => {
            if (SelectedChannelStore.getChannelId() === channelId) return resolve(true);
            if (Date.now() - start > timeout) return resolve(false);
            setTimeout(check, 100);
        };
        check();
    });
}

/** Ouvre le salon de sanction et attend qu'il soit le salon actif */
export async function openSanctionChannel() {
    const channelId = settings.store.sanctionChannelId;
    if (!channelId || !ChannelStore.getChannel(channelId)) {
        showToast({ text: "Aucun salon de sanction valide : configure-le dans les réglages ModSight." });
        return false;
    }
    goToChannel(channelId);
    if (!await waitForChannel(channelId)) {
        showToast({ text: "Le salon de sanction ne s'est pas ouvert à temps. Utilise « Copier la commande »." });
        return false;
    }
    return true;
}

/** Ouvre le salon de sanction et y insère le texte, sans l'envoyer */
export async function insertInSanctionChannel(text: string) {
    if (!await openSanctionChannel()) return false;
    // Laisse la barre de message se monter avant d'y insérer le texte
    await new Promise(r => setTimeout(r, 300));
    insertTextIntoChatInputBox(text);
    return true;
}
