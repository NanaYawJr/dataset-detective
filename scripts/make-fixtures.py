"""Generates the Excel and Parquet sample and test files.

These are written by real, widely used writers (openpyxl, XlsxWriter,
pyarrow, DuckDB) so the readers are tested against files as they occur in
practice. The outputs are committed, so this only needs running when the
fixtures change:

    pip install openpyxl XlsxWriter pyarrow duckdb
    python scripts/make-fixtures.py
"""

import csv
import datetime as dt
from pathlib import Path

import duckdb
import openpyxl
import pyarrow as pa
import pyarrow.parquet as pq
import xlsxwriter
from openpyxl.styles import Font

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "samples"
FIXTURES = ROOT / "src" / "lib" / "source" / "fixtures"
FIXED_TIME = dt.datetime(2026, 1, 1)


def read_sales():
    with open(SAMPLES / "sales-sample.csv", newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def day_first(text):
    return dt.datetime.strptime(text, "%d/%m/%Y").date()


def sales_parquet(rows):
    """The sales sample with proper types, as a database export would have."""
    table = pa.table(
        {
            "Order ID": pa.array([int(r["Order ID"]) for r in rows], pa.int64()),
            "Order Date": pa.array([day_first(r["Order Date"]) for r in rows], pa.date32()),
            "Ship Date": pa.array([day_first(r["Ship Date"]) for r in rows], pa.date32()),
            "Order Priority": [r["Order Priority"] for r in rows],
            "Order Quantity": pa.array([int(r["Order Quantity"]) for r in rows], pa.int32()),
            "Discount": pa.array([int(r["Discount"].rstrip("%")) / 100 for r in rows], pa.float64()),
            "Unit Price": pa.array([float(r["Unit Price"]) for r in rows], pa.float64()),
            "Profit": pa.array([float(r["Profit"]) for r in rows], pa.float64()),
            "Ship Mode": [r["Ship Mode"] for r in rows],
            "City | Region": [r["City | Region"] for r in rows],
            "Customer Segment": [r["Customer Segment"] for r in rows],
            "Customer Email": [r["Customer Email"] for r in rows],
        }
    )
    pq.write_table(table, SAMPLES / "sales-sample.parquet", compression="snappy")


def sales_xlsx(rows):
    """The sales sample as a workbook: a title above the header, real dates, a second sheet."""
    wb = xlsxwriter.Workbook(SAMPLES / "sales-sample.xlsx")
    wb.set_properties({"created": FIXED_TIME})
    date = wb.add_format({"num_format": "dd/mm/yyyy"})
    bold = wb.add_format({"bold": True})
    title = wb.add_format({"bold": True, "font_size": 14})

    orders = wb.add_worksheet("Orders")
    orders.merge_range(0, 0, 0, 5, "Sales extract — orders", title)
    orders.write(1, 0, "Source: sample data, generated")
    header = list(rows[0].keys())
    orders.write_row(3, 0, header, bold)
    for i, r in enumerate(rows, start=4):
        orders.write_number(i, 0, int(r["Order ID"]))
        orders.write_datetime(i, 1, day_first(r["Order Date"]), date)
        orders.write_datetime(i, 2, day_first(r["Ship Date"]), date)
        orders.write_string(i, 3, r["Order Priority"])
        orders.write_number(i, 4, int(r["Order Quantity"]))
        orders.write_string(i, 5, r["Discount"])
        orders.write_number(i, 6, float(r["Unit Price"]))
        orders.write_number(i, 7, float(r["Profit"]))
        for j, key in enumerate(header[8:], start=8):
            orders.write_string(i, j, r[key])

    regions = wb.add_worksheet("Regions")
    pairs = sorted({tuple(p.strip() for p in r["City | Region"].split("|")) for r in rows})
    regions.write_row(0, 0, ["City", "Region"], bold)
    for i, (city, region) in enumerate(pairs, start=1):
        regions.write_row(i, 0, [city, region])
    wb.close()


def types_parquet():
    """One of each kind of column, plus dates, amounts and codes held as text. Written by DuckDB with zstd."""
    out = FIXTURES / "types.parquet"
    duckdb.sql(
        f"""
        COPY (
          SELECT
            i::INTEGER AS id,
            (i * 1000000007)::BIGINT AS big,
            (i / 4.0)::DOUBLE AS ratio,
            (i * 1.25)::DECIMAL(10, 2) AS amount,
            i % 2 = 0 AS flag,
            DATE '2025-01-01' + i::INTEGER AS day,
            TIMESTAMP '2025-01-01 08:30:00' + INTERVAL (i) HOUR AS seen_at,
            CASE WHEN i % 5 = 0 THEN NULL ELSE 'name ' || i END AS label,
            strftime(DATE '2025-03-01' + i::INTEGER, '%Y-%m-%d') AS day_as_text,
            printf('%.2f', i * 12.5) AS price_as_text,
            printf('%05d', i) AS code,
            [i, i + 1] AS tags,
            {{'x': i, 'y': 'p' || i}} AS point
          FROM range(1, 41) t(i)
        ) TO '{out}' (FORMAT parquet, COMPRESSION zstd)
        """
    )


def openpyxl_workbook():
    """Title rows, a formula with no stored result, a merged cell, a hidden sheet."""
    wb = openpyxl.Workbook()
    notes = wb.active
    notes.title = "Notes"
    notes["A1"] = "Prepared by the finance team"

    ws = wb.create_sheet("Visits")
    ws["A1"] = "Clinic visits"
    ws["A1"].font = Font(bold=True)
    ws.merge_cells("A1:D1")
    ws.append([])
    ws.append(["Visit ID", "Seen", "Clinic & Site", "Minutes", "Cost"])
    for i in range(1, 31):
        ws.append([f"V{i:03}", dt.date(2025, 1, 1) + dt.timedelta(days=i * 3), f"Site <{i % 4}>", 10 + i, None])
        ws.cell(row=ws.max_row, column=5).value = f"=D{ws.max_row}*2.5"
    ws.cell(row=10, column=3).value = None

    hidden = wb.create_sheet("Lookup")
    hidden.append(["Code", "Meaning"])
    hidden.append(["A", "Attended"])
    hidden.sheet_state = "hidden"
    wb.save(FIXTURES / "openpyxl.xlsx")


def xlsxwriter_workbook():
    """Shared strings, date and date-time formats, a stored formula result, booleans, an error."""
    wb = xlsxwriter.Workbook(FIXTURES / "xlsxwriter.xlsx")
    wb.set_properties({"created": FIXED_TIME})
    date = wb.add_format({"num_format": "dd/mm/yyyy"})
    stamp = wb.add_format({"num_format": "yyyy-mm-dd hh:mm"})
    percent = wb.add_format({"num_format": "0%"})
    ws = wb.add_worksheet("Data")
    ws.write_row(0, 0, ["Ref", "When", "Logged", "Share", "Paid", "Total", "Status", "Note"])
    for i in range(1, 21):
        ws.write_string(i, 0, f"R{i}")
        ws.write_datetime(i, 1, dt.date(2026, 3, i), date)
        ws.write_datetime(i, 2, dt.datetime(2026, 3, i, 9, 15), stamp)
        ws.write_number(i, 3, i / 100, percent)
        ws.write_boolean(i, 4, i % 3 == 0)
        ws.write_formula(i, 5, f"=D{i + 1}*200", None, i * 2)
        ws.write_string(i, 6, "open" if i % 2 else "closed")
    ws.write_formula(3, 7, "=1/0", None, "#DIV/0!")
    ws.write_string(4, 7, 'He said "hi", then left')
    wb.close()

    wb = xlsxwriter.Workbook(FIXTURES / "date1904.xlsx", {"date_1904": True})
    wb.set_properties({"created": FIXED_TIME})
    date = wb.add_format({"num_format": "d mmm yyyy"})
    ws = wb.add_worksheet("Old Mac")
    ws.write_row(0, 0, ["Item", "Due"])
    for i in range(1, 6):
        ws.write_string(i, 0, f"Item {i}")
        ws.write_datetime(i, 1, dt.date(2025, 6, i), date)
    wb.close()


if __name__ == "__main__":
    FIXTURES.mkdir(parents=True, exist_ok=True)
    sales = read_sales()
    sales_parquet(sales)
    sales_xlsx(sales)
    types_parquet()
    openpyxl_workbook()
    xlsxwriter_workbook()
    print("Wrote samples and fixtures.")
