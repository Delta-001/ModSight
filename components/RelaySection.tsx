/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Switch } from "@components/Switch";
import { showToast, TextInput, useState } from "@webpack/common";

import { RELAY_KINDS, sendRelayTest } from "../relay";
import { settings } from "../settings";
import { cl } from "../utils";
import { WEBHOOK_PATTERN } from "../webhook";

export function RelaySection() {
    const { webhookUrl, relayEvents } = settings.use(["webhookUrl", "relayEvents"]);
    const [testing, setTesting] = useState(false);
    const valid = WEBHOOK_PATTERN.test(webhookUrl);

    async function test() {
        setTesting(true);
        const res = await sendRelayTest();
        setTesting(false);
        showToast({ text: res.ok ? "Message de test envoyé dans le salon du webhook." : `Échec du test : ${res.error}` });
    }

    return (
        <>
            <div className={cl("muted")}>
                Envoie les évènements des membres surveillés dans un salon de ton choix, sur n'importe quel serveur où tu peux créer un webhook (Modifier le salon → Intégrations → Webhooks → Nouveau webhook → Copier l'URL). C'est le webhook qui écrit, pas ton compte. Ces informations quittent alors ton ordinateur : garde l'URL secrète, car toute personne qui l'a peut écrire dans ce salon. L'URL n'est pas incluse dans l'export JSON.
            </div>
            <div className={cl("field")}>
                <div className={cl("label")}>URL du webhook</div>
                <div className={cl("toolbar")}>
                    <div className={cl("grow")}>
                        <TextInput
                            type="password"
                            placeholder="https://discord.com/api/webhooks/…"
                            value={webhookUrl}
                            onChange={v => settings.store.webhookUrl = v.trim()}
                        />
                    </div>
                    <Button size="small" variant="secondary" disabled={!valid || testing} onClick={test}>Envoyer un test</Button>
                    {webhookUrl && <Button size="small" variant="dangerSecondary" onClick={() => settings.store.webhookUrl = ""}>Désactiver</Button>}
                </div>
                <div className={cl("muted")}>
                    {!webhookUrl ? "Aucun webhook : le journal est désactivé." : valid ? "✅ Journal actif" : "❌ Ce n'est pas une URL de webhook Discord"}
                </div>
            </div>
            {RELAY_KINDS.map(([kind, label]) => (
                <div key={kind} className={cl("switch-row")}>
                    <span>{label}</span>
                    <Switch
                        checked={!!relayEvents[kind]}
                        onChange={v => settings.store.relayEvents = { ...settings.store.relayEvents, [kind]: v }}
                    />
                </div>
            ))}
        </>
    );
}
