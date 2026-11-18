"""Association pièce du site ↔ annonce Vinted (Tom, 2026-11-16). Utilisé par export_products.py.

D'abord la description : si celle du site et celle de Vinted sont quasi identiques (80 % des mots,
mesures comprises), c'est la bonne annonce. Sinon, prudent : même marque, même famille de vêtement (le mot doit figurer dans le titre Vinted),
prix proche, puis départage par la saison / l'année, la couleur, la matière et les mots de la
description. En cas de doute (deux annonces à égalité, ou signal trop faible), pas de lien."""
import re, unicodedata

def norm(t):
    t = unicodedata.normalize('NFKD', str(t or '')).encode('ascii', 'ignore').decode().lower()
    t = re.sub(r't[\s-]?shirt|tee[\s-]?shirt', 'tshirt', t)
    return re.sub(r'[^a-z0-9]+', ' ', t).strip()

FAMILIES = {
    'chemise': 'chemise chemisier blouse surchemise',
    'tshirt': 'tshirt tee',
    'sweat': 'sweat sweatshirt hoodie capuche',
    'pull': 'pull pullover maille tricot jumper',
    'cardigan': 'cardigan gilet',
    'veste': 'veste blouson blazer parka caban manteau duffle doudoune coat jacket kimono trench imperméable impermeable costume',
    'pantalon': 'pantalon jean jeans chino jogging salopette',
    'jupe': 'jupe',
    'robe': 'robe',
    'short': 'short bermuda',
    'top': 'top debardeur tunique polo',
    'chapeau': 'casquette chapeau bob bonnet panama beret',
    'echarpe': 'echarpe foulard cheche etole snood',
    'sac': 'sac cartable banane besace pochette portefeuille porte bagage valise',
    'chaussure': 'derbies bottes boots ballerines chaussures mocassins baskets sandales rangers bottines sneakers escarpins',
    'chaussettes': 'chaussettes',
}
WORD2FAM = {}
for f, ws in FAMILIES.items():
    for w in ws.split(): WORD2FAM.setdefault(norm(w), f)
# Cardigan et gilet sont souvent mélangés avec pull / veste dans les titres
CLOSE = {'cardigan': {'pull', 'veste'}, 'pull': {'cardigan'}, 'top': {'tshirt', 'chemise'}, 'tshirt': {'top'}}

def families(text):
    return {WORD2FAM[w] for w in norm(text).split() if w in WORD2FAM}

STOP = set('de du des la le les en et a au aux pour avec sur sans homme femme men women taille unique t vintage japon japan japonais tres bon etat neuf one size fit'.split())
def words(t): return {w for w in norm(t).split() if len(w) > 2 and w not in STOP and not w.isdigit()}

def years(t):
    n = norm(t); out = set(re.findall(r'\b(19[5-9]\d|20[0-3]\d)\b', n))
    for d in re.findall(r'annees (\d0)\b', n): out.add('19' + d if d != '00' else '2000')
    return out

def tokens(t):
    """Mots et nombres d'une description (les mesures « 54cm » comptent beaucoup)."""
    return {w for w in norm(t).split() if (len(w) > 2 or w.isdigit()) and w not in STOP}

def dsim(a, b):
    """Part des mots de la description la plus courte présents dans l'autre (0 à 1)."""
    ta, tb = tokens(a), tokens(b)
    if len(ta) < 8 or len(tb) < 8: return None
    return len(ta & tb) / min(len(ta), len(tb))

def nums(t):
    """Nombres d'une description (mesures surtout) : ce qui distingue deux pièces de même marque."""
    return set(re.findall(r'\d+(?:[.,]\d+)?', str(t or '')))

def brand_in(brand, v):
    """Marque du site citée dans le titre ou la description Vinted (marque Vinted différente,
    ex. « Vintage Dressing »)."""
    w = [x for x in norm(brand).split() if len(x) > 2]
    txt = norm(str(v.get('title', '')) + ' ' + str(v.get('desc', '')))
    return bool(w) and any(x in txt for x in w)

def brand_ok(a, b):
    a, b = norm(a), norm(b)
    if not a or not b: return False
    return a == b or a in b or b in a or a.split()[0] == b.split()[0]

def saison(t):
    n = norm(t); h = bool(re.search(r'\b(hiver|automne|winter|fall|aw)\b', n)); e = bool(re.search(r'\b(ete|printemps|summer|spring|ss)\b', n))
    return 'h' if h and not e else ('e' if e and not h else '')

def site_years(e):
    y = set()
    if e.get('year'): y.add(str(e['year']))
    y |= years(e.get('season', ''))
    return y

def match(lookup, byid, vinted, skip_ids=(), used_vinted=()):
    """Rapprochement par la DESCRIPTION seulement (Tom, 2026-11-18) : c'est le seul point commun
    fiable entre Vinted, Vestiaire et le site. Marque, prix et titre ne comptent pas.
    Texte quasi identique, et mesures concordantes pour départager deux annonces qui partagent
    le même texte d'introduction. En cas de doute (deux annonces trop proches), pas de lien.
    Renvoie ({id: url}, {ids reliés}) ; tous les liens sont « confirmés par la description »."""
    vs = [(str(v.get('id')), v, v.get('desc') or '') for v in vinted if (v.get('desc') or '')]
    used = {str(x) for x in used_vinted}
    best_of = {}
    for pid in lookup:
        if pid in skip_ids: continue
        d = (byid.get(pid) or {}).get('desc') or ''
        if not d: continue
        pn = nums(d)
        cands = []
        for vid, v, vd in vs:
            ds = dsim(d, vd)
            if ds is None or ds < 0.8: continue
            nr = len(pn & nums(vd)) / len(pn) if len(pn) >= 3 else 1.0
            if not ((ds >= 0.9 and nr >= 0.7) or (ds >= 0.8 and nr >= 0.9)): continue
            cands.append((round(ds * 100 + nr * 30, 2), vid, v))
        if cands:
            cands.sort(key=lambda c: -c[0])
            best_of[pid] = cands
    out = {}
    # Les rapprochements les plus nets d'abord ; une annonce ne sert qu'une fois
    for pid in sorted(best_of, key=lambda k: -best_of[k][0][0]):
        c = [x for x in best_of[pid] if x[1] not in used]
        if not c: continue
        if len(c) > 1 and c[1][0] >= c[0][0] - 3: continue   # doute
        out[pid] = f"https://www.vinted.fr/items/{c[0][1]}"
        used.add(c[0][1])
    return out, set(out)
