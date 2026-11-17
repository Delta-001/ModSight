/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

/** Commande slash d'un bot (DraftBot…), pré-remplie puis collée par l'utilisateur */
export interface SlashConfig {
    applicationId: string;
    /** Nom complet de la commande, sous-commandes comprises : "ban", "sanction ban" */
    command: string;
    /** Modèle de valeur par nom d'option */
    options: Record<string, string>;
}

export interface Category {
    id: string;
    name: string;
    emoji: string;
    color: string;
    /** Commande texte (bot à préfixe), utilisée quand slash est absent */
    command: string;
    slash?: SlashConfig;
    durations: string[];
    reason: string;
}

const WARN = "+warn {id} {raison}";
const MUTE = "+mute {id} {durée} {raison}";
const BAN = "+ban {id} {raison}";

export const DEFAULT_CATEGORIES: Category[] = [
    { id: "warn", name: "Avertissement", emoji: "⚠️", color: "#f0b232", command: WARN, durations: [], reason: "Non-respect du règlement" },
    { id: "spam", name: "Spam/Flood", emoji: "🔁", color: "#5865f2", command: MUTE, durations: ["10m", "30m", "1h", "6h"], reason: "Spam / flood" },
    { id: "insultes", name: "Insultes", emoji: "🤬", color: "#e67e22", command: MUTE, durations: ["1h", "6h", "12h", "1d"], reason: "Insultes envers un membre" },
    { id: "pub", name: "Pub", emoji: "📢", color: "#9b59b6", command: MUTE, durations: ["1h", "1d", "7d"], reason: "Publicité non autorisée" },
    { id: "arnaque", name: "Arnaque", emoji: "💸", color: "#da373c", command: BAN, durations: [], reason: "Tentative d'arnaque" },
    { id: "nsfw", name: "NSFW", emoji: "🔞", color: "#ed4245", command: BAN, durations: [], reason: "Contenu NSFW" },
    { id: "pirate", name: "Compte piraté", emoji: "🏴‍☠️", color: "#747f8d", command: BAN, durations: [], reason: "Compte compromis (piraté)" }
];

export const DEFAULT_REPORT = [
    "**Sanction : {catégorie}**",
    "Membre : {mention} ({pseudo} · {id})",
    "Commande : `{commande}`",
    "Raison : {raison}",
    "Récidive : {récidive} sanction(s) validée(s) avant celle-ci",
    "Preuves : {preuves}",
    "Date : {date}"
].join("\n");

export const settings = definePluginSettings({
    guildId: {
        type: OptionType.STRING,
        description: "ID du serveur modéré (clic droit sur le serveur → « ModSight : serveur de modération »)",
        default: ""
    },
    sanctionChannelId: {
        type: OptionType.STRING,
        description: "ID du salon de sanction (clic droit sur le salon → « ModSight : salon de sanction »)",
        default: ""
    },
    contextSize: {
        type: OptionType.NUMBER,
        description: "Nombre de messages capturés avant et après le message ciblé",
        default: 5
    },
    maxAttachmentMb: {
        type: OptionType.NUMBER,
        description: "Taille maximale d'une pièce jointe téléchargée (Mo)",
        default: 8
    },
    notifyMessages: {
        type: OptionType.BOOLEAN,
        description: "Notifier les messages des membres surveillés (une fois par minute et par membre)",
        default: true
    },
    notifyVoice: {
        type: OptionType.BOOLEAN,
        description: "Notifier les arrivées, changements et départs de vocal des membres surveillés",
        default: true
    },
    notifyMembers: {
        type: OptionType.BOOLEAN,
        description: "Notifier les changements de pseudo, arrivées et départs des membres surveillés",
        default: true
    },
    notifyDeleted: {
        type: OptionType.BOOLEAN,
        description: "Notifier quand un message d'un membre surveillé est supprimé",
        default: true
    },
    categories: {
        type: OptionType.CUSTOM,
        default: DEFAULT_CATEGORIES as Category[]
    },
    reportTemplate: {
        type: OptionType.CUSTOM,
        default: DEFAULT_REPORT
    }
});

export const isModGuild = (guildId: string | null | undefined) => !!guildId && guildId === settings.store.guildId;
