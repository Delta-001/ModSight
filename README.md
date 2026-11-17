# ModSight

Outil de modération personnel pour **un seul serveur Discord** : préparation de sanctions, liste de surveillance et capture de preuves.

ModSight ne fait **aucune action à ta place**. Il n'envoie aucun message, ne sanctionne personne et n'appelle pas l'API de Discord. Il lit ce que ton client reçoit déjà, l'affiche, le garde en local, le copie dans le presse-papier ou l'insère dans la barre de message. C'est toujours toi qui appuies sur Entrée.

Toutes les données (surveillés, preuves, pièces jointes, historique) restent sur ton ordinateur, dans le stockage local de Vencord.

## Installation

ModSight est un *userplugin* : il faut Vencord compilé depuis ses sources (dépôt `Vendicated/Vencord`, avec git, Node.js et pnpm), puis injecté dans Discord.

### Windows

1. Clone ModSight directement dans le dossier des userplugins de Vencord (PowerShell, dans le dossier Vencord) :
   ```powershell
   git clone https://github.com/Delta-001/ModSight src\userplugins\modSight
   ```
2. Compile Vencord :
   ```powershell
   pnpm build
   ```
3. Si Vencord n'est pas encore injecté dans Discord : `pnpm inject`, puis choisis ton installation de Discord.
4. Quitte complètement Discord (clic droit sur l'icône près de l'horloge → Quitter), puis rouvre-le.
5. Active **ModSight** dans Réglages Discord → Vencord → Plugins.

Mise à jour :
```powershell
git -C src\userplugins\modSight pull
pnpm build
```
Puis Ctrl+R dans Discord, ou un redémarrage complet si `native.ts` a changé.

### Mac

Même principe : `git clone https://github.com/Delta-001/ModSight src/userplugins/modSight` dans le dossier Vencord, puis `pnpm build`.

Pour garder le code ailleurs (par exemple `~/Developer/ModSight`), fais un lien depuis Vencord :
```bash
ln -s ~/Developer/ModSight ~/Developer/Vencord/src/userplugins/modSight
```
Le compilateur suit alors le lien jusqu'au vrai dossier et n'y trouve plus les raccourcis `@api/…` de Vencord. Ajoute donc dans `~/Developer/ModSight` :
- un `tsconfig.json` :
  ```json
  {
      "extends": "../Vencord/tsconfig.json",
      "compilerOptions": { "rootDir": ".." },
      "include": ["**/*", "../Vencord/src/globals.d.ts", "../Vencord/src/modules.d.ts", "../Vencord/src/nativeModules.d.ts"]
  }
  ```
- un lien vers les modules de Vencord : `ln -s ../Vencord/node_modules ~/Developer/ModSight/node_modules`

Ces deux éléments ne sont pas dans le dépôt : ils casseraient le build quand ModSight est cloné directement dans Vencord.

Après une mise à jour : `pnpm build` dans Vencord, puis Cmd+R dans Discord, ou Cmd+Q et réouverture si `native.ts` a changé.

## Configuration en 3 étapes

1. **Serveur** : clic droit sur l'icône du serveur → « ModSight : serveur de modération ».
2. **Salon de sanction** : clic droit sur le salon où tu tapes les commandes du bot → « ModSight : salon de sanction ».
3. **Commandes** : ouvre le panneau (bouton 👁 dans la barre de message ou `/modsight`), onglet **Réglages**, puis adapte les catégories et les commandes à votre bot.

Tant qu'aucun serveur n'est configuré, le plugin ne fait rien et le panneau explique ces étapes.

## Utilisation

| Où | Action |
| --- | --- |
| Clic droit sur un membre | « Préparer une sanction », « Surveiller » ou « Ne plus surveiller » |
| Clic droit sur un message | « Préparer une sanction », « Capturer comme preuve » |
| Barre de message, `/modsight` | Ouvre le panneau : Surveillés, En vocal, Preuves, Sanctions, Réglages |

Dans la fenêtre de sanction :
- **Insérer dans #salon** ouvre le salon de sanction et y écrit la commande, sans l'envoyer.
- **Copier la commande** et **Copier le rapport** copient le texte dans le presse-papier.
- Chaque ouverture de la fenêtre crée une seule entrée « en attente » dans l'historique. Passe-la en « Validée » ou « Refusée » dans l'onglet Sanctions. La récidive ne compte que les sanctions validées.

## Commandes slash (DraftBot…)

Chaque catégorie peut utiliser soit une commande texte (bot à préfixe, comme `+ban`), soit une commande slash.

Réglage, une fois par catégorie :
1. Dans un salon du serveur, tape « / » dans la barre de message. Discord charge alors les commandes des bots ; ModSight ne fait aucun appel de son côté.
2. Panneau → Réglages → ouvre la catégorie → « Commande slash », puis choisis la commande dans la liste (par exemple `/ban`, sous DraftBot).
3. Pour chaque option, indique un modèle de valeur (`{id}`, `{raison}`, `{durée}`…) ou choisis une valeur dans la liste. ModSight propose des valeurs d'office pour le membre, la raison et la durée.

Utilisation : dans la fenêtre de sanction, **Insérer dans #salon** ouvre le salon de sanction et colle `/ban` dans la barre de message, avec les champs remplis. Rien n'est envoyé : vérifie, puis appuie sur Entrée.

La barre de message du salon doit être **vide**. Sinon, ModSight ne colle rien et te prévient. La commande est aussi copiée dans le presse-papier : si le collage automatique échoue, vide la barre et fais Cmd+V.

Si la barre n'est pas vide, ou si Discord n'a pas les commandes en mémoire, le collage donne seulement le texte de la commande.

## Variables des modèles

Elles sont utilisables dans les commandes des catégories et dans le modèle de rapport.

| Variable | Contenu |
| --- | --- |
| `{id}` | ID du membre |
| `{mention}` | Mention du membre (`<@id>`) |
| `{pseudo}` | Pseudo sur le serveur |
| `{durée}` | Durée choisie (pastille ou durée libre) |
| `{raison}` | Raison |
| `{preuves}` | Liens du message d'origine et des preuves cochées |
| `{message}` | Lien du message d'origine |
| `{salon}` | Salon du message d'origine (`<#id>`) |
| `{catégorie}` | Nom de la catégorie |
| `{commande}` | Commande finale (dans le rapport uniquement) |
| `{récidive}` | Nombre de sanctions validées avant celle-ci |
| `{date}` | Date du jour |

Une variable vide est retirée et les espaces en double sont nettoyés. Exemple : `+mute {id} {durée} {raison}` sans durée donne `+mute 123 Spam`.

## Limites connues

- **Commandes slash** : « Insérer » remplace le contenu de ton presse-papier par la commande. Les options à autocomplétion sont ignorées par Discord au collage : remplis-les à la main. Ce collage pré-rempli repose sur un comportement interne de Discord, qu'une mise à jour pourrait changer.
- **Pièces jointes** : elles sont téléchargées au moment de la capture, depuis `cdn.discordapp.com` et `media.discordapp.net` uniquement, dans la limite de taille fixée dans les réglages. Au-delà, ou si le téléchargement échoue, seul le lien est gardé, et il finit par expirer. Pour un message supprimé enregistré automatiquement, le téléchargement a lieu après la suppression et peut échouer.
- **Évènements de membres** : sur un gros serveur, Discord n'envoie pas toujours au client les changements de pseudo, les arrivées et les départs. Ces notifications peuvent donc manquer.
- **Messages supprimés** : seuls les 200 derniers messages des membres surveillés sont gardés en mémoire, jusqu'au redémarrage de Discord.
- **Export** : le fichier JSON contient les pièces jointes en base64 et peut être volumineux. L'import remplace toutes les données actuelles, après une confirmation.
