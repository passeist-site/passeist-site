# passéist (passeist.com)

## Photos : règles figées

Les règles d'affichage et d'import des photos produits (format des sources
Vestiaire, photo 1 en 3:4 contain jamais recadrée, cartes des grilles = photo 1
de la fiche, photos 2+ en cover 3:4 avec `scale: 1.01`, interdiction du rognage
canvas, grilles et espacements) sont décrites dans **[PHOTOS.md](PHOTOS.md)**.

Elles ont été validées par Tom : **ne pas les modifier sans son accord
explicite**. Les règles CSS concernées dans `index.html` portent le commentaire
`REGLE FIGEE par Tom, voir PHOTOS.md`.

## Mise en page : vérification obligatoire

Après **tout** changement visuel (site, chat, panier, fiches), et avant de le montrer à Tom ou de
le mettre en ligne : `python3 -m http.server 8765 &` puis `node tools/check_layout.js`.
Il contrôle accueil, boutique, fiche, panier et chat, en FR et EN, à 360, 393, 430 et 1440 px :
débordements, chevauchements, textes coupés, blocs mal centrés, erreurs JavaScript. Tout
problème signalé se corrige avant de présenter le travail. Demande de Tom (2026-11-18) :
« il faut que tu vérifies la mise en page en permanence dès qu'on fait un changement ».
