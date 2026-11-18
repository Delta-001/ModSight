/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { confirmAction, copyWithToast } from "@utils/discord";
import { showToast, TextInput, useEffect, useState } from "@webpack/common";

import { deleteEvidence, getAttachmentUrl } from "../capture";
import { relayEvidence } from "../relay";
import { AttachmentRef, Evidence, useData } from "../store";
import { channelName, cl, formatDate, goToChannel, messageLink } from "../utils";
import { closePanel } from "./Panel";
import { openSanctionModal } from "./SanctionModal";

const time = (ts: number) => new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

function summary(e: Evidence) {
    const lines = [
        `Preuve : ${e.userName} (${e.userId})${e.deleted ? " · message supprimé" : ""}`,
        `Salon : <#${e.channelId}> · capturée le ${formatDate(e.createdAt)}`,
        `Message : ${messageLink(e.guildId, e.channelId, e.messageId)}`,
        ""
    ];
    for (const m of e.messages) {
        const files = m.attachments.map(a => a.url).join(" ");
        lines.push(`${m.target ? "➤ " : ""}[${time(m.timestamp)}] ${m.authorName} : ${m.content}${m.edited ? " (modifié)" : ""}${m.deleted ? " (supprimé)" : ""}${files ? " " + files : ""}`);
    }
    return lines.join("\n");
}

function AttachmentView({ att }: { att: AttachmentRef; }) {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        if (att.stored) getAttachmentUrl(att.id).then(setUrl);
    }, [att.id, att.stored]);

    if (!att.stored) {
        return <a className={cl("attachment")} href={att.url} target="_blank" rel="noreferrer">📎 {att.filename} (non stocké, lien susceptible d'expirer)</a>;
    }
    if (!url) return <span className={cl("attachment", "muted")}>📎 {att.filename}…</span>;
    if (att.mime.startsWith("image/")) return <img className={cl("attachment-img")} src={url} alt={att.filename} />;
    if (att.mime.startsWith("video/")) return <video className={cl("attachment-img")} src={url} controls />;
    return <a className={cl("attachment")} href={url} download={att.filename}>📎 {att.filename}</a>;
}

function EvidenceCard({ e }: { e: Evidence; }) {
    const [expanded, setExpanded] = useState(false);
    const messages = expanded ? e.messages : e.messages.filter(m => m.target);

    return (
        <div className={cl("card")}>
            <div className={cl("row")}>
                <div className={cl("grow")}>
                    <div className={cl("row-title")}>
                        <strong>{e.userName}</strong>
                        <span className={cl("muted")}>{e.userId}</span>
                        {e.deleted && <span className={cl("badge", "badge-danger")}>Supprimé</span>}
                    </div>
                    <div className={cl("muted")}>{channelName(e.channelId)} · capturée le {formatDate(e.createdAt)}</div>
                </div>
                <div className={cl("actions")}>
                    <Button size="small" variant="secondary" onClick={() => copyWithToast(summary(e), "Résumé copié")}>Copier le résumé</Button>
                    <Button size="small" variant="secondary" onClick={() => { closePanel(); goToChannel(e.channelId, e.messageId); }}>Aller au message</Button>
                    <Button
                        size="small"
                        variant="secondary"
                        onClick={() => relayEvidence(e, { force: true }).then(sent => showToast({
                            text: sent ? "Preuve envoyée dans le salon des preuves." : "Aucun salon de preuves : configure un webhook dans les réglages."
                        }))}
                    >
                        Envoyer au salon
                    </Button>
                    <Button
                        size="small"
                        variant="dangerSecondary"
                        onClick={() => openSanctionModal({ userId: e.userId, message: { id: e.messageId, channelId: e.channelId }, evidenceId: e.id })}
                    >
                        Sanction
                    </Button>
                    <Button
                        size="small"
                        variant="dangerSecondary"
                        onClick={() => confirmAction({
                            title: "Supprimer cette preuve ?",
                            subtitle: "La capture et ses pièces jointes stockées seront effacées de ton ordinateur.",
                            confirmText: "Supprimer",
                            cancelText: "Annuler",
                            onConfirm: () => deleteEvidence(e.id)
                        })}
                    >
                        Supprimer
                    </Button>
                </div>
            </div>
            <div className={cl("messages")}>
                {messages.map(m => (
                    <div key={m.id} className={cl("message", m.target && "message-target", m.deleted && "message-deleted")}>
                        <div>
                            <span className={cl("muted")}>{time(m.timestamp)}</span> <strong>{m.authorName}</strong>
                            {m.edited && <span className={cl("muted")}> (modifié)</span>}
                            {m.deleted && <span className={cl("muted")}> (supprimé)</span>}
                        </div>
                        {m.content && <div className={cl("message-content")}>{m.content}</div>}
                        {m.attachments.map(a => <AttachmentView key={a.id} att={a} />)}
                    </div>
                ))}
            </div>
            {e.messages.length > 1 && (
                <button className={cl("link", "toggle")} onClick={() => setExpanded(!expanded)}>
                    {expanded ? "▾ Masquer le contexte" : `▸ Afficher le contexte (${e.messages.length} messages)`}
                </button>
            )}
        </div>
    );
}

function EvidenceTabInner() {
    const evidence = useData(d => d.evidence);
    const [query, setQuery] = useState("");
    const q = query.trim().toLowerCase();

    const filtered = q
        ? evidence.filter(e => e.userId.includes(q) || e.userName.toLowerCase().includes(q) || e.messages.some(m => m.content.toLowerCase().includes(q)))
        : evidence;

    return (
        <div className={cl("list")}>
            <TextInput placeholder="Rechercher un membre, un ID ou un contenu" value={query} onChange={setQuery} />
            {filtered.length === 0 && (
                <div className={cl("empty")}>
                    {evidence.length ? "Aucune preuve pour cette recherche." : "Aucune preuve. Clic droit sur un message → « Capturer comme preuve »."}
                </div>
            )}
            {filtered.map(e => <EvidenceCard key={e.id} e={e} />)}
        </div>
    );
}

export const EvidenceTab = ErrorBoundary.wrap(EvidenceTabInner);
