#!/usr/bin/env python3
"""Re-traite TOUS les dossiers HD dans FAIT avec trim_white_border + crop 2:3.
Bypass le check A IMPORTER. Sparse-checkout désactivé requis avant."""
import sys, os, re, glob, json
from PIL import Image, ImageOps

# Force PHOTOS_DIR sur FAIT
os.environ['_FORCE_PHOTOS_DIR'] = '/sessions/sharp-vibrant-turing/mnt/PASSEIST WEBSITE/photos passeist /FAIT'

# Import directly (bypass the path detection)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import import_hd
import_hd.PHOTOS_DIR = os.environ['_FORCE_PHOTOS_DIR']

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, 'index.html')
OUT_IMG = os.path.join(ROOT, 'img')
import_hd.OUT_IMG = OUT_IMG
import_hd.INDEX = INDEX

PHOTOS_DIR = import_hd.PHOTOS_DIR

# Liste tous les sous-dossiers de FAIT avec des photos
ids = []
for d in sorted(os.listdir(PHOTOS_DIR)):
    full = os.path.join(PHOTOS_DIR, d)
    if not os.path.isdir(full): continue
    if not re.match(r'^\d{7,10}$', d): continue
    photos = (glob.glob(os.path.join(full, '*.[Jj][Pp][Gg]'))
              + glob.glob(os.path.join(full, '*.[Jj][Pp][Ee][Gg]')))
    if photos: ids.append(d)

print(f'Re-traitement de {len(ids)} dossiers HD avec trim_white_border + crop 2:3')
print('---')

updates = {}
errors = []
for i, item_id in enumerate(ids):
    print(f'[{i+1}/{len(ids)}] {item_id}', flush=True)
    try:
        n = import_hd.process_one(item_id)
        if n > 0: updates[item_id] = n
    except Exception as e:
        print(f'  ERR: {e}')
        errors.append((item_id, str(e)))

print('\n=== Update index.html ===')
import_hd.update_index(updates)

print(f'\n✓ {len(updates)} produits re-traités')
if errors:
    print(f'⚠ {len(errors)} erreurs:')
    for eid, msg in errors[:10]: print(f'  {eid}: {msg[:80]}')
