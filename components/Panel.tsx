/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { RenderModalProps } from "@vencord/discord-types";
import { closeModal, GuildStore, Modal, openModal, SelectedGuildStore, showToast, useState } from "@webpack/common";

import { settings } from "../settings";
import { useData } from "../store";
import { cl } from "../utils";
import { EvidenceTab } from "./EvidenceTab";
import { SanctionsTab } from "./SanctionsTab";
import { SettingsTab } from "./SettingsTab";
import { VoiceTab } from "./VoiceTab";
import { WatchedTab } from "./WatchedTab";

type TabId = "watched" | "voice" | "evidence" | "sanctions" | "settings";

let panelKey: string | null = null;

export function openPanel() {
    if (panelKey) closeModal(panelKey);
    panelKey = openModal(props => <WrappedPanel modalProps={props} />, { onCloseCallback: () => { panelKey = null; } });
}

export function closePanel() {
    if (panelKey) closeModal(panelKey);
    panelKey = null;
}

function SetupScreen() {
    const currentGuildId = SelectedGuildStore.getGuildId();
    const currentGuild = currentGuildId ? GuildStore.getGuild(currentGuildId) : null;

    return (
        <div className={cl("setup")}>
            <h2 className={cl("setup-title")}>Bienvenue dans ModSight</h2>
            <p>Aucun serveur n'est configuré : le plugin reste inactif tant que ce n'est pas fait.</p>
            <ol>
                <li>Fais un clic droit sur l'icône du serveur à modérer, puis « ModSight : serveur de modération ».</li>
                <li>Fais un clic droit sur le salon où tu tapes les commandes de sanction, puis « ModSight : salon de sanction ».</li>
                <li>Rouvre ce panneau : dans l'onglet Réglages, règle la commande de chaque action, puis importe ou adapte les motifs de sanction.</li>
            </ol>
            {currentGuild && (
                <Button
                    onClick={() => {
                        settings.store.guildId = currentGuild.id;
                        showToast({ text: `Serveur configuré : ${currentGuild.name}` });
                    }}
                >
                    Utiliser le serveur actuel ({currentGuild.name})
                </Button>
            )}
        </div>
    );
}

function Panel({ modalProps }: { modalProps: RenderModalProps; }) {
    const { guildId } = settings.use(["guildId"]);
    const [tab, setTab] = useState<TabId>("watched");
    const counts = useData(d => ({
        watched: Object.keys(d.watched).length,
        evidence: d.evidence.length,
        pending: d.sanctions.filter(s => s.status === "pending").length
    }));

    const tabs: [TabId, string][] = [
        ["watched", `👁 Surveillés (${counts.watched})`],
        ["voice", "🔊 En vocal"],
        ["evidence", `📎 Preuves (${counts.evidence})`],
        ["sanctions", `⚖️ Sanctions${counts.pending ? ` (${counts.pending} en attente)` : ""}`],
        ["settings", "⚙️ Réglages"]
    ];

    return (
        <Modal {...modalProps} size="lg" title="ModSight" subtitle={guildId ? GuildStore.getGuild(guildId)?.name : undefined}>
            <div className={cl("panel")}>
                {!guildId ? <SetupScreen /> : (
                    <>
                        <div className={cl("tabs")}>
                            {tabs.map(([id, label]) => (
                                <button key={id} className={cl("tab", tab === id && "tab-selected")} onClick={() => setTab(id)}>
                                    {label}
                                </button>
                            ))}
                        </div>
                        <div className={cl("tab-content")}>
                            {tab === "watched" && <WatchedTab />}
                            {tab === "voice" && <VoiceTab />}
                            {tab === "evidence" && <EvidenceTab />}
                            {tab === "sanctions" && <SanctionsTab />}
                            {tab === "settings" && <SettingsTab />}
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
}

const WrappedPanel = ErrorBoundary.wrap(Panel);
