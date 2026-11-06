#!/usr/bin/env python3
"""Type de pièce lu dans la description écrite par Tom (règle Tom, nov. 2026 :
la catégorie du site se base sur SA description, pas sur la catégorie Vestiaire).

  type_from_desc(desc) → type FR (« Top », « Gilet », « Jupe-culotte »…) ou ''
  category_of(type)    → rayon du site (mêmes règles que getCategory() dans
                         index.html et categoryOf() dans netlify/lib/category.js)

Lecture :
 1. « Ravissant top… », « Très belle paire de bottes… », « Superbe et rare gilet… »
    (adjectif d'ouverture puis le vêtement), n'importe où au début du texte ;
 2. sinon, le premier vêtement nommé dans la première ligne qui décrit la
    pièce (lignes « Collection… », « Marque créée… », « Photos… » ignorées).
Les comparaisons (« type sweat », « façon chemise », « comme un jean »,
« en forme de débardeur ») ne comptent pas.
"""
import re

# (motif, type FR) — les plus précis d'abord
GARMENTS = [
    (r"sweats? à capuche|hoodie", 'Sweat à capuche'),
    (r"(?:pantacourt )?jupes?[- ]culottes?", 'Jupe-culotte'),
    (r"mini[- ]jupes?", 'Mini jupe'), (r"mini[- ]robes?", 'Mini robe'),
    (r"t-shirts?|tee-shirts?|tee shirts?", 'T-shirt'), (r"débardeurs?", 'Débardeur'),
    (r"chemisiers?", 'Chemisier'), (r"chemisettes?", 'Chemise'), (r"surchemises?", 'Surchemise'),
    (r"chemises?", 'Chemise'), (r"blouses?", 'Blouse'), (r"polos?", 'Polo'), (r"tops?", 'Top'),
    (r"cardigans?", 'Cardigan'), (r"gilets?", 'Gilet'), (r"pull-overs?|pulls?", 'Pull'), (r"sweats?|sweet", 'Sweat'),
    (r"blousons?|bombers?", 'Blouson'), (r"blazers?", 'Blazer'), (r"vestes?", 'Veste'),
    (r"manteaux|manteau", 'Manteau'), (r"parkas?", 'Parka'), (r"trench(?:-coat)?s?", 'Trench'),
    (r"cabans?", 'Caban'), (r"doudounes?", 'Doudoune'), (r"duffle-?coats?", 'Dufflecoat'),
    (r"costumes?", 'Costume'), (r"tailleurs?", 'Tailleur'),
    (r"combinaisons?|salopettes?", 'Combinaison'),
    (r"pantalons?|joggings?|pantacourts?", 'Pantalon'), (r"jeans?", 'Jean'), (r"shorts?", 'Short'),
    (r"bermudas?", 'Bermuda'), (r"sarouels?", 'Sarouel'), (r"leggings?", 'Legging'),
    (r"jupes?", 'Jupe'), (r"robes?", 'Robe'), (r"tuniques?", 'Tunique'),
    (r"baskets?|sneakers?", 'Baskets'), (r"bottines?", 'Bottines'), (r"bottes?|boots", 'Bottes'),
    (r"derbies|derby", 'Derbies'), (r"mocassins?", 'Mocassins'), (r"espadrilles?", 'Espadrilles'),
    (r"sandales?", 'Sandales'), (r"mules", 'Mules'), (r"ballerines?", 'Ballerines'), (r"tongs", 'Tongs'),
    (r"sacs? à dos", 'Sac à dos'), (r"sacs? banane|banane", 'Sac banane'), (r"cabas", 'Sac'),
    (r"sacoches?", 'Sacoche'), (r"pochettes?", 'Pochette'), (r"portefeuilles?|porte-cartes?", 'Portefeuille'),
    (r"cartables?", 'Cartable'), (r"sacs?", 'Sac'),
    (r"écharpes?|echarpes?", 'Écharpe'), (r"étoles?|etoles?", 'Étole'), (r"foulards?", 'Foulard'),
    (r"chèches?|cheches?", 'Chèche'), (r"furoshikis?|bandanas?", 'Foulard'),
    (r"chapeaux|chapeau|bobs?|panamas?", 'Chapeau'), (r"bonnets?", 'Bonnet'), (r"casquettes?", 'Casquette'),
    (r"bérets?|berets?", 'Béret'),
    (r"ceintures?", 'Ceinture'), (r"cravates?", 'Cravate'), (r"gants", 'Gants'), (r"moufles", 'Moufles'),
    (r"bracelets?", 'Bracelet'), (r"boucles d.oreilles", "Boucles d'oreilles"), (r"colliers?", 'Collier'),
    (r"bagues?", 'Bague'), (r"chaussettes?", 'Chaussettes'), (r"clips? d.oreilles?", "Boucles d'oreilles"),
    (r"porte[- ]clés?", 'Porte-clés'), (r"cagoules?", 'Bonnet'), (r"richelieus?", 'Derbies'),
    (r"vareuses?", 'Chemise'), (r"mailles?", 'Pull'),
]
_ALT = '|'.join(g for g, _ in GARMENTS)
_OPEN = (r"(?:superbe|ravissante?|très belle|très beau|très bel|très jolie?|jolie?|magnifique|incroyable|"
         r"adorable|sublime|exceptionnelle?|impressionnante?|très impressionnante?|belle|beau|bel|rare|"
         r"absolument magnifique|très rare|élégante?|splendide)")
_ADJ = (r"(?:(?:et|ou)\s+(?:très\s+)?\w+|long|longue|court|courte|petit|petite|grand|grande|maxi|fin|fine|"
        r"ample|oversized|ultra|large|légère?|épaisse?|vintage|authentique|véritable|paire\s+de|paire\s+d['’]|"
        r"\w+\s+paire\s+de)")
_RE_OPEN = re.compile(_OPEN + r"(?:\s+" + _ADJ + r")*\s+(" + _ALT + r")\b")
_RE_ANY = re.compile(r"\b(" + _ALT + r")\b")
# « type sweat », « façon chemise », « comme un jean », « en forme de débardeur »…
_COMPARE = re.compile(r"(?:type|façon|style|forme\s+d['’]?\w*|comme\s+une?|esprit|inspiration|"
                      r"inspirée?\s+d['’]?\w*|allure|genre|de\s+la\s+même|ligne|collection)\s*$")
# Lignes d'en-tête qui ne décrivent pas la pièce
_HEADER = re.compile(r"^(?:collection|marque|photos?|matière|composition|taille|dimensions|pays|nous\s|cette\s+(?:série|ligne)|ligne|"
                     r"fondée?|créée?|\w+\s+a\s+été\s+fondé|made\s+in|fabriqué|modèle\s*:|"
                     r"en\s+collaboration|pour\s+(?:homme|femme))", re.I)


def _type_of_word(w):
    for g, t in GARMENTS:
        if re.fullmatch(g, w):
            return t
    return ''


def _first_real(text, rx):
    for m in rx.finditer(text):
        if not _COMPARE.search(text[max(0, m.start(1) - 30):m.start(1)].strip()):
            return _type_of_word(m.group(1))
    return ''


def type_from_desc(desc):
    d = (desc or '').lower()
    if not d.strip():
        return ''
    # 1. « Ravissant top… » dans les 600 premiers caractères
    t = _first_real(d[:600], _RE_OPEN)
    if t:
        return t
    # 2. ligne qui commence par le vêtement (« Chemisette en coton… »,
    #    « Pantalon en laine… ») : les 4 premiers mots de chaque ligne
    for line in d.split('\n'):
        line = line.strip()
        if not line or line[0] in '-•*' or _HEADER.match(line):
            continue
        head = ' '.join(line.split()[:4])
        t = _first_real(head, _RE_ANY)
        if t:
            return t
    return ''


# Catégorie du site (même règles que getCategory() dans index.html et
# netlify/lib/category.js)
_CATS = [
    ('Écharpes', r"étole|etole|foulard|écharpe|echarpe|chèche|cheche|tour de cou"),
    ('Accessoires', r"porte-clé|breloque|ceinture|cravate|gants?\b|moufle|bracelet|boucles|bague|collier|broche|pendentif|bijou|chaussette"),
    ('Sacs', r"\bsacs?\b|banane|satchel|cabas|pochette|portefeuille|cartable|sacoche|maroquinerie"),
    ('Chapeaux', r"chapeau|bonnet|panama|casquette|\bcap\b|béret|beret"),
    ('Chaussures', r"botte|boots|basket|trainer|ballerine|escarpin|mocassin|derbies|derby|sandale|chaussure|sneaker|espadrille|\btongs?\b|\bmules?\b|lace.?ups?"),
    ('Costumes', r"costume|tailleur"),
    ('Combinaisons', r"combinaison|jumpsuit|salopette"),
    ('Robes', r"robe|tunique|tunic"),
    ('Jupes', r"jupe"),
    ('Pantalons', r"pantalon|\bjeans?\b|short|bermuda|legging|sarouel|harem"),
    ('Manteaux', r"manteau|parka|caban|duffle|trench|puffer|doudoune"),
    ('Vestes', r"veste|blouson|blazer"),
    ('Chemises', r"chemis|blouse"),
    ('Pulls & gilets', r"pull|gilet|cardigan|jumper|maille"),
    ('Sweats', r"sweat"),
    ('T-shirts & tops', r"t-shirt|\btee\b|débardeur|debardeur|polo|\bhaut\b|\btop\b|camisole"),
]


def category_of(t):
    t = (t or '').lower()
    for c, r in _CATS:
        if re.search(r, t):
            return c
    return 'Autres'


def site_type(vestiaire_type, desc):
    """Type à afficher : celui de la description s'il change de rayon, sinon
    celui de Vestiaire (souvent plus précis : « Jupe mi-longue en laine »)."""
    dt = type_from_desc(desc)
    # Costume = ensemble (veste + pantalon) : la description nomme souvent une
    # seule des deux pièces, on garde « Costume »
    if not dt or category_of(dt) == category_of(vestiaire_type) or category_of(vestiaire_type) == 'Costumes':
        return vestiaire_type
    mat = re.search(r' en (laine|lin|soie|cuir|cachemire|coton|toile)\b', (vestiaire_type or '').lower())
    return dt + (mat.group(0) if mat and category_of(dt) not in ('Chaussures', 'Sacs') else '')


if __name__ == '__main__':
    for d in ['Collection Y’s\n\nRavissant top en polyester 100%',
              'Collection robe de chambre probablement été 1992.\nSuperbe et rare pantacourt jupe culotte en nylon',
              'Très beau sac en forme de débardeur', 'Yohji Yamamoto\nTrès belle veste manteau en laine',
              'Comme des Garçons\nCollection homme 2005\nChemisette en coton à partie avant type t-shirt',
              'Issey Miyake\nCollection I.S.\nRavissant bob en coton', 'Junko Koshino\nTrès beau jogging en french terry']:
        print(repr(d[-40:]), '→', type_from_desc(d), '/', category_of(type_from_desc(d)))
