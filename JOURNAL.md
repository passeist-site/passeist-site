# Journal des modifications — Passéist

Tout changement, fix, idée ou décision important est tracé ici. À chaque modif que je fais je rajoute une ligne, datée, courte. Ordre antéchronologique (plus récent en haut).

---

## 2026-05-01

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
