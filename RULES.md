# Règles d'or — Passéist

Ces règles sont **non négociables**, issues d'incidents réels. Chaque règle = 1 catastrophe évitée.

---

## R0. Vérifier individuellement TOUT candidat à bascule SOLD (R1 appliquée)

**Incident 2026-05-03** : 7 articles ont été basculés SOLD à tort. Cause : la liste
B (`vc_sold_ids - vc_fs_ids & site_available`) était basculée DIRECTEMENT sans
vérification individuelle. L'onglet "Vendus" de Vestiaire affichait par erreur
7 articles actuellement InStock (bug UI / cache Vestiaire).

**Règle absolue** : tout item qui va passer en SOLD (que ce soit via B, D1, ou
n'importe quel autre bucket) DOIT être vérifié individuellement via sa fiche
produit JSON-LD `availability="OutOfStock"` AVANT bascule. Aucune exception.

Application dans `synchro_vestiaire.py` : `B_raw → verify_item() → B`. Les items
qui ne renvoient pas explicitement `OutOfStock` sont skippés silencieusement
(R1 : doute = sécurité).

---

## R1. Le doute profite à l'item (sécurité par défaut)

Pour toute opération automatique sur l'inventaire (bascule SOLD, retrait, suppression, etc.) :

- **Une réponse incertaine doit toujours être interprétée comme "ne rien faire"**, jamais comme une action destructive.
- Spécifiquement, dans le scan Vestiaire :
  - HTTP non-200 / timeout / erreur réseau / JSON-LD absent → article reste **ACTIF**, jamais marqué "supprimé"
  - DELETED uniquement si **preuve positive** : HTTP 200 + ID disparu de l'URL finale (vraie redirection vers catégorie)
  - SOLD uniquement si **preuve positive** : HTTP 200 + JSON-LD `availability="OutOfStock"`

**Pourquoi** : 2026-05-01, l'inverse de cette règle (= 403/5xx interprété comme "deleted") a basculé 184 articles à tort.

---

## R2. Circuit breaker sur tout traitement de masse

Tout script qui modifie automatiquement plusieurs items doit avoir un **plafond max** de modifications par run. Si dépassé → ABORT, 0 modification, log/Issue.

- Sync Vestiaire : `MAX_BASCULES_PER_RUN = 15`
- Si > 15 items détectés en un run, c'est anormal → on ne touche à rien et on attend une vérification humaine.

**Pourquoi** : un seul cron foireux peut faire des dégâts irréversibles si rien ne le stoppe.

---

## R3. Confirmation pass avant action irréversible

Toute action automatique destructive (= qui modifie l'état du site) doit être précédée d'une **deuxième vérification** indépendante du candidat.

- Première passe : détecte les candidats
- Pause + deuxième passe : re-vérifie chaque candidat individuellement
- Action seulement sur les items confirmés aux deux passes

**Pourquoi** : un glitch transitoire (timeout, 503 ponctuel) ne doit pas suffire à déclencher une bascule.

---

## R4. Concurrence modérée sur les services externes

Quand on hit un service externe (Vestiaire, Decodo, Netlify…), la concurrence doit rester modérée :

- **3 workers max en parallèle**
- **Pacing minimum 0.3s** entre requêtes (verrou global, pas par worker)
- Au-dessus, on se fait rate-limit, et un rate-limit perçu comme "erreur" peut empoisonner la classification (cf R1).

**Pourquoi** : 12 threads ont déclenché Cloudflare sur le scan complet et causé l'incident du 2026-05-01.

---

## R5. Test local avant prod, toujours

Aucun fix de logique de bascule auto n'est pushé sans :

1. Run en local avec un cas réel reproduit (ex : retirer 1 ID de SOLD_IDS et vérifier qu'il est re-détecté correctement)
2. Confirmation visuelle des résultats : 0 faux positifs, vrais positifs détectés
3. Examen du circuit breaker (le run doit rester sous le seuil dans des conditions normales)

**Pourquoi** : tout patch sur la sync touche potentiellement à des dizaines de produits. La prod n'est pas un environnement de test.

---

## R6. Toute résolution de conflit git relit le résultat avant `add`

Après un rebase / merge avec conflit :

1. Vérifier qu'aucun marqueur résiduel ne traîne : `grep -E '<<<<<<<|=======|>>>>>>>' fichiers`
2. Pour les fichiers JS / JSON, valider la syntaxe (parser, ou regex sanity check)
3. Seulement ensuite `git add` + commit + push

**Pourquoi** : 2026-05-01, un résidu `<<<<<<<` dans `SOLD_IDS` a cassé le JS du site → page blanche.

---

## R7. Tokens GitHub : éphémères, scope minimal

- Tout token créé pour une session est **supprimé immédiatement après le push**.
- Scope minimum nécessaire (`repo` seul si pas de modif workflow, `repo + workflow` sinon).
- Jamais de token avec `admin:org` ou `delete_repo`.
- Si un token apparaît dans un message, il est révoqué immédiatement (GitHub le détecte, mais ne pas s'y fier).

**Pourquoi** : un token compromis = full write access au site live et aux secrets associés.

---

## R8. Log permanent dans `JOURNAL.md`

Chaque modification non triviale fait l'objet d'une entrée datée dans `JOURNAL.md` :

- **Quoi** changé
- **Pourquoi** (problème résolu / objectif)
- **Numéro de commit** pour retrouver le diff
- En cas d'incident : cause racine + recovery

**Pourquoi** : une session Cowork est éphémère. Sans journal écrit, l'historique est perdu.
