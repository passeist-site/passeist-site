#!/usr/bin/env python3
"""Import photos HD pour un produit. Lit le dossier `photos passeist/{ID}/`,
process en xl/md/sm webp (natif + carré pad blanc), update PRODUCTS et VALIDATED_LOCAL.

Usage : python3 tools/import_hd.py <ID> [<ID>...]
   ou  python3 tools/import_hd.py --all  (process tous les sous-dossiers)

Respecte l'ordre Finder via .DS_Store (Iloc), sinon tri alphanum.

Codes retour :
  0  OK
  1  erreur (dossier manquant, photos illisibles, etc.)
"""
import sys, os, re, json, glob
from PIL import Image, ImageOps, ImageFilter
Image.MAX_IMAGE_PIXELS = 200_000_000

# Permet d'utiliser ce script depuis le repo cloné OU depuis Cowork
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "index.html")
OUT_IMG = os.path.join(ROOT, "img")

# Cherche le dossier source dans plusieurs paths possibles (sandbox vs CI)
PHOTOS_DIRS_CANDIDATES = [
    "/sessions/sharp-vibrant-turing/mnt/PASSEIST WEBSITE/photos passeist ",
    os.path.expanduser("~/Desktop/PASSEIST WEBSITE/photos passeist "),
    os.path.expanduser("~/Desktop/PASSEIST WEBSITE/photos passeist"),
]
PHOTOS_DIR = None
for p in PHOTOS_DIRS_CANDIDATES:
    if os.path.isdir(p):
        PHOTOS_DIR = p
        break

QUALITIES = [('xl', 2000, 99), ('md', 800, 96), ('sm', 400, 92)]
# Ratio FIXE pour toutes les photos HD : 2:3 portrait (w/h ≈ 0.667 = Leica M natif)
# Garantit l'uniformité de la galerie fiche produit (zéro décalage).
TARGET_RATIO = 2 / 3
# Pas de sharpen — Tom préfère le rendu naturel Lanczos sans accentuation
# (test 26/04 : sharpen donnait un look "crispy" pas naturel sur Leica HD)

def crop_to_ratio(im, target_ratio=TARGET_RATIO):
    """Crop centré pour atteindre exactement target_ratio (w/h).
    Si la photo est plus large → crop gauche/droite. Plus haute → crop top/bottom."""
    w, h = im.size
    current = w / h
    if abs(current - target_ratio) < 0.005: return im  # déjà bon
    if current > target_ratio:
        # Trop large : crop largeur
        new_w = int(round(h * target_ratio))
        left = (w - new_w) // 2
        return im.crop((left, 0, left + new_w, h))
    else:
        # Trop haut : crop hauteur
        new_h = int(round(w / target_ratio))
        top = (h - new_h) // 2
        return im.crop((0, top, w, top + new_h))

def pad_square(im, target):
    w, h = im.size
    if h >= w: nh = target; nw = max(1, int(w * target / h))
    else: nw = target; nh = max(1, int(h * target / w))
    scaled = im.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new('RGB', (target, target), (255, 255, 255))
    canvas.paste(scaled, ((target - nw) // 2, (target - nh) // 2))
    return canvas

def resize_max(im, target):
    w, h = im.size
    if max(w, h) <= target: return im.copy()
    if h >= w: nh = target; nw = max(1, int(w * target / h))
    else: nw = target; nh = max(1, int(h * target / w))
    return im.resize((nw, nh), Image.LANCZOS)

def get_finder_order(d):
    ds = os.path.join(d, '.DS_Store')
    if not os.path.exists(ds): return None
    try:
        from ds_store import DSStore
        with DSStore.open(ds, 'r+') as ds_:
            entries = []
            for entry in ds_:
                if entry.code == b'Iloc':
                    x, y = entry.value
                    entries.append((y // 50, x, entry.filename))
            if entries:
                entries.sort()
                return [n for _, _, n in entries]
    except Exception as e: print(f'  DS_Store err: {e}', flush=True)
    return None

def process_one(item_id):
    src_dir = os.path.join(PHOTOS_DIR, item_id)
    if not os.path.isdir(src_dir):
        print(f'❌ {item_id}: dossier introuvable {src_dir}')
        return 0
    finder_order = get_finder_order(src_dir)
    all_jpgs = glob.glob(os.path.join(src_dir, '*.[Jj][Pp][Gg]'))
    if finder_order:
        by_name = {os.path.basename(p): p for p in all_jpgs}
        photos = [by_name[n] for n in finder_order if n in by_name]
        extras = sorted([p for p in all_jpgs if os.path.basename(p) not in finder_order])
        photos.extend(extras)
    else:
        photos = sorted(all_jpgs)
    if not photos:
        print(f'⚠ {item_id}: aucune photo')
        return 0
    print(f'\n=== {item_id} : {len(photos)} photos ===')
    for i, p in enumerate(photos): print(f'  [{i}] {os.path.basename(p)}')
    # Suppr anciennes
    old = glob.glob(os.path.join(OUT_IMG, f'{item_id}-*.webp'))
    for f in old: os.remove(f)
    if old: print(f'  Suppr {len(old)} anciennes webp')
    good = 0
    for idx, src in enumerate(photos):
        try:
            im = ImageOps.exif_transpose(Image.open(src)).convert('RGB')
            # Force ratio 3:4 portrait via crop centré (uniformité galerie)
            im_cropped = crop_to_ratio(im, TARGET_RATIO)
            if im_cropped.size != im.size:
                print(f'  [{idx}] crop {im.size} → {im_cropped.size} (ratio 3:4)')
            for sn, target, q in QUALITIES:
                # Native 2:3 (resize Lanczos sans post-traitement)
                resize_max(im_cropped, target).save(
                    os.path.join(OUT_IMG, f'{item_id}-{idx}-{sn}.webp'),
                    'WEBP', quality=q, method=6)
                # Square pad blanc
                pad_square(im_cropped, target).save(
                    os.path.join(OUT_IMG, f'{item_id}-{idx}-sq-{sn}.webp'),
                    'WEBP', quality=q, method=6)
            im.close(); im_cropped.close()
            good += 1
        except Exception as e:
            print(f'  ERR [{idx}]: {e}')
    print(f'  → {good}/{len(photos)} OK ({good*6} webp)')
    return good

def update_index(updates):
    """updates = {item_id: n_photos}"""
    with open(INDEX) as f: html = f.read()
    for item_id, n in updates.items():
        if n == 0: continue
        # Update n + sq
        m = re.search(rf'(\{{"id": "{item_id}"[^}}]*?\}})', html)
        if m:
            try:
                entry = json.loads(m.group(1))
                entry['n'] = n
                entry['sq'] = True
                new = json.dumps(entry, ensure_ascii=False)
                html = html.replace(m.group(1), new, 1)
                print(f'  {item_id}: PRODUCTS n={n}, sq=True')
            except Exception as e:
                print(f'  ⚠ {item_id}: parse err {e}')
        # VALIDATED_LOCAL
        m2 = re.search(r'(const VALIDATED_LOCAL = new Set\(\[)(.*?)(\]\);)', html, re.DOTALL)
        if m2 and f'"{item_id}"' not in m2.group(2):
            ids = re.findall(r'"(\d+)"', m2.group(2))
            ids.insert(0, item_id)
            inside = '\n  ' + ',\n  '.join(f'"{i}"' for i in ids) + '\n'
            html = html.replace(m2.group(0), m2.group(1) + inside + m2.group(3))
            print(f'  {item_id}: VALIDATED_LOCAL')
    with open(INDEX, 'w') as f: f.write(html)

def main():
    if PHOTOS_DIR is None:
        print('❌ Dossier "photos passeist" introuvable dans tous les paths')
        sys.exit(1)
    print(f'Source : {PHOTOS_DIR}')
    args = sys.argv[1:]
    if not args:
        print('Usage : python3 tools/import_hd.py <ID> [<ID>...] | --all')
        sys.exit(1)
    if args == ['--all']:
        # Tous les sous-dossiers ID
        ids = [os.path.basename(d.rstrip('/')) for d in glob.glob(os.path.join(PHOTOS_DIR, '*/'))
               if re.match(r'^\d{7,10}$', os.path.basename(d.rstrip('/')))]
        print(f'Mode --all : {len(ids)} dossiers détectés')
    else:
        ids = args
    updates = {}
    for item_id in ids:
        n = process_one(item_id)
        if n > 0: updates[item_id] = n
    print('\n=== Update index.html ===')
    update_index(updates)
    print(f'\n✓ {len(updates)} produits importés en HD')

if __name__ == '__main__': main()
