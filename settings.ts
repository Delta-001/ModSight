/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";
import { React } from "@webpack/common";

import { UpdateSection } from "./components/UpdateSection";

/** Commande slash d'un bot (DraftBot…), pré-remplie puis collée par l'utilisateur */
export interface SlashConfig {
    applicationId: string;
    /** Nom complet de la commande, sous-commandes comprises : "ban", "sanction ban" */
    command: string;
    /** Modèle de valeur par nom d'option */
    options: Record<string, string>;
}

/** Action de sanction du bot (Warn, Mute, Ban…), avec sa commande texte ou slash */
export interface SanctionAction {
    id: string;
    name: string;
    emoji: string;
    /** Commande texte (bot à préfixe), utilisée quand slash est absent */
    command: string;
    slash?: SlashConfig;
}

/** Palier d'un motif : la sanction prévue la Nᵉ fois */
export interface Step {
    /** ID de l'action, ou "" pour une consigne sans commande */
    action: string;
    duration?: string;
    /** Consigne affichée au modérateur */
    note?: string;
}

/** Motif de sanction, avec ses paliers successifs */
export interface Category {
    id: string;
    name: string;
    emoji: string;
    color: string;
    reason: string;
    /** Consigne générale du motif */
    hint?: string;
    steps: Step[];
    /** Au-delà des paliers : action à appliquer, et jours ajoutés à chaque récidive */
    repeat?: { action: string; addDays?: number; };
}

export const DEFAULT_ACTIONS: SanctionAction[] = [
    { id: "note", name: "Note", emoji: "📝", command: "+note {id} {raison}" },
    { id: "warn", name: "Warn", emoji: "⚠️", command: "+warn {id} {raison}" },
    { id: "mute", name: "Mute", emoji: "🔇", command: "+mute {id} {durée} {raison}" },
    { id: "forclos", name: "Forclos", emoji: "⛔", command: "+forclos {id} {durée} {raison}" },
    { id: "ban", name: "Ban", emoji: "🔨", command: "+ban {id} {raison}" }
];

export const DEFAULT_CATEGORIES: Category[] = [
    {
        id: "spam", name: "Spam", emoji: "🔁", color: "#5865f2", reason: "Spam",
        steps: [{ action: "warn" }, { action: "mute", duration: "1h" }, { action: "mute", duration: "1j" }, { action: "mute", duration: "3j" }],
        repeat: { action: "mute", addDays: 3 }
    },
    {
        id: "insulte", name: "Insulte membre", emoji: "🤬", color: "#e67e22", reason: "Insulte envers un membre",
        steps: [{ action: "mute", duration: "1h" }, { action: "mute", duration: "1j" }, { action: "mute", duration: "3j" }, { action: "mute", duration: "7j" }],
        repeat: { action: "mute", addDays: 7 }
    },
    { id: "scam", name: "Scam de compte", emoji: "💸", color: "#da373c", reason: "Scam de compte", steps: [{ action: "ban" }] }
];

export const DEFAULT_REPORT = [
    "**Sanction : {catégorie}** ({niveau}ᵉ fois) → {action} {durée}",
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
    actions: {
        type: OptionType.CUSTOM,
        default: DEFAULT_ACTIONS as SanctionAction[]
    },
    categories: {
        type: OptionType.CUSTOM,
        default: DEFAULT_CATEGORIES as Category[]
    },
    reportTemplate: {
        type: OptionType.CUSTOM,
        default: DEFAULT_REPORT
    },
    update: {
        type: OptionType.COMPONENT,
        // Résolu au rendu : UpdateSection importe ce fichier
        component: () => React.createElement(UpdateSection)
    }
});

export const isModGuild = (guildId: string | null | undefined) => !!guildId && guildId === settings.store.guildId;

/** Convertit les catégories d'avant les paliers (une commande par catégorie) en action + motif à un palier */
export function migrateCategories() {
    const old = settings.store.categories as any[];
    if (!old.some(c => !Array.isArray(c.steps))) return;

    const actions = [...settings.store.actions];
    settings.store.categories = old.map(c => {
        if (Array.isArray(c.steps)) return c;
        const actionId = "ancien-" + c.id;
        actions.push({ id: actionId, name: c.name, emoji: c.emoji, command: c.command ?? "", slash: c.slash });
        return { id: c.id, name: c.name, emoji: c.emoji, color: c.color, reason: c.reason, steps: [{ action: actionId, duration: c.durations?.[0] }] };
    });
    settings.store.actions = actions;
}
