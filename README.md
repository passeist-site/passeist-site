# Passeist — Site

Site vitrine de Passeist, curation de vêtements japonais vintage.
Toutes les photos sont auto-hébergées dans `/img/` (WebP, 3 tailles : sm/md/xl).

## Déploiement Netlify via GitHub

Le dossier fait ~820 Mo (9 881 photos WebP), trop lourd pour le drag-drop Netlify. Voici la procédure GitHub (gratuite, 15 min) :

### Étape 1 — Créer un compte GitHub
1. [github.com/signup](https://github.com/signup) si tu n'en as pas

### Étape 2 — Installer Git sur ton Mac
Ouvre Terminal (Applications → Utilitaires → Terminal) et tape :
```
git --version
```
Si Git n'est pas installé, macOS te proposera de l'installer en un clic.

### Étape 3 — Créer un repo GitHub
1. [github.com/new](https://github.com/new)
2. Nom : `passeist-site`
3. Visibilité : **Private** (pour ne pas exposer le code publiquement)
4. Clique **Create repository**
5. GitHub te montre une page avec des commandes — ne fais rien, passe à l'étape 4

### Étape 4 — Pusher le site sur GitHub
Dans le Terminal, navigue vers le dossier qui contient ces fichiers (`index.html`, `img/`, etc.), puis tape :
```
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/TON_USERNAME/passeist-site.git
git push -u origin main
```
(Remplace `TON_USERNAME` par ton username GitHub.) La première fois Git va te demander tes identifiants.

Le push peut prendre 5-10 min (on envoie 820 Mo).

### Étape 5 — Connecter le repo à Netlify
1. [app.netlify.com](https://app.netlify.com) → ouvre ton projet **candid-stardust-597818**
2. **Site settings** → **Build & deploy** → **Continuous deployment** → **Link repository**
3. Autorise GitHub, sélectionne `passeist-site`
4. Branche `main`, build command vide, publish directory `.` (le root)
5. **Deploy**
6. Netlify va builder en 1-2 min puis le site est live sur passeist.com

### Pour mettre à jour le site après
Dans le dossier local :
```
git add .
git commit -m "mise à jour"
git push
```
Netlify redéploie automatiquement en 30 sec.

---

## Ajouter de nouveaux produits

1. Nouvelles photos : ajouter dans `/img/{id}-{n}-sm.webp`, `-md.webp`, `-xl.webp`
2. Nouveau produit : éditer le tableau `PRODUCTS` dans `index.html`
3. `git commit + push` → Netlify redéploie

On mettra en place un script automatique plus tard pour synchroniser Vinted/Vestiaire.

---

## Fichiers présents

- `index.html` — le site complet (une page)
- `img/` — 9 881 photos WebP (3 tailles par photo produit)
- `robots.txt` + `sitemap.xml` — SEO Google
- `_headers` — sécurité (HSTS, Referrer-Policy)
- `netlify.toml` — config Netlify
- `vercel.json` — config Vercel (backup)
