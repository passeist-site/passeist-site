#!/usr/bin/env python3
"""Daily digest passeist — résumé des actions auto + erreurs depuis 24h.

Lit les runs récents du workflow sync-vestiaire via GitHub API, parse leurs
commit messages + Issues ouvertes, et envoie 1 mail HTML à Tom.

Env vars requis :
- GH_TOKEN : pour l'API GitHub (le GITHUB_TOKEN du workflow suffit)
- REPO : ex 'passeist-site/passeist-site'
- GMAIL_USER : compte expéditeur (ex dagnas.tom@gmail.com)
- GMAIL_APP_PASSWORD : App Password Gmail (≠ password normal, généré sur
  https://myaccount.google.com/apppasswords après activation 2FA)
- DIGEST_RECIPIENT : destinataire (par défaut = GMAIL_USER)

Cron typique : 19h UTC (21h Paris) une fois par jour.
"""
import os, json, re, sys, smtplib
import requests
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

GH_TOKEN = os.environ['GH_TOKEN']
REPO = os.environ.get('REPO', 'passeist-site/passeist-site')
GMAIL_USER = os.environ['GMAIL_USER']
GMAIL_APP_PASSWORD = os.environ['GMAIL_APP_PASSWORD']
RECIPIENT = os.environ.get('DIGEST_RECIPIENT', GMAIL_USER)

API = f'https://api.github.com/repos/{REPO}'
HEADERS = {'Authorization': f'Bearer {GH_TOKEN}', 'Accept': 'application/vnd.github+json'}


def gh(path, **params):
    r = requests.get(f'{API}{path}', headers=HEADERS, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def fetch_recent_syncs(hours=24):
    """Runs sync-vestiaire des dernières {hours}h."""
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    runs = gh('/actions/workflows/sync-vestiaire.yml/runs', per_page=20, created=f'>={since}')
    return runs.get('workflow_runs', [])


def fetch_recent_issues(hours=24):
    """Issues label 'sync-auto' des dernières {hours}h."""
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    issues = gh('/issues', labels='sync-auto', state='open', since=since, per_page=20)
    return issues if isinstance(issues, list) else []


def parse_commit_message(msg):
    """Extrait sold/imports counts depuis 'auto-sync ... | sold: N | imports: M'."""
    sold = re.search(r'sold:\s*(\d+)', msg)
    imports = re.search(r'imports:\s*(\d+)', msg)
    return {
        'sold': int(sold.group(1)) if sold else 0,
        'imports': int(imports.group(1)) if imports else 0,
        'sold_ids': re.findall(r'SOLD bascule IDs:\s*([\d ]+)', msg),
        'imports_ids': re.findall(r'Imports IDs:\s*([\d ]+)', msg),
    }


def build_digest():
    runs = fetch_recent_syncs(24)
    issues = fetch_recent_issues(24)

    total_sold = total_imports = 0
    sold_ids, imports_ids = [], []
    failed_runs = []
    for r in runs:
        if r.get('conclusion') != 'success':
            failed_runs.append(r)
            continue
        msg = (r.get('head_commit') or {}).get('message', '')
        if not msg.startswith('auto-sync'): continue
        data = parse_commit_message(msg)
        total_sold += data['sold']
        total_imports += data['imports']
        for s in data['sold_ids']: sold_ids.extend(s.split())
        for s in data['imports_ids']: imports_ids.extend(s.split())

    needs_action = bool(issues) or bool(failed_runs)

    # === Build HTML body ===
    today = datetime.now(timezone.utc).astimezone().strftime('%d/%m/%Y')
    if not needs_action and total_sold == 0 and total_imports == 0:
        title = f'✓ Sync passeist {today} — RAS'
        body_summary = '<p>Aucune action automatique sur les 24 dernières heures. Rien à faire.</p>'
    else:
        parts = []
        if total_sold: parts.append(f'{total_sold} bascule{"s" if total_sold>1 else ""} SOLD')
        if total_imports: parts.append(f'{total_imports} import{"s" if total_imports>1 else ""}')
        if issues: parts.append(f'{len(issues)} issue{"s" if len(issues)>1 else ""}')
        if failed_runs: parts.append(f'{len(failed_runs)} run{"s" if len(failed_runs)>1 else ""} échoué{"s" if len(failed_runs)>1 else ""}')
        title = f'Sync passeist {today} — ' + ', '.join(parts)
        body_summary = ''

    html = f"""<html><body style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; color: #1c2230;">
<h2 style="border-bottom: 2px solid #1c2230; padding-bottom: 8px;">{title}</h2>
{body_summary}
"""

    if total_sold > 0:
        html += f'<h3 style="color: #5984b0;">✓ {total_sold} article{"s" if total_sold>1 else ""} basculé{"s" if total_sold>1 else ""} en SOLD</h3><ul>'
        for pid in sold_ids[:30]:
            html += f'<li><code>{pid}</code> — <a href="https://passeist.com/?ref={pid}">voir sur le site</a></li>'
        html += '</ul>'

    if total_imports > 0:
        html += f'<h3 style="color: #5984b0;">✓ {total_imports} nouvelle{"s" if total_imports>1 else ""} pièce{"s" if total_imports>1 else ""} importée{"s" if total_imports>1 else ""}</h3><ul>'
        for pid in imports_ids[:30]:
            html += f'<li><code>{pid}</code> — <a href="https://passeist.com/?ref={pid}">voir sur le site</a></li>'
        html += '</ul>'

    if failed_runs:
        html += f'<h3 style="color: #c44;">⚠ {len(failed_runs)} run{"s" if len(failed_runs)>1 else ""} sync échoué{"s" if len(failed_runs)>1 else ""}</h3><ul>'
        for r in failed_runs:
            html += f'<li><a href="{r["html_url"]}">{r["created_at"][:16].replace("T"," ")} — {r["conclusion"] or r["status"]}</a></li>'
        html += '</ul>'

    if issues:
        html += f'<h3 style="color: #c44;">⚠ {len(issues)} action{"s" if len(issues)>1 else ""} à valider manuellement</h3><ul>'
        for iss in issues:
            html += f'<li><a href="{iss["html_url"]}">{iss["title"]}</a></li>'
        html += '</ul>'

    html += '<hr style="margin-top: 32px; border: 0; border-top: 1px solid #ccc;">'
    html += '<p style="font-size: 11px; color: #888;">Daily digest passeist · sync auto Vestiaire · 21h Paris<br>'
    html += f'Repo : <a href="https://github.com/{REPO}">{REPO}</a></p></body></html>'

    return title, html


def send(title, html):
    msg = MIMEMultipart('alternative')
    msg['Subject'] = title
    msg['From'] = GMAIL_USER
    msg['To'] = RECIPIENT
    msg.attach(MIMEText(html, 'html', 'utf-8'))
    with smtplib.SMTP_SSL('smtp.gmail.com', 465, timeout=30) as s:
        s.login(GMAIL_USER, GMAIL_APP_PASSWORD)
        s.send_message(msg)
    print(f'OK : mail envoyé à {RECIPIENT}')


if __name__ == '__main__':
    title, html = build_digest()
    print(f'Title : {title}')
    print(f'HTML length : {len(html)} chars')
    send(title, html)
