# Journal des modifications
## 2.6.2 - 2026-09-24
### Corrections
- **Plus d'avertissement dans Chrome/Edge** : le manifest ne contient plus les clés propres à Firefox (`background.scripts`, `browser_specific_settings`)

### Firefox
- Version Firefox fournie à part : `IgensiaExtension-firefox.zip` dans les releases, ou `node tools/build-firefox.js` pour la générer depuis le dépôt

## 2.6.1 - 2026-09-24
### Corrections
- **Bouton « Ouvrir l'EDT »** : fonctionne même sans être jamais allé sur l'emploi du temps (lien récupéré depuis MonCampus) et ouvre la semaine en cours
- **Synchronisation de l'EDT** : la session de l'emploi du temps est recréée automatiquement, il suffit d'être connecté à MonCampus

## 2.6.0 - 2026-09-24
### Nouveautés
- **Popup entièrement refait** : nouvelle interface avec icônes SVG, thème Clair / Sombre / Système
- **Cours en cours et prochain cours** : horaires, salle (ou distanciel), prof et avancement du cours, synchronisés automatiquement depuis l'emploi du temps
- **Dernières notes dans le popup** : les 5 dernières notes avec l'étiquette « Nouveau », sans ouvrir le relevé
- **Relevé de l'année en cours** : détecté automatiquement depuis la page E-Notes (plus besoin de l'URL)
- **Devoirs par matière** : choix de la matière (depuis le relevé et l'EDT), filtre, date d'échéance suggérée au prochain cours de la matière
- **Devoirs** : vrai mode modification, case à cocher, échéances colorées (en retard, aujourd'hui, demain), devoirs terminés regroupés
- **Paramètres** : liens pour mettre une étoile sur GitHub, voir le code et signaler un bug
- **Compatibilité Firefox** : manifest compatible Chrome, Edge et Firefox (115+)

### Corrections
- **Calcul du GPA** : moyenne calculée par matière (et non sur la dernière épreuve), barème corrigé, plus de notes exclues silencieusement, export PDF avec moyennes en lettre et statut validé / non validé — merci à [@SudoKipedia](https://github.com/SudoKipedia) (PR #1)
- **Alertes de nouvelles notes** : elles ne fonctionnaient pas (DOMParser indisponible dans le service worker) ; plus de notification en masse au premier lancement
- **Reconnexion automatique** : l'extension suit la redirection CAS quand la session des notes expire
- **Temps passé** : le chrono n'est plus perdu quand Chrome met le service worker en veille ; jours et semaines en heure locale
- **Mises à jour** : plus de notification « nouvelle version » à chaque installation
- **Devoirs** : un devoir n'est plus supprimé quand on clique sur « Modifier » ; les devoirs sans date passent à la fin
- **Sécurité** : le texte des devoirs n'est plus injecté en HTML brut

### Permissions
- Ajout de `cas-p.wigorservices.net` (serveur de connexion Wigor) pour la reconnexion automatique

## 2.5.0 - 2026-02-11
### Nouveautés
- **Barre GPA refaite** : Échelle fixe 0→4, la barre colorée représente la moyenne actuelle
- **Curseur objectif** : Marqueur visuel déplaçable à la souris sur la barre de progression
- **Palette de couleurs réaliste** : Rouge → Orange → Jaune → Vert selon la proximité à l'objectif

### Corrections
- **Filtre "matières avec notes"** : La checkbox fonctionne à nouveau correctement
- **Cap objectif GPA** : Impossible de dépasser 4.0
- **Modification notes** : Les notes éditées se mettent à jour visuellement dans le tableau
- **Stabilité** : Prévention des écouteurs dupliqués sur les boutons d'édition

## 2.4.1 - 2026-01-30
- Toggle mode simulation

## 2.4.0 - 2026-01-30
### Nouveautés
- **Édition des notes existantes** : Modifiez les notes dans le simulateur pour voir l'impact sur la moyenne
- **Objectif de moyenne GPA** : Définissez un objectif et suivez votre progression avec une barre visuelle
- **Export PDF** : Exportez votre relevé de notes en PDF formaté
- **Temps passé** : Suivez le temps passé sur MonCampus (aujourd'hui, semaine, total)
- **Alertes de notes** : Notifications Chrome automatiques lors de nouvelles notes

---
## 2.3.0 - 2026-01-30
### Nouveautés
- **Tri par date** : Nouveau bouton pour trier les notes par date (plus récent en premier)
- **Simulateur de notes** : Ajoutez des notes hypothétiques pour simuler votre moyenne GPA
  - Sélection de matière existante ou personnalisée
  - Coefficient ajustable
  - Moyenne simulée séparée avec indicateur visuel
  - Confirmation avant de quitter si des notes simulées sont présentes
  - Notes simulées effacées automatiquement au rafraîchissement

### Améliorations
- Exclusion des notes A+ et F du graphique de répartition
- La checkbox "Afficher uniquement matières avec notes" applique maintenant le filtre automatiquement au chargement

## 2.2.5 - 2025-12-08
- Ajout de la prise en charge des URL de pages de notes avec différentes casses (majuscules/minuscules).

## 2.2.4 - 2025-12-01
- Correction d'un problème de casse dans les URL des pages de notes (prise en charge des URL en minuscules/majuscules).

## 2.2.3 - 2025-11-24
- Suppression de la fonctionnalité de minuteur injecté (supprimée sur demande de l'utilisateur).
- Mise à jour du README pour afficher la version du manifeste.