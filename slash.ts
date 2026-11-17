/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findStoreLazy } from "@webpack";
import { ComponentDispatch, DraftStore } from "@webpack/common";

import { SlashConfig } from "./settings";
import { fillTemplate } from "./utils";

/*
 * Discord transforme un collage en commande slash pré-remplie quand les données collées contiennent
 * ce type et que la barre de message est vide. ModSight passe ces données à la barre comme le fait
 * Discord pour un collage, sans rien envoyer : l'utilisateur vérifie puis appuie sur Entrée.
 * Aucun appel à l'API.
 */
const INTERACTION_MIME = "application/x-discord-interaction-data";

export const ApplicationCommandIndexStore = findStoreLazy("ApplicationCommandIndexStore");
const ApplicationCommandStore = findStoreLazy("ApplicationCommandStore");

export const enum OptionType {
    SUB_COMMAND = 1,
    SUB_COMMAND_GROUP = 2,
    STRING = 3,
    INTEGER = 4,
    BOOLEAN = 5,
    USER = 6,
    CHANNEL = 7,
    ROLE = 8,
    MENTIONABLE = 9,
    NUMBER = 10,
    ATTACHMENT = 11
}

export interface CommandOption {
    name: string;
    displayName?: string;
    displayDescription?: string;
    type: number;
    required?: boolean;
    autocomplete?: boolean;
    choices?: { name: string; displayName?: string; value: string | number; }[];
}

export interface IndexedCommand {
    id: string;
    untranslatedName: string;
    displayName: string;
    displayDescription?: string;
    applicationId: string;
    options?: CommandOption[];
    rootCommand: { id: string; name: string; type?: number; version?: string; };
    subCommandPath?: { name: string; type: number; }[];
}

export interface IndexedApp {
    id: string;
    name: string;
    commands: IndexedCommand[];
}

export const OPTION_TYPE_LABELS: Record<number, string> = {
    [OptionType.STRING]: "texte",
    [OptionType.INTEGER]: "nombre entier",
    [OptionType.BOOLEAN]: "oui/non",
    [OptionType.USER]: "membre",
    [OptionType.CHANNEL]: "salon",
    [OptionType.ROLE]: "rôle",
    [OptionType.MENTIONABLE]: "membre ou rôle",
    [OptionType.NUMBER]: "nombre",
    [OptionType.ATTACHMENT]: "fichier"
};

/** Commandes slash des bots du serveur, telles que Discord les a déjà chargées (en tapant « / ») */
export function getGuildApps(guildId: string, state = ApplicationCommandIndexStore.getGuildState(guildId)): IndexedApp[] {
    const sections = state?.result?.sections ?? {};
    return Object.values<any>(sections)
        .map(s => ({
            id: s.descriptor.id as string,
            name: (s.descriptor.name ?? s.descriptor.application?.name ?? "Application") as string,
            commands: (Object.values(s.commands) as IndexedCommand[]).sort((a, b) => a.untranslatedName.localeCompare(b.untranslatedName))
        }))
        .filter(a => a.commands.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
}

export function findCommand(guildId: string, slash: SlashConfig) {
    return getGuildApps(guildId)
        .find(a => a.id === slash.applicationId)
        ?.commands.find(c => c.untranslatedName === slash.command);
}

/** Modèles proposés par défaut d'après le type et le nom de chaque option */
export function guessTemplates(command: IndexedCommand) {
    const options: Record<string, string> = {};
    for (const o of command.options ?? []) {
        const name = o.name.toLowerCase();
        if (o.type === OptionType.USER || o.type === OptionType.MENTIONABLE || /member|membre|user|utilisateur|target|cible/.test(name)) options[o.name] = "{id}";
        else if (/raison|reason|motif/.test(name)) options[o.name] = "{raison}";
        else if (/dur[ée]e|duration|temps|time/.test(name)) options[o.name] = "{durée}";
        else if (/preuve|proof/.test(name)) options[o.name] = "{preuves}";
    }
    return options;
}

function toValue(option: CommandOption, raw: string): string | number | boolean | null {
    if (!raw) return null;
    if (option.choices?.length) {
        const choice = option.choices.find(c => String(c.value) === raw || c.name === raw || c.displayName === raw);
        return choice ? choice.value : null;
    }
    switch (option.type) {
        case OptionType.INTEGER:
        case OptionType.NUMBER: {
            const n = Number(raw.replace(",", "."));
            return Number.isFinite(n) ? n : null;
        }
        case OptionType.BOOLEAN:
            return /^(true|oui|vrai|1)$/i.test(raw);
        case OptionType.USER:
        case OptionType.CHANNEL:
        case OptionType.ROLE:
        case OptionType.MENTIONABLE:
            // Accepte un ID seul ou une mention <@id>, <#id>, <@&id>
            return raw.match(/\d{17,20}/)?.[0] ?? null;
        case OptionType.ATTACHMENT:
            return null;
        default:
            return raw;
    }
}

export type SlashResult =
    | { ok: true; text: string; payload: string; skipped: string[]; }
    | { ok: false; error: string; };

/** Construit l'aperçu texte et les données d'interaction que Discord sait coller */
export function buildSlash(guildId: string, slash: SlashConfig, vars: Record<string, string>): SlashResult {
    const command = findCommand(guildId, slash);
    if (!command) {
        return { ok: false, error: `Commande /${slash.command} introuvable. Tape « / » une fois dans un salon du serveur pour que Discord charge les commandes des bots, puis rouvre cette fenêtre.` };
    }

    const values: { name: string; type: number; value: string | number | boolean; }[] = [];
    const skipped: string[] = [];
    for (const option of command.options ?? []) {
        const value = toValue(option, fillTemplate(slash.options[option.name] ?? "", vars));
        if (value === null) continue;
        // Discord ignore les options à autocomplétion lors d'un collage
        if (option.autocomplete) skipped.push(option.name);
        else values.push({ name: option.name, type: option.type, value });
    }

    let options: any[] = values;
    for (const part of [...command.subCommandPath ?? []].reverse()) options = [{ name: part.name, type: part.type, options }];

    const payload = JSON.stringify({
        id: command.rootCommand.id,
        name: command.rootCommand.name,
        type: command.rootCommand.type ?? 1,
        version: command.rootCommand.version,
        application_id: command.applicationId,
        guild_id: guildId,
        options
    });

    const text = [`/${command.untranslatedName}`, ...values.map(v => {
        const option = command.options!.find(o => o.name === v.name)!;
        const choice = option.choices?.find(c => c.value === v.value);
        return `${v.name}:${choice?.displayName ?? choice?.name ?? v.value}`;
    })].join(" ");

    return { ok: true, text, payload, skipped };
}

/** Copie la commande dans le presse-papier, avec les données que Discord transforme en commande au collage */
export function copySlash(text: string, payload: string) {
    const onCopy = (e: ClipboardEvent) => {
        e.clipboardData?.setData("text/plain", text);
        e.clipboardData?.setData(INTERACTION_MIME, payload);
        e.preventDefault();
    };
    document.addEventListener("copy", onCopy);
    try {
        return document.execCommand("copy");
    } finally {
        document.removeEventListener("copy", onCopy);
    }
}

export type PasteResult = "ok" | "draft" | "failed";

/**
 * Colle la commande dans la barre de message du salon actif, par le même évènement que Discord
 * utilise pour un collage (Cmd+V ou Ctrl+V) fait hors de la barre. Il faut une barre vide pour obtenir la commande.
 */
export async function pasteSlash(channelId: string, text: string, payload: string): Promise<PasteResult> {
    // Brouillon en cours (DraftType.ChannelMessage = 0) : Discord collerait le texte dedans au lieu d'ouvrir la commande
    if (DraftStore.getDraft(channelId, 0)?.trim()) return "draft";

    const data = new DataTransfer();
    data.setData("text/plain", text);
    data.setData(INTERACTION_MIME, payload);
    const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
    ComponentDispatch.dispatchToLastSubscribed("GLOBAL_CLIPBOARD_PASTE", { event });

    await new Promise(r => setTimeout(r, 100));
    return ApplicationCommandStore.getActiveCommand(channelId) ? "ok" : "failed";
}
