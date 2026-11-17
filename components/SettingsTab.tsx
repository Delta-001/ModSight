/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Switch } from "@components/Switch";
import { confirmAction } from "@utils/discord";
import { chooseFile, saveFile } from "@utils/web";
import { ChannelStore, GuildStore, SelectedChannelStore, SelectedGuildStore, showToast, TextArea, TextInput, useState } from "@webpack/common";
import type { ReactNode } from "react";

import { describeImport, exportAll, importAll, parseExport } from "../capture";
import { DEFAULT_REPORT, settings } from "../settings";
import { channelName, cl } from "../utils";
import { ActionsEditor, CategoryEditor, VariablesHelp } from "./CategoryEditor";

function Section({ title, children }: { title: string; children: ReactNode; }) {
    return (
        <section className={cl("section")}>
            <h3 className={cl("section-title")}>{title}</h3>
            {children}
        </section>
    );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode; }) {
    return (
        <div className={cl("field")}>
            <div className={cl("label")}>{label}</div>
            {children}
            {hint && <div className={cl("muted")}>{hint}</div>}
        </div>
    );
}

const NOTIFICATIONS = [
    ["notifyMessages", "Messages (une notification par minute et par membre)"],
    ["notifyVoice", "Vocal : arrivée, changement de salon, départ"],
    ["notifyMembers", "Pseudo modifié, arrivée et départ du serveur"],
    ["notifyDeleted", "Message supprimé (enregistré automatiquement comme preuve)"]
] as const;

function NumberInput({ value, min, onChange }: { value: number; min: number; onChange(v: number): void; }) {
    return (
        <TextInput
            type="number"
            min={min}
            value={String(value)}
            onChange={v => {
                const n = Number(v);
                if (Number.isFinite(n) && n >= min) onChange(n);
            }}
        />
    );
}

async function doExport() {
    const json = await exportAll();
    saveFile(new File([json], `modsight-${new Date().toISOString().slice(0, 10)}.json`, { type: "application/json" }));
}

async function doImport() {
    const file = await chooseFile("application/json");
    if (!file) return;
    let parsed: ReturnType<typeof parseExport>;
    try {
        parsed = parseExport(await file.text());
    } catch (e: any) {
        showToast({ text: e instanceof SyntaxError ? "Fichier JSON illisible." : e.message });
        return;
    }
    confirmAction({
        title: "Importer ce fichier ?",
        subtitle: `L'import remplace, par le contenu du fichier : ${describeImport(parsed)}. Le reste ne change pas. Cette action est définitive.`,
        confirmText: "Tout remplacer",
        cancelText: "Annuler",
        onConfirm: async () => {
            await importAll(parsed);
            showToast({ text: "Import terminé" });
        }
    });
}

function SettingsTabInner() {
    const s = settings.use();
    const [busy, setBusy] = useState(false);
    const guild = s.guildId ? GuildStore.getGuild(s.guildId) : null;
    const sanctionChannel = s.sanctionChannelId ? ChannelStore.getChannel(s.sanctionChannelId) : null;

    return (
        <div className={cl("settings")}>
            <Section title="Serveur et salon">
                <Field label="Serveur modéré" hint={guild ? `✅ ${guild.name}` : "❌ Serveur introuvable"}>
                    <div className={cl("toolbar")}>
                        <div className={cl("grow")}><TextInput value={s.guildId} onChange={v => settings.store.guildId = v.trim()} /></div>
                        <Button
                            size="small"
                            variant="secondary"
                            onClick={() => {
                                const id = SelectedGuildStore.getGuildId();
                                if (id) settings.store.guildId = id;
                                else showToast({ text: "Ouvre d'abord un serveur." });
                            }}
                        >
                            Serveur actuel
                        </Button>
                    </div>
                </Field>
                <Field
                    label="Salon de sanction"
                    hint={sanctionChannel ? `✅ ${channelName(sanctionChannel.id)}` : "❌ Aucun salon valide : « Insérer » ne fonctionnera pas"}
                >
                    <div className={cl("toolbar")}>
                        <div className={cl("grow")}><TextInput value={s.sanctionChannelId} onChange={v => settings.store.sanctionChannelId = v.trim()} /></div>
                        <Button
                            size="small"
                            variant="secondary"
                            onClick={() => {
                                const id = SelectedChannelStore.getChannelId();
                                if (id) settings.store.sanctionChannelId = id;
                            }}
                        >
                            Salon actuel
                        </Button>
                    </div>
                </Field>
            </Section>

            <Section title="Actions du bot">
                <ActionsEditor />
            </Section>

            <Section title="Motifs et paliers">
                <CategoryEditor />
            </Section>

            <Section title="Modèle de rapport">
                <VariablesHelp />
                <div className={cl("code")}><TextArea rows={8} value={s.reportTemplate} onChange={v => settings.store.reportTemplate = v} /></div>
                <div className={cl("toolbar")}>
                    <Button size="small" variant="secondary" onClick={() => settings.store.reportTemplate = DEFAULT_REPORT}>Rétablir le modèle par défaut</Button>
                </div>
            </Section>

            <Section title="Preuves">
                <div className={cl("grid-2")}>
                    <Field label="Messages capturés avant et après">
                        <NumberInput value={s.contextSize} min={0} onChange={v => settings.store.contextSize = Math.round(v)} />
                    </Field>
                    <Field label="Taille max. d'une pièce jointe (Mo)">
                        <NumberInput value={s.maxAttachmentMb} min={0} onChange={v => settings.store.maxAttachmentMb = v} />
                    </Field>
                </div>
            </Section>

            <Section title="Notifications">
                {NOTIFICATIONS.map(([key, label]) => (
                    <div key={key} className={cl("switch-row")}>
                        <span>{label}</span>
                        <Switch checked={s[key]} onChange={v => settings.store[key] = v} />
                    </div>
                ))}
            </Section>

            <Section title="Sauvegarde">
                <div className={cl("muted")}>L'export contient tous les réglages (actions, motifs, serveur, salon…), la liste de surveillance, les preuves (pièces jointes comprises) et l'historique des sanctions. Il sert aussi à passer d'un ordinateur à l'autre. L'import accepte aussi un fichier de motifs seuls.</div>
                <div className={cl("toolbar")}>
                    <Button
                        size="small"
                        disabled={busy}
                        onClick={() => {
                            setBusy(true);
                            doExport().catch(() => showToast({ text: "L'export a échoué." })).finally(() => setBusy(false));
                        }}
                    >
                        Exporter en JSON
                    </Button>
                    <Button size="small" variant="dangerSecondary" onClick={doImport}>Importer un JSON</Button>
                </div>
            </Section>
        </div>
    );
}

export const SettingsTab = ErrorBoundary.wrap(SettingsTabInner);
