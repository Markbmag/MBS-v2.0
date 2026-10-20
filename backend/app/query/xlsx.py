"""Excel export of a result envelope (xlsxwriter, constant memory: rows are written
and flushed one by one, so even the largest allowed result stays small in memory).

Cells keep their type: numbers are numbers, dates and date-times are real Excel
dates, booleans are TRUE/FALSE. Text that a spreadsheet would run as a formula
(=, +, -, @) is written as plain text, never as a formula.
"""

from __future__ import annotations

import datetime as dt
import tempfile
from typing import IO, Any, Iterator

import xlsxwriter

from ..results import ResultEnvelope

CHUNK = 64 * 1024
MAX_COL_WIDTH = 60


def _date(value: Any, with_time: bool) -> dt.datetime | dt.date | None:
    if not isinstance(value, str):
        return None
    text = value.strip().replace("Z", "+00:00")
    try:
        parsed = dt.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.replace(tzinfo=None)  # Excel has no time zones
    return parsed if with_time else parsed.date()


def write_xlsx(result: ResultEnvelope, out: IO[bytes], sheet_name: str = "Result") -> None:
    workbook = xlsxwriter.Workbook(out, {"constant_memory": True, "strings_to_formulas": False, "strings_to_urls": False})
    sheet = workbook.add_worksheet(sheet_name[:31] or "Result")
    header = workbook.add_format({"bold": True, "bg_color": "#EEF0FB", "border": 0})
    date_fmt = workbook.add_format({"num_format": "yyyy-mm-dd"})
    datetime_fmt = workbook.add_format({"num_format": "yyyy-mm-dd hh:mm:ss"})

    widths = [min(MAX_COL_WIDTH, max(8, len(c.name) + 2)) for c in result.columns]
    for col, column in enumerate(result.columns):
        sheet.write_string(0, col, column.name, header)
    for r, row in enumerate(result.rows, start=1):
        for col, value in enumerate(row):
            if value is None:
                continue
            kind = result.columns[col].type
            if isinstance(value, bool):
                sheet.write_boolean(r, col, value)
            elif isinstance(value, (int, float)):
                sheet.write_number(r, col, value)
            elif kind in ("date", "datetime") and (parsed := _date(value, kind == "datetime")) is not None:
                if isinstance(parsed, dt.datetime):
                    sheet.write_datetime(r, col, parsed, datetime_fmt)
                else:
                    sheet.write_datetime(r, col, dt.datetime.combine(parsed, dt.time()), date_fmt)
            else:
                text = value if isinstance(value, str) else str(value)
                sheet.write_string(r, col, text)  # never a formula, whatever it starts with
                widths[col] = min(MAX_COL_WIDTH, max(widths[col], len(text) + 2))
    for col, width in enumerate(widths):
        sheet.set_column(col, col, width)
    sheet.freeze_panes(1, 0)
    if result.columns:
        sheet.autofilter(0, 0, max(1, len(result.rows)), len(result.columns) - 1)
    workbook.close()


def xlsx_stream(result: ResultEnvelope) -> Iterator[bytes]:
    """Build the workbook in a temporary file (memory below 1 MB, spills to disk) and stream it."""
    with tempfile.SpooledTemporaryFile(max_size=1024 * 1024) as tmp:
        write_xlsx(result, tmp)
        tmp.seek(0)
        while chunk := tmp.read(CHUNK):
            yield chunk
