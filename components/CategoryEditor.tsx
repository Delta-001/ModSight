/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { confirmAction, copyWithToast } from "@utils/discord";
import { TextInput, useState, useStateFromStores } from "@webpack/common";

import { ordinal } from "../ladder";
import { Category, DEFAULT_ACTIONS, DEFAULT_CATEGORIES, SanctionAction, settings, SlashConfig, Step } from "../settings";
import { ApplicationCommandIndexStore, CommandOption, getGuildApps, guessTemplates, IndexedApp, IndexedCommand, OPTION_TYPE_LABELS, OptionType } from "../slash";
import { newId } from "../store";
import { cl, TEMPLATE_VARIABLES } from "../utils";

const cloneCategory = (c: Category): Category => ({
    ...c,
    steps: c.steps.map(s => ({ ...s })),
    repeat: c.repeat && { ...c.repeat }
});

const cloneAction = (a: SanctionAction): SanctionAction => ({
    ...a,
    slash: a.slash && { ...a.slash, options: { ...a.slash.options } }
});

const saveCategories = (categories: Category[]) => { settings.store.categories = categories.map(cloneCategory); };
const saveActions = (actions: SanctionAction[]) => { settings.store.actions = actions.map(cloneAction); };

function move<T>(list: T[], index: number, delta: number) {
    const next = [...list];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    return next;
}

function RowButtons({ index, count, onMove, onDuplicate, onDelete }: { index: number; count: number; onMove(delta: number): void; onDuplicate(): void; onDelete(): void; }) {
    return (
        <div className={cl("actions")}>
            <Button size="min" variant="secondary" disabled={index === 0} onClick={() => onMove(-1)} title="Monter">↑</Button>
            <Button size="min" variant="secondary" disabled={index === count - 1} onClick={() => onMove(1)} title="Descendre">↓</Button>
            <Button size="min" variant="secondary" onClick={onDuplicate}>Dupliquer</Button>
            <Button size="min" variant="dangerSecondary" onClick={onDelete}>Supprimer</Button>
        </div>
    );
}

function ActionSelect({ value, actions, onChange, allowNone }: { value: string; actions: SanctionAction[]; onChange(id: string): void; allowNone: string; }) {
    return (
        <select className={cl("select")} value={value} onChange={e => onChange(e.currentTarget.value)}>
            <option value="">{allowNone}</option>
            {actions.map(a => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}
            {value && !actions.some(a => a.id === value) && <option value={value}>{value} (introuvable)</option>}
        </select>
    );
}

function OptionField({ option, value, onChange }: { option: CommandOption; value: string; onChange(v: string): void; }) {
    const shown = option.displayName ?? option.name;
    const label = (
        <span>
            <strong>{shown}</strong>
            {shown !== option.name && <span className={cl("muted")}> ({option.name})</span>}
            {option.required && " *"}
            <span className={cl("muted")}> · {OPTION_TYPE_LABELS[option.type] ?? "option"}</span>
            {option.displayDescription && <span className={cl("muted")}> · {option.displayDescription}</span>}
        </span>
    );

    if (option.choices?.length) {
        return (
            <label className={cl("span-3")}>
                {label}
                <select className={cl("select")} value={value} onChange={e => onChange(e.currentTarget.value)}>
                    <option value="">(laisser vide)</option>
                    {option.choices.map(c => <option key={String(c.value)} value={String(c.value)}>{c.displayName ?? c.name}</option>)}
                </select>
            </label>
        );
    }
    return (
        <label className={cl("span-3")}>
            {label}
            {option.autocomplete && <span className={cl("muted")}>Autocomplétion : Discord ignore cette option au collage, remplis-la à la main.</span>}
            <div className={cl("code")}><TextInput placeholder="Vide = option non remplie. Ex. : {id}, {raison}, {durée}, 7" value={value} onChange={onChange} /></div>
        </label>
    );
}

function CommandSearch({ apps, onPick }: { apps: IndexedApp[]; onPick(app: IndexedApp, command: IndexedCommand): void; }) {
    const [query, setQuery] = useState("");
    const q = query.trim().toLowerCase().replace(/^\//, "");

    const results = !q ? [] : apps
        .flatMap(app => app.commands.map(command => ({ app, command })))
        .filter(({ app, command }) => command.untranslatedName.toLowerCase().includes(q) || command.displayName.toLowerCase().includes(q) || app.name.toLowerCase().includes(q))
        // Les commandes dont le nom commence par la recherche passent en premier
        .sort((a, b) => Number(!a.command.untranslatedName.toLowerCase().startsWith(q)) - Number(!b.command.untranslatedName.toLowerCase().startsWith(q)))
        .slice(0, 15);

    return (
        <div className={cl("span-3", "command-search")}>
            <TextInput autoFocus placeholder="Rechercher : ban, mute, warn… ou le nom du bot (DraftBot)" value={query} onChange={setQuery} />
            {q && (
                <div className={cl("command-results")}>
                    {results.length === 0 && <div className={cl("muted")}>Aucune commande trouvée.</div>}
                    {results.map(({ app, command }) => (
                        <button key={app.id + command.id} className={cl("command-result")} onClick={() => onPick(app, command)}>
                            <strong>/{command.displayName}</strong>
                            <span className={cl("badge")}>{app.name}</span>
                            {command.displayDescription && <span className={cl("muted", "ellipsis")}>{command.displayDescription}</span>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function SlashEditor({ slash, onChange }: { slash: SlashConfig; onChange(slash: SlashConfig): void; }) {
    const { guildId } = settings.store;
    // L'état renvoyé par le store ne change que quand Discord recharge les commandes du serveur
    const state = useStateFromStores([ApplicationCommandIndexStore], () => ApplicationCommandIndexStore.getGuildState(guildId));
    const apps = getGuildApps(guildId, state);
    const app = apps.find(a => a.id === slash.applicationId);
    const command = app?.commands.find(c => c.untranslatedName === slash.command);
    const [searching, setSearching] = useState(!slash.command);

    const options: CommandOption[] = command?.options ?? Object.keys(slash.options).map(name => ({ name, type: OptionType.STRING }));

    if (apps.length === 0 && !slash.command) {
        return (
            <div className={cl("notice", "span-3")}>
                Discord n'a pas encore chargé les commandes des bots de ce serveur. Ouvre un salon du serveur et tape « / » dans la barre de message : la recherche fonctionnera ensuite.
            </div>
        );
    }

    return (
        <>
            {searching
                ? <CommandSearch apps={apps} onPick={(a, c) => { onChange({ applicationId: a.id, command: c.untranslatedName, options: guessTemplates(c) }); setSearching(false); }} />
                : (
                    <div className={cl("span-3", "row")}>
                        <span>
                            Commande : <strong>/{command?.displayName ?? slash.command}</strong>{" "}
                            <span className={cl("badge")}>{app?.name ?? "bot non chargé"}</span>
                        </span>
                        <Button size="min" variant="secondary" onClick={() => setSearching(true)}>Changer</Button>
                    </div>
                )}
            {slash.command && !command && (
                <div className={cl("notice", "span-3")}>
                    Discord n'a pas les commandes de ce bot en mémoire : tape « / » dans un salon du serveur pour les recharger.
                </div>
            )}
            {options.map(o => (
                <OptionField
                    key={o.name}
                    option={o}
                    value={slash.options[o.name] ?? ""}
                    onChange={v => onChange({ ...slash, options: { ...slash.options, [o.name]: v } })}
                />
            ))}
            {command && (
                <details className={cl("details", "span-3")}>
                    <summary>Détails techniques de la commande</summary>
                    <pre className={cl("pre")}>{commandDetails(command)}</pre>
                    <Button size="min" variant="secondary" onClick={() => copyWithToast(commandDetails(command), "Détails copiés")}>Copier</Button>
                </details>
            )}
        </>
    );
}

const commandDetails = (command: IndexedCommand) => JSON.stringify({
    commande: command.untranslatedName,
    application: command.applicationId,
    options: (command.options ?? []).map(o => ({
        nom: o.name,
        affiché: o.displayName,
        type: OPTION_TYPE_LABELS[o.type] ?? o.type,
        requis: !!o.required,
        autocomplétion: !!o.autocomplete,
        choix: o.choices?.map(c => ({ nom: c.displayName ?? c.name, valeur: c.value }))
    }))
}, null, 2);


// Actions

function ActionRow({ action, index, all }: { action: SanctionAction; index: number; all: SanctionAction[]; }) {
    const [open, setOpen] = useState(false);
    const update = (patch: Partial<SanctionAction>) => saveActions(all.map((a, i) => i === index ? { ...cloneAction(a), ...patch } : a));
    const usedBy = settings.store.categories.filter(c => c.steps.some(s => s.action === action.id) || c.repeat?.action === action.id);

    return (
        <div className={cl("card")}>
            <div className={cl("row")}>
                <button className={cl("link", "grow", "category-title")} onClick={() => setOpen(!open)}>
                    {open ? "▾" : "▸"} {action.emoji} {action.name || "(sans nom)"}
                    <code className={cl("code-inline", "muted")}>{action.slash ? `/${action.slash.command || "?"}` : action.command}</code>
                </button>
                <RowButtons
                    index={index}
                    count={all.length}
                    onMove={d => saveActions(move(all, index, d))}
                    onDuplicate={() => saveActions([...all.slice(0, index + 1), { ...cloneAction(action), id: newId(), name: action.name + " (copie)" }, ...all.slice(index + 1)])}
                    onDelete={() => confirmAction({
                        title: `Supprimer l'action « ${action.name} » ?`,
                        subtitle: usedBy.length
                            ? `Elle est utilisée par ${usedBy.length} motif(s) : ${usedBy.slice(0, 5).map(c => c.name).join(", ")}${usedBy.length > 5 ? "…" : ""}. Leurs paliers n'auront plus de commande.`
                            : "Aucun motif ne l'utilise.",
                        confirmText: "Supprimer",
                        cancelText: "Annuler",
                        onConfirm: () => saveActions(all.filter((_, i) => i !== index))
                    })}
                />
            </div>
            {open && (
                <div className={cl("category-fields")}>
                    <label>Nom<TextInput value={action.name} onChange={name => update({ name })} /></label>
                    <label>Emoji<TextInput value={action.emoji} onChange={emoji => update({ emoji })} /></label>
                    <label>ID<TextInput value={action.id} disabled /></label>
                    <div className={cl("span-3", "pills")}>
                        <button className={cl("pill", !action.slash && "pill-selected")} onClick={() => update({ slash: undefined })}>
                            Commande texte (préfixe)
                        </button>
                        <button
                            className={cl("pill", !!action.slash && "pill-selected")}
                            onClick={() => action.slash || update({ slash: { applicationId: "", command: "", options: {} } })}
                        >
                            Commande slash (DraftBot…)
                        </button>
                    </div>
                    {action.slash
                        ? <SlashEditor slash={action.slash} onChange={slash => update({ slash })} />
                        : (
                            <label className={cl("span-3")}>
                                Commande
                                <div className={cl("code")}><TextInput value={action.command} onChange={command => update({ command })} /></div>
                            </label>
                        )}
                </div>
            )}
        </div>
    );
}

function ActionsEditorInner() {
    const { actions } = settings.use(["actions"]);

    return (
        <div className={cl("list")}>
            <div className={cl("muted")}>
                Une action par type de sanction du bot. Les paliers des motifs y font référence : règle chaque commande une seule fois ici.
            </div>
            {actions.map((a, i) => <ActionRow key={a.id} action={a} index={i} all={actions} />)}
            <div className={cl("toolbar")}>
                <Button size="small" onClick={() => saveActions([...actions, { id: newId(), name: "Nouvelle action", emoji: "🔨", command: "+warn {id} {raison}" }])}>
                    Ajouter une action
                </Button>
                <Button
                    size="small"
                    variant="dangerSecondary"
                    onClick={() => confirmAction({
                        title: "Réinitialiser les actions ?",
                        subtitle: "Tes actions seront remplacées par Note, Warn, Mute, Forclos et Ban, avec des commandes texte d'exemple.",
                        confirmText: "Réinitialiser",
                        cancelText: "Annuler",
                        onConfirm: () => saveActions(DEFAULT_ACTIONS)
                    })}
                >
                    Réinitialiser par défaut
                </Button>
            </div>
        </div>
    );
}

export const ActionsEditor = ErrorBoundary.wrap(ActionsEditorInner);

// Motifs

function StepRow({ step, index, actions, onChange, onDelete }: { step: Step; index: number; actions: SanctionAction[]; onChange(step: Step): void; onDelete(): void; }) {
    return (
        <div className={cl("step")}>
            <span className={cl("step-label")}>{ordinal(index + 1)}</span>
            <ActionSelect value={step.action} actions={actions} allowNone="Consigne seule" onChange={action => onChange({ ...step, action })} />
            <TextInput placeholder="Durée (1h, 3j…)" value={step.duration ?? ""} onChange={duration => onChange({ ...step, duration: duration || undefined })} />
            <TextInput placeholder="Consigne (facultatif)" value={step.note ?? ""} onChange={note => onChange({ ...step, note: note || undefined })} />
            <Button size="min" variant="dangerSecondary" onClick={onDelete} title="Retirer ce palier">✕</Button>
        </div>
    );
}

function MotifRow({ category, index, all, actions }: { category: Category; index: number; all: Category[]; actions: SanctionAction[]; }) {
    const [open, setOpen] = useState(false);
    const update = (patch: Partial<Category>) => saveCategories(all.map((c, i) => i === index ? { ...cloneCategory(c), ...patch } : c));
    const setStep = (i: number, step: Step) => update({ steps: category.steps.map((s, j) => j === i ? step : { ...s }) });

    const summary = category.steps
        .map(s => {
            const a = actions.find(x => x.id === s.action);
            return `${a?.name ?? "Consigne"}${s.duration ? " " + s.duration : ""}`;
        })
        .join(" → ") + (category.repeat ? ` → ${actions.find(a => a.id === category.repeat!.action)?.name ?? "?"}${category.repeat.addDays ? ` +${category.repeat.addDays} j` : ""}…` : "");

    return (
        <div className={cl("card")}>
            <div className={cl("row")}>
                <span className={cl("dot")} style={{ background: category.color }} />
                <button className={cl("link", "grow", "category-title")} onClick={() => setOpen(!open)}>
                    {open ? "▾" : "▸"} {category.emoji} {category.name || "(sans nom)"}
                    <span className={cl("muted", "ellipsis")}>{summary}</span>
                </button>
                <RowButtons
                    index={index}
                    count={all.length}
                    onMove={d => saveCategories(move(all, index, d))}
                    onDuplicate={() => saveCategories([...all.slice(0, index + 1), { ...cloneCategory(category), id: newId(), name: category.name + " (copie)" }, ...all.slice(index + 1)])}
                    onDelete={() => confirmAction({
                        title: `Supprimer « ${category.name} » ?`,
                        subtitle: "L'historique des sanctions déjà préparées est conservé.",
                        confirmText: "Supprimer",
                        cancelText: "Annuler",
                        onConfirm: () => saveCategories(all.filter((_, i) => i !== index))
                    })}
                />
            </div>
            {open && (
                <div className={cl("category-fields")}>
                    <label>Nom<TextInput value={category.name} onChange={name => update({ name })} /></label>
                    <label>Emoji<TextInput value={category.emoji} onChange={emoji => update({ emoji })} /></label>
                    <label>
                        Couleur
                        <input className={cl("color")} type="color" value={category.color} onChange={e => update({ color: e.currentTarget.value })} />
                    </label>
                    <label className={cl("span-3")}>Raison par défaut<TextInput value={category.reason} onChange={reason => update({ reason })} /></label>
                    <label className={cl("span-3")}>Consigne générale (facultatif)<TextInput value={category.hint ?? ""} onChange={hint => update({ hint: hint || undefined })} /></label>
                    <label className={cl("check", "span-3")}>
                        <input type="checkbox" checked={!!category.autoCapture} onChange={e => update({ autoCapture: e.currentTarget.checked || undefined })} />
                        <span>📸 Capture automatique des preuves, cochée d'office dans la fenêtre de sanction</span>
                    </label>

                    <div className={cl("span-3", "steps")}>
                        <div className={cl("label")}>Paliers</div>
                        {category.steps.map((s, i) => (
                            <StepRow
                                key={i}
                                step={s}
                                index={i}
                                actions={actions}
                                onChange={step => setStep(i, step)}
                                onDelete={() => update({ steps: category.steps.filter((_, j) => j !== i).map(x => ({ ...x })) })}
                            />
                        ))}
                        <div className={cl("toolbar")}>
                            <Button size="min" variant="secondary" onClick={() => update({ steps: [...category.steps.map(x => ({ ...x })), { action: category.steps.at(-1)?.action ?? "warn" }] })}>
                                Ajouter un palier
                            </Button>
                        </div>
                    </div>

                    <div className={cl("span-3", "step")}>
                        <span className={cl("step-label")}>Récidive</span>
                        <ActionSelect
                            value={category.repeat?.action ?? ""}
                            actions={actions}
                            allowNone="Rester au dernier palier"
                            onChange={action => update({ repeat: action ? { action, addDays: category.repeat?.addDays } : undefined })}
                        />
                        {category.repeat && (
                            <TextInput
                                type="number"
                                min={0}
                                placeholder="Jours ajoutés à chaque récidive"
                                value={category.repeat.addDays ? String(category.repeat.addDays) : ""}
                                onChange={v => update({ repeat: { action: category.repeat!.action, addDays: Number(v) > 0 ? Number(v) : undefined } })}
                            />
                        )}
                    </div>
                    <div className={cl("span-3", "muted")}>
                        Au-delà des paliers : l'action de récidive, avec la dernière durée augmentée du nombre de jours indiqué à chaque nouvelle fois. Sans jours ajoutés, elle s'applique telle quelle (par exemple un ban).
                    </div>
                </div>
            )}
        </div>
    );
}

export function VariablesHelp() {
    return (
        <details className={cl("details")}>
            <summary>Variables disponibles dans les modèles</summary>
            <div className={cl("variables")}>
                {TEMPLATE_VARIABLES.map(([name, desc]) => (
                    <div key={name}><code className={cl("code-inline")}>{name}</code> {desc}</div>
                ))}
            </div>
            <div className={cl("muted")}>Une variable vide est retirée et les espaces en double sont nettoyés.</div>
        </details>
    );
}

function CategoryEditorInner() {
    const { categories, actions } = settings.use(["categories", "actions"]);
    const [query, setQuery] = useState("");
    const q = query.trim().toLowerCase();

    return (
        <div className={cl("list")}>
            <VariablesHelp />
            {categories.length > 8 && <TextInput placeholder="Rechercher un motif" value={query} onChange={setQuery} />}
            {categories.map((c, i) => (!q || c.name.toLowerCase().includes(q)) && (
                <MotifRow key={c.id} category={c} index={i} all={categories} actions={actions} />
            ))}
            <div className={cl("toolbar")}>
                <Button
                    size="small"
                    onClick={() => saveCategories([...categories, { id: newId(), name: "Nouveau motif", emoji: "🔨", color: "#5865f2", reason: "", steps: [{ action: "warn" }] }])}
                >
                    Ajouter un motif
                </Button>
                <Button
                    size="small"
                    variant="dangerSecondary"
                    onClick={() => confirmAction({
                        title: "Réinitialiser les motifs ?",
                        subtitle: "Tous tes motifs seront remplacés par les exemples d'origine.",
                        confirmText: "Réinitialiser",
                        cancelText: "Annuler",
                        onConfirm: () => saveCategories(DEFAULT_CATEGORIES)
                    })}
                >
                    Réinitialiser par défaut
                </Button>
            </div>
        </div>
    );
}

export const CategoryEditor = ErrorBoundary.wrap(CategoryEditorInner);
