#!/usr/bin/env python3
"""Traduction FR ↔ EN pour l'import Vestiaire et le rattrapage.

Pourquoi : depuis mi-octobre 2026, Google Traduction refuse les serveurs de
GitHub (page « Sorry… » anti-robots) : deep-translator échouait sans rien dire
et ~200 pièces sont arrivées sans description anglaise. On essaie d'abord en
direct (gratuit) ; si Google refuse, la même requête passe par ScrapingBee
(adresse française, 1 crédit par appel), comme les fiches et les photos.

  translate(text, src='fr', dst='en') → texte traduit, ou '' si échec
  python3 tools/translate.py --selftest       essai sur une phrase
  python3 tools/translate.py --fill [N]       complète desc_en / type_en
                                              manquants dans index.html (N max)
"""
import json, os, re, sys, time
import requests

GTX = 'https://translate.googleapis.com/translate_a/single'
_DIRECT_OK = True  # passe à False au premier refus de Google


def _parse(js):
    try:
        data = json.loads(js)
        return ''.join(seg[0] for seg in data[0] if seg and seg[0])
    except Exception:
        return ''


def _one(chunk, src, dst):
    global _DIRECT_OK
    params = {'client': 'gtx', 'sl': src, 'tl': dst, 'dt': 't', 'q': chunk}
    if _DIRECT_OK:
        try:
            r = requests.get(GTX, params=params, timeout=20, headers={'User-Agent': 'Mozilla/5.0'})
            if r.status_code == 200 and r.text.startswith('['):
                out = _parse(r.text)
                if out:
                    return out
            _DIRECT_OK = False
            print(f'  traduction directe refusée (HTTP {r.status_code}) → ScrapingBee', file=sys.stderr)
        except Exception as e:
            _DIRECT_OK = False
            print(f'  traduction directe ERR {e} → ScrapingBee', file=sys.stderr)
    key = os.environ.get('SCRAPINGBEE_API_KEY', '').strip()
    if not key:
        return ''
    url = requests.Request('GET', GTX, params=params).prepare().url
    for premium in (False, True):
        try:
            p = {'api_key': key, 'url': url, 'render_js': 'false'}
            if premium:
                p['premium_proxy'] = 'true'
            r = requests.get('https://app.scrapingbee.com/api/v1/', params=p, timeout=40)
            r.encoding = 'utf-8'
            if r.status_code == 200 and r.text.lstrip().startswith('['):
                out = _parse(r.text)
                if out:
                    return out
            print(f'  traduction scrapingbee{" premium" if premium else ""} HTTP {r.status_code}', file=sys.stderr)
        except Exception as e:
            print(f'  traduction scrapingbee ERR {e}', file=sys.stderr)
        time.sleep(1)
    return ''


def _chunks(text, size=1500):
    """Morceaux de ≤ size caractères, coupés aux sauts de ligne (l'adresse de
    la requête a une longueur limitée)."""
    parts, cur = [], ''
    for line in text.split('\n'):
        while len(line) > size:
            cut = line.rfind('. ', 0, size)
            cut = cut + 1 if cut > 0 else size
            if cur:
                parts.append(cur); cur = ''
            parts.append(line[:cut]); line = line[cut:].lstrip()
        if len(cur) + len(line) + 1 > size and cur:
            parts.append(cur); cur = line
        else:
            cur = (cur + '\n' + line) if cur else line
    if cur:
        parts.append(cur)
    return parts


def translate(text, src='fr', dst='en'):
    text = (text or '').strip()
    if not text:
        return ''
    out = []
    for ch in _chunks(text):
        t = _one(ch, src, dst)
        if not t:
            return ''  # tout ou rien : pas de description à moitié traduite
        out.append(t)
    return '\n'.join(out)


def fill_missing(limit=60):
    """Complète desc_en / type_en manquants dans index.html (rattrapage)."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(root, 'index.html')
    h = open(path, encoding='utf-8').read()
    dec = json.JSONDecoder()
    done = 0
    for mo in list(re.finditer(r'\{"id": ?"(\d+)"', h))[::-1]:
        if done >= limit:
            break
        s = mo.start()
        try:
            obj, end = dec.raw_decode(h, s)
        except Exception:
            continue
        need_d = (obj.get('desc') or '').strip() and not (obj.get('desc_en') or '').strip()
        need_t = (obj.get('type') or '').strip() and not (obj.get('type_en') or '').strip()
        if not (need_d or need_t):
            continue
        changed = False
        if need_d:
            t = translate(obj['desc'])
            if t:
                obj['desc_en'] = t; changed = True
        if need_t:
            t = translate(obj['type'])
            if t:
                obj['type_en'] = t[:1].upper() + t[1:]; changed = True
        if changed:
            compact = '":"' in h[s:s + 30]
            h = h[:s] + json.dumps(obj, ensure_ascii=False, separators=(',', ':') if compact else (', ', ': ')) + h[end:]
            done += 1
            print(f'  {obj["id"]} traduit')
        else:
            print(f'  {obj["id"]} : traduction impossible', file=sys.stderr)
    open(path, 'w', encoding='utf-8').write(h)
    print(f'Rattrapage traduction : {done} pièce(s) complétée(s)')
    return done


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        s = 'Superbe veste en laine 100%.\nParfait état\nTaille indiquée 3 convient à un M'
        t = translate(s)
        print('FR :', s.replace('\n', ' / '))
        print('EN :', (t or '(échec)').replace('\n', ' / '))
        sys.exit(0 if t else 1)
    if '--fill' in sys.argv:
        i = sys.argv.index('--fill')
        n = int(sys.argv[i + 1]) if len(sys.argv) > i + 1 and sys.argv[i + 1].isdigit() else 60
        fill_missing(n)
