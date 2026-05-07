# Règles d'or — Passéist

Ces règles sont **non négociables**, issues d'incidents réels. Chaque règle = 1 catastrophe évitée.

---

## R-1. Sparse-checkout : danger sur les modifications de fichiers exclus

**Incident 2026-05-04** : batch d'import HD photos. 137 dossiers traités, 10K+ webp écrites localement par `import_hd.py`. `git status` ne montrait quasi rien comme modifié → mes commits étaient vides/incomplets → les versions carrées (800×800) sont restées sur GitHub à la place des nouvelles natives 2:3 (533×800).

**Cause** : sparse-checkout marque les fichiers exclus (ex: `img/`) avec le flag `SkipWorktree`. **Git ignore les modifications locales sur ces fichiers**, même quand ils existent physiquement et qu'on les a réécrits. `git add --sparse` traite les NOUVEAUX fichiers, mais pas les MODIFICATIONS de fichiers déjà tracked et skip-worktree'd.

**Règle** : quand on modifie en masse des fichiers dans un path exclu de sparse-checkout :
1. **Désactiver sparse temporairement** : `git config core.sparseCheckout false`
2. **Clear skip-worktree** : `git ls-files -t img/ | grep '^S' | awk '{print $2}' | xargs git update-index --no-skip-worktree`
3. Vérifier avec `git status -s` qu'on a bien le nombre de modifs attendu
4. Add + commit + push
5. Réactiver sparse : `git config core.sparseCheckout true && git read-tree -mu HEAD`

**Ou plus simple** : pour les batchs photos, faire un clone NON-sparse temporaire dans un autre dossier, traiter, push, supprimer le clone.

---

## R-1bis. Inspection visuelle après batch sur output binaire

Après tout traitement batch d'images (`import_hd.py`, `import_vestiaire.py`) :
1. **Comparer 1-2 outputs avec un produit déjà OK connu** — dimensions, format, ratio
2. Vérifier qu'au moins un fichier modifié apparaît dans `git status`
3. Hash 1 fichier local vs HEAD pour confirmer divergence : `git hash-object img/X.webp` vs `git ls-tree HEAD img/X.webp`

Sans ça, on peut traiter parfaitement 10 000 fichiers et n'en pousser que 0% à 50% sans s'en rendre compte.

---

## R-1ter. Batchs lourds I/O : depuis le Mac, jamais depuis le sandbox Cowork

**Incident 2026-05-04 (suite)** : tentative de re-process de 184 dossiers FAIT (~2700 photos) depuis Cowork. Résultat : ~30 min perdues à se battre contre :
- Erreurs FUSE deadlock (errno 35 « Resource deadlock avoided ») aléatoires sur les lectures du mount macOS↔Linux
- Saturation du disque sandbox (`/sessions` = 9.8 GB partagés avec git history et /tmp)
- CPU sandbox limité (~1 thread effectif) → encoding WebP 5-10× plus lent que sur le Mac

**Règle** : tout batch qui touche à beaucoup de fichiers binaires (photos, vidéos, archives) → script `.command` sur le Mac, jamais depuis le sandbox.

**Outil** : `tools/relance_batch_hd.command` (re-process complet photos HD format 2:3 portrait + push). Lance directement en double-clic depuis le Finder.

**Pour le sandbox** : code, diff, logique métier, audits HTTP, edits ciblés sur quelques fichiers. Pas de gros volumes I/O.

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

## R2bis. Pas de seuils incohérents entre couches (layered guards alignés)

**Incident 2026-05-04** : la sync Vestiaire ne basculait plus les D1 (articles supprimés sur Vestiaire) depuis plusieurs runs. Cause : double check sur la complétude du scan, avec deux seuils différents :

- `synchro_vestiaire.py` : `SCAN_THRESHOLD = 0.9` (calcule D1 si scan ≥ 90%)
- `.github/workflows/sync-vestiaire.yml` : `fs_complete = fs_scanned >= fs_target` (applique D1 SEULEMENT si scan = 100% strict)

Quand Tom est passé à 611 articles dispos pour un cap scan de 600, le ratio passait à 98% : le script computait D1, le workflow le skippait. Tom voyait "rien ne bascule" sans erreur visible.

**Règle** : quand deux couches successives gardent la même condition (ici "scan complet"), elles doivent utiliser le **MÊME seuil**, ou la couche aval doit être strictement plus permissive (la couche amont est déjà la garde-fou). Sinon on a un guard mort qui bloque silencieusement.

**Pour la sync Vestiaire** : seuil aligné à 90% des deux côtés, car `verify_item()` (JSON-LD individuel) est l'ultime garde-fou anti-faux-positif (R0).

**Plus généralement** : à chaque check de sécurité empilé, se poser la question "est-ce que ce check est strictement plus restrictif que celui d'amont, et si oui pourquoi ?". Sinon → simplifier.

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
