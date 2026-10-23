"""Generate a clearly fictional, scope-bound D5O document for local UI qualification."""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle


output = Path("output/pdf/d5o-fictional-support/north-as-built-v2.pdf")
output.parent.mkdir(parents=True, exist_ok=True)
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="PilotTitle", parent=styles["Heading1"], fontSize=16, leading=19, textColor=colors.HexColor("#10354a")))
styles.add(ParagraphStyle(name="PilotBody", parent=styles["BodyText"], fontSize=9, leading=13, spaceAfter=5))
styles.add(ParagraphStyle(name="PilotSmall", parent=styles["BodyText"], fontSize=7.7, leading=11, textColor=colors.HexColor("#365066")))


def p(value, style="PilotBody"):
    return Paragraph(value, styles[style])


def table(rows, widths):
    result = Table([[p(str(cell), "PilotSmall") for cell in row] for row in rows], colWidths=widths, repeatRows=1, hAlign="LEFT")
    result.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e6eff4")),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#b4c4ce")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return result


story = [
    p("FICTIONAL PILOT - SIMULATED AS-BUILT", "PilotTitle"),
    p("North-zone controls route and label record - revision 2"),
    p("<b>Not a field-verified Rybex or customer document.</b> Coordinates, labels, inspection observations and signers below are invented solely to exercise document custody and independent review in the disposable prototype."),
    Spacer(1, 4),
    table([
        ("Exact source", "Fictional pilot reference"),
        ("Work", "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5"),
        ("Package", "wp-25c4b286f2454f01915a588c345cce03 - North-zone controls"),
        ("Issued Design release", "3bc43e3c-eb6d-4cc0-a65f-f6165e6880d0, revision 3"),
        ("Accepted turnover", "26241096-02c1-4699-8bdc-759f5d83a426, revision 1"),
        ("Whole-work acceptance", "360aee71-9da7-4112-8ae8-86d564adf54e, revision 1"),
        ("Related retained inspection", "628fd6d5-f2bf-4432-af27-0312b7c87d5a (fictional North inspection)"),
    ], [1.45 * inch, 5.15 * inch]),
    Spacer(1, 7),
    p("Simulated installed route", "Heading2"),
    p("All locations use this document's fictional North-zone grid, measured in metres from the simulated northwest room corner. This local grid is <b>not</b> a survey, CAD coordinate system or real site measurement."),
    table([
        ("Segment", "From / to", "Grid route", "Method / condition"),
        ("N-01", "Rack N-RK-01 / junction N-JB-01", "(1.2, 2.0) to (4.5, 2.0); elevation 2.7", "Overhead tray T-N1; simulated visual inspection clear"),
        ("N-02", "Junction N-JB-01 / panel N-CP-01", "(4.5, 2.0) to (4.5, 6.4); elevation 2.7 to 1.5", "Conduit C-N2; simulated bend and support check recorded"),
        ("N-03", "Panel N-CP-01 / device N-DV-01", "(4.5, 6.4) to (7.1, 6.4); elevation 1.5", "Conduit C-N3; simulated final device entry check recorded"),
    ], [0.7 * inch, 1.55 * inch, 2.1 * inch, 2.25 * inch]),
    Spacer(1, 7),
    p("Simulated label schedule", "Heading2"),
    table([
        ("Cable / point", "Origin label", "Destination label", "Verification reference"),
        ("NC-001 / control point 1", "N-RK-01:TB1:01", "N-CP-01:TB1:01", "Fictional continuity record FI-N-01, pass"),
        ("NC-002 / control point 2", "N-RK-01:TB1:02", "N-CP-01:TB1:02", "Fictional continuity record FI-N-02, pass"),
        ("NC-003 / alarm point", "N-CP-01:TB2:03", "N-DV-01:ALM", "Fictional retest FI-N-03, pass after correction"),
    ], [1.45 * inch, 1.45 * inch, 1.55 * inch, 2.15 * inch]),
    Spacer(1, 7),
    p("Simulated supplier verification and limits", "Heading2"),
    p("Fictional field supervisor: Pilot North Supervisor. Simulated check: route segments, labels and the corrected alarm terminal were compared with the fictional North inspection record for this exercise. No real site visit, measurement or customer approval occurred."),
    p("This revision supersedes the returned index evidence ae4bdd50-1a34-4ebd-bdf3-3e1bfebdf62f only as a proposed support-document version. The D5O upload and independent Operations decision determine its prototype custody and review status; this PDF alone grants no authority."),
]

doc = SimpleDocTemplate(str(output), pagesize=letter, rightMargin=0.7 * inch,
                        leftMargin=0.7 * inch, topMargin=0.5 * inch, bottomMargin=0.5 * inch)
doc.build(story)
print(output)
