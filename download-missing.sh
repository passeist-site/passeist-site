#!/bin/bash
# Script à lancer sur ton Mac depuis le dossier local du repo passeist-site.
# Télécharge les photos manquantes directement depuis Vestiaire + resize + commit.
# Usage:
#   cd chemin/vers/ton/clone-local-du-repo
#   bash download-missing.sh
#
# Pré-requis: ImageMagick (pour resize). Install: brew install imagemagick webp

set -e

UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15'
mkdir -p img tmp_download

# Lit la liste depuis urls.txt (format id:i:url)
if [ ! -f urls.txt ]; then
  echo "ERROR: urls.txt absent. Il contient la liste des URLs à télécharger."
  echo "Tu dois avoir ce fichier dans le dossier (fourni par Claude)."
  exit 1
fi

total=$(wc -l < urls.txt | tr -d ' ')
echo "Téléchargement de jusqu'à $total photos…"

ok=0; fail=0; skip=0
while IFS=: read -r id i url; do
  out_xl="img/${id}-${i}-xl.webp"
  out_md="img/${id}-${i}-md.webp"
  out_sm="img/${id}-${i}-sm.webp"
  # Si déjà présent, skip
  if [ -f "$out_md" ]; then skip=$((skip+1)); continue; fi

  tmp="tmp_download/${id}-${i}.jpg"
  http=$(curl -sS -A "$UA" -o "$tmp" -w '%{http_code}' --max-time 15 "$url" 2>/dev/null || echo "000")
  if [ "$http" != "200" ] || [ ! -s "$tmp" ]; then
    rm -f "$tmp"
    fail=$((fail+1))
    continue
  fi

  # Resize via ImageMagick → 3 tailles WebP q85
  magick "$tmp" -auto-orient -resize "1600x1600>" -quality 85 "$out_xl" 2>/dev/null
  magick "$out_xl" -resize "800x800>" -quality 85 "$out_md" 2>/dev/null
  magick "$out_xl" -resize "400x400>" -quality 80 "$out_sm" 2>/dev/null
  rm -f "$tmp"
  ok=$((ok+1))

  # Progress toutes les 100
  if (( (ok+fail+skip) % 100 == 0 )); then
    echo "  progress: ok=$ok fail=$fail skip=$skip / $total"
  fi
done < urls.txt

rm -rf tmp_download
echo ""
echo "=== Résumé ==="
echo "Téléchargées:  $ok"
echo "Déjà là:       $skip"
echo "Échecs (404):  $fail (photos qui n'existent plus sur Vestiaire, normal)"

# Auto-commit + push
echo ""
echo "Commit et push vers GitHub…"
git add img/
git commit -m "photos: ajout $ok nouvelles images produits" || echo "(rien à committer)"
git push

echo ""
echo "✓ Fini. Netlify redéploie dans 1-2 min."
