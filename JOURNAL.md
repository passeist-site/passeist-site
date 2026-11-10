# Journal des modifications — Passéist

Tout changement, fix, idée ou décision important est tracé ici. À chaque modif que je fais je rajoute une ligne, datée, courte. Ordre antéchronologique (plus récent en haut).

---

## 2026-11-06

### Écharpe A.A.R. 73332525 : photo 1 remise dans le bon sens (Tom)
- Vestiaire l'affichait couchée : remplacée par la photo fournie par Tom (verticale), préparée comme à l'import (carré fond blanc, xl/md/sm), fond gris très clair passé en blanc pur.

### Traduction anglaise automatique réparée
- Cause : depuis mi-octobre 2026, Google Traduction refuse les serveurs GitHub (page « Sorry… »). deep-translator échouait sans rien dire : ~230 pièces importées sans anglais (traduites à la main les 6/11).
- tools/translate.py : appel direct d'abord (gratuit), sinon même requête via ScrapingBee (adresse française, 1 crédit par appel), découpage en morceaux de 1 500 caractères, tout ou rien. Utilisé par l'import.
- Synchro : étape « Rattrapage traductions anglaises manquantes » (translate.py --fill 40) après les imports.
- Workflow « Essai traduction » (lancement à la main) : traduit une phrase, ne modifie rien.

### Synchro complète du 6/11 : 32 pièces importées, toutes les photos
- Import en 5 photos à la fois : 32 pièces (dont les 4 « Non signé » : 3 × 45RPM, 1 × X-LARGE), toutes leurs photos, accents corrects. 816 pièces en vente.
- Types : quand Vestiaire donne un mot générique ou faux dans un même rayon (« Cravate » pour des chaussettes, « Chapeau » pour une casquette), la description l'emporte : 4 chaussettes, 3 casquettes, 1 bonnet, 1 cagoule (nouveau type, rayon Chapeaux). Panama, Cartable, Ballerines… restent tels quels. 9 adresses redirigées.
- 32 descriptions et 25 noms traduits en anglais (la traduction automatique de l'import ne marche plus).

### Import bloqué pour toutes les nouvelles pièces : nom des photos Vestiaire changé
- 2e synchro : 28 pièces importées mais incomplètes (1 à 7 photos sur 15) : le CDN photo refuse GitHub (403), le secours ScrapingBee échoue par moments et l'import s'arrêtait à la 1re photo ratée. Accents abîmés sur 6 pièces (réponse ScrapingBee lue en latin-1), « T-shirt » devenu « Chemise » (double traduction). Corrigé : 3 essais par photo (le dernier en proxy premium), on continue à la photo suivante, encodage UTF-8 forcé, « T-shirt » reconnu comme français, « Tie » = Cravate, MIHARA YASUHIRO = MAISON MIHARA YASUHIRO. Les 28 pièces et leurs 381 photos retirées pour être réimportées proprement.
- 68563799 : collaboration X-Large × Eames Office → marque X-LARGE (BRAND_OVERRIDES).
- 3e version (Tom : « synchro de 5 min ») : 3e synchro arrêtée après 35 min. Photos téléchargées 5 à la fois, ScrapingBee 1 essai normal + 1 premium (délai 30 s), plus d'essai direct une fois le 403 vu. Option « max_imports » au lancement manuel de la synchro pour essayer sur 1 pièce avant de tout lancer.
- Synchro du 6/11 (lancée à la main) : 32 imports en échec, « photo 1 : HTTP 403 ». Vestiaire nomme désormais les photos avec le numéro de l'annonce (« produit/73317570-1_2.jpg ») et non plus avec son nom ; l'adresse devinée par l'import ne marche plus pour aucune pièce. Les chemins sont lus dans la fiche (pictures[].path), préfixe « produit/ » ajouté ; secours ScrapingBee si le CDN refuse les serveurs GitHub.

### Types précis pour chaque pièce (Tom : « pas de chapeau/bonnet »)
- 56 types flous venus de Vestiaire remplacés par la pièce nommée dans la description : « Chapeau / bonnet » → Casquette, Chapeau, Bob, Bonnet ; « Pull / gilet / sweat » → Cardigan ; « Petite maroquinerie » → Portefeuille, Porte-cartes, Porte-clés ; « Pochette » → Sacoche, Sac bandoulière ; « Haut » → Top, T-shirt… (matière gardée : « Casquette en cuir »). L'import fait pareil (tools/type_from_desc.py, VAGUE). 237 anciennes adresses redirigées au total.
- Sous les photos : le type seul, sans matière (choix de Tom) : window.cardType() retire « en laine », « en cuir »… (EN : wool, leather…) ; la fiche garde le nom complet. Marque et type toujours sur une ligne (points de suspension au besoin) : toutes les cartes ont la même hauteur, vérifié sur iPhone SE, iPhone 13 et ordinateur, FR et EN (0 nom coupé).

### Langues : plus de français sur les pages anglaises, ni l'inverse (Tom)
- 197 descriptions sans version anglaise (155 en vente, 42 vendues) traduites (la traduction automatique de l'import échoue : Google bloque). 17 noms de pièces sans anglais complétés.
- Bulles et libellés d'accessibilité (Panier, Recherche, Favoris, Retour à l'accueil, Photo suivante…) traduits sur le site et les pages Auteurs ; « Réf. » → « Ref. » ; pied de page CGV / Confidentialité → Terms / Privacy ; titres « Notre sélection » / « Voir toutes les pièces » des pages Auteurs traduits ; titre de l'onglet d'une fiche en anglais pour un visiteur anglophone (les robots gardent le français).
- Page Yohji : « FW 2023-24 » → « automne-hiver 2023-24 », « mid 90s » → « milieu des années 90 », « pièces staple » → « pièces essentielles » (version française).
- Laissés exprès : noms propres (Comme des Garçons, Y's for men…), descriptions Google (meta) en français.

### Boutique : titre, filtre Auteur, date seule sous les photos (Tom)
- Titre sans filtre : « 790 pièces de créateurs japonais » (EN « 790 Japanese designer pieces »), « 790 pièces » dans le bouton Filtres sur mobile ; Vendu : « 663 pièces vendues ».
- Filtre « Marque » → « Auteur » (« Tous les auteurs » ; EN Designer).
- Plus de date sous les photos des cartes (Tom : seules 55 % des pièces en ont une, souvent « Années 90 », les cartes se décalaient). Date et ligne (Pleats Please, Homme Plus, Y's…) sur la fiche, sauf les lignes qui se lisent comme un genre (Men, Pour Homme, Homme, Man), retirées. La date reste cherchable.

### Marques corrigées
- 71640391 : « SÉRIE VINTAGE "LIEBE LECKEN" » → RIPVANWINKLE (tirettes gravées) ; GROUND Y → YOHJI YAMAMOTO ; MIHARA YASUHIRO → MAISON MIHARA YASUHIRO (et à l'import).
- Import, photos : l'import devinait le nom des photos à partir de l'adresse de l'annonce ; pour les 4 pièces « Non signé » (annonces renommées depuis leur création) la photo 1 restait introuvable → EXIT 3. Les chemins des photos sont maintenant lus dans la fiche Vestiaire (le nom deviné reste en secours), avec un diagnostic dans le journal si ça échoue encore.
- 72606166 (sweat zippé marine, « Non signé ») = 45RPM d'après Tom (BRAND_OVERRIDES dans import_vestiaire.py).
- Import : « North Marine Drive », « 45R & », « umii908 » = 45RPM (2 des 4 pièces « Non signé »). Les 4 n'étaient pas entrées le 5/11 : ScrapingBee a expiré pendant le téléchargement des photos, ça se retente à chaque synchro.

### Catégories revues de fond en comble (Tom : « pas de jupe, pas de chemise, Bas ça veut rien dire »)
- 17 catégories au lieu de 8 : Vestes, Manteaux, Costumes, Chemises, T-shirts & tops, Pulls & gilets, Sweats, Pantalons, Jupes, Robes, Combinaisons, Chaussures, Sacs, Chapeaux, Écharpes, Accessoires (Autres seulement si rien ne colle : 0 pièce aujourd'hui, contre 49 avant). Dans cet ordre dans le filtre, noms anglais en EN.
- Mêmes règles partout : getCategory() (index.html), categoryOf() (plugin, lib/category.js), tools/type_from_desc.py (import).
- 37 noms de pièces restés en anglais remis en français (Wool pull → Pull en laine, Harem → Sarouel, Satchel → Sac à dos…).
- 74 pièces en vente dont le type Vestiaire contredisait la description (« Blouse » pour un top, « Sweat » pour un gilet, « Costume » pour une jupe, « Espadrilles » pour un short…) : type corrigé d'après la description.
- 108 anciennes adresses de fiches redirigées (301) vers les nouvelles.
- Règle Tom : **la catégorie se base sur la description de Tom, pas sur Vestiaire.** tools/type_from_desc.py lit la pièce dans la description (« Ravissant top… », « Très belle paire de bottes… », ou une ligne qui commence par le vêtement : « Chemisette en coton… »), en ignorant les comparaisons (« type sweat », « comme un jean ») et les en-têtes (Collection, Marque, Matière…). Le type Vestiaire n'est gardé que s'il est dans le même rayon, ou si la description ne nomme pas la pièce (70 sur 1 460). Costumes gardés (ensembles).
- Appliqué à tout le catalogue, pièces vendues comprises : 73 types de plus corrigés (ex. 7 paires de chaussettes rangées en « Pantalon », « Legging » ou « Écharpe & pochette »). 179 anciennes adresses redirigées au total.
- L'import applique la même règle à chaque nouvelle pièce.
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

## 2026-11-06 — Pinterest : flux à part, photo 1 seule
Pinterest lisait feed.xml (8 photos par pièce pour Google Merchant) et a créé
une épingle par photo : 5 141 épingles, dont plein de zooms. Le build génère
maintenant aussi `feed-pinterest.xml` (photo 1 seule, 1 pièce = 1 épingle).
À faire côté Pinterest : source de données du catalogue → feed-pinterest.xml.

## 2026-11-08 — Bonnet CDG vendu, « bonnet » = beanie
- 73405015 (bonnet Comme des Garçons) vendu sur Vinted, retiré de Vestiaire → SOLD.
- Google traduisait « bonnet » par Cap ou Wool hat : 6 pièces renommées
  Beanie / Wool beanie. `translate.translate_type()` force beanie pour les
  types commençant par « Bonnet » (import + rattrapage).

## 2026-11-08 — Newsletter du 8 novembre en ligne
Édition copiée de tools/newsletter-drafts/edition1.json vers
netlify/functions/newsletter-edition.json. Sommaire : Vestiaire noir, Pièce de
défilé, Nouvel auteur, Les accessoires. Objet avec les marques. Envoi manuel
par Tom (« Envoyer maintenant » dans la messagerie).
- Version finale (16 pièces) : titres de partie numérotés comme le sommaire (`numbered`), photos des paires dans le même cadre (colonnes fixes, photos et textes sur deux lignes), lien « Voir les pièces Monitaly » (`sec.more`), textes doudoune et Monitaly réécrits avec Tom.

## 2026-11-08 — Messagerie : « Envoyer à une personne » (en attente du push)
Pour un inscrit arrivé après l'envoi : vraie campagne Brevo (objet normal,
désinscription, statistiques) vers une petite liste « passéist · envoi à une
personne » vidée avant chaque envoi. Langue prise dans la liste de la personne.
Refuse toute adresse absente des listes FR/EN ou désabonnée.

## 2026-11-09 — Fiche produit inspirée de Wright (ESSAI, branche seulement)
- Téléphone : grande photo bord à bord en « ruban » (photos voisines collées
  qui glissent avec le doigt), vignettes 54 px à angles droits (PHOTOS.md § 4 ter).
- Prix dans la typo et la taille de la marque, sans l’étiquette (fiche, puis cartes de la boutique, de l’accueil et des articles similaires).
- Description repliée sous « Lire la description complète + » (EN : Read the full description +).
- Abandonné : compteur de photos, bloc de faits, ligne matière (déjà dans le titre).
- Retour arrière : `git revert` du commit « Fiche produit façon Wright ».

## 2026-11-09 — Version blanche (essai caché, puis pour tous le soir même)
`?theme=blanc` (gardé dans le navigateur, `?theme=sombre` pour revenir) : la feuille
de style est inversée à la volée (bleu nuit ↔ blanc, crème ↔ bleu nuit). Fond de page
= blanc exact des photos Vestiaire (90 % du stock en #FFFFFF) : vêtements comme
détourés, ombres gardées. Les clients ne voient rien. Retour arrière : supprimer le
script « Version blanche en essai » dans index.html.
- Passée par défaut pour tous (Tom : « personne sur le site »). `?theme=sombre` = ancien bleu nuit.

## 2026-11-09 : thème blanc, retouches (Tom)
- Barre « Ajouter au panier » des fiches (mobile) un peu moins haute : boutons 36 px, marges 6 px.
- Boutons Explorer / Tout voir en bleu nuit (#1C2230, l'ancien fond) et non plus le bleu du point.
- Ruban photos : largeur exacte du cadre (décimales) et voisines cachées au repos, plus de filet sur les bords.
- Thème blanc : photo 1 des 65 pièces à fond gris détourée et posée sur blanc pur, pour ne plus voir de rectangle gris en boutique. Détourage hybride (modèle isnet, plus comparaison au fond réel pour garder le crème et le blanc : manches crème, tee et sac 45rpm blancs). Photo défilé Issey, illustration CDG et portefeuille Y's : photo d'origine gardée.
- Cases gris très clair (boutique et fiche) essayées, pas retenues : Tom garde les pièces qui flottent sur le blanc. Fiche produit : solution encore à trouver.
- Fiche : description de nouveau affichée en entier, le bouton « Lire la description complète + » est retiré (Tom).
- Retour au bleu nuit pour tous (Tom, soir du 2026-11-09). Version blanche gardée sur demande : ?theme=blanc (?theme=sombre pour revenir). Conservés : ruban photos sans espace, photo de fiche limitée en hauteur, barre panier réduite, description en entier, photos 1 détourées, colonnes de la version blanche non appliquées au bleu.
- Une seule version (Tom) : assets/theme.js et la version blanche retirés du site (récupérables dans l'historique git, commit daff99d4d).
- Fiche mobile : coins arrondis 6 px (vignettes 4 px) et grande photo réduite à 46svh (Tom). PHOTOS.md mis à jour.
- Version claire retenue pour l'essai (Tom, soir) : fond #eeeeee, pièces qui flottent (multiply, sans détourage) en boutique, carrousel d'accueil et fiche. Retour au bleu nuit si ça ne va pas : retirer le script theme.js.
- Version claire : boutons de filtres et barre panier en verre dépoli (Liquid Glass), point actif sous les photos en bleu du logo, cœur gardé en bleu nuit (Tom). À faire plus tard : détourer les 2e photos à fond gris (Tom accepte les vues coupées net).
- Version claire : filtres et panier en bleu nuit vitré, Explorer en verre, photo de fiche à 56svh (Tom).
- Explorer reste bleu nuit (Tom), pas de verre.
- Détourage des 2e photos abandonné (Tom).
- Ordinateur : au survol d'une carte, la photo 1 s'efface sous la photo 2 (elles se superposaient avec multiply).
- Fenêtre de discussion en bleu nuit vitré, comme le panier et les filtres (Tom).
- Ordinateur : menu de l'en-tête (Accueil, Boutique, Auteurs…) et FR/EN en crème, ils étaient invisibles sur l'en-tête bleu nuit.
- Pages auteurs : rouleau « Notre sélection » aligné sur les rouleaux des fiches (pièces qui flottent, prix sans étiquette), bouton « Voir toutes les pièces » bleu nuit (Tom).
- Accueil ordinateur : photos du carrousel 25 % plus grandes, moins de vide sous Explorer (Tom).
- 34 photos 1 de plus détourées (fond gris au bas/au bord non vu par le premier tri, ex. jeans 45rpm et Yohji). Sweat blanc 64206614 et chemise 55692186 laissés tels quels (halo).
- Gilet Issey Miyake PE 2010 (66122852) : photo du gilet passée en photo 1 et détourée, la photo défilé passe en 2e (Tom).
- Portefeuille Y's 65393849 : 3e photo (portefeuille seul) passée en photo 1 et détourée (Tom).
- Fenêtre « Ajouté au panier » en bleu nuit, texte crème (Tom).
- Page Contact : encart « Discuter avec nous » en bleu nuit (tour d'homogénéité du site).
- Pastille du panier : crème avec le chiffre bleu nuit (le chiffre était invisible, il ne restait qu'un grand cercle).
- Pied de page de la même hauteur que l'en-tête (64 px ordinateur, ~54 px téléphone ; e-mail retiré du pied sur téléphone, il reste sur Contact) (Tom).
- Bandeau VENDU en bleu nuit, texte crème (Tom).
- Page Vendu : 85 photos 1 de pièces vendues détourées (fond gris), comme en boutique (Tom). Illustration 70328124 laissée telle quelle.
- Boutique / Vendu téléphone : barre de filtres collée sous l'en-tête dès l'arrivée (même écart qu'en défilant), tout remonte de 28 px (Tom).
- Fiches vendues : plus d'icônes panier ni favori à côté du prix (Tom).
- Paiement : si Stripe refuse un moyen de paiement, on retire seulement celui-là au lieu de repasser à la carte seule (Tom ne voyait que carte + Apple Pay).
- Boutique téléphone : « Créer votre alerte » à égale distance des filtres et des pièces (~19 px à l'œil) (Tom).
- Accueil : titre « les auteurs » remis au-dessus des marques (Tom). Cœur des favoris vides laissé vide.
- Boutique téléphone : grande carte en cadre carré et 52 px entre les rangées (Tom).
- Grande carte : retour au cadre 3:4 (Tom ne veut pas risquer de couper l'objet).
- Page Vendu téléphone : 32 px entre les rangées (cartes sans ligne taille) (Tom).
- Grande carte : cadre carré validé par Tom sur aperçu (rien n'est coupé).
- Pages Auteurs : le panier ouvre le panier (/?cart=1) au lieu de l'accueil, avec la pastille du nombre d'articles (Tom).
- Carrousels (pages auteurs, sous les fiches) : barre de défilement masquée (Tom). Le glissé au doigt reste.
- Pages Auteurs intégrées au site (Tom, 2026-11-10) : au build, marques.html et marques/*.html deviennent le site complet (index allégé) avec le contenu de la page Auteur dans #auteur-page (route SPA « marques »). Panier, discussion, favoris, menu et retour navigateur sont ceux du site ; titre, description, canonique et JSON-LD restent ceux de la page Auteur. Les fichiers du dépôt restent la source du contenu (plugin buildBrandSpaPages, CSS des pages Auteurs limitée à #auteur-page).
- Photos : numéro de version IMG_V ajouté aux adresses des photos (index + build) pour forcer le rechargement après retouche. À vérifier avant mise en ligne.
- Carrousel d'accueil : tirage au hasard parmi toutes les pièces en vente (avant : les 120 plus chères seulement) (Tom).
- Cartes vendues : étiquette « VENDU » droite (bleu nuit, coins 3 px) en haut à droite au lieu du bandeau en biais (Tom, choix B). Fiche vendue : bandeau inchangé.
- Fiche vendue : même étiquette VENDU droite en haut à droite que sur les cartes (le bandeau en biais était resté).
- Pull CDG PE 1996 (65021255) : photo du pull en photo 1, détourée ; photo défilé en 2e (Tom). IMG_V passe à 3.
- FAIT (Tom, 2026-11-10, pas encore en ligne) : fiche mobile, toucher une photo ouvre une visionneuse plein écran (fond sombre, photo bord à bord, bouton ✕, points en bas), zoom libre au pincement, passage à la photo suivante en glissant. Modèle : appli Drouot (captures du 10/11). Remplace la règle « pas de lightbox au tap sur mobile » (index.html, ~l. 8233).
