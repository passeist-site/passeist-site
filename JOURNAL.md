# Journal des modifications — Passéist

Tout changement, fix, idée ou décision important est tracé ici. À chaque modif que je fais je rajoute une ligne, datée, courte. Ordre antéchronologique (plus récent en haut).

---

## 2026-11-06

### Catégories revues de fond en comble (Tom : « pas de jupe, pas de chemise, Bas ça veut rien dire »)
- 17 catégories au lieu de 8 : Vestes, Manteaux, Costumes, Chemises, T-shirts & tops, Pulls & gilets, Sweats, Pantalons, Jupes, Robes, Combinaisons, Chaussures, Sacs, Chapeaux, Écharpes, Accessoires (Autres seulement si rien ne colle : 0 pièce aujourd'hui, contre 49 avant). Dans cet ordre dans le filtre, noms anglais en EN.
- Mêmes règles partout : getCategory() (index.html), categoryOf() (plugin, lib/category.js), tools/type_from_desc.py (import).
- 37 noms de pièces restés en anglais remis en français (Wool pull → Pull en laine, Harem → Sarouel, Satchel → Sac à dos…).
- 74 pièces en vente dont le type Vestiaire contredisait la description (« Blouse » pour un top, « Sweat » pour un gilet, « Costume » pour une jupe, « Espadrilles » pour un short…) : type corrigé d'après la description.
- 108 anciennes adresses de fiches redirigées (301) vers les nouvelles.
- Import : type anglais traduit d'office, et le type écrit en tête de description (« Ravissant top en… ») l'emporte quand il n'est pas dans le même rayon que celui de Vestiaire.
- Alertes : les anciennes catégories (Bas, Hauts, Maille, Vestes, Accessoires, Robes) reçoivent les nouvelles correspondantes.

## 2026-11-04

### Import Vestiaire : plus aucune pièce laissée sur Vestiaire (Tom)
- Pièce « Non signé » : la marque est lue en tête de description. D'abord les marques connues, puis toute marque déjà sur le site (« Junko Shimada, collection… »), puis ce qui précède la 1ère ponctuation (« Mina Perhonen, … », « Atelier X - automne-hiver… »). Les débuts descriptifs (« Superbe pull, … ») ne sont jamais pris pour une marque.
- Sans marque lisible, la pièce est importée quand même, en « NON SIGNÉ » (avant : laissée de côté, cf. 72606166, 73092118, 69708104, 68563799). Elles entrent à la prochaine synchro.

### Recherche boutique : le titre complet de la carte trouve la pièce
- La ligne et la saison (« Pour Homme · Printemps-été 2023 ») n'étaient pas dans la recherche : taper le titre tel qu'affiché ne donnait rien. Ajoutées (FR et EN) ; tirets, points et virgules ignorés (« printemps ete 2023 » = « Printemps-été 2023 »).
- Recherche par référence (« 73092452 » ou « Réf. 73092452 ») : la pièce sort où qu'elle soit, même vendue ou avec des filtres actifs. Avant, une pièce vendue cherchée depuis la Boutique ne donnait rien.

### Bing Webmaster Tools : accueil indexé, 3 alertes SEO corrigées
- Titre de l'accueil raccourci (95 → 66 caractères) : « passéist · vintage Yohji Yamamoto, Issey Miyake, Comme des Garçons » (FR et EN). Titre Boutique raccourci aussi.
- Meta description de l'accueil ramenée à 155 caractères (Bing : 25 à 160).
- Un seul <h1> sur l'accueil : le titre (vide) de la fiche dans index.html passe en <div>. Les pages produit générées gardent leur <h1> marque + pièce.

### SEO : liens entre les fiches (Search Console : 919 pages « explorées, non indexées »)
- « Articles similaires » : 8 vrais liens `<a href>` écrits dans chaque fiche générée (`buildSimilarHtml()` du plugin), et liens `<a>` dans le carrousel du site (avant : `<div>` cliquables, vides dans le HTML). Pièces vendues en `noindex,follow` (avant `nofollow`).
- Marques corrigées : Monitaly (et non Matsuda, 4 pièces) ; dates de fondation de marque plus prises pour l'année de la pièce (`tools/designation.py`).

### Alertes « nouvelles pièces » (clients)
- Panneau « Créez votre alerte » (Tom : « plus ludique ») : maisons, pièces et genre à choisir en touchant des étiquettes (plusieurs possibles), résumé en direct, puis e-mail. Lien « Créer une alerte nouvelles pièces » toujours présent dans la boutique (prérempli avec les filtres) et sur chaque fiche (prérempli avec la pièce, « Vendue. … » si vendue). Anti-robots comme la newsletter.
- `netlify/functions/alerts.js` (création, suppression avec bouton de confirmation, liste pour la messagerie), `alerts-send.js` planifiée chaque heure : un e-mail Brevo par alerte concernée par les pièces arrivées. Store Blobs « passeist-alerts ». Adresses jamais ajoutées à la newsletter. Notification à Tom à chaque alerte créée. Mention ajoutée à la politique de confidentialité.

### Boutique : loupe sur mobile, « Vus récemment »
- Loupe à droite de « Filtres + tri » (mobile) : la barre devient le champ de recherche, résultats en direct, × pour revenir (Tom : « le réflexe c'est de taper »).
- « Vus récemment » en bas de l'accueil et de la boutique : 12 dernières pièces regardées (disponibles), gardées dans le navigateur (`passeist_recent`), même carte que la Boutique.

### Fiche produit : galerie de la page identique à celle du site (vignette 1 comprise), position de lecture gardée au chargement

### « archive » : gardé partout où c'est invisible (adresses, titres pour Google), Tom
- Les gens tapent « archive » : l'adresse `/archive`, les titres et descriptions pour Google le gardent. Retiré seulement de deux textes visibles (titre de la page Vendu « Pièces vendues », légendes Final Home / Jun Men).
- Googlebot navigue en anglais : il voyait tout le site traduit, avec une canonique `?lang=en` contraire à celle de la page. Robots désormais servis en français ; canonique `?lang=en` seulement si l'adresse la demande.
- Titres et canoniques propres à Boutique / Vendu / À propos après chargement (avant : ceux de l'accueil).

### SEO (2) : titres, H1, pages marques, catalogue allégé
- Titre Google des fiches : marque + pièce + matière + couleur accordée + homme/femme + saison (`seoTitle()` du plugin). Ex. « Monitaly Sweat en coton vert, vintage homme · passéist ».
- Un seul `<h1>` par fiche : marque + pièce (`.detail-title`, `display: contents`, affichage identique au pixel près) ; le logo de l'accueil passe en `<div>` sur les fiches.
- Pages marques : au-delà des 24 du carrousel, toutes les autres pièces disponibles en grille (`.brand-all`), avec leur lien.
- Catalogue 2,07 Mo -> 1,5 Mo : `intro`/`intro_en` retirés (inutilisés par le site). Essai de sortir aussi les descriptions des pièces vendues (chargées à la demande) : abandonné, la description d'une pièce vendue mettait plusieurs secondes à s'afficher sur téléphone (Tom). Catalogue préchargé dans le `<head>`.
- Les 693 « 404 » de Search Console : anciennes adresses Vestiaire lues dans le catalogue (champ `path`), déjà corrigé ; elles disparaîtront d'elles-mêmes.

### Page marque Plantation (1982, date officielle de la marque, photo fournie par Tom)
Texte validé par Tom, à reprendre tel quel :
- « Lancée en 1981 par Issey Miyake, Plantation privilégie la matière et le confort : lin, chanvre, coton, laine, des coupes amples faites pour durer. »
- « Plissés tissés asymétriques, toiles flammées, imprimés à la planche, tailles élastiquées : une mode discrète et organique, souvent en taille unique M, qui prolonge loin des podiums le travail de Miyake sur la matière. »
- Gabarit : `git show 60c91626 -- marques/plantation.html` (+ `marques.html`, accueil, `BRAND_PAGES`, `STATIC_ROUTES`).

## 2026-09-27

### Audit technique du site (SEO, photos, données)
- **Sitemap.xml désynchronisé du vrai catalogue** : fichier statique jamais régénéré, les slugs produits avaient changé depuis (0/755 URLs correspondaient à une vraie page). Google recevait donc 755 URLs qui tombaient sur le fallback SPA (contenu dupliqué homepage) au lieu des 1318 vraies fiches produit. Sitemap régénéré + plugin patché pour le régénérer à chaque `onPostBuild` (`buildSitemap()` dans `netlify/plugins/generate-product-pages/index.js`), ne peut plus diverger. Commit `d12707c`.
- **Photos produit** : Vestiaire a changé son format de photo secondaire (2:3 "Leica" → 3:4 "classique"). Ratio galerie + lightbox mis à jour en conséquence (commits `c24df2d`, `710f291`). Photo principale (galerie + lightbox) passée en boîte fixe 3:4 avec `object-fit: contain` + fond blanc : taille constante d'une fiche à l'autre, aucune photo (ancien ou nouveau format) n'est jamais recadrée. Commit `f6ff05d`.
- **Doublons marque (accents à l'import)** : COMME DES GARCONS/GARÇONS (174 produits, + le calcul du slug marque dans le breadcrumb JSON-LD était cassé pour la version accentuée) et MIHARA YASUHIRO/MAISON MIHARA YASUHIRO (6 produits). Fusionnés vers l'orthographe correcte/existante. Commits `d65ec03`, `eddff54`.
- **Bug de traduction sur les imports récents** : `tools/import_vestiaire.py` traduisait FR→EN le champ `type` en supposant qu'il était toujours en français, alors que Vestiaire renvoie parfois déjà de l'anglais (texte libre du vendeur) malgré `Accept-Language: fr` forcé. Résultat : 339/1318 produits affichaient un type anglais brut sur le site FR (ex. "YOHJI YAMAMOTO Vest"). Ajout d'une détection heuristique avant traduction (`_looks_already_english()`) + correction rétroactive des 339 produits (traduction manuelle des 83 valeurs distinctes, pas automatique, pour garantir le vocabulaire mode correct). Commit `d65ec03`.
- **Hreflang EN trompeur retiré** : le switch FR/EN est purement client-side (le HTML servi reste identique en français), les balises `hreflang="en"` promettaient à Google une version indexable qui n'existe pas server-side. Commit `d65ec03`.
- **Points restants identifiés, non traités cette session** : pas de GA4/Meta Pixel (bloqué en attente des IDs de Tom), dépendance photos hotlinkées Vestiaire (chantier plus lourd), bandeau cookies RGPD (à faire).

### Réorganisation marques Auteurs (demande Tom)
- Fusions brand field : Y'S + GROUND Y + ASPESI → YOHJI YAMAMOTO, PLEATS PLEASE + HAI → ISSEY MIYAKE, JUN → JUN MEN. 3 produits mal classés Issey Miyake (mention explicite "Plantation" dans la desc) → PLANTATION. Nouvelle marque DIVERS (Asdic, Kriff Mayer, Gucci, Hermès, Remi Relief, Yves Saint Laurent, 7 pièces).
- Nouvelles pages `marques/jun-men.html` et `marques/final-home.html` (texte Jun Men complété via jun.co.jp + Wikipedia JA, texte Final Home rédigé via sources publiques sur Kosuke Tsumura). Ajoutées au listing `marques.html`, au menu `index.html`, et à `STATIC_ROUTES` du plugin sitemap.
- Commit `eddff54`.

### Bandeau cookies RGPD
- tawk.to (seul cookie tiers du site) se chargeait sans consentement. Ajout d'un bandeau bas de page (Accepter/Refuser, FR/EN) : le script tawk.to n'est injecté qu'après clic "Accepter" (`localStorage.passeist_cookie_consent`). Le lanceur de chat topbar ouvre le bandeau si pas encore répondu. Commit `8c99c5d`.

### Note token GitHub (R7)
Le token PAT fourni par Tom a servi à plusieurs pushes dans cette session (au lieu d'un usage unique). À révoquer par Tom après le push final de cette session — pas fait automatiquement, je n'ai pas les droits pour révoquer le token moi-même.

---

## 2026-05-01

### Incident & recovery — auto-bascule de 184 faux positifs
- **Incident** : à 21:33 UTC, l'auto-sync (commit `8e4466a`) a basculé **184 articles** en SOLD à tort.
- **Cause** : la vérif parallèle 12 threads + pacing 0 s'est faite rate-limit/challenge par Cloudflare. Beaucoup d'URLs ont retourné 403 ou 5xx. Mon code interprétait `r.status_code != 200` comme "supprimé" → bascule massive.
- **Recovery** :
  1. `git revert 8e4466a` → annule les 184 bascules (commit `fdb833a`).
  2. Workflow **désactivé** via API GitHub (`PUT /actions/workflows/.../disable`) pour empêcher une re-occurrence au prochain cron.
  3. Re-bascule manuelle de `66151282` qui avait été retiré pour le test.
- **Fix robuste** (commit `6fe9747`) :
  - **Concurrence réduite** : 3 workers (vs 12) + pacing 0.3 s entre requêtes
  - **Classification stricte** : HTTP non-200 / timeout / erreur réseau → on garde ACTIF (jamais "deleted"). DELETED ssi HTTP 200 ET ID disparu de l'URL finale. SOLD ssi HTTP 200 ET JSON-LD `OutOfStock`.
  - **Confirmation pass** : chaque candidat re-vérifié 1× avant inclusion finale (anti-glitch).
  - **Circuit breaker** : si > 15 items détectés en un run → ABORT, 0 bascule, vérification manuelle requise.
- **Validation end-to-end** (run `25235087251`) :
  - 563 items vérifiés sans rate-limit
  - **1 seul détecté** : `66151282` (le bon)
  - Confirmation pass OK → bascule auto → commit `b733f0f auto-sync 2026-05-01_22:13 | sold: 1`
  - **0 faux positif**
- Workflow ré-activé. L'outil est maintenant à toute épreuve.

### Sync Vestiaire — vérification parallèle systématique (FINAL)
- **Architecture finale** : pour chaque article dans `fs_map ∩ site_available`, on hit sa fiche produit Vestiaire en parallèle (12 threads via `ThreadPoolExecutor`). On lit le JSON-LD `availability` :
  - URL redirige vers catégorie (ID disparaît) → vraiment supprimé → bascule SOLD via D1
  - HTTP != 200 → vraiment supprimé → bascule SOLD via D1
  - JSON-LD `OutOfStock` → vendu oublié → bascule SOLD via B
  - JSON-LD `InStock` → article actif, on garde
- **Coût** : ~70s pour 564 articles (vs 14 min en séquentiel). Tient largement dans le timeout 15 min du workflow.
- **Plus de phantoms qui passent à travers les mailles** : les URLs fantômes que Vestiaire laisse dans la grille for-sale sont maintenant systématiquement testées contre l'état réel de la fiche produit.
- Commit : `627624b`.

### Bascules SOLD manuelles — Tom
- `66151282` Comme des Garçons T-shirt 150€ (Femme)
- `65604053` Yohji Yamamoto Pantalon 170€ (Femme)
- Articles supprimés sur Vestiaire mais qui ne sortaient pas en D1 sur l'ancien algo (phantoms). Avec la vérif parallèle ils seraient désormais détectés automatiquement.
- Commit : `ea99bc5`.

### Fix critique i18n — filtre Genre vide en anglais
- **Bug** : sur la version EN du site, le dropdown "Genre" ne montrait que "Accessories" (33). Plus de Homme/Femme.
- **Cause** : `getGender()` retournait `'Men'` / `'Women'` en EN, mais `genderOrder` était hardcodé `['Femme', 'Homme', '']`. Le `genderOrder.filter(g => genderCounts[g])` cherchait des clés FR qui n'existaient plus → liste vide → 0 options.
- **Fix** : `getGender()` retourne TOUJOURS la valeur canonique FR (`'Homme'`/`'Femme'`/`''`), peu importe la langue. La traduction est appliquée uniquement au moment de l'affichage via `t('gender.X')`. C'est la bonne architecture, c'est cohérent avec le reste du codebase qui utilise `t()` partout.
- Commit : `d646e3a`.

### Sync Vestiaire — fix faux positifs D1
- **Problème** : le scan SOLD était limité à la page 1 (24 derniers vendus). Un article vendu il y a longtemps tombait à tort en D1 quand notre logique pensait qu'il avait été supprimé.
- **Fix** : ajouté une étape de vérification individuelle dans `tools/synchro_vestiaire.py`. Pour chaque D1 candidat, on hit sa fiche produit Vestiaire via cloudscraper et on classe via JSON-LD `availability` :
  - Redirection vers catégorie OU 404 → vraiment supprimé (D1 confirmé, bascule SOLD)
  - `OutOfStock` → vendu raté par le scan (re-classé en B, bascule SOLD)
  - `InStock` → article actif, faux positif (skip)
- **Bascules manuelles validées par la vérif** : `66150681` (Yohji Yamamoto pantalon), `66151635` (Comme des Garçons sarouel), `63092993` (Comme des Garçons t-shirt — celui que tu avais supprimé sur Vestiaire).
- **Auto-sync confirmé fonctionnel** : 2 commits cron `auto-sync 2026-05-01_11:48` et `auto-sync 2026-05-01_20:01` ont basculé tout seuls les 2 vendus avant que je le fasse manuellement.
- Commits : `9a0a9e2`, `35ac915`, `fff3543`, `8c9ace9`.

### Sync Vestiaire — fix bypass Cloudflare
- **Problème** : depuis le matin, le scan timeout. Vestiaire est protégé par Cloudflare, qui détecte Playwright headless et envoie un challenge JS impossible à résoudre en mode headless.
- **Faux départs** : tenté `playwright-stealth` + xvfb → toujours bloqué. Tenté endpoints country-specific Decodo (`fr.decodo`, `us.decodo`, etc.) → ils n'existent pas sur le compte (le pool est `gate.decodo.com:10001-10010` only, et le format `user-session-XXX` renvoie 407). Tenté l'API `search.vestiairecollective.com` directement → bloqué par Cloudflare aussi.
- **Solution qui marche** : approche hybride. cloudscraper passe le challenge JS Cloudflare (en Python pur) et récolte les cookies `__cf_bm` etc. → ces cookies sont injectés dans Playwright qui ouvre la page sans plus se faire challenger. Puis Playwright fait son scroll/click habituel.
- **Bug bonus** : les secrets `DECODO_USER` / `DECODO_PASS` sur GitHub Actions contenaient un caractère parasite (newline ou espace) qui faisait 407 systématique. Ajouté un `.strip()` qui purge.
- **Compteurs FR + EN** : l'IP Decodo est routée US donc Vestiaire redirige sur `us.vestiairecollective.com`. Regex compteurs adaptée pour matcher les 2 langues (`X articles en vente` / `X items for sale`).
- Commits : `55aed15`, `d018562`.

### UI — petits ajustements
- **About page** : texte central re-centré verticalement (auto margins desktop + mobile) + gaps réduits pour tenir en 1 écran sans scroll. Commits `9b442eb`, `7b5e33b`.
- **Page d'accueil** : "Les Auteurs" agrandi sur desktop (`clamp(32px, 4.2vw, 56px)`) ; espace entre carousel et "Les Auteurs" raccourci sur desktop (110px → 50px), augmenté un poil sur mobile pour respirer un peu (-40 → -20). Commits `30e04a6`, `02d0144`.
- **Archive** : flou des photos retiré (était `blur(4px)` sur sold). Commit `7b5e33b`.

### Hotfix prod
- **Page blanche post-rebase** : ma résolution de conflit sur `index.html` a laissé un résidu de marqueur de rebase (`e304de7 (fix(sync)…)`) au milieu du tableau `SOLD_IDS` → JS pété → page blanche pendant ~5 min. Réparé immédiatement par `3e862e4`. À retenir : **toujours grep `<<<<<<<`/`>>>>>>>` ET vérifier la syntaxe d'un tableau JSON/JS après tout merge avant de pousser.**

---

## Comment ce journal est tenu

- Je rajoute une entrée à chaque modif significative
- Sections groupées par thème dans la même date (UX, sync, fix, etc.)
- Numéros de commits en référence pour retrouver le diff exact via `git show <hash>`
- Si je foire et que je te dois une explication, c'est noté
