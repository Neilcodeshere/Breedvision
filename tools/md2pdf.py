"""Render Markdown documents to PDF.

Built for the BreedVision docs, which lean heavily on tables, fenced code
blocks and box-drawing diagrams. Two details matter for those:

* Fonts. ReportLab's built-in fonts are Latin-1 only, so box-drawing characters
  (used in the architecture diagrams) and typographic dashes render as black
  boxes. DejaVu — shipped with matplotlib — covers them, so it is registered
  and used throughout.
* Tables. Markdown tables carry most of the measured results in these
  documents, so they are rendered as real ReportLab tables with wrapped cells
  rather than flattened to text.

Usage:
    python tools/md2pdf.py docs/explained.md docs/explained-pitch.md
    python tools/md2pdf.py docs/explained.md --out build/explained.pdf
"""

from __future__ import annotations

import argparse
import html
import re
import sys
import unicodedata
from pathlib import Path

from markdown_it import MarkdownIt
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# --- palette, matched to the product's design tokens ------------------------
INK = colors.HexColor("#1a1917")
INK_2 = colors.HexColor("#46433c")
INK_3 = colors.HexColor("#6b665c")
FOREST = colors.HexColor("#276046")
LINE = colors.HexColor("#d8d2c4")
PAPER_SUNK = colors.HexColor("#f2eee5")
CODE_BG = colors.HexColor("#f6f3ec")
CLAY = colors.HexColor("#8f3a22")

BODY = "DejaVu"
BODY_B = "DejaVu-Bold"
BODY_I = "DejaVu-Oblique"
MONO = "DejaVuMono"


def register_fonts() -> None:
    """Register DejaVu from matplotlib's bundled font directory."""
    import matplotlib

    d = Path(matplotlib.get_data_path()) / "fonts" / "ttf"
    faces = {
        BODY: "DejaVuSans.ttf",
        BODY_B: "DejaVuSans-Bold.ttf",
        BODY_I: "DejaVuSans-Oblique.ttf",
        MONO: "DejaVuSansMono.ttf",
        "DejaVuMono-Bold": "DejaVuSansMono-Bold.ttf",
    }
    for name, filename in faces.items():
        path = d / filename
        if not path.is_file():
            raise FileNotFoundError(f"font not found: {path}")
        pdfmetrics.registerFont(TTFont(name, str(path)))

    from reportlab.pdfbase.pdfmetrics import registerFontFamily

    registerFontFamily(BODY, normal=BODY, bold=BODY_B, italic=BODY_I,
                       boldItalic=BODY_B)


# Emoji have no glyph even in DejaVu; map the few used to plain text.
EMOJI_MAP = {
    # A bare "!" left over from a warning emoji reads like a typo in a heading,
    # so it is dropped; the heading text already carries the emphasis.
    "⚠": "",
    "✅": "[x]",
    "❌": "[ ]",
}


def clean_text(s: str) -> str:
    """Strip variation selectors and swap emoji for renderable stand-ins."""
    s = s.replace("️", "").replace("︎", "")
    for k, v in EMOJI_MAP.items():
        s = s.replace(k, v)
    # Drop anything with no glyph (private use, remaining pictographs).
    return "".join(
        c for c in s
        if unicodedata.category(c) not in ("Cs", "Co", "Cn")
    )


def styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()["Normal"]

    def mk(**kw):
        """ParagraphStyle with project defaults that callers may override."""
        return ParagraphStyle(**{"fontName": BODY, "textColor": INK, **kw})

    return {
        "h1": mk(name="h1", parent=base, fontName=BODY_B, fontSize=21,
                 leading=26, spaceBefore=2, spaceAfter=10, textColor=INK),
        "h2": mk(name="h2", parent=base, fontName=BODY_B, fontSize=15.5,
                 leading=20, spaceBefore=18, spaceAfter=7, textColor=INK),
        "h3": mk(name="h3", parent=base, fontName=BODY_B, fontSize=12.5,
                 leading=17, spaceBefore=13, spaceAfter=5, textColor=INK),
        "h4": mk(name="h4", parent=base, fontName=BODY_B, fontSize=11,
                 leading=15, spaceBefore=10, spaceAfter=4, textColor=INK_2),
        "body": mk(name="body", parent=base, fontSize=9.7, leading=14.6,
                   spaceAfter=7, alignment=TA_LEFT, textColor=INK_2),
        "quote": mk(name="quote", parent=base, fontSize=9.7, leading=14.6,
                    leftIndent=10, spaceAfter=7, textColor=INK_2,
                    borderPadding=0),
        "code": ParagraphStyle(name="code", parent=base, fontName=MONO,
                               fontSize=7.6, leading=10.4, textColor=INK,
                               spaceAfter=0),
        "cell": mk(name="cell", parent=base, fontSize=8.4, leading=11.6,
                   spaceAfter=0, textColor=INK_2),
        "cellh": mk(name="cellh", parent=base, fontName=BODY_B, fontSize=8.4,
                    leading=11.6, spaceAfter=0, textColor=INK),
        "li": mk(name="li", parent=base, fontSize=9.7, leading=14.2,
                 spaceAfter=3, textColor=INK_2),
    }


def inline_markup(tokens) -> str:
    """Convert markdown-it inline children into ReportLab mini-markup."""
    out: list[str] = []
    for t in tokens or []:
        if t.type == "text":
            out.append(html.escape(clean_text(t.content)))
        elif t.type == "code_inline":
            out.append(
                f'<font face="{MONO}" size="8.6" color="#8f3a22">'
                f"{html.escape(clean_text(t.content))}</font>"
            )
        elif t.type == "strong_open":
            out.append(f'<font face="{BODY_B}" color="#1a1917">')
        elif t.type == "strong_close":
            out.append("</font>")
        elif t.type in ("em_open",):
            out.append(f'<font face="{BODY_I}">')
        elif t.type in ("em_close",):
            out.append("</font>")
        elif t.type == "link_open":
            href = t.attrGet("href") or ""
            out.append(f'<font color="#276046"><u>' if href.startswith("#")
                       else f'<link href="{html.escape(href)}" color="#276046"><u>')
            t._closed_as_plain = href.startswith("#")
        elif t.type == "link_close":
            out.append("</u></font>" if out and "</u>" not in out[-1:] else "</u></link>")
        elif t.type == "softbreak":
            out.append(" ")
        elif t.type == "hardbreak":
            out.append("<br/>")
        elif t.type == "s_open":
            out.append("<strike>")
        elif t.type == "s_close":
            out.append("</strike>")
        elif t.type == "image":
            alt = clean_text(t.content or "image")
            out.append(f'<font color="#6b665c">[{html.escape(alt)}]</font>')
    text = "".join(out)
    # Normalise any mismatched link close produced above.
    text = text.replace("</u></link>", "</u></font>")
    return text


def _plain(markup: str) -> str:
    """Strip mini-markup so cell text can be measured."""
    return re.sub(r"<[^>]+>", "", markup)


def column_widths(rows: list[list[str]], avail: float, font_size: float):
    """Size columns so no unbreakable token wraps mid-word.

    Markdown tables here carry measured results, and a value split as
    "0.635 / 9" across two lines is unreadable. Columns are therefore sized
    from their longest *token*, not their longest line, and the font is scaled
    down if the natural widths do not fit.
    """
    ncols = max(len(r) for r in rows)
    pad = 12.0  # left + right cell padding

    def token_w(text: str, size: float) -> float:
        toks = _plain(text).split() or [""]
        return max(pdfmetrics.stringWidth(t, BODY_B, size) for t in toks)

    size = font_size
    while size >= 6.0:
        need = []
        for c in range(ncols):
            w = max(
                (token_w(r[c], size) for r in rows if c < len(r)),
                default=0.0,
            )
            need.append(w + pad)
        total = sum(need)
        if total <= avail:
            # Distribute the slack in proportion to natural width, so text-heavy
            # columns get the room rather than numeric ones.
            slack = avail - total
            weights = [n / total for n in need]
            return [n + slack * w for n, w in zip(need, weights)], size
        size -= 0.4

    # Still too wide at the minimum size: fall back to proportional scaling.
    scale = avail / total
    return [n * scale for n in need], size


def build_story(md_text: str, st: dict) -> list:
    md = MarkdownIt("commonmark").enable("table").enable("strikethrough")
    tokens = md.parse(md_text)

    story: list = []
    i = 0
    list_stack: list[dict] = []

    def para(markup: str, style):
        if markup.strip():
            story.append(Paragraph(markup, style))

    while i < len(tokens):
        t = tokens[i]

        if t.type == "heading_open":
            level = int(t.tag[1])
            content = inline_markup(tokens[i + 1].children)
            key = f"h{min(level, 4)}"
            flow = [Paragraph(content, st[key])]
            if level == 2:
                flow.insert(0, Spacer(1, 4))
            story.append(KeepTogether(flow) if level >= 2 else flow[0])
            i += 3
            continue

        if t.type == "paragraph_open":
            content = inline_markup(tokens[i + 1].children)
            target = st["quote"] if list_stack and list_stack[-1].get("quote") \
                else st["body"]
            para(content, target)
            i += 3
            continue

        if t.type == "fence" or t.type == "code_block":
            lines = clean_text(t.content).rstrip("\n").split("\n")
            body = "<br/>".join(
                html.escape(ln).replace(" ", "&nbsp;") or "&nbsp;"
                for ln in lines
            )
            tbl = Table([[Paragraph(body, st["code"])]], colWidths=["100%"])
            tbl.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
                ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]))
            story.append(tbl)
            story.append(Spacer(1, 8))
            i += 1
            continue

        if t.type == "table_open":
            rows, header = [], []
            j = i + 1
            in_head = False
            row: list[str] = []
            while j < len(tokens) and tokens[j].type != "table_close":
                tt = tokens[j].type
                if tt == "thead_open":
                    in_head = True
                elif tt == "thead_close":
                    in_head = False
                elif tt == "tr_open":
                    row = []
                elif tt in ("th_open", "td_open"):
                    row.append(inline_markup(tokens[j + 1].children))
                    j += 2
                elif tt == "tr_close":
                    (header if in_head else rows).append(row)
                j += 1

            head = header[0] if header else []
            data = [[Paragraph(c, st["cellh"]) for c in head]] if head else []
            for r in rows:
                data.append([Paragraph(c, st["cell"]) for c in r])

            if data:
                ncols = max(len(r) for r in data)
                for r in data:
                    while len(r) < ncols:
                        r.append(Paragraph("", st["cell"]))
                avail = 170 * mm
                raw_rows = ([head] if head else []) + rows
                widths, cell_size = column_widths(raw_rows, avail, 8.4)

                if cell_size < 8.4:
                    # Re-render the cells at the reduced size that actually fits.
                    small = ParagraphStyle(
                        "cell-s", parent=st["cell"], fontSize=cell_size,
                        leading=cell_size * 1.35)
                    small_h = ParagraphStyle(
                        "cellh-s", parent=st["cellh"], fontSize=cell_size,
                        leading=cell_size * 1.35)
                    data = ([[Paragraph(c, small_h) for c in head]] if head else [])
                    for r in rows:
                        data.append([Paragraph(c, small) for c in r])
                    for r in data:
                        while len(r) < ncols:
                            r.append(Paragraph("", small))

                tbl = Table(data, colWidths=widths, repeatRows=1 if head else 0)
                style = [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ("LINEBELOW", (0, 0), (-1, -2), 0.4, LINE),
                    ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                ]
                if head:
                    style += [
                        ("BACKGROUND", (0, 0), (-1, 0), PAPER_SUNK),
                        ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK_3),
                    ]
                tbl.setStyle(TableStyle(style))
                story.append(tbl)
                story.append(Spacer(1, 10))
            i = j + 1
            continue

        if t.type in ("bullet_list_open", "ordered_list_open"):
            list_stack.append({"ordered": t.type.startswith("ordered"),
                               "items": []})
            i += 1
            continue

        if t.type in ("bullet_list_close", "ordered_list_close"):
            spec = list_stack.pop()
            items = spec["items"]
            if items:
                lf = ListFlowable(
                    [ListItem(x, leftIndent=12) for x in items],
                    bulletType="1" if spec["ordered"] else "bullet",
                    bulletFontName=BODY,
                    bulletFontSize=8,
                    start="1" if spec["ordered"] else None,
                    leftIndent=14,
                )
                if list_stack:
                    list_stack[-1]["items"].append(lf)
                else:
                    story.append(lf)
                    story.append(Spacer(1, 6))
            i += 1
            continue

        if t.type == "list_item_open":
            # Gather this item's paragraphs until its close.
            depth, j, parts = 1, i + 1, []
            while j < len(tokens) and depth:
                if tokens[j].type == "list_item_open":
                    depth += 1
                elif tokens[j].type == "list_item_close":
                    depth -= 1
                    if depth == 0:
                        break
                if tokens[j].type == "inline" and tokens[j].level >= t.level:
                    parts.append(inline_markup(tokens[j].children))
                    j += 1
                    continue
                j += 1
            if list_stack:
                text = " ".join(p for p in parts if p.strip())
                if text:
                    list_stack[-1]["items"].append(Paragraph(text, st["li"]))
            i = j + 1
            continue

        if t.type == "blockquote_open":
            list_stack.append({"quote": True, "items": []})
            i += 1
            continue

        if t.type == "blockquote_close":
            list_stack.pop()
            i += 1
            continue

        if t.type == "hr":
            story.append(Spacer(1, 6))
            story.append(HRFlowable(width="100%", thickness=0.6, color=LINE))
            story.append(Spacer(1, 10))
            i += 1
            continue

        i += 1

    return story


def convert(src: Path, out: Path) -> Path:
    register_fonts()
    st = styles()
    text = src.read_text(encoding="utf-8")

    title = next(
        (ln.lstrip("# ").strip() for ln in text.splitlines()
         if ln.startswith("# ")),
        src.stem,
    )

    out.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(out),
        pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
        title=clean_text(title),
        author="BreedVision",
    )

    def footer(canvas, doc_):
        canvas.saveState()
        canvas.setFont(BODY, 7.5)
        canvas.setFillColor(INK_3)
        canvas.drawString(20 * mm, 11 * mm, clean_text(title))
        canvas.drawRightString(A4[0] - 20 * mm, 11 * mm, str(doc_.page))
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.4)
        canvas.line(20 * mm, 14 * mm, A4[0] - 20 * mm, 14 * mm)
        canvas.restoreState()

    doc.build(build_story(text, st), onFirstPage=footer, onLaterPages=footer)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("sources", nargs="+", help="markdown files")
    ap.add_argument("--out", default=None,
                    help="output path (only valid with a single source)")
    ap.add_argument("--out-dir", default=None,
                    help="directory for outputs (default: alongside source)")
    args = ap.parse_args()

    if args.out and len(args.sources) > 1:
        print("ERROR: --out takes a single source file", file=sys.stderr)
        return 2

    for s in args.sources:
        src = Path(s)
        if not src.is_file():
            print(f"ERROR: not found: {src}", file=sys.stderr)
            return 2
        if args.out:
            out = Path(args.out)
        elif args.out_dir:
            out = Path(args.out_dir) / f"{src.stem}.pdf"
        else:
            out = src.with_suffix(".pdf")
        convert(src, out)
        size = out.stat().st_size / 1024
        print(f"{src}  ->  {out}  ({size:,.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
