/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { copyWithToast } from "@utils/discord";
import { showToast, TextInput, useState } from "@webpack/common";

import { copySlash } from "../slash";
import { SanctionRecord, SanctionStatus, setSanctionStatus, useData } from "../store";
import { cl, formatDate, PASTE_KEY } from "../utils";

const STATUSES: [SanctionStatus, string][] = [
    ["pending", "En attente"],
    ["approved", "Validée"],
    ["rejected", "Refusée"]
];

function recopy(s: SanctionRecord) {
    if (!s.slashPayload) return copyWithToast(s.command, "Commande copiée");
    showToast({ text: copySlash(s.command, s.slashPayload) ? `Commande copiée : colle-la (${PASTE_KEY}) dans une barre de message vide.` : "La copie a échoué." });
}

function SanctionRow({ s }: { s: SanctionRecord; }) {
    return (
        <div className={cl("card")}>
            <div className={cl("row")}>
                <div className={cl("grow")}>
                    <div className={cl("row-title")}>
                        <span className={cl("dot")} style={{ background: s.color }} />
                        <strong>{s.categoryName}</strong>
                        <span>{s.userName}</span>
                        <span className={cl("muted")}>{s.userId}</span>
                    </div>
                    <div className={cl("muted")}>{formatDate(s.createdAt)}{s.reason ? ` · ${s.reason}` : ""}</div>
                    <code className={cl("code-inline")}>{s.command}</code>
                </div>
                <div className={cl("actions", "actions-col")}>
                    <div className={cl("status-pills")}>
                        {STATUSES.map(([status, label]) => (
                            <button
                                key={status}
                                className={cl("status", `status-${status}`, s.status === status && "status-selected")}
                                onClick={() => setSanctionStatus(s.id, status)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <Button size="small" variant="secondary" onClick={() => recopy(s)}>Recopier la commande</Button>
                </div>
            </div>
        </div>
    );
}

function SanctionsTabInner() {
    const sanctions = useData(d => d.sanctions);
    const [status, setStatus] = useState<SanctionStatus | "all">("all");
    const [query, setQuery] = useState("");
    const q = query.trim().toLowerCase();

    const filtered = sanctions.filter(s =>
        (status === "all" || s.status === status)
        && (!q || s.userId.includes(q) || s.userName.toLowerCase().includes(q))
    );

    return (
        <div className={cl("list")}>
            <div className={cl("toolbar")}>
                <div className={cl("grow")}><TextInput placeholder="Filtrer par membre (pseudo ou ID)" value={query} onChange={setQuery} /></div>
                <select className={cl("select")} value={status} onChange={e => setStatus(e.currentTarget.value as SanctionStatus | "all")}>
                    <option value="all">Tous les statuts</option>
                    {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
            </div>
            <div className={cl("muted")}>Seules les sanctions validées comptent dans la récidive.</div>
            {filtered.length === 0 && <div className={cl("empty")}>Aucune sanction{sanctions.length ? " pour ce filtre" : " préparée pour l'instant"}.</div>}
            {filtered.map(s => <SanctionRow key={s.id} s={s} />)}
        </div>
    );
}

export const SanctionsTab = ErrorBoundary.wrap(SanctionsTabInner);
