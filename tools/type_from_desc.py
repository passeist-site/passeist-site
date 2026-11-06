import re
GARMENTS = [  # (motif dans la description, type FR)
 (r"sweat à capuche|hoodie", 'Sweat à capuche'), (r"jupe[- ]culotte", 'Jupe-culotte'),
 (r"t-shirt|tee-shirt|tee shirt", 'T-shirt'), (r"débardeur", 'Débardeur'), (r"chemisier", 'Chemisier'),
 (r"surchemise", 'Surchemise'), (r"chemise", 'Chemise'), (r"blouse", 'Blouse'), (r"polo", 'Polo'), (r"top", 'Top'),
 (r"cardigan", 'Cardigan'), (r"gilet", 'Gilet'), (r"pull", 'Pull'), (r"sweat", 'Sweat'),
 (r"blouson", 'Blouson'), (r"blazer", 'Blazer'), (r"veste", 'Veste'), (r"manteau", 'Manteau'), (r"parka", 'Parka'),
 (r"trench", 'Trench'), (r"caban", 'Caban'), (r"doudoune", 'Doudoune'),
 (r"pantalon", 'Pantalon'), (r"jean", 'Jean'), (r"short", 'Short'), (r"bermuda", 'Bermuda'), (r"sarouel", 'Sarouel'),
 (r"jupe", 'Jupe'), (r"robe", 'Robe'), (r"tunique", 'Tunique'), (r"combinaison", 'Combinaison'),
]
OPEN = r"(?:superbe|ravissante?|très bel(?:le)?|très beau|très joli(?:e)?|jolie?|magnifique|incroyable|adorable|sublime|bel(?:le)?|beau|rare)"
def type_from_desc(desc):
    """Type de pièce tel que Tom l'écrit en tête de description (« Ravissant top en… »).
    Renvoie le type FR ou ''."""
    d = (desc or '').lower()[:400]
    m = re.search(OPEN + r"(?:\s+et\s+\w+)?\s+(?:(?:long|longue|court|courte|petit|petite|grand|grande|maxi|mini|fin|fine|ample|oversized|ultra)\s+)*(" + '|'.join(g for g, _ in GARMENTS) + r")\b", d)
    if not m: return ''
    w = m.group(1)
    for g, t in GARMENTS:
        if re.fullmatch(g, w): return t
    return ''


# Catégorie du site (même règles que getCategory() dans index.html et
# netlify/lib/category.js) : sert à ne changer le type que s'il change de rayon.
_CATS = [
 ('Écharpes', r"étole|etole|foulard|écharpe|echarpe|chèche|cheche|tour de cou"),
 ('Accessoires', r"breloque|ceinture|cravate|gants?\b|moufle|bracelet|boucles|bague|collier|broche|pendentif|bijou|chaussette"),
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
        if re.search(r, t): return c
    return 'Autres'


if __name__ == '__main__':
    for d in ['Collection Y’s\n\nRavissant top en polyester 100%', 'Superbe et rare pantacourt jupe culotte en nylon',
              'Très beau sac en forme de débardeur', 'Yohji Yamamoto\nTrès belle veste manteau en laine']:
        print(repr(d[:40]), type_from_desc(d), category_of(type_from_desc(d)))
