/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Switch } from "@components/Switch";
import { ChannelStore, showToast, TextInput, useEffect, useState } from "@webpack/common";

import { getWebhookChannel, RELAY_KINDS, RelayKind, sendRelayTest } from "../relay";
import { settings } from "../settings";
import { cl } from "../utils";
import { WEBHOOK_PATTERN } from "../webhook";

function status(url: string, fallback: string) {
    if (!url) return fallback;
    return WEBHOOK_PATTERN.test(url) ? "" : "❌ Ce n'est pas une URL de webhook Discord";
}

/** Champ d'URL de webhook, masqué, avec un bouton de test */
function WebhookInput({ value, placeholder, label, slot, onChange }: { value: string; placeholder: string; label: string; slot: string; onChange(v: string): void; }) {
    const { relayThreads } = settings.use(["relayThreads"]);
    const threaded = !!relayThreads[slot];
    const [testing, setTesting] = useState(false);
    // Salon visé par le webhook : undefined pendant la lecture, null si Discord ne répond pas
    const [channel, setChannel] = useState<{ channelId: string; name: string; } | null | undefined>();
    const valid = WEBHOOK_PATTERN.test(value);

    useEffect(() => {
        setChannel(undefined);
        if (!valid) return;
        let cancelled = false;
        getWebhookChannel(value).then(info => !cancelled && setChannel(info));
        return () => { cancelled = true; };
    }, [value]);

    const known = channel && ChannelStore.getChannel(channel.channelId);
    // Forum (15) et salon média (16) : un webhook n'y écrit que dans un fil
    const isForum = known ? known.type === 15 || known.type === 16 : undefined;

    useEffect(() => {
        if (isForum !== undefined && isForum !== threaded)
            settings.store.relayThreads = { ...settings.store.relayThreads, [slot]: isForum };
    }, [isForum]);

    async function test() {
        setTesting(true);
        const res = await sendRelayTest(value, label, slot);
        setTesting(false);
        showToast({ text: res.ok ? "Message de test envoyé." : `Échec du test : ${res.error}` });
    }

    return (
        <>
            <div className={cl("toolbar")}>
                <div className={cl("grow")}>
                    <TextInput type="password" placeholder={placeholder} value={value} onChange={v => onChange(v.trim())} />
                </div>
                <Button size="small" variant="secondary" disabled={!valid || testing} onClick={test}>Tester</Button>
                {value && <Button size="small" variant="dangerSecondary" onClick={() => onChange("")}>Effacer</Button>}
            </div>
            {valid && (
                <div className={cl("muted")}>
                    {channel === undefined ? "Lecture du webhook…"
                        : channel === null ? "❌ Discord ne reconnaît pas ce webhook : il a peut-être été supprimé."
                            : `✅ Webhook « ${channel.name} » → ${known ? `#${known.name}${isForum ? " (forum)" : ""}` : "salon d'un serveur où tu n'es pas"}`}
                </div>
            )}
            {value && (
                <label className={cl("check")}>
                    <input
                        type="checkbox"
                        checked={threaded}
                        onChange={e => settings.store.relayThreads = { ...settings.store.relayThreads, [slot]: e.currentTarget.checked }}
                    />
                    <span>🧵 Un fil par membre surveillé (le salon doit être un forum{isForum !== undefined ? ", réglé d'office" : ""})</span>
                </label>
            )}
        </>
    );
}

export function RelaySection() {
    const { webhookUrl, relayEvents, relayWebhooks, relayThreads } = settings.use(["webhookUrl", "relayEvents", "relayWebhooks", "relayThreads"]);
    const [open, setOpen] = useState<RelayKind | null>(null);

    const setKindUrl = (kind: RelayKind, url: string) => {
        const { [kind]: _, ...rest } = settings.store.relayWebhooks;
        settings.store.relayWebhooks = url ? { ...rest, [kind]: url } : rest;
    };

    return (
        <>
            <div className={cl("muted")}>
                Envoie les évènements des membres surveillés dans des salons de ton choix, sur n'importe quel serveur où tu peux créer un webhook (Modifier le salon → Intégrations → Webhooks → Nouveau webhook → Copier l'URL). C'est le webhook qui écrit, pas ton compte. Ces informations quittent alors ton ordinateur : garde les URL secrètes, car toute personne qui en a une peut écrire dans le salon. Les URL ne sont pas incluses dans l'export JSON.
            </div>
            <div className={cl("field")}>
                <div className={cl("label")}>Salon par défaut</div>
                <WebhookInput value={webhookUrl} placeholder="https://discord.com/api/webhooks/…" label="tous les évènements sans salon dédié" slot="default" onChange={v => settings.store.webhookUrl = v} />
                {status(webhookUrl, "Aucun : seuls les types qui ont un salon dédié sont envoyés.") && <div className={cl("muted")}>{status(webhookUrl, "Aucun : seuls les types qui ont un salon dédié sont envoyés.")}</div>}
            </div>

            <div className={cl("label")}>Évènements</div>
            {RELAY_KINDS.map(([kind, label]) => {
                const own = relayWebhooks[kind] ?? "";
                const target = (own ? "salon dédié" : webhookUrl ? "salon par défaut" : "aucun salon")
                    + ((own || webhookUrl) && relayThreads[own ? kind : "default"] ? ", un fil par membre" : "");
                return (
                    <div key={kind} className={cl("field")}>
                        <div className={cl("switch-row")}>
                            <span>
                                {label}
                                <span className={cl("muted")}> · {target} </span>
                                <button className={cl("link")} onClick={() => setOpen(open === kind ? null : kind)}>
                                    {open === kind ? "fermer" : "changer de salon"}
                                </button>
                            </span>
                            <Switch
                                checked={relayEvents[kind] !== false}
                                onChange={v => settings.store.relayEvents = { ...settings.store.relayEvents, [kind]: v }}
                            />
                        </div>
                        {open === kind && (
                            <>
                                <WebhookInput value={own} placeholder="Webhook dédié (vide : salon par défaut)" label={label} slot={kind} onChange={v => setKindUrl(kind, v)} />
                                {status(own, "Vide : ces évènements vont dans le salon par défaut.") && <div className={cl("muted")}>{status(own, "Vide : ces évènements vont dans le salon par défaut.")}</div>}
                            </>
                        )}
                    </div>
                );
            })}
            <div className={cl("muted")}>
                Preuves : chaque envoi contient l'ID du membre en texte (la recherche du salon retrouve toutes ses preuves), le message visé, la transcription complète en .txt et les fichiers stockés (10 Mo max par envoi). Les preuves partent à chaque capture, au message supprimé d'un surveillé, à la capture automatique d'une sanction, ou avec « Envoyer au salon » dans l'onglet Preuves.
            </div>
        </>
    );
}
