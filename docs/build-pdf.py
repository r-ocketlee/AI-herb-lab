#!/usr/bin/env python3
"""
Convert handover.md → handover.html → handover.pdf (via Chrome headless).

Korean text supported via Apple SD Gothic Neo / system fallback fonts.
Code blocks, tables, and ASCII diagrams are preserved with monospace styling.
"""

import os
import subprocess
import sys
from pathlib import Path

# Add user pip directory to path so we can import the markdown package
sys.path.insert(0, str(Path.home() / '.local' / 'lib' / 'python3.13' / 'site-packages'))
sys.path.insert(0, str(Path.home() / '.local' / 'lib' / 'python3.12' / 'site-packages'))
sys.path.insert(0, str(Path.home() / '.local' / 'lib' / 'python3.11' / 'site-packages'))

import markdown

DOCS_DIR = Path(__file__).parent
MD_FILE = DOCS_DIR / 'handover.md'
HTML_FILE = DOCS_DIR / 'handover.html'
PDF_FILE = DOCS_DIR / 'handover.pdf'

# Read markdown
md_content = MD_FILE.read_text(encoding='utf-8')

# Convert with extensions for code highlighting, tables, fenced code blocks, etc.
html_body = markdown.markdown(
    md_content,
    extensions=[
        'fenced_code',
        'tables',
        'codehilite',
        'toc',
        'nl2br',
    ],
    extension_configs={
        'codehilite': {
            'css_class': 'codehilite',
            'guess_lang': False,
        },
    },
)

# Wrap in a full HTML document with print-friendly CSS.
# Key choices:
#   - Apple SD Gothic Neo for Korean (preinstalled on macOS)
#   - SF Mono for code blocks (preserves ASCII box-drawing diagrams)
#   - Letter size with generous margins
#   - Tables: thin borders, alternating-row not needed (too busy in print)
#   - Code blocks: light gray bg, no overflow scrolling (wrap or shrink)
#   - Anchor links from TOC remain functional in PDF

html_template = """<!doctype html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>Smart Herb AI Lab — 기술 인수인계 문서</title>
<style>
  @page {
    size: A4;
    margin: 18mm 16mm 18mm 16mm;
    @bottom-right {
      content: counter(page) " / " counter(pages);
      font-size: 9pt;
      color: #888;
    }
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    color: #1a1a1a;
    font-family: "Apple SD Gothic Neo", "Helvetica Neue", "Arial", sans-serif;
    font-size: 10.5pt;
    line-height: 1.55;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  body {
    max-width: 100%;
    padding: 0 0 40px;
  }

  h1, h2, h3, h4 {
    font-weight: 600;
    color: #1a1a1a;
    line-height: 1.3;
    page-break-after: avoid;
  }

  h1 {
    font-size: 22pt;
    margin-top: 0;
    margin-bottom: 8px;
    padding-bottom: 12px;
    border-bottom: 2px solid #1a1a1a;
  }

  h2 {
    font-size: 16pt;
    margin-top: 28px;
    margin-bottom: 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid #d0d0d0;
    page-break-before: auto;
  }

  h3 {
    font-size: 12.5pt;
    margin-top: 18px;
    margin-bottom: 8px;
    color: #2a2a2a;
  }

  h4 {
    font-size: 11pt;
    margin-top: 14px;
    margin-bottom: 6px;
    color: #444;
  }

  p {
    margin: 8px 0 10px;
  }

  ul, ol {
    margin: 8px 0 10px;
    padding-left: 22px;
  }
  li {
    margin: 3px 0;
  }

  blockquote {
    margin: 12px 0;
    padding: 8px 14px;
    background: #fff8e6;
    border-left: 3px solid #d6a920;
    color: #5a4a10;
    font-size: 10pt;
  }
  blockquote p { margin: 4px 0; }

  /* Inline code */
  code {
    font-family: "SF Mono", "Menlo", "Consolas", "DejaVu Sans Mono", monospace;
    font-size: 0.88em;
    background: #f1f1f3;
    padding: 1px 5px;
    border-radius: 3px;
    color: #c7254e;
  }

  /* Code blocks */
  pre {
    font-family: "SF Mono", "Menlo", "Consolas", "DejaVu Sans Mono", monospace;
    font-size: 8.5pt;
    line-height: 1.4;
    background: #f7f7f8;
    border: 1px solid #e1e1e4;
    border-radius: 4px;
    padding: 10px 12px;
    overflow: hidden;
    white-space: pre;
    page-break-inside: avoid;
    margin: 10px 0;
  }
  pre code {
    background: transparent;
    padding: 0;
    color: #1a1a1a;
    font-size: inherit;
  }

  /* Tables */
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 12px 0;
    font-size: 9.5pt;
    page-break-inside: avoid;
  }
  th, td {
    border: 1px solid #d0d0d0;
    padding: 6px 9px;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: #f1f1f3;
    font-weight: 600;
  }
  tr:nth-child(even) td {
    background: #fafafa;
  }

  /* TOC list — render compact */
  h2 + ol {
    margin-top: 4px;
  }

  /* Horizontal rule */
  hr {
    border: 0;
    border-top: 1px solid #d6d6d6;
    margin: 24px 0;
  }

  /* Links — subtle for print */
  a {
    color: #1a4a8a;
    text-decoration: none;
  }

  /* Header on first page */
  .doc-header {
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid #e0e0e0;
  }

  /* Strong */
  strong {
    font-weight: 600;
    color: #000;
  }

  /* Em */
  em {
    font-style: italic;
  }
</style>
</head>
<body>
""" + html_body + """
</body>
</html>
"""

HTML_FILE.write_text(html_template, encoding='utf-8')
print(f"[1/2] HTML 생성됨: {HTML_FILE}")

# Use Chrome headless to convert HTML to PDF.
chrome_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if not Path(chrome_path).exists():
    print(f"Chrome not found at {chrome_path}")
    sys.exit(1)

# Run Chrome headless. file:// URL for local HTML.
html_url = f"file://{HTML_FILE.absolute()}"

result = subprocess.run([
    chrome_path,
    "--headless=new",
    "--disable-gpu",
    "--no-pdf-header-footer",
    "--no-sandbox",
    f"--print-to-pdf={PDF_FILE.absolute()}",
    "--print-to-pdf-no-header",
    "--virtual-time-budget=5000",
    html_url,
], capture_output=True, text=True)

if result.returncode != 0:
    print("Chrome stderr:", result.stderr)
    print("Chrome stdout:", result.stdout)
    sys.exit(1)

print(f"[2/2] PDF 생성됨: {PDF_FILE}")
print(f"파일 크기: {PDF_FILE.stat().st_size / 1024:.1f} KB")
