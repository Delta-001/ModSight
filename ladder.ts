/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Category, Step } from "./settings";

const UNIT_DAYS: Record<string, number> = { m: 1 / 1440, h: 1 / 24, d: 1, j: 1, w: 7, s: 7 };

/** Durée en jours : "3j", "3d", "1h", "2w"… ; 0 si absente ou illisible */
function toDays(duration: string | undefined) {
    const match = duration?.trim().toLowerCase().match(/^(\d+(?:[.,]\d+)?)\s*([mhdjws])/);
    return match ? Number(match[1].replace(",", ".")) * UNIT_DAYS[match[2]] : 0;
}

export interface Level {
    /** Numéro de l'infraction : 1 pour la première fois */
    level: number;
    step: Step;
    /** Libellé court : « 3ᵉ fois », « Récidive (+3 j) » */
    label: string;
}

export const ordinal = (n: number) => n === 1 ? "1re fois" : `${n}ᵉ fois`;

/** Sanction prévue pour la Nᵉ infraction de ce motif */
export function levelFor(category: Category, level: number): Level {
    const { steps, repeat } = category;
    if (level <= steps.length) return { level, step: steps[level - 1], label: ordinal(level) };

    if (repeat) {
        const extra = level - steps.length;
        if (!repeat.addDays) return { level, step: { action: repeat.action }, label: `${ordinal(level)} (récidive)` };
        // La dernière durée connue sert de base ; chaque récidive ajoute addDays jours
        const last = [...steps].reverse().find(s => s.duration)?.duration;
        const days = Math.round(toDays(last) + repeat.addDays * extra);
        // Même unité que les paliers ("3d" ou "3j") ; "j" par défaut, le format de DraftBot
        const unit = last?.trim().toLowerCase().endsWith("d") ? "d" : "j";
        return { level, step: { action: repeat.action, duration: `${days}${unit}` }, label: `${ordinal(level)} (récidive +${repeat.addDays} j)` };
    }

    // Pas de règle de récidive : on reste au dernier palier
    return { level, step: steps[steps.length - 1] ?? { action: "" }, label: `${ordinal(level)} (dernier palier)` };
}
