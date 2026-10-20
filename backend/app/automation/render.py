"""What a subscription sends: one report rendered for each channel.

Email gets an HTML page (tables and bar lists drawn with HTML tables, so every mail
client shows them; no images, no scripts) plus a plain-text part. Slack, Teams and
Telegram get a short text with headline numbers and the first rows; a generic
webhook gets the data as JSON. Results can be attached as CSV or Excel.

Every value from the database is escaped: a cell like "<script>" arrives as text.
"""

from __future__ import annotations

import csv
import io
import math
from dataclasses import dataclass, field
from html import escape
from typing import Any

from ..query.xlsx import write_xlsx
from ..results import ResultColumn, ResultEnvelope

CHART_BARS = {"bar", "line", "area", "combo", "pie", "funnel", "histogram"}
TIME_SERIES = {"line", "area", "combo"}
MAX_TABLE_COLUMNS = 8
MAX_TEXT_COLUMNS = 5
BRAND = "#4f46e5"


@dataclass
class CardOut:
    title: str
    kind: str = "question"                 # question | text | heading
    result: ResultEnvelope | None = None
    error: str | None = None
    viz: dict[str, Any] | None = None      # the card's (or question's) viz state {"mode", "spec"}
    url: str | None = None
    text: str | None = None


@dataclass
class Report:
    title: str
    subtitle: str = ""
    url: str | None = None
    cards: list[CardOut] = field(default_factory=list)
    rows_per_card: int = 10
    alert_note: str | None = None          # "Alert: 12 rows" etc.
    footer: str = ""


# ---------------------------------------------------------------- values

def _number(v: float, fmt: dict[str, Any] | None, compact: bool = False) -> str:
    fmt = fmt or {}
    style = fmt.get("style")
    decimals = fmt.get("decimals")
    if style == "percent":
        value = v * 100 if fmt.get("percentIsFraction", True) else v
        d = 1 if decimals is None else int(decimals)
        return f"{fmt.get('prefix', '')}{value:,.{d}f} %{fmt.get('suffix', '')}"
    if compact or fmt.get("compact"):
        for size, unit in ((1e12, "T"), (1e9, "B"), (1e6, "M"), (1e3, "K")):
            if abs(v) >= size:
                text = f"{v / size:,.1f}".rstrip("0").rstrip(".") + unit
                break
        else:
            text = f"{v:,.{2 if v % 1 else 0}f}" if decimals is None else f"{v:,.{int(decimals)}f}"
    elif decimals is not None:
        text = f"{v:,.{int(decimals)}f}"
    elif isinstance(v, int) or float(v).is_integer():
        text = f"{int(v):,}"
    else:
        text = f"{v:,.2f}".rstrip("0").rstrip(".") if abs(v) >= 1 else f"{v:.4g}"
    if style == "currency":
        if decimals is None and not compact and not fmt.get("compact"):
            text = f"{v:,.2f}"  # money keeps its cents
        cur = fmt.get("currency") or ""
        return f"{fmt.get('prefix', '')}{text} {cur}".strip() + fmt.get("suffix", "")
    return f"{fmt.get('prefix', '')}{text}{fmt.get('suffix', '')}"


def format_value(value: Any, col: ResultColumn | None, fmt: dict[str, Any] | None = None, compact: bool = False) -> str:
    if value is None:
        return "—"
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return "—"
        return _number(value, fmt if fmt is not None else (col.format if col else None), compact)
    text = str(value)
    if col is not None and col.type == "date":
        return text[:10]
    if col is not None and col.type == "datetime":
        return text.replace("T", " ")[:16]
    return text


def label(col: ResultColumn) -> str:
    return col.display_name or col.name.replace("_", " ").strip().capitalize()


# ---------------------------------------------------------------- shapes

def _spec(card: CardOut) -> dict[str, Any] | None:
    viz = card.viz or {}
    if viz.get("mode") == "table":
        return {"type": "table"}
    spec = viz.get("spec")
    return spec if isinstance(spec, dict) else None


def _col(result: ResultEnvelope, name: str | None) -> int | None:
    if not name:
        return None
    for i, c in enumerate(result.columns):
        if c.name == name:
            return i
    return None


def _first(result: ResultEnvelope, role: str) -> int | None:
    for i, c in enumerate(result.columns):
        if (role == "measure") == (c.type == "number" and c.role == "measure"):
            return i
    return None


def shape(card: CardOut) -> tuple[str, dict[str, Any]]:
    """("kpi", {...}) | ("bars", {...}) | ("table", {}) for a question card with a result."""
    result = card.result
    assert result is not None
    spec = _spec(card) or {}
    kind = spec.get("type")
    fmt_of = spec.get("format") or {}
    numeric = [i for i, c in enumerate(result.columns) if c.type == "number"]
    if not result.rows:
        return "table", {}
    if kind in ("kpi", "gauge") or (kind is None and len(result.rows) == 1 and len(result.columns) == 1 and numeric):
        i = _col(result, spec.get("value")) if spec.get("value") else None
        i = i if i is not None else (numeric[0] if numeric else 0)
        value = result.rows[-1][i]
        previous = result.rows[-2][i] if len(result.rows) > 1 else None
        return "kpi", {"index": i, "value": value, "previous": previous, "format": fmt_of.get(result.columns[i].name)}
    if kind in CHART_BARS or (kind is None and len(result.columns) == 2 and len(numeric) == 1 and numeric[0] == 1):
        x = _col(result, spec.get("x"))
        series = spec.get("series") or []
        y = _col(result, series[0].get("y") if series and isinstance(series[0], dict) else None) or _col(result, spec.get("value"))
        x = x if x is not None else _first(result, "dimension")
        y = y if y is not None else _first(result, "measure")
        if x is not None and y is not None and x != y and not spec.get("breakout"):
            return "bars", {"x": x, "y": y, "time": kind in TIME_SERIES, "format": fmt_of.get(result.columns[y].name)}
    return "table", {}


def bar_rows(result: ResultEnvelope, info: dict[str, Any], limit: int) -> list[tuple[str, Any]]:
    rows = [(r[info["x"]], r[info["y"]]) for r in result.rows]
    if info["time"]:
        rows = rows[-limit:]
    else:
        rows = rows[:limit]
    return [("(empty)" if x is None else format_value(x, result.columns[info["x"]]), y) for x, y in rows]


def _change(value: Any, previous: Any) -> str | None:
    if not isinstance(value, (int, float)) or not isinstance(previous, (int, float)) or not previous:
        return None
    pct = (value - previous) / abs(previous) * 100
    return f"{'▲' if pct >= 0 else '▼'} {abs(pct):.1f} % vs. previous"


# ---------------------------------------------------------------- email

def _td(text: str, *, head: bool = False, right: bool = False) -> str:
    tag = "th" if head else "td"
    style = (
        "padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;"
        + ("text-align:right;" if right else "text-align:left;")
        + ("background:#f3f4f6;color:#374151;font-weight:600;" if head else "color:#111827;")
    )
    return f'<{tag} style="{style}">{escape(text)}</{tag}>'


def _email_card(card: CardOut, rows_per_card: int) -> str:
    title = escape(card.title)
    if card.kind == "heading":
        return f'<h2 style="margin:28px 0 8px;font-size:18px;color:#111827">{title}</h2>'
    if card.kind == "text":
        body = escape(card.text or "").replace("\n", "<br>")
        return f'<p style="margin:12px 0;font-size:14px;color:#374151;line-height:1.5">{body}</p>'
    link = f' <a href="{escape(card.url)}" style="font-size:12px;color:{BRAND};text-decoration:none">open ›</a>' if card.url else ""
    head = f'<div style="font-size:15px;font-weight:600;color:#111827;margin:0 0 8px">{title}{link}</div>'
    box = 'style="margin:0 0 18px;padding:14px 16px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff"'
    if card.error:
        return f'<div {box}>{head}<div style="color:#b91c1c;font-size:13px">{escape(card.error)}</div></div>'
    result = card.result
    if result is None:
        return ""
    kind, info = shape(card)
    if not result.rows:
        return f'<div {box}>{head}<div style="color:#6b7280;font-size:13px">No rows.</div></div>'
    if kind == "kpi":
        col = result.columns[info["index"]]
        value = format_value(info["value"], col, info["format"])
        change = _change(info["value"], info["previous"])
        sub = f'<div style="font-size:12px;color:#6b7280;margin-top:4px">{escape(change)}</div>' if change else ""
        return f'<div {box}>{head}<div style="font-size:32px;font-weight:700;color:#111827">{escape(value)}</div>{sub}</div>'
    if kind == "bars":
        items = bar_rows(result, info, rows_per_card)
        numbers = [abs(v) for _, v in items if isinstance(v, (int, float))]
        top = max(numbers) if numbers else 0
        ycol = result.columns[info["y"]]
        lines = []
        for x, y in items:
            width = int(round(abs(y) / top * 100)) if top and isinstance(y, (int, float)) else 0
            # a div with a percentage width inside a fixed-width cell: drawn by every mail client we know
            bar = (f'<div style="width:{max(width, 1)}%;background:{BRAND};height:12px;line-height:12px;'
                   f'font-size:1px;border-radius:3px">&nbsp;</div>') if width else ""
            lines.append(
                f'<tr><td width="32%" style="width:32%;padding:3px 8px 3px 0;font-size:13px;color:#374151">{escape(x)}</td>'
                f'<td width="50%" style="width:50%;padding:3px 0">{bar}</td>'
                f'<td width="18%" style="width:18%;padding:3px 0 3px 8px;font-size:13px;color:#111827;text-align:right;white-space:nowrap">'
                f'{escape(format_value(y, ycol, info["format"]))}</td></tr>'
            )
        more = _more(len(result.rows) - len(items), card.url)
        return (f'<div {box}>{head}<div style="font-size:12px;color:#6b7280;margin-bottom:6px">{escape(label(ycol))}</div>'
                f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0">{"".join(lines)}</table>{more}</div>')
    cols = list(range(min(len(result.columns), MAX_TABLE_COLUMNS)))
    header = "".join(_td(label(result.columns[i]), head=True, right=result.columns[i].type == "number") for i in cols)
    body = "".join(
        "<tr>" + "".join(_td(format_value(row[i], result.columns[i]), right=result.columns[i].type == "number") for i in cols) + "</tr>"
        for row in result.rows[:rows_per_card]
    )
    hidden = len(result.columns) - len(cols)
    note = f'<div style="font-size:12px;color:#6b7280;margin-top:6px">{hidden} more column{"s" if hidden > 1 else ""} in Ncode.</div>' if hidden else ""
    more = _more(len(result.rows) - min(len(result.rows), rows_per_card), card.url)
    return (f'<div {box}>{head}<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%">'
            f'<tr>{header}</tr>{body}</table>{note}{more}</div>')


def _more(hidden: int, url: str | None) -> str:
    if hidden <= 0:
        return ""
    text = f"{hidden:,} more row{'s' if hidden > 1 else ''}"
    if url:
        return f'<div style="font-size:12px;margin-top:6px"><a href="{escape(url)}" style="color:{BRAND}">{text} in Ncode</a></div>'
    return f'<div style="font-size:12px;color:#6b7280;margin-top:6px">{text}.</div>'


def email_html(report: Report) -> str:
    cards = "".join(_email_card(c, report.rows_per_card) for c in report.cards)
    alert = (f'<div style="margin:0 0 16px;padding:10px 14px;border-radius:8px;background:#fef3c7;color:#92400e;font-size:14px">'
             f'{escape(report.alert_note)}</div>') if report.alert_note else ""
    title = escape(report.title)
    if report.url:
        title = f'<a href="{escape(report.url)}" style="color:#111827;text-decoration:none">{title}</a>'
    button = (f'<p style="margin:20px 0"><a href="{escape(report.url)}" style="display:inline-block;padding:9px 16px;'
              f'background:{BRAND};color:#ffffff;border-radius:8px;text-decoration:none;font-size:14px">Open in Ncode</a></p>') if report.url else ""
    return (
        '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
        f"<title>{escape(report.title)}</title></head>"
        '<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px"><tr><td>'
        f'<h1 style="margin:0 0 4px;font-size:22px;color:#111827">{title}</h1>'
        f'<div style="margin:0 0 18px;font-size:13px;color:#6b7280">{escape(report.subtitle)}</div>'
        f"{alert}{cards}{button}"
        f'<div style="margin-top:24px;font-size:11px;color:#9ca3af">{escape(report.footer)}</div>'
        "</td></tr></table></td></tr></table></body></html>"
    )


# ---------------------------------------------------------------- plain text (email text part, chat apps)

def text_table(result: ResultEnvelope, rows: int, max_cols: int = MAX_TEXT_COLUMNS, width: int = 22) -> str:
    cols = list(range(min(len(result.columns), max_cols)))
    cells = [[label(result.columns[i])[:width] for i in cols]]
    for row in result.rows[:rows]:
        cells.append([format_value(row[i], result.columns[i])[:width] for i in cols])
    widths = [max(len(r[j]) for r in cells) for j in range(len(cols))]
    lines = []
    for n, r in enumerate(cells):
        lines.append("  ".join(
            v.rjust(widths[j]) if result.columns[cols[j]].type == "number" else v.ljust(widths[j]) for j, v in enumerate(r)
        ).rstrip())
        if n == 0:
            lines.append("  ".join("-" * w for w in widths))
    return "\n".join(lines)


def card_text(card: CardOut, rows: int) -> tuple[str, str | None]:
    """(headline, monospaced block or None) for one question card."""
    if card.error:
        return f"⚠ {card.error}", None
    result = card.result
    if result is None:
        return "", None
    if not result.rows:
        return "No rows.", None
    kind, info = shape(card)
    if kind == "kpi":
        col = result.columns[info["index"]]
        change = _change(info["value"], info["previous"])
        return format_value(info["value"], col, info["format"]) + (f"  ({change})" if change else ""), None
    if kind == "bars":
        items = bar_rows(result, info, rows)
        ycol = result.columns[info["y"]]
        w = max(len(x[:24]) for x, _ in items)
        block = "\n".join(f"{x[:24].ljust(w)}  {format_value(y, ycol, info['format'])}" for x, y in items)
        more = len(result.rows) - len(items)
        return label(ycol) + (f" ({more} more rows)" if more > 0 else ""), block
    more = len(result.rows) - min(len(result.rows), rows)
    return (f"{len(result.rows):,} rows" + (f", first {rows}" if more > 0 else "")), text_table(result, rows)


def plain_text(report: Report) -> str:
    out = [report.title, report.subtitle, ""]
    if report.alert_note:
        out += [report.alert_note, ""]
    for card in report.cards:
        if card.kind == "heading":
            out += ["", card.title.upper(), ""]
            continue
        if card.kind == "text":
            out += [card.text or "", ""]
            continue
        headline, block = card_text(card, report.rows_per_card)
        out.append(f"{card.title}: {headline}")
        if block:
            out += [block]
        if card.url:
            out.append(card.url)
        out.append("")
    if report.url:
        out.append(f"Open in Ncode: {report.url}")
    out += ["", report.footer]
    return "\n".join(out)


# ---------------------------------------------------------------- chat apps and webhooks

def _trim(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def slack_payload(report: Report) -> dict[str, Any]:
    def md(text: str) -> str:  # Slack escapes only these three
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    blocks: list[dict[str, Any]] = [{"type": "header", "text": {"type": "plain_text", "text": _trim(report.title, 150)}}]
    if report.alert_note:
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": f":bell: {md(report.alert_note)}"}})
    for card in report.cards:
        if len(blocks) >= 45:
            break
        if card.kind == "heading":
            blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": f"*{md(card.title)}*"}})
            continue
        if card.kind == "text":
            if card.text:
                blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": _trim(md(card.text), 2900)}})
            continue
        headline, block = card_text(card, report.rows_per_card)
        title = f"<{card.url}|{md(card.title)}>" if card.url else md(card.title)
        text = f"*{title}*\n{md(headline)}"
        if block:
            text += f"\n```{md(block)}```"
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": _trim(text, 2900)}})
    if report.url:
        blocks.append({"type": "actions", "elements": [{"type": "button", "text": {"type": "plain_text", "text": "Open in Ncode"}, "url": report.url}]})
    return {"text": _trim(report.title + (f" - {report.alert_note}" if report.alert_note else ""), 3000), "blocks": blocks}


def teams_payload(report: Report) -> dict[str, Any]:
    """An Adaptive Card for a Teams 'Workflows' (Power Automate) webhook."""
    body: list[dict[str, Any]] = [{"type": "TextBlock", "text": report.title, "weight": "Bolder", "size": "Large", "wrap": True}]
    if report.subtitle:
        body.append({"type": "TextBlock", "text": report.subtitle, "isSubtle": True, "spacing": "None", "wrap": True})
    if report.alert_note:
        body.append({"type": "TextBlock", "text": report.alert_note, "color": "Warning", "wrap": True})
    for card in report.cards:
        if card.kind == "heading":
            body.append({"type": "TextBlock", "text": card.title, "weight": "Bolder", "size": "Medium", "wrap": True, "separator": True})
            continue
        if card.kind == "text":
            if card.text:
                body.append({"type": "TextBlock", "text": _trim(card.text, 2000), "wrap": True})
            continue
        headline, block = card_text(card, report.rows_per_card)
        body.append({"type": "TextBlock", "text": card.title, "weight": "Bolder", "wrap": True, "separator": True})
        body.append({"type": "TextBlock", "text": headline, "wrap": True, "spacing": "None"})
        if block:
            body.append({"type": "TextBlock", "text": _trim(block, 3000), "fontType": "Monospace", "wrap": True, "size": "Small"})
    content: dict[str, Any] = {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json", "type": "AdaptiveCard", "version": "1.4", "body": body,
    }
    if report.url:
        content["actions"] = [{"type": "Action.OpenUrl", "title": "Open in Ncode", "url": report.url}]
    return {"type": "message", "attachments": [{"contentType": "application/vnd.microsoft.card.adaptive", "content": content}]}


def telegram_text(report: Report) -> str:
    """Telegram's HTML subset (b, i, a, pre), at most 4096 characters."""
    out = [f"<b>{escape(report.title)}</b>"]
    if report.alert_note:
        out.append(f"🔔 {escape(report.alert_note)}")
    for card in report.cards:
        if card.kind == "heading":
            out.append(f"\n<b>{escape(card.title.upper())}</b>")
            continue
        if card.kind == "text":
            if card.text:
                out.append(escape(_trim(card.text, 500)))
            continue
        headline, block = card_text(card, report.rows_per_card)
        title = f'<a href="{escape(card.url)}">{escape(card.title)}</a>' if card.url else escape(card.title)
        out.append(f"\n<b>{title}</b>\n{escape(headline)}")
        if block:
            out.append(f"<pre>{escape(_trim(block, 1500))}</pre>")
    if report.url:
        out.append(f'\n<a href="{escape(report.url)}">Open in Ncode</a>')
    text = "\n".join(out)
    if len(text) > 4000:  # never cut inside a tag: fall back to the headlines only
        text = "\n".join(line for line in out if not line.startswith("<pre>"))[:4000]
    return text


def webhook_payload(report: Report, event: dict[str, Any]) -> dict[str, Any]:
    cards = []
    for card in report.cards:
        if card.kind != "question":
            continue
        item: dict[str, Any] = {"title": card.title, "url": card.url, "error": card.error}
        if card.result is not None:
            item.update(
                columns=[{"name": c.name, "type": c.type} for c in card.result.columns],
                rows=card.result.rows[: report.rows_per_card],
                row_count=card.result.stats.row_count,
                truncated=card.result.stats.truncated or card.result.stats.row_count > report.rows_per_card,
            )
        cards.append(item)
    return {**event, "title": report.title, "url": report.url, "alert": report.alert_note, "cards": cards}


# ---------------------------------------------------------------- attachments

def csv_bytes(result: ResultEnvelope) -> bytes:
    """Semicolon-separated with a BOM, like the CSV download: Excel opens it directly."""
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";", lineterminator="\r\n")
    writer.writerow([_safe_cell(c.name) for c in result.columns])
    for row in result.rows:
        writer.writerow(["" if v is None else _safe_cell(v) for v in row])
    return ("﻿" + buf.getvalue()).encode("utf-8")


def _safe_cell(v: Any) -> Any:
    """A text cell starting with = + - @ would run as a formula in a spreadsheet."""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v
    return v


def xlsx_bytes(result: ResultEnvelope, sheet: str) -> bytes:
    buf = io.BytesIO()
    write_xlsx(result, buf, sheet_name=_sheet_name(sheet))
    return buf.getvalue()


def _sheet_name(title: str) -> str:
    return "".join(ch for ch in title if ch not in "[]:*?/\\")[:31] or "Result"


def safe_filename(title: str) -> str:
    keep = "".join(ch if ch.isalnum() or ch in " -_." else "_" for ch in title).strip(" ._")
    return (keep or "result")[:80]


def attachments(report: Report, fmt: str) -> list[tuple[str, bytes, str]]:
    out: list[tuple[str, bytes, str]] = []
    used: set[str] = set()
    for card in report.cards:
        if card.kind != "question" or card.result is None:
            continue
        name = safe_filename(card.title)
        base, n = name, 2
        while name.lower() in used:
            name, n = f"{base} ({n})", n + 1
        used.add(name.lower())
        if fmt == "xlsx":
            out.append((f"{name}.xlsx", xlsx_bytes(card.result, card.title),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
        else:
            out.append((f"{name}.csv", csv_bytes(card.result), "text/csv"))
    return out
