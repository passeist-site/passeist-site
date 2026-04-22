# Déploiement Passeist — pas à pas

## État du dossier
- `index.html` → le site (tout-en-un, ~630 KB)
- `robots.txt` + `sitemap.xml` → SEO Google
- `_headers` → sécurité (HSTS, Referrer-Policy…)
- `netlify.toml` / `vercel.json` → config selon l'hébergeur
- Tu as **passeist.com** déjà acheté chez OVH (expire janv. 2027)

## Étape 1 — Créer un compte Netlify (5 min)
1. Va sur [app.netlify.com/signup](https://app.netlify.com/signup)
2. Clique "Sign up with email" (ou GitHub/Google si tu préfères)
3. Valide ton email

## Étape 2 — Déployer le site (2 min)
1. Dans le dashboard Netlify, clique **"Add new site"** → **"Deploy manually"**
2. **Glisse-dépose le dossier entier** qui contient `index.html`, `robots.txt`, etc. (tout le contenu de outputs/)
3. Netlify te donne une URL temporaire `xxx.netlify.app` — le site est en ligne ✅

## Étape 3 — Connecter passeist.com (5 min)
**Dans Netlify :**
1. Site settings → **Domain management** → **Add a domain** → tape `passeist.com`
2. Netlify te propose de configurer le DNS ou de changer les nameservers. **Choisis "Set up Netlify DNS"** — NON, tu veux garder OVH pour ton email. **Choisis "use your own DNS"**.
3. Netlify t'affiche deux records à ajouter : un **A** pour `passeist.com` (IP type 75.2.60.5) et un **CNAME** pour `www.passeist.com` (valeur `apex-loadbalancer.netlify.com`). Note-les.

**Dans OVH :**
1. Connecte-toi sur [ovh.com](https://www.ovh.com), va dans ton espace client → Web Cloud → Noms de domaine → passeist.com
2. Onglet **Zone DNS** → **Ajouter une entrée**
3. Ajoute les 2 records que Netlify t'a donnés (A et CNAME). Laisse les autres records (MX email, etc.) **intacts**.
4. Propagation DNS : 30 min à 24 h selon la chance

## Étape 4 — SSL automatique
Une fois le DNS propagé, Netlify active tout seul un certificat Let's Encrypt en HTTPS. Tu n'as rien à faire. 10-30 min.

## Étape 5 — Vérifier
- `https://passeist.com` s'ouvre → le site apparaît
- Le chat Tawk.to (bulle en bas à droite) s'affiche enfin (ne marche pas en file://)
- Reçois un premier message test depuis ton propre tel pour valider l'appli Tawk mobile

## Étape 6 — Tawk.to dashboard
1. Connecte-toi sur [dashboard.tawk.to](https://dashboard.tawk.to)
2. **Administration → Chat Widget** : choisis la couleur primaire `#0a0a08` (noir d'encre pour matcher le site), nom d'agent "Passeist"
3. **Administration → Triggers → Welcome Message** : colle *"Bonjour, une question ? Dites-nous tout ici et nous vous répondrons le plus vite possible."*
4. Installe l'appli Tawk sur ton iPhone (App Store → "Tawk.to") et connecte-toi au même compte

## C'est fini
Temps total estimé : **15 min** entre Netlify + OVH, puis 30 min de propagation DNS. Le site est live à `https://passeist.com`.

---

## Pour tes prochaines mises à jour du site
- Rebuild en local (le fichier `improve.py` de ton dossier projet)
- Re-glisse le nouveau `index.html` dans Netlify → nouveau déploiement en 30 secondes. L'historique est conservé, tu peux revenir à une version précédente d'un clic.
