/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { relaunch } from "@utils/native";
import { useState } from "@webpack/common";

import { Native } from "../capture";
import type { UpdateCheck, UpdateResult } from "../native";
import { cl } from "../utils";

type State =
    | { step: "idle"; }
    | { step: "checking" | "updating"; }
    | { step: "checked"; check: UpdateCheck; }
    | { step: "updated"; result: UpdateResult; };

function UpdateSectionInner() {
    const [state, setState] = useState<State>({ step: "idle" });

    const native = Native;
    if (!native) return <div className={cl("muted")}>La mise à jour n'est possible que dans l'application Discord.</div>;

    const check = async () => {
        setState({ step: "checking" });
        setState({ step: "checked", check: await native.checkUpdate() });
    };
    const update = async () => {
        setState({ step: "updating" });
        setState({ step: "updated", result: await native.applyUpdate() });
    };

    const busy = state.step === "checking" || state.step === "updating";

    return (
        <div className={cl("section")}>
            <div className={cl("muted")}>Télécharge la dernière version depuis GitHub (git pull), puis recompile Vencord. ModSight ne contacte GitHub que quand tu cliques.</div>

            {state.step === "updating" && <div className={cl("muted")}>Mise à jour et compilation en cours, ça peut prendre une minute…</div>}

            {state.step === "checked" && (state.check.ok
                ? state.check.commits.length
                    ? (
                        <>
                            <div>{state.check.commits.length} mise(s) à jour disponible(s) :</div>
                            <ul className={cl("update-list")}>
                                {state.check.commits.map(c => <li key={c.hash}><code>{c.hash}</code> {c.message}</li>)}
                            </ul>
                        </>
                    )
                    : <div>ModSight est à jour (version <code>{state.check.current}</code>).</div>
                : <pre className={cl("update-error")}>{state.check.error}</pre>
            )}

            {state.step === "updated" && (state.result.ok
                ? <div>Mise à jour installée. {state.result.needsRestart ? "Redémarre Discord pour l'appliquer." : "Recharge Discord pour l'appliquer."}</div>
                : <pre className={cl("update-error")}>{state.result.error}</pre>
            )}

            <div className={cl("toolbar")}>
                {state.step === "updated" && state.result.ok
                    ? state.result.needsRestart
                        ? <Button size="small" onClick={relaunch}>Redémarrer Discord</Button>
                        : <Button size="small" onClick={() => location.reload()}>Recharger Discord</Button>
                    : (
                        <>
                            <Button size="small" variant="secondary" disabled={busy} onClick={check}>
                                {state.step === "checking" ? "Vérification…" : "Vérifier les mises à jour"}
                            </Button>
                            {state.step === "checked" && state.check.ok && state.check.commits.length > 0 && (
                                <Button size="small" disabled={busy} onClick={update}>Mettre à jour</Button>
                            )}
                        </>
                    )}
            </div>
        </div>
    );
}

export const UpdateSection = ErrorBoundary.wrap(UpdateSectionInner, { noop: true });
