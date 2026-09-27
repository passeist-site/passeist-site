# Règles photos passéist (FIGÉES)

Règles validées par Tom le 2026-09-27. Elles décrivent exactement ce qui est
implémenté dans `index.html`. **Ne pas les modifier sans l'accord explicite de
Tom**, y compris pour un « petit ajustement » visuel. Les règles CSS concernées
portent le commentaire `REGLE FIGEE par Tom, voir PHOTOS.md`.

## 1. Format des sources (Vestiaire)

Toutes les images Vestiaire sont des **carrés** (800×800 sur le CDN en `w=800`,
1600×1600 en `w=1600`). Les copies locales `img/<id>-<i>-{sm,md,xl}.webp`
(400 / 800 / 1600 px) ont les mêmes proportions : ce sont des réductions du
même fichier, jamais des recadrages.

- **Photo 1** (index 0) : photo studio qui occupe **tout le carré**, sans bandes
  (le vêtement peut aller presque d'un bord à l'autre).
- **Photos 2+** (index 1 et suivants) : une photo **3:4 portrait** posée au
  centre du carré, avec des **bandes blanches de 12,5 % de chaque côté**
  (100 px sur 800, 200 px sur 1600).

## 2. Photo 1 : jamais recadrée

Partout (fiche produit desktop et mobile, grande photo et vignette, cartes des
grilles) :

- cadre **3:4 portrait**, fond **#fff**, `object-fit: contain` ;
- **jamais** de `cover`, de `scale`, de zoom ni de rognage : le carré est posé
  entier, le blanc ajouté en haut et en bas se fond avec le fond studio.

**Ne plus jamais modifier la grande photo 1 ni la vignette 1 de la fiche
produit.** Leur rendu actuel est validé tel quel.

## 3. Cartes des grilles = photo 1 de la fiche

Boutique, Vendu, Favoris, résultats de recherche, filtre par marque :

- la carte affiche **le même fichier** que la grande photo 1 de la fiche :
  même fonction `imgUrl(p, 0, …)`, même source (fichier local s'il est dans
  `VALIDATED_LOCAL`, sinon CDN Vestiaire avec le même numéro de photo) ;
- seule la **largeur** change, via `srcset` (`imgSrcset(p, 0)` : 400 / 800 /
  1600 px), jamais une autre variante Vestiaire ni une image recadrée ;
- **même rendu** que `.main-photo[data-idx="0"]` sur mobile : cadre 3:4, fond
  #fff, `object-fit: contain`, aucun `cover`, aucun `scale`, aucun zoom ;
- coins arrondis **6 px** (`.product-img`).

## 3 bis. Carrousel de l'accueil (`.hero-marquee`)

Même règle que les cartes des grilles :

- chaque carte montre **la photo 1 de la fiche** (même fichier, via
  `imgUrl(p, 0, …)` + `srcset` `imgSrcset(p, 0)`, seule la largeur chargée
  change) ;
- cadre **3:4 portrait identique pour toutes les cartes** (largeur = hauteur ×
  3/4 : 171×228 px sur desktop, 127,5×170 px sur mobile), fond **#fff**,
  `object-fit: contain`, photo entière, **aucun zoom ni recadrage**, aucune
  opacité ou filtre ; coins arrondis **6 px** ;
- hauteur du carrousel inchangée (240 px desktop, 170 px mobile), défilement
  infini et drag conservés ; la longueur d'un tour est mesurée à la position
  de la première carte dupliquée (boucle sans saut).

Le bouton EXPLORE (`.hero-cta`) a lui aussi des coins arrondis de 6 px.

## 3 ter. Carrousel des pages Auteurs (`/marques/<marque>`)

Même règle que les cartes des grilles, avec le même texte que les cartes de la
Boutique (marque + étiquette prix, nom, trait, taille · genre, FR/EN) :

- photo 1 de la fiche (même fichier, `srcset` 400 / 800 / 1600), cadre 3:4,
  fond #fff, `object-fit: contain`, coins 6 px (`assets/marques.css`) ;
- les cartes sont **régénérées à chaque build** par
  `netlify/plugins/generate-product-pages` (pièces en vente de la marque,
  24 max) et renvoient directement vers la fiche produit.

## 4. Photos 2+ de la fiche produit

Grande photo quand une photo 2+ est affichée, et vignettes 2+, sur mobile et
desktop :

- cadre **3:4**, `object-fit: cover`, `object-position: center` : le cover
  retire exactement les bandes blanches latérales, sans toucher au vêtement ;
- **`scale: 1.01`** (agrandissement de 1 %, centré), dans un conteneur en
  `overflow: hidden` (`.main-photo-wrap`, `.thumb`) : supprime le liseré blanc
  de 1-2 px au bord des bandes. 1.01 est la plus petite valeur qui le supprime
  (mesure au pixel à 390 et 1400 px ; sans agrandissement le liseré est
  visible). On utilise la propriété CSS `scale` et non `transform`, car le
  pinch-zoom écrit un `transform` inline sur la grande photo.

## 5. Interdictions

- **Aucun rognage canvas** : la fonction `trimWhiteBorders` / `applyTrim`
  (détection et découpe des bords blancs dans le navigateur) est **interdite**.
  Elle a été supprimée : elle rognait jusqu'au vêtement (photos ultra zoomées).
- Pas de rognage côté serveur non plus (ex. `wsrv.nl?trim=`).
- Pas de `cover` sur la photo 1, ni sur les cartes des grilles.

## 6. Grilles produits

- **Desktop (> 900 px)** : toutes les cartes au format normal, **aucune carte
  agrandie** (pas de pièce mise en avant, pas de `grid-auto-flow: dense`).
- **Mobile (≤ 900 px)** : une carte **pleine largeur tous les 5 articles**
  (`.product-card:nth-child(5n)`, `grid-column: 1 / -1`) sur la Boutique,
  **sauf sur les pages Favoris et Vendu** (`body[data-page="favorites"]`,
  `body[data-page="archive"]`) où toutes les cartes sont normales.
- **Espacements** :
  - écart vertical entre rangées : **48 px** desktop, **32 px** mobile ; écart
    horizontal inchangé (36 px desktop, 14 px ≤ 900 px, 10 px ≤ 480 px) ;
  - bloc texte compact sous la photo : `.product-body` padding-top 12 px
    (8 px mobile), marque → nom 6 px (4 px), nom → trait 8 px (4 px), trait →
    ligne taille 6 px (4 px), sans `min-height` : la ligne taille · genre est
    collée sous le trait.

## 7. Pour les imports

Les scripts d'import (`tools/import_vestiaire.py`, `tools/import_hd.py`,
`tools/reprocess_all_hd.py`, workflow `sync-vestiaire`) doivent produire des
fichiers conformes à la section 1 (carrés, photo 1 plein carré, photos 2+ en
3:4 centré avec bandes de 12,5 %), sans recadrage ni rognage. Vérifier ce
point avant toute modification de ces scripts.
