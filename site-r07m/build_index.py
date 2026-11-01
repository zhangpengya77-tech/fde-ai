#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Minimal Markdown -> HTML converter for the R07-M delivery reports.
Handles: headings, bold/italic, inline code, fenced code, tables,
unordered/ordered lists, horizontal rules, links, paragraphs.
"""
import re
import html
import os

def convert(md: str) -> str:
    lines = md.split("\n")
    out = []
    i = 0
    n = len(lines)

    def flush_paragraph(buf):
        if buf:
            text = " ".join(buf).strip()
            if text:
                out.append("<p>" + inline(text) + "</p>")
            return []
        return []

    para = []
    while i < n:
        line = lines[i]
        # fenced code
        if line.strip().startswith("```"):
            para = flush_paragraph(para)
            i += 1
            code = []
            while i < n and not lines[i].strip().startswith("```"):
                code.append(lines[i])
                i += 1
            i += 1
            out.append("<pre><code>" + html.escape("\n".join(code)) + "</code></pre>")
            continue
        # table
        if line.strip().startswith("|") and i + 1 < n and re.match(r"^\s*\|?[\s:|-]+\|?\s*$", lines[i+1]):
            para = flush_paragraph(para)
            header = [c.strip() for c in line.strip().strip("|").split("|")]
            i += 2  # skip header + separator
            rows = []
            while i < n and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            out.append("<table>")
            out.append("<thead><tr>" + "".join("<th>" + inline(h) + "</th>" for h in header) + "</tr></thead>")
            out.append("<tbody>")
            for r in rows:
                out.append("<tr>" + "".join("<td>" + inline(c) + "</td>" for c in r) + "</tr>")
            out.append("</tbody></table>")
            continue
        # heading
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            para = flush_paragraph(para)
            lvl = len(m.group(1))
            out.append(f"<h{lvl}>" + inline(m.group(2).strip()) + f"</h{lvl}>")
            i += 1
            continue
        # hr
        if re.match(r"^\s*([-*_])\1{2,}\s*$", line):
            para = flush_paragraph(para)
            out.append("<hr/>")
            i += 1
            continue
        # unordered list
        if re.match(r"^\s*[-*+]\s+", line):
            para = flush_paragraph(para)
            items = []
            while i < n and re.match(r"^\s*[-*+]\s+", lines[i]):
                items.append(inline(re.sub(r"^\s*[-*+]\s+", "", lines[i])))
                i += 1
            out.append("<ul>" + "".join("<li>" + it + "</li>" for it in items) + "</ul>")
            continue
        # ordered list
        if re.match(r"^\s*\d+\.\s+", line):
            para = flush_paragraph(para)
            items = []
            while i < n and re.match(r"^\s*\d+\.\s+", lines[i]):
                items.append(inline(re.sub(r"^\s*\d+\.\s+", "", lines[i])))
                i += 1
            out.append("<ol>" + "".join("<li>" + it + "</li>" for it in items) + "</ol>")
            continue
        # blank
        if not line.strip():
            para = flush_paragraph(para)
            i += 1
            continue
        # normal paragraph line
        para.append(line)
        i += 1
    flush_paragraph(para)
    return "\n".join(out)

def inline(text: str) -> str:
    text = html.escape(text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\*)\*(?!\*)(.+?)\*(?!\*)", r"<em>\1</em>", text)
    text = re.sub(r"\[(.+?)\]\((.+?)\)", r'<a href="\2">\1</a>', text)
    return text

base = os.path.dirname(os.path.abspath(__file__))
for src, dst in [
    ("R07-M-模型管理-交付报告_2026-10-21.md", "report-delivery.html"),
    ("R07-M-模型管理-步骤0-上传拒绝点调查报告_2026-10-21.md", "report-step0.html"),
]:
    with open(os.path.join(base, src), encoding="utf-8") as f:
        body = convert(f.read())
    title = "R07-M 交付报告" if "交付报告" in src else "R07-M 步骤0调查"
    html_doc = f"""<!DOCTYPE html>
<html lang="zh-Hans"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
body{{font-family:-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;max-width:920px;margin:0 auto;padding:32px 20px;color:#1f2328;line-height:1.7}}
h1{{border-bottom:3px solid #2563eb;padding-bottom:8px}}
h2{{border-bottom:1px solid #e5e7eb;padding-bottom:6px;margin-top:32px}}
h3{{color:#2563eb}}
code{{background:#f1f5f9;padding:1px 5px;border-radius:4px;font-size:.9em}}
pre{{background:#0f172a;color:#e2e8f0;padding:14px;border-radius:8px;overflow:auto}}
pre code{{background:none;color:inherit}}
table{{border-collapse:collapse;width:100%;margin:16px 0;font-size:.92em}}
th,td{{border:1px solid #d1d5db;padding:8px 10px;text-align:left}}
th{{background:#eff6ff}}
tr:nth-child(even) td{{background:#f8fafc}}
a{{color:#2563eb}}
blockquote{{border-left:4px solid #cbd5e1;margin:0;padding:4px 16px;color:#475569}}
</style></head><body>
{body}
</body></html>"""
    with open(os.path.join(base, dst), "w", encoding="utf-8") as f:
        f.write(html_doc)
    print("wrote", dst)
