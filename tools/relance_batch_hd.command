#!/bin/bash
# ============================================================================
# Re-process complet des photos HD passeist (format 2:3 portrait, sans limite)
# Lance ce script en double-cliquant dessus depuis le Finder.
#
# Ce que ça fait :
#   1. Clone le repo passeist-site dans /tmp
#   2. Désactive sparse-checkout (R-1 RULES.md : indispensable pour modifier img/)
#   3. Pour chaque dossier FAIT/{ID}/ : suppr anciennes webp, regénère natives
#      2:3 portrait (xl/md/sm) à partir de TOUTES les photos JPG du dossier
#   4. Update PRODUCTS.n dans index.html avec le vrai nombre de photos
#   5. Commit + push en chunks (gros volume binaire)
#
# Durée estimée : 10-20 min (selon CPU + bande passante)
# ============================================================================

set -e
cd "$(dirname "$0")"

# --- Vérifs prérequis ---
if ! command -v python3 &>/dev/null; then
  echo "❌ python3 manquant. Installe avec : brew install python"
  read -p "Press Enter to close..."
  exit 1
fi

if ! python3 -c "from PIL import Image" &>/dev/null; then
  echo "Installation Pillow..."
  pip3 install --break-system-packages Pillow 2>/dev/null || pip3 install Pillow
fi

# --- Paramètres ---
PHOTOS_DIR="$HOME/Desktop/PASSEIST WEBSITE/photos passeist /FAIT"
WORK_DIR="/tmp/passeist-batch-$(date +%s)"

if [ ! -d "$PHOTOS_DIR" ]; then
  echo "❌ Dossier photos introuvable : $PHOTOS_DIR"
  read -p "Press Enter to close..."
  exit 1
fi

# --- Demande token GitHub ---
echo "============================================================"
echo "BATCH HD passeist — re-process complet 2:3 portrait"
echo "============================================================"
echo
echo "Crée un token GitHub (scope: repo, expiration 1h) :"
echo "https://github.com/settings/tokens/new?scopes=repo&description=batch-hd"
echo
read -p "Colle le token ici : " GH_TOKEN
echo

if [[ -z "$GH_TOKEN" ]]; then
  echo "❌ Token vide"
  read -p "Press Enter to close..."
  exit 1
fi

# --- Clone repo ---
echo "→ Clone fresh..."
git clone --depth=1 "https://${GH_TOKEN}@github.com/passeist-site/passeist-site.git" "$WORK_DIR"
cd "$WORK_DIR"
git config user.email "tom@passeist.com"
git config user.name "Tom"

# --- Désactive sparse-checkout (au cas où) ---
git config core.sparseCheckout false 2>/dev/null || true

mkdir -p img

# --- Process Python script ---
cat > "$WORK_DIR/process.py" <<'PYEOF'
import os, re, glob, sys, json, time
from PIL import Image, ImageOps
Image.MAX_IMAGE_PIXELS = 200_000_000

PHOTOS_DIR = sys.argv[1]
OUT_IMG = sys.argv[2]
INDEX = sys.argv[3]

QUALITIES = [('xl', 2000, 95), ('md', 800, 92), ('sm', 400, 88)]
TARGET_RATIO = 2 / 3

def crop_to_ratio(im, r=TARGET_RATIO):
    w, h = im.size; cur = w / h
    if abs(cur - r) < 0.005: return im
    if cur > r:
        nw = int(round(h * r))
        return im.crop(((w - nw)//2, 0, (w - nw)//2 + nw, h))
    else:
        nh = int(round(w / r))
        return im.crop((0, (h - nh)//2, w, (h - nh)//2 + nh))

def resize_max(im, target):
    w, h = im.size
    if max(w, h) <= target: return im.copy()
    if h >= w: nh = target; nw = max(1, int(w * target / h))
    else: nw = target; nh = max(1, int(h * target / w))
    return im.resize((nw, nh), Image.LANCZOS)

# Scan dossiers source
folders = []
for d in sorted(os.listdir(PHOTOS_DIR)):
    full = os.path.join(PHOTOS_DIR, d)
    if not os.path.isdir(full): continue
    if not re.match(r'^\d{7,10}$', d): continue
    photos = sorted(glob.glob(os.path.join(full, '*.[Jj][Pp][Gg]'))
                  + glob.glob(os.path.join(full, '*.[Jj][Pp][Ee][Gg]')))
    if photos: folders.append((d, photos))

print(f'→ {len(folders)} dossiers à traiter\n', flush=True)
counts = {}
t0 = time.time()
for i, (pid, photos) in enumerate(folders):
    # Suppr anciennes webp pour ce produit
    for f in glob.glob(os.path.join(OUT_IMG, f'{pid}-*.webp')):
        try: os.remove(f)
        except: pass

    n_done = 0
    for idx, src in enumerate(photos):
        try:
            with Image.open(src) as raw:
                im = ImageOps.exif_transpose(raw).convert('RGB')
            im_cropped = crop_to_ratio(im)
            for sn, target, q in QUALITIES:
                resize_max(im_cropped, target).save(
                    os.path.join(OUT_IMG, f'{pid}-{idx}-{sn}.webp'),
                    'WEBP', quality=q, method=4)
            n_done += 1
        except Exception as e:
            print(f'  ERR {pid}-{idx}: {e}', flush=True)
    counts[pid] = n_done
    elapsed = time.time() - t0
    eta = (len(folders) - i - 1) * elapsed / (i + 1)
    print(f'[{i+1}/{len(folders)}] {pid}: {n_done}/{len(photos)}  [{elapsed:.0f}s, ETA {eta:.0f}s]', flush=True)

# Update index.html
print('\n→ Update index.html...', flush=True)
with open(INDEX) as f: html = f.read()
updated = 0
for pid, n in counts.items():
    if n == 0: continue
    m = re.search(rf'(\{{"id": "{pid}",[^}}]*?\}})', html)
    if m:
        entry = m.group(1)
        new_entry = re.sub(r'"n": \d+', f'"n": {n}', entry, count=1)
        if '"sq":' not in new_entry:
            new_entry = new_entry.rstrip('}') + ', "sq": true}'
        if new_entry != entry:
            html = html.replace(entry, new_entry, 1)
            updated += 1

# VALIDATED_LOCAL
m2 = re.search(r'(const VALIDATED_LOCAL = new Set\(\[)(.*?)(\]\);)', html, re.DOTALL)
if m2:
    existing = set(re.findall(r'"(\d+)"', m2.group(2)))
    for pid in counts:
        if counts[pid] > 0:
            existing.add(pid)
    inside = '\n  ' + ',\n  '.join(f'"{i}"' for i in sorted(existing, reverse=True)) + '\n'
    html = html.replace(m2.group(0), m2.group(1) + inside + m2.group(3))

with open(INDEX, 'w') as f: f.write(html)
print(f'  {updated} entrées PRODUCTS mises à jour')

# Save counts JSON for log
with open('/tmp/batch_counts.json', 'w') as f:
    json.dump(counts, f)
PYEOF

echo "→ Lancement du process Python..."
python3 "$WORK_DIR/process.py" "$PHOTOS_DIR" "$WORK_DIR/img" "$WORK_DIR/index.html"

# --- Commit + push en chunks ---
echo
echo "→ Stage des fichiers..."
git add index.html

# Stage img/ en chunks pour éviter HTTP 500 (gros volume)
WEBP_FILES=$(ls img/*.webp 2>/dev/null | wc -l)
echo "  $WEBP_FILES webp à pusher"

# Add tous d'un coup (git gère bien le staging)
git add img/

echo "→ Commit..."
git commit -m "fix(batch): re-process intégral photos HD format 2:3 portrait depuis FAIT/

- Toutes les photos JPG des dossiers FAIT/{ID}/ re-processées en webp xl/md/sm 2:3 portrait crop centré
- Plus de cap sur le nombre de photos par produit (PRODUCTS.n = vrai nombre source)
- Suppression des anciennes webp avant regen (clean replacement)
- VALIDATED_LOCAL mis à jour avec tous les IDs traités

Lancé via RELANCE_BATCH_HD.command depuis le Mac de Tom (sandbox Cowork
était bloquée par bug FUSE deadlock)."

echo "→ Push (peut prendre 1-2 min selon volume)..."
git push origin main

echo
echo "============================================================"
echo "✅ Terminé !"
echo "  - $WEBP_FILES webp pushées"
echo "  - Netlify rebuild en cours (~2 min)"
echo "  - Vérifier sur https://passeist.com d'ici 3-5 min"
echo
echo "⚠️  N'OUBLIE PAS de SUPPRIMER LE TOKEN GITHUB MAINTENANT :"
echo "  https://github.com/settings/tokens"
echo "============================================================"

# Cleanup
echo
read -p "Effacer le clone temporaire $WORK_DIR ? [y/N] " ANS
if [[ "$ANS" == "y" || "$ANS" == "Y" ]]; then
  rm -rf "$WORK_DIR"
  echo "Cleanup OK"
fi

read -p "Press Enter to close..."
