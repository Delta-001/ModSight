/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { copyWithToast } from "@utils/discord";
import { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, GuildMemberStore, Modal, openModal, showToast, SnowflakeUtils, TextArea, TextInput, useMemo, useRef, useState } from "@webpack/common";
import type { CSSProperties, ReactNode } from "react";

import { levelFor, ordinal } from "../ladder";
import { Category, settings } from "../settings";
import { buildSlash, copySlash, pasteSlash } from "../slash";
import { countApproved, newId, SanctionRecord, upsertSanction, useData } from "../store";
import { avatarUrl, channelName, cl, daysSince, displayName, fillTemplate, formatDay, insertInSanctionChannel, messageLink, openSanctionChannel, PASTE_KEY } from "../utils";
import { closePanel } from "./Panel";

export interface SanctionOptions {
    userId: string;
    /** Message d'origine (clic droit sur un message, ou message ciblé d'une preuve) */
    message?: { id: string; channelId: string; };
    /** Preuve cochée d'office */
    evidenceId?: string;
}

export function openSanctionModal(opts: SanctionOptions) {
    openModal(props => <WrappedSanctionModal modalProps={props} {...opts} />);
}

function MemberHeader({ userId, recidive }: { userId: string; recidive: number; }) {
    const { guildId } = settings.store;
    const member = GuildMemberStore.getMember(guildId, userId);
    const ageDays = daysSince(SnowflakeUtils.extractTimestamp(userId));

    return (
        <div className={cl("member-header")}>
            <img className={cl("avatar", "avatar-lg")} src={avatarUrl(userId, 128)} alt="" />
            <div className={cl("member-info")}>
                <div className={cl("member-name")}>{displayName(userId)}</div>
                <div className={cl("muted")}>{userId}</div>
                <div className={cl("badges")}>
                    <span className={cl("badge", ageDays < 30 && "badge-danger")}>Compte : {ageDays} j</span>
                    <span className={cl("badge")}>
                        Arrivé : {member?.joinedAt ? formatDay(new Date(member.joinedAt).getTime()) : "inconnu"}
                    </span>
                    <span className={cl("badge", recidive > 0 && "badge-warning")}>Récidive : {recidive}</span>
                </div>
            </div>
        </div>
    );
}

function Pill({ selected, color, onClick, children }: { selected: boolean; color?: string; onClick(): void; children: ReactNode; }) {
    return (
        <button
            className={cl("pill", selected && "pill-selected")}
            style={color ? { "--vc-ms-pill": color } as CSSProperties : undefined}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function SanctionModal({ modalProps, userId, message, evidenceId }: SanctionOptions & { modalProps: RenderModalProps; }) {
    const { guildId, sanctionChannelId } = settings.store;
    const { categories, actions, reportTemplate } = settings.use(["categories", "actions", "reportTemplate"]);

    const recordId = useRef(newId());
    const createdAt = useRef(0);

    const recidive = useData(d => countApproved(d, userId));
    const recidiveBefore = useData(d => d.sanctions.filter(s => s.userId === userId && s.status === "approved" && s.id !== recordId.current).length);
    const memberEvidence = useData(d => d.evidence.filter(e => e.userId === userId));

    const [query, setQuery] = useState("");
    const [categoryId, setCategoryId] = useState("");
    const category: Category | undefined = categories.find(c => c.id === categoryId);
    const [chosenLevel, setChosenLevel] = useState<number | null>(null);
    const [customDuration, setCustomDuration] = useState<string | null>(null);
    const [reason, setReason] = useState("");
    const [checked, setChecked] = useState<string[]>(evidenceId ? [evidenceId] : []);
    const [manualCommand, setManualCommand] = useState<string | null>(null);

    // Infractions déjà validées pour ce motif : elles déterminent le palier prévu
    const priorForMotif = useData(d => d.sanctions.filter(s => s.userId === userId && s.categoryId === categoryId && s.status === "approved" && s.id !== recordId.current).length);
    const plannedLevel = priorForMotif + 1;
    const level = chosenLevel ?? plannedLevel;
    const current = category && levelFor(category, level);
    const action = current && actions.find(a => a.id === current.step.action);
    const duration = customDuration ?? current?.step.duration ?? "";

    function selectCategory(c: Category) {
        setCategoryId(c.id);
        setChosenLevel(null);
        setCustomDuration(null);
        setReason(c.reason);
        setManualCommand(null);
    }

    function selectLevel(n: number) {
        setChosenLevel(n === plannedLevel ? null : n);
        setCustomDuration(null);
        setManualCommand(null);
    }

    const q = query.trim().toLowerCase();
    const shownCategories = q ? categories.filter(c => c.name.toLowerCase().includes(q)) : categories;
    // Paliers affichés : ceux du motif, le palier prévu s'il est au-delà, et la récidive
    const levels = category
        ? [...new Set([...category.steps.map((_, i) => i + 1), ...(category.repeat ? [category.steps.length + 1] : []), plannedLevel])].sort((a, b) => a - b)
        : [];

    const origin = message ?? (() => {
        const e = memberEvidence.find(e => e.id === evidenceId);
        return e && { id: e.messageId, channelId: e.channelId };
    })();
    const originLink = origin ? messageLink(guildId, origin.channelId, origin.id) : "";

    const proofLinks = useMemo(() => {
        const links = memberEvidence
            .filter(e => checked.includes(e.id))
            .map(e => messageLink(e.guildId, e.channelId, e.messageId));
        return [...new Set([originLink, ...links].filter(Boolean))];
    }, [memberEvidence, checked, originLink]);

    const vars: Record<string, string> = {
        id: userId,
        mention: `<@${userId}>`,
        pseudo: displayName(userId),
        durée: duration.trim(),
        raison: reason.trim(),
        preuves: proofLinks.join(" "),
        message: originLink,
        salon: origin ? `<#${origin.channelId}>` : "",
        catégorie: category?.name ?? "",
        action: action?.name ?? "",
        niveau: category ? String(level) : "",
        commande: "",
        récidive: String(recidiveBefore),
        date: new Date().toLocaleDateString("fr-FR")
    };
    const slash = action?.slash ? buildSlash(guildId, action.slash, vars) : null;
    const generated = action && !action.slash ? fillTemplate(action.command, vars) : "";
    const command = slash ? (slash.ok ? slash.text : "") : manualCommand ?? generated;
    const report = fillTemplate(reportTemplate, { ...vars, commande: command });

    function record() {
        if (!category) return;
        createdAt.current ||= Date.now();
        const entry: SanctionRecord = {
            id: recordId.current,
            createdAt: createdAt.current,
            userId,
            userName: displayName(userId),
            categoryId: category.id,
            categoryName: category.name,
            color: category.color,
            actionName: action?.name ?? "",
            level,
            duration: vars.durée,
            reason: vars.raison,
            command,
            slashPayload: slash?.ok ? slash.payload : undefined,
            report,
            evidenceIds: checked,
            status: "pending"
        };
        upsertSanction(entry);
    }

    /** Mode slash : copie la commande pré-remplie, que l'utilisateur colle dans une barre vide */
    function copySlashCommand() {
        if (!slash?.ok) return false;
        record();
        if (copySlash(slash.text, slash.payload)) return true;
        showToast({ text: "La copie a échoué." });
        return false;
    }

    async function insert() {
        record();
        modalProps.onClose();
        closePanel();
        if (!slash?.ok) {
            await insertInSanctionChannel(command);
            return;
        }

        // Copie de secours, faite pendant le clic : si le collage automatique échoue, un collage manuel suffit
        copySlash(slash.text, slash.payload);
        if (!await openSanctionChannel()) return;
        // Laisse la barre de message du salon se monter
        await new Promise(r => setTimeout(r, 300));

        const result = await pasteSlash(sanctionChannelId, slash.text, slash.payload);
        if (result === "ok") showToast({ text: "Commande prête : vérifie les champs, puis Entrée." });
        else if (result === "draft") showToast({ text: `La barre contient déjà un message : vide-la, puis colle la commande (${PASTE_KEY}).` });
        else showToast({ text: `Le collage automatique n'a pas marché : colle la commande avec ${PASTE_KEY} dans la barre vide.` });
    }

    function copyCommand() {
        if (slash) {
            if (copySlashCommand()) showToast({ text: `Commande copiée : colle-la (${PASTE_KEY}) dans une barre de message vide.` });
        } else {
            record();
            copyWithToast(command, "Commande copiée");
        }
    }

    const channelLabel = sanctionChannelId && ChannelStore.getChannel(sanctionChannelId) ? channelName(sanctionChannelId) : "#salon de sanction";

    return (
        <Modal
            {...modalProps}
            size="lg"
            title="Préparer une sanction"
            actions={[
                { text: `Insérer dans ${channelLabel}`, variant: "primary", onClick: insert, disabled: !command },
                { text: "Copier la commande", variant: "secondary", onClick: copyCommand, disabled: !command },
                { text: "Copier le rapport", variant: "secondary", onClick: () => { record(); copyWithToast(report, "Rapport copié"); }, disabled: !category }
            ]}
        >
            <div className={cl("sanction")}>
                <MemberHeader userId={userId} recidive={recidive} />

                <div className={cl("label")}>Motif</div>
                {categories.length === 0 && <div className={cl("muted")}>Aucun motif : ajoute-en dans l'onglet Réglages du panneau.</div>}
                <TextInput autoFocus placeholder="Rechercher un motif" value={query} onChange={setQuery} />
                <div className={cl("pills", "motifs")}>
                    {shownCategories.map(c => (
                        <Pill key={c.id} selected={c.id === categoryId} color={c.color} onClick={() => selectCategory(c)}>
                            {c.emoji} {c.name}
                        </Pill>
                    ))}
                    {shownCategories.length === 0 && <span className={cl("muted")}>Aucun motif ne correspond.</span>}
                </div>

                {category && current && (
                    <>
                        {category.hint && <div className={cl("notice")}>{category.hint}</div>}

                        <div className={cl("label")}>
                            Palier
                            <span className={cl("muted")}>
                                {priorForMotif === 0 ? "aucune sanction validée pour ce motif" : `${priorForMotif} sanction(s) validée(s) pour ce motif`}
                            </span>
                        </div>
                        <div className={cl("pills")}>
                            {levels.map(n => {
                                const l = levelFor(category, n);
                                const a = actions.find(x => x.id === l.step.action);
                                return (
                                    <Pill key={n} selected={n === level} color={n === plannedLevel ? category.color : undefined} onClick={() => selectLevel(n)}>
                                        {n === plannedLevel && "★ "}{ordinal(n)} · {a ? `${a.emoji} ${a.name}` : "Consigne"}{l.step.duration ? ` ${l.step.duration}` : ""}
                                    </Pill>
                                );
                            })}
                        </div>
                        <div className={cl("muted")}>★ palier prévu par le guide. {current.label}{current.step.action && !action ? " · action introuvable, vérifie les réglages" : ""}</div>
                        {current.step.note && <div className={cl("notice")}>{current.step.note}</div>}

                        <div className={cl("grid-2")}>
                            <div>
                                <div className={cl("label")}>Durée</div>
                                <TextInput
                                    placeholder="Aucune"
                                    value={duration}
                                    onChange={v => { setCustomDuration(v); setManualCommand(null); }}
                                />
                            </div>
                            <div>
                                <div className={cl("label")}>Raison</div>
                                <TextInput value={reason} onChange={v => { setReason(v); setManualCommand(null); }} />
                            </div>
                        </div>
                    </>
                )}

                {memberEvidence.length > 0 && (
                    <>
                        <div className={cl("label")}>Preuves de ce membre</div>
                        <div className={cl("evidence-checks")}>
                            {memberEvidence.map(e => {
                                const target = e.messages.find(m => m.target) ?? e.messages[0];
                                return (
                                    <label key={e.id} className={cl("check")}>
                                        <input
                                            type="checkbox"
                                            checked={checked.includes(e.id)}
                                            onChange={ev => {
                                                setChecked(ev.currentTarget.checked ? [...checked, e.id] : checked.filter(id => id !== e.id));
                                                setManualCommand(null);
                                            }}
                                        />
                                        <span className={cl("muted")}>{channelName(e.channelId)}</span>
                                        <span className={cl("ellipsis")}>{e.deleted && "🗑 "}{target?.content || "(pièce jointe)"}</span>
                                    </label>
                                );
                            })}
                        </div>
                    </>
                )}

                {category && !action && <div className={cl("notice")}>Ce palier n'a pas de commande : suis la consigne, puis « Copier le rapport » pour garder une trace.</div>}

                <div className={cl("label")}>
                    {slash ? "Commande slash" : "Commande"}
                    {!slash && manualCommand !== null && (
                        <button className={cl("link")} onClick={() => setManualCommand(null)}>Rétablir l'aperçu automatique</button>
                    )}
                </div>
                {!slash && <div className={cl("code")}><TextArea rows={2} value={command} onChange={setManualCommand} /></div>}
                {slash && !slash.ok && <div className={cl("notice", "notice-danger")}>{slash.error}</div>}
                {slash?.ok && (
                    <>
                        <pre className={cl("pre")}>{slash.text}</pre>
                        <div className={cl("muted")}>
                            « Insérer » ouvre le salon et y colle la commande avec ces champs remplis, sans l'envoyer. La barre de message doit être <strong>vide</strong>. Tu peux encore modifier les champs avant d'appuyer sur Entrée.
                        </div>
                        {slash.skipped.length > 0 && (
                            <div className={cl("notice")}>
                                À remplir à la main (autocomplétion) : {slash.skipped.join(", ")}
                            </div>
                        )}
                    </>
                )}

                <details className={cl("details")}>
                    <summary>Aperçu du rapport</summary>
                    <pre className={cl("pre")}>{report}</pre>
                </details>
            </div>
        </Modal>
    );
}

const WrappedSanctionModal = ErrorBoundary.wrap(SanctionModal);
