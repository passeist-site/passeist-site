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

def match(lookup, byid, vinted):
    """lookup: {id: entrée products.json}; byid: {id: pièce index.html}; renvoie {id: url}."""
    out, cands_of = {}, {}
    for pid, e in lookup.items():
        p = byid.get(pid, {})
        try: price = float(e.get('price') or 0)
        except ValueError: continue
        fam = families(e.get('type', '')) or families(e.get('label', ''))
        if not price or not fam: continue
        mine = words(' '.join([e.get('label', ''), e.get('type', ''), p.get('desc', ''), p.get('color', '')]))
        sy = site_years(e)
        cands = []
        for v in vinted:
            if not brand_ok(e.get('brand'), v.get('brand')): continue
            # Descriptions quasi identiques (Tom) : c'est la bonne annonce, quel que soit le titre
            ds = dsim(p.get('desc', ''), v.get('desc', '')) if p.get('desc') and v.get('desc') else None
            if ds is not None and ds >= 0.8:
                cands.append((100 + round(ds * 20), str(v.get('id')), v)); continue
            if ds is not None and ds < 0.4: continue   # descriptions différentes : autre pièce
            try: vp = float(str(v.get('price') or 0).replace(',', '.'))
            except ValueError: continue
            if not vp or abs(vp - price) > max(0.2 * price, 10): continue
            vf = families(v.get('title', ''))
            okfam = fam & vf or any(CLOSE.get(f, set()) & vf for f in fam)
            if not okfam: continue
            vy = years(v.get('title', ''))
            if sy and vy and not (sy & vy): continue   # années contradictoires
            ss, vs = saison(e.get('season', '')), saison(v.get('title', ''))
            if ss and vs and ss != vs: continue        # été / hiver contradictoires
            sc = len(mine & words(v.get('title', '')))
            sc += 3 if (sy and sy & vy) else 0
            sc += 2 if fam & vf else 0
            sc += 2 if abs(vp - price - 5) < 1 or abs(vp - price) < 1 else (1 if abs(vp - price) <= 0.06 * price else 0)  # Vinted = prix du site + 5 € le plus souvent
            cands.append((sc, str(v.get('id')), v))
        cands.sort(key=lambda c: -c[0])
        cands_of[pid] = cands
    # Attribution : meilleur score d'abord ; une annonce ne sert qu'une fois
    order = sorted(((c[0][0], pid) for pid, c in cands_of.items() if c), reverse=True)
    used = set()
    for _, pid in order:
        c = [x for x in cands_of[pid] if x[1] not in used]
        if not c: continue
        top = c[0][0]
        if top < 4: continue
        if len(c) > 1 and c[1][0] >= top - 1: continue  # doute : deux annonces trop proches
        v = c[0][2]
        out[pid] = f"https://www.vinted.fr/items/{v['id']}"  # forme courte, Vinted redirige
        used.add(c[0][1])
    return out
