"""Désignation précise d'une pièce à partir de sa description (newsletter,
e-mails) : « Pantalon » -> « Pantalon en velours », plus la saison ou
l'époque quand la description la donne (« Automne-hiver 2003 », « Années 90 »).
Utilisé par export_products.py."""
import re

MATIERES = ['cachemire', 'mohair', 'mérinos', 'alpaga', 'angora', 'laine', 'soie', 'coton', 'lin', 'velours',
            'cuir', 'daim', 'denim', 'jean', 'nylon', 'polyester', 'viscose', 'rayonne', 'satin', 'tweed',
            'flanelle', 'jersey', 'maille', 'crêpe', 'organza', 'gabardine', 'toile', 'tricot', 'feutre',
            'chanvre', 'ramie', 'cupro', 'tulle', 'dentelle', 'mousseline', 'seersucker', 'shetland']
MOTIFS = ['plissé', 'plissée', 'rayé', 'rayée', 'à rayures', 'à carreaux', 'à pois', 'imprimé', 'imprimée',
          'brodé', 'brodée', 'matelassé', 'matelassée', 'froissé', 'froissée', 'patchwork', 'asymétrique', 'oversize']


def _norm(s):
    return (s or '').lower().replace('’', "'")


def matiere(desc, typ):
    d = _norm(desc)
    t = _norm(typ)
    if ' en ' in t:          # le type dit déjà la matière (« Pull en laine »)
        return ''
    # « pantalon en velours », « veste en laine », « en 100% coton »
    for m in re.finditer(r"\ben\s+(?:\d+\s*%\s*(?:de\s+)?)?([a-zéèêàçûô'-]+)", d):
        w = m.group(1)
        if w in MATIERES:
            return w
    # à défaut : matière la plus citée
    best = None
    for w in MATIERES:
        n = len(re.findall(r'\b' + re.escape(w) + r'\b', d))
        if n and (best is None or n > best[1]):
            best = (w, n)
    return best[0] if best else ''


def motif(desc):
    d = _norm(desc)
    for w in MOTIFS:
        if re.search(r'\b' + re.escape(w) + r'\b', d):
            return w.replace('ée', 'é') if w.endswith('ée') else w
    return ''


def saison(desc):
    """(libellé, année) : « Automne-hiver 2003 », « Printemps-été 1998 », « Années 90 »."""
    d = _norm(desc)
    m = re.search(r'(automne|printemps)[\s-]*(hiver|été|ete)\s*(?:\d{4}\s*[/-]\s*)?((?:19|20)\d{2})', d)
    if m:
        s = 'Automne-hiver' if m.group(1) == 'automne' else 'Printemps-été'
        return f'{s} {m.group(3)}', int(m.group(3))
    m = re.search(r'\b(aw|fw|ah)\s*[\'’]?\s*(\d{2}|\d{4})\b', d)
    if m:
        y = int(m.group(2)); y = y if y > 1900 else (1900 + y if y > 40 else 2000 + y)
        return f'Automne-hiver {y}', y
    m = re.search(r'\b(ss|pe)\s*[\'’]?\s*(\d{2}|\d{4})\b', d)
    if m:
        y = int(m.group(2)); y = y if y > 1900 else (1900 + y if y > 40 else 2000 + y)
        return f'Printemps-été {y}', y
    m = re.search(r"ann[ée]es\s*((?:19)?[5-9]0|(?:20)?[0-2]0)\b", d)
    if m:
        y = int(m.group(1)); y = y if y > 1900 else (1900 + y if y >= 50 else 2000 + y)
        return f'Années {str(y)[2:]}' if y < 2000 else f'Années {y}', y
    m = re.search(r'\b(19[5-9]\d|20[0-2]\d)\b', d)
    if m:
        return m.group(1), int(m.group(1))
    return '', 0


FEMININ = {'blouse', 'jupe', 'robe', 'veste', 'chemise', 'parka', 'salopette', 'combinaison', 'cape', 'tunique',
           'marinière', 'doudoune', 'blouson', 'écharpe', 'étole', 'ceinture', 'casquette', 'pochette', 'besace'}
FEMININ.discard('blouson')


def accord(adj, typ):
    """plissé -> plissée si la pièce est féminine (blouse, jupe…)."""
    first = _norm(typ).split(' ')[0] if typ else ''
    if first in FEMININ and adj.endswith('é'):
        return adj + 'e'
    return adj


def designation(p):
    typ = p.get('type', '') or ''
    desc = p.get('desc', '') or ''
    label = typ
    mat = matiere(desc, typ)
    if mat:
        label += ' en ' + mat
    mo = motif(desc)
    if mo and mo.split()[-1] not in _norm(label):
        label += ' ' + accord(mo, typ)
    s, y = saison(desc)
    return label, s, y
