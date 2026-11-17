/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delta-001
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { confirmAction, copyWithToast } from "@utils/discord";
import { TextInput, useEffect, useState, useStateFromStores } from "@webpack/common";

import { Category, DEFAULT_CATEGORIES, settings, SlashConfig } from "../settings";
import { ApplicationCommandIndexStore, CommandOption, getGuildApps, guessTemplates, IndexedApp, IndexedCommand, OPTION_TYPE_LABELS, OptionType } from "../slash";
import { newId } from "../store";
import { cl, TEMPLATE_VARIABLES } from "../utils";

const parseDurations = (text: string) => text.split(",").map(d => d.trim()).filter(Boolean);

const clone = (c: Category): Category => ({
    ...c,
    durations: [...c.durations],
    slash: c.slash && { ...c.slash, options: { ...c.slash.options } }
});

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

function save(categories: Category[]) {
    settings.store.categories = categories.map(clone);
}

function CategoryRow({ category, index, all }: { category: Category; index: number; all: Category[]; }) {
    const [open, setOpen] = useState(false);
    const [durations, setDurations] = useState(category.durations.join(", "));
    // Resynchronise le champ si la catégorie change ailleurs (réinitialisation, import)
    const joined = category.durations.join(", ");
    useEffect(() => {
        if (parseDurations(durations).join(", ") !== joined) setDurations(joined);
    }, [joined]);

    const update = (patch: Partial<Category>) => save(all.map((c, i) => i === index ? { ...clone(c), ...patch } : c));

    function move(delta: number) {
        const next = [...all];
        [next[index], next[index + delta]] = [next[index + delta], next[index]];
        save(next);
    }

    return (
        <div className={cl("card")}>
            <div className={cl("row")}>
                <span className={cl("dot")} style={{ background: category.color }} />
                <button className={cl("link", "grow", "category-title")} onClick={() => setOpen(!open)}>
                    {open ? "▾" : "▸"} {category.emoji} {category.name || "(sans nom)"}
                    <code className={cl("code-inline", "muted")}>{category.slash ? `/${category.slash.command || "?"}` : category.command}</code>
                </button>
                <div className={cl("actions")}>
                    <Button size="min" variant="secondary" disabled={index === 0} onClick={() => move(-1)} title="Monter">↑</Button>
                    <Button size="min" variant="secondary" disabled={index === all.length - 1} onClick={() => move(1)} title="Descendre">↓</Button>
                    <Button
                        size="min"
                        variant="secondary"
                        onClick={() => save([...all.slice(0, index + 1), { ...clone(category), id: newId(), name: category.name + " (copie)" }, ...all.slice(index + 1)])}
                    >
                        Dupliquer
                    </Button>
                    <Button
                        size="min"
                        variant="dangerSecondary"
                        onClick={() => confirmAction({
                            title: `Supprimer « ${category.name} » ?`,
                            subtitle: "L'historique des sanctions déjà préparées est conservé.",
                            confirmText: "Supprimer",
                            cancelText: "Annuler",
                            onConfirm: () => save(all.filter((_, i) => i !== index))
                        })}
                    >
                        Supprimer
                    </Button>
                </div>
            </div>
            {open && (
                <div className={cl("category-fields")}>
                    <label>Nom<TextInput value={category.name} onChange={name => update({ name })} /></label>
                    <label>Emoji<TextInput value={category.emoji} onChange={emoji => update({ emoji })} /></label>
                    <label>
                        Couleur
                        <input className={cl("color")} type="color" value={category.color} onChange={e => update({ color: e.currentTarget.value })} />
                    </label>
                    <div className={cl("span-3", "pills")}>
                        <button className={cl("pill", !category.slash && "pill-selected")} onClick={() => update({ slash: undefined })}>
                            Commande texte (préfixe)
                        </button>
                        <button
                            className={cl("pill", !!category.slash && "pill-selected")}
                            onClick={() => category.slash || update({ slash: { applicationId: "", command: "", options: {} } })}
                        >
                            Commande slash (DraftBot…)
                        </button>
                    </div>
                    {category.slash
                        ? <SlashEditor slash={category.slash} onChange={slash => update({ slash })} />
                        : (
                            <label className={cl("span-3")}>
                                Commande
                                <div className={cl("code")}><TextInput value={category.command} onChange={command => update({ command })} /></div>
                            </label>
                        )}
                    <label className={cl("span-3")}>
                        Durées (séparées par des virgules)
                        <TextInput
                            placeholder="10m, 1h, 1d"
                            value={durations}
                            onChange={v => {
                                setDurations(v);
                                update({ durations: parseDurations(v) });
                            }}
                        />
                    </label>
                    <label className={cl("span-3")}>Raison par défaut<TextInput value={category.reason} onChange={reason => update({ reason })} /></label>
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
    const { categories } = settings.use(["categories"]);

    return (
        <div className={cl("list")}>
            <VariablesHelp />
            {categories.map((c, i) => <CategoryRow key={c.id} category={c} index={i} all={categories} />)}
            <div className={cl("toolbar")}>
                <Button
                    size="small"
                    onClick={() => save([...categories, { id: newId(), name: "Nouvelle catégorie", emoji: "🔨", color: "#5865f2", command: "+warn {id} {raison}", durations: [], reason: "" }])}
                >
                    Ajouter une catégorie
                </Button>
                <Button
                    size="small"
                    variant="dangerSecondary"
                    onClick={() => confirmAction({
                        title: "Réinitialiser les catégories ?",
                        subtitle: "Toutes tes catégories seront remplacées par celles d'origine.",
                        confirmText: "Réinitialiser",
                        cancelText: "Annuler",
                        onConfirm: () => save(DEFAULT_CATEGORIES)
                    })}
                >
                    Réinitialiser par défaut
                </Button>
            </div>
        </div>
    );
}

export const CategoryEditor = ErrorBoundary.wrap(CategoryEditorInner);
