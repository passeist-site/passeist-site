#!/usr/bin/env python3
"""Détection de marque depuis description Vestiaire.
Règle TASKS.md : si brand Vestiaire = 'Non Signé / Unsigned', chercher la vraie
marque dans la description et l'utiliser à la place."""

# Marques connues du catalogue passeist (canonique → patterns lowercase)
KNOWN_BRANDS = [
    # Japonaises majeures
    ('YOHJI YAMAMOTO',      ['yohji yamamoto', "y's", 'ys ', 'yohji', 'pour homme', 'y-3']),
    ('COMME DES GARÇONS',   ['comme des garcons', 'comme des garçons', 'cdg', 'tao', 'tricot comme']),
    ('JUNYA WATANABE',      ['junya watanabe', 'junya']),
    ('ISSEY MIYAKE',        ['issey miyake', 'pleats please', 'homme plisse', 'homme plissé', 'me issey', 'a-poc', 'haat', 'bao bao']),
    ('KENZO',               ['kenzo']),
    ('MATSUDA',             ['matsuda']),
    ('KANSAI YAMAMOTO',     ['kansai yamamoto']),
    ('HIROKO KOSHINO',      ['hiroko koshino']),
    ('TAKEO KIKUCHI',       ['takeo kikuchi']),
    ('KIJIMA TAKAYUKI',     ['kijima takayuki', 'kijima']),
    ('SACAI',               ['sacai']),
    ('VISVIM',              ['visvim']),
    ('UNDERCOVER',          ['undercover', 'undercoverism']),
    ('NUMBER (N)INE',       ['number nine', 'number (n)ine', 'numbernine']),
    ('MIHARA YASUHIRO',     ['mihara yasuhiro', 'maison mihara']),
    ('NEIGHBORHOOD',        ['neighborhood']),
    ('WHITE MOUNTAINEERING',['white mountaineering']),
    ('NE-NET',              ['ne-net', 'ne net']),
    ('45RPM',               ['45rpm', '45 rpm']),
    # Belges / autres
    ('MAISON MARGIELA',     ['maison margiela', 'martin margiela']),
    ('HELMUT LANG',         ['helmut lang']),
    ('RAF SIMONS',          ['raf simons']),
    ('RICK OWENS',          ['rick owens']),
    ('ANN DEMEULEMEESTER',  ['demeulemeester']),
    ('DRIES VAN NOTEN',     ['dries van noten']),
]

UNSIGNED_BRANDS = {'non signé / unsigned', 'non signe / unsigned', 'unsigned',
                   'non signé', 'non signe'}


def is_unsigned(brand_name):
    """True si le brand Vestiaire est 'Non Signé / Unsigned' ou variante."""
    return (brand_name or '').strip().lower() in UNSIGNED_BRANDS


def detect_brand_in_desc(desc):
    """Cherche une marque connue dans la description.
    Retourne (canonical, pattern_matched, context) ou (None, None, None)."""
    if not desc:
        return None, None, None
    desc_lc = desc.lower()
    for canonical, patterns in KNOWN_BRANDS:
        for pat in patterns:
            if pat in desc_lc:
                idx = desc_lc.find(pat)
                ctx_start = max(0, idx - 30)
                ctx_end = min(len(desc), idx + len(pat) + 30)
                context = desc[ctx_start:ctx_end]
                return canonical, pat, context
    return None, None, None


def clean_desc_after_brand_extraction(desc, detected_brand):
    """Si la première ligne de la desc est juste le nom du brand détecté
    (cas typique : 'Kijima Takayuki\\n\\nMade in Japan...'), on la retire
    pour éviter la redondance puisque le brand devient un champ structuré."""
    if not desc or not detected_brand: return desc
    lines = desc.split('\n')
    if not lines: return desc
    first = lines[0].strip().lower()
    brand_lc = detected_brand.lower()
    # Match exact ou très proche (ex. 'Kijima' tout court)
    if first == brand_lc or first in brand_lc or brand_lc.startswith(first):
        lines = lines[1:]
        while lines and not lines[0].strip(): lines = lines[1:]
        return '\n'.join(lines).strip()
    return desc


def slug_with_detected_brand(original_slug, detected_brand_slug):
    """Remplace 'non-signe-unsigned' par le slug de la marque détectée
    dans le slug Vestiaire."""
    return original_slug.replace('non-signe-unsigned', detected_brand_slug)


def path_with_detected_brand(original_path, detected_brand_slug):
    """Remplace 'non-signe-unsigned' par le slug de la marque dans le path."""
    return original_path.replace('non-signe-unsigned', detected_brand_slug)


if __name__ == '__main__':
    # Tests
    test_desc = """Kijima Takayuki

Made in Japan

Ravissante bob noir, 100% soie monté sur une base en nylon 100% et doublure intérieure en cupro."""
    brand, pat, ctx = detect_brand_in_desc(test_desc)
    print(f'TEST 1: brand={brand} pattern={pat!r}')
    print(f'  cleaned desc: {clean_desc_after_brand_extraction(test_desc, brand)[:80]}')

    test2 = "Made in Japan, vintage piece sans signature"
    print(f'TEST 2 (no brand): {detect_brand_in_desc(test2)}')

    print(f'TEST is_unsigned: {is_unsigned("Non Signé / Unsigned")}')
    print(f'TEST is_unsigned: {is_unsigned("YOHJI YAMAMOTO")}')
