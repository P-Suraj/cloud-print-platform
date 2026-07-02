import os
import sys
import glob
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image, KeepTogether, HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super(NumberedCanvas, self).__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super(NumberedCanvas, self).showPage()
        super(NumberedCanvas, self).save()

    def draw_page_decorations(self, page_count):
        self.saveState()
        # Header banner (deep indigo strip)
        self.setFillColor(colors.HexColor('#1E1B4B'))
        self.rect(0, 792 - 8, 612, 8, fill=True, stroke=False)
        
        # Footer text
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor('#64748B'))
        self.drawString(54, 25, "AutoPrint - Customer Self-Service Printer Setup Guide")
        
        page_text = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(612 - 54, 25, page_text)
        
        # Line above footer
        self.setStrokeColor(colors.HexColor('#E2E8F0'))
        self.setLineWidth(0.5)
        self.line(54, 38, 612 - 54, 38)
        self.restoreState()

def create_guide_pdf(filename="AutoPrint_Shopkeeper_Guide.pdf"):
    # Target letter size, 0.75-inch margins (54 points)
    doc = SimpleDocTemplate(
        filename,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=45,
        bottomMargin=50
    )
    
    # Locate screenshots
    artifacts_dir = r"C:\Users\Suraj Pandavula\.gemini\antigravity-ide\brain\be4a1105-e76c-44a2-8c2c-ce02736b0b75"
    
    def get_latest_screenshot(pattern_name):
        matches = glob.glob(os.path.join(artifacts_dir, f"{pattern_name}_*.png"))
        if matches:
            # Sort by filename timestamp (newest first)
            matches.sort(reverse=True)
            return matches[0]
        return None

    cust_portal_path = get_latest_screenshot("customer_portal")
    dashboard_path = get_latest_screenshot("shop_dashboard")
    console_path = get_latest_screenshot("shop_console")
    rates_path = get_latest_screenshot("shop_rates")

    styles = getSampleStyleSheet()
    
    # Color system matching the app
    primary_color = colors.HexColor('#06B6D4') # Cyan accent
    dark_slate = colors.HexColor('#0F172A')
    slate_text = colors.HexColor('#334155')
    
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=22,
        leading=26,
        textColor=dark_slate,
        spaceAfter=4
    )
    
    subtitle_style = ParagraphStyle(
        'DocSubTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=11,
        leading=14,
        textColor=colors.HexColor('#0891B2'),
        spaceAfter=12
    )
    
    h1_style = ParagraphStyle(
        'SectionHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=13,
        leading=17,
        textColor=dark_slate,
        spaceBefore=10,
        spaceAfter=6,
        keepWithNext=True
    )
    
    body_style = ParagraphStyle(
        'BodyTextCustom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=13,
        textColor=slate_text,
        spaceAfter=6
    )
    
    bullet_style = ParagraphStyle(
        'BulletText',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=13,
        textColor=slate_text,
        leftIndent=12,
        firstLineIndent=-8,
        spaceAfter=4
    )

    note_style = ParagraphStyle(
        'NoteText',
        parent=styles['Normal'],
        fontName='Helvetica-Oblique',
        fontSize=8.5,
        leading=12,
        textColor=colors.HexColor('#475569')
    )

    story = []
    
    # ── Page 1: Header ──
    story.append(Paragraph("AutoPrint Kiosk Setup & Support", subtitle_style))
    story.append(Paragraph("Shopkeeper Operating Guide", title_style))
    story.append(HRFlowable(width="100%", thickness=2, color=primary_color, spaceAfter=10))
    
    story.append(Paragraph("Welcome! AutoPrint allows customers to upload PDFs and print directly at your shop. Follow this simple guide to understand the system.", body_style))
    story.append(Spacer(1, 5))
    
    # ── Row 1: Customer Upload Portal ──
    portal_desc = []
    portal_desc.append(Paragraph("How Customers Upload PDFs", h1_style))
    portal_desc.append(Paragraph("1. Customer scans the <b>Counter QR Code</b> using their phone camera.", bullet_style))
    portal_desc.append(Paragraph("2. They select a PDF file from WhatsApp, Downloads, or Documents.", bullet_style))
    portal_desc.append(Paragraph("3. They choose number of <b>Copies</b>, color mode (<b>Black & White</b> or <b>Color</b>), and page sides (<b>Single</b> or <b>Double</b> side).", bullet_style))
    portal_desc.append(Paragraph("4. They click <b>Print</b> to send it to your queue.", bullet_style))
    
    portal_img = Paragraph("<i>[No Screenshot Found]</i>", body_style)
    if cust_portal_path:
        portal_img = Image(cust_portal_path, width=220, height=132)
        
    row1_table = Table([[portal_desc, portal_img]], colWidths=[264, 240])
    row1_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING', (0,0), (-1,0), 10),
        ('LEFTPADDING', (1,0), (1,0), 10),
    ]))
    story.append(row1_table)
    
    # ── Row 2: Desktop Agent Client Setup ──
    agent_desc = []
    agent_desc.append(Paragraph("Windows Desktop Program Setup", h1_style))
    agent_desc.append(Paragraph("The program on your computer connects your physical printer (Epson, HP, Canon, etc.) to the online customer queue.", bullet_style))
    agent_desc.append(Paragraph("• <b>Keep it running:</b> Make sure <b>AutoPrint.exe</b> is open. Look for the small icon in the bottom-right Windows taskbar tray.", bullet_style))
    agent_desc.append(Paragraph("• <b>Check System light:</b>", bullet_style))
    agent_desc.append(Paragraph("  - <font color='#10B981'><b>Green light:</b></font> Active and ready to print.", bullet_style))
    agent_desc.append(Paragraph("  - <font color='#3B82F6'><b>Blue light:</b></font> Currently printing a file.", bullet_style))
    agent_desc.append(Paragraph("  - <font color='#EF4444'><b>Red light:</b></font> Error! Check internet or if printer is offline.", bullet_style))
    agent_desc.append(Paragraph("• <b>Set Printer:</b> Right-click the tray icon, click <b>Configure</b>, and choose your physical printer name.", bullet_style))
    
    # Simple table instead of image for program installation since installer has no active screenshot
    agent_info_data = [
        [
            Paragraph("<b>Desktop Program Quick Checklist:</b><br/>"
                      "1. Make sure your computer is connected to the internet.<br/>"
                      "2. Ensure your physical printer has paper and ink.<br/>"
                      "3. Keep the PC awake (turn off sleep mode in Windows settings so printing doesn't stop).", note_style)
        ]
    ]
    agent_info_table = Table(agent_info_data, colWidths=[220])
    agent_info_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#F8FAFC')),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E1')),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING', (0,0), (-1,-1), 10),
    ]))
    
    row2_table = Table([[agent_desc, agent_info_table]], colWidths=[264, 240])
    row2_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING', (0,0), (-1,0), 10),
        ('LEFTPADDING', (1,0), (1,0), 10),
    ]))
    story.append(row2_table)
    
    story.append(PageBreak()) # ── Move to Page 2 ──
    
    # ── Row 3: Shop Dashboard & Print Modes ──
    dash_desc = []
    dash_desc.append(Paragraph("Shopkeeper Dashboard", h1_style))
    dash_desc.append(Paragraph("Open the web dashboard on your phone or computer to manage operations:", bullet_style))
    dash_desc.append(Paragraph("• <b>Print Mode Toggle:</b> Switch between two modes:", bullet_style))
    dash_desc.append(Paragraph("  - <b>Manual Mode (Recommended):</b> Each print request waits for you. Collect money first, then print. Saves paper from wasted prints.", bullet_style))
    dash_desc.append(Paragraph("  - <b>Auto Mode:</b> Prints are spooled instantly. Good if you are busy.", bullet_style))
    dash_desc.append(Paragraph("• <b>Agent Status:</b> Shows <b>Agent Online</b> or <b>Agent Offline</b> (heartbeat updates every 20s).", bullet_style))
    
    dash_img = Paragraph("<i>[No Screenshot Found]</i>", body_style)
    if dashboard_path:
        dash_img = Image(dashboard_path, width=220, height=125)
        
    row3_table = Table([[dash_desc, dash_img]], colWidths=[264, 240])
    row3_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING', (0,0), (-1,0), 10),
        ('LEFTPADDING', (1,0), (1,0), 10),
    ]))
    story.append(row3_table)
    
    # ── Row 4: Cash Collection & Approval Console ──
    console_desc = []
    console_desc.append(Paragraph("Cash Collection & Print Console", h1_style))
    console_desc.append(Paragraph("Click <b>Open Console</b> on the dashboard to view incoming files:", bullet_style))
    console_desc.append(Paragraph("1. Customer upload details (Pages, copies, B&W/Color) are shown.", bullet_style))
    console_desc.append(Paragraph("2. Look at the <b>Collect Price</b> badge (e.g. <b>₹12.00</b>).", bullet_style))
    console_desc.append(Paragraph("3. <b>Collect cash or scan UPI first</b> from the customer.", bullet_style))
    console_desc.append(Paragraph("4. Click <b>Approve & Print</b> to print, or <b>Reject</b> to delete the job.", bullet_style))
    
    console_img = Paragraph("<i>[No Screenshot Found]</i>", body_style)
    if console_path:
        console_img = Image(console_path, width=220, height=125)
        
    row4_table = Table([[console_desc, console_img]], colWidths=[264, 240])
    row4_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING', (0,0), (-1,0), 10),
        ('LEFTPADDING', (1,0), (1,0), 10),
    ]))
    story.append(row4_table)
    
    # ── Row 5: Rates Setting ──
    rates_desc = []
    rates_desc.append(Paragraph("Changing Rates & Prices", h1_style))
    rates_desc.append(Paragraph("You can change print pricing at any time to match your rates:", bullet_style))
    rates_desc.append(Paragraph("1. Click <b>Change Rates</b> in the dashboard header.", bullet_style))
    rates_desc.append(Paragraph("2. Set prices for Black & White (Single Side), Black & White (Double Side), Color (Single), and Color (Double) side prints.", bullet_style))
    rates_desc.append(Paragraph("3. Click <b>Save Rates</b> to update prices instantly.", bullet_style))
    
    rates_img = Paragraph("<i>[No Screenshot Found]</i>", body_style)
    if rates_path:
        rates_img = Image(rates_path, width=220, height=120)
        
    row5_table = Table([[rates_desc, rates_img]], colWidths=[264, 240])
    row5_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,0), 10),
        ('LEFTPADDING', (1,0), (1,0), 10),
    ]))
    story.append(row5_table)
    story.append(Spacer(1, 5))
    
    # Support Card
    support_data = [
        [
            Paragraph("<b>Need Help? Pilot Operations Support:</b> Contact your AutoPrint Representative immediately if prints are stuck, if the status remains Red, or if pricing calculations look wrong. We are here to help your shop succeed!", note_style)
        ]
    ]
    support_table = Table(support_data, colWidths=[504])
    support_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#EFF6FF')),
        ('BORDER', (0,0), (-1,-1), 1, colors.HexColor('#BFDBFE')),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 12),
        ('RIGHTPADDING', (0,0), (-1,-1), 12),
    ]))
    story.append(support_table)

    doc.build(story, canvasmaker=NumberedCanvas)

if __name__ == "__main__":
    output_pdf = "AutoPrint_Shopkeeper_Guide.pdf"
    if len(sys.argv) > 1:
        output_pdf = sys.argv[1]
    
    print(f"Generating visual guide PDF to: {output_pdf}...")
    create_guide_pdf(output_pdf)
    print("PDF generation complete.")
