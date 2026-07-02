import os
import sys
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
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
        # Header banner (indigo strip)
        self.setFillColor(colors.HexColor('#1E1B4B')) # Deep indigo
        self.rect(0, 792 - 8, 612, 8, fill=True, stroke=False)
        
        # Footer text
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor('#64748B')) # Slate gray
        self.drawString(54, 32, "AutoPrint Pilot Setup & Support Guide")
        
        page_text = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(612 - 54, 32, page_text)
        
        # Horizontal line above footer
        self.setStrokeColor(colors.HexColor('#E2E8F0'))
        self.setLineWidth(0.5)
        self.line(54, 45, 612 - 54, 45)
        self.restoreState()

def create_guide_pdf(filename="AutoPrint_Shopkeeper_Guide.pdf"):
    # Target letter size, 0.75-inch margins (54 points)
    doc = SimpleDocTemplate(
        filename,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=60
    )
    
    styles = getSampleStyleSheet()
    
    # Custom styles
    # Colors: Primary (#06B6D4 - Cyan), Secondary (#0F172A - Dark slate), Text (#334155 - Slate text)
    primary_color = colors.HexColor('#06B6D4') # Cyan accent
    dark_slate = colors.HexColor('#0F172A')
    slate_text = colors.HexColor('#334155')
    
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=24,
        leading=28,
        textColor=dark_slate,
        spaceAfter=6
    )
    
    subtitle_style = ParagraphStyle(
        'DocSubTitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=12,
        leading=16,
        textColor=colors.HexColor('#0891B2'),
        spaceAfter=20
    )
    
    h1_style = ParagraphStyle(
        'SectionHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=14,
        leading=18,
        textColor=dark_slate,
        spaceBefore=14,
        spaceAfter=10,
        keepWithNext=True
    )
    
    h2_style = ParagraphStyle(
        'SubSectionHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=10.5,
        leading=13.5,
        textColor=colors.HexColor('#0F172A'),
        spaceBefore=8,
        spaceAfter=4,
        keepWithNext=True
    )

    body_style = ParagraphStyle(
        'BodyTextCustom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9.5,
        leading=13.5,
        textColor=slate_text,
        spaceAfter=8
    )
    
    bullet_style = ParagraphStyle(
        'BulletText',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9.5,
        leading=13.5,
        textColor=slate_text,
        leftIndent=15,
        firstLineIndent=-10,
        spaceAfter=4
    )

    note_style = ParagraphStyle(
        'NoteText',
        parent=styles['Normal'],
        fontName='Helvetica-Oblique',
        fontSize=9,
        leading=13,
        textColor=colors.HexColor('#475569')
    )

    story = []
    
    # ── Page 1: Header & System Overview ──
    story.append(Paragraph("AutoPrint Kiosk", subtitle_style))
    story.append(Paragraph("Shopkeeper Guide", title_style))
    story.append(HRFlowable(width="100%", thickness=2, color=primary_color, spaceAfter=15))
    
    story.append(Paragraph("Welcome to the AutoPrint Kiosk Pilot program! This guide will walk you through setting up, configuring, and operating your automated printer station.", body_style))
    story.append(Spacer(1, 10))
    
    # How AutoPrint Works Table
    story.append(Paragraph("How the System Works", h1_style))
    flow_data = [
        [
            Paragraph("<b>Step 1: Scan QR</b>", h2_style),
            Paragraph("<b>Step 2: Upload File</b>", h2_style),
            Paragraph("<b>Step 3: Approval</b>", h2_style),
            Paragraph("<b>Step 4: Automatic Print</b>", h2_style)
        ],
        [
            Paragraph("Customer scans the unique counter QR code at your shop.", body_style),
            Paragraph("Customer uploads PDF, configures copies, duplex, and color mode.", body_style),
            Paragraph("If print mode is <b>Manual</b>, you approve it in the Console. If <b>Auto</b>, it skips approval.", body_style),
            Paragraph("The Desktop Agent downloads the job and sends it directly to your physical printer.", body_style)
        ]
    ]
    flow_table = Table(flow_data, colWidths=[126, 126, 126, 126])
    flow_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#E2E8F0')),
        ('BACKGROUND', (0,1), (-1,1), colors.HexColor('#F8FAFC')),
        ('TEXTCOLOR', (0,0), (-1,0), dark_slate),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 10),
        ('TOPPADDING', (0,0), (-1,-1), 10),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E1')),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
    ]))
    story.append(flow_table)
    story.append(Spacer(1, 15))
    
    # Desktop Agent Setup Section
    story.append(Paragraph("1. Desktop Agent Setup", h1_style))
    story.append(Paragraph("The Windows Desktop Agent acts as the bridge connecting your physical USB/Network printer to the cloud queue.", body_style))
    story.append(Paragraph("• <b>Download & Install:</b> Access the download link from your main Shop Dashboard to retrieve the installer bundle.", bullet_style))
    story.append(Paragraph("• <b>Run Background Service:</b> Open <b>AutoPrint.exe</b>. It runs in the background and places a tray icon on the bottom-right taskbar tray.", bullet_style))
    story.append(Paragraph("• <b>Status Tray Icons:</b> Monitor the tray icon colors for instant status checks:", bullet_style))
    
    # Status Icons table
    status_data = [
        [Paragraph("<b>Icon State</b>", h2_style), Paragraph("<b>Meaning</b>", h2_style), Paragraph("<b>Required Action</b>", h2_style)],
        [Paragraph("<font color='#10B981'><b>🟢 Green (Ready)</b></font>", body_style), Paragraph("Agent is online, polling jobs, and connected to the database.", body_style), Paragraph("No action required. Ready to process prints.", body_style)],
        [Paragraph("<font color='#3B82F6'><b>🔵 Blue (Printing)</b></font>", body_style), Paragraph("Agent is downloading, spooling, or printing a file.", body_style), Paragraph("Wait for spooling to finish and printer to complete job.", body_style)],
        [Paragraph("<font color='#EF4444'><b>🔴 Red (Offline/Error)</b></font>", body_style), Paragraph("Disconnected from database, or physical printer queue is stalled.", body_style), Paragraph("Check internet connection, or restart the agent.", body_style)]
    ]
    status_table = Table(status_data, colWidths=[130, 214, 160])
    status_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#F1F5F9')),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E1')),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
    ]))
    story.append(status_table)
    story.append(Spacer(1, 10))
    story.append(Paragraph("• <b>Configuring Printer:</b> Right-click the tray icon and select <i>Configure</i> to verify/select your physical printer destination.", bullet_style))
    
    story.append(PageBreak()) # ── Move to Page 2 ──
    
    # Shopkeeper Dashboard & Console
    story.append(Paragraph("2. Managing Queue & Print Modes", h1_style))
    story.append(Paragraph("Open the web portal on your phone or PC and navigate to the <b>Shopkeeper Dashboard</b>:", body_style))
    story.append(Paragraph("• <b>Manual Approval Mode (Recommended for pilot):</b> Each job enters a 'Pending Approval' queue. Review the page counts and collect cash first, then click <b>Approve & Print</b>. This prevents customers from wasting paper.", bullet_style))
    story.append(Paragraph("• <b>Auto-Print Mode:</b> Jobs bypass approval and spool directly. Ideal if you want a complete hands-off self-service kiosk (requires digital pre-payment integration in next phase).", bullet_style))
    story.append(Paragraph("• <b>Live Connectivity Card:</b> The dashboard displays <b>🟢 Agent Online</b> or <b>🔴 Agent Offline</b> status. The online state updates automatically based on a 20-second heartbeat from your physical computer.", bullet_style))
    
    # Rates and Billing Configuration
    story.append(Paragraph("3. Rates & Cash Collection Flow", h1_style))
    story.append(Paragraph("AutoPrint automatically calculates the price of each print job so you can charge customers instantly. The system supports distinct pricing configurations.", body_style))
    story.append(Paragraph("To change your default rates:", body_style))
    story.append(Paragraph("1. Go to the dashboard/console header and click the <b>💰 Change Rates</b> link.", bullet_style))
    story.append(Paragraph("2. Update rates for Black & White (Single Side), Black & White (Double Side), Color (Single Side), and Color (Double Side).", bullet_style))
    story.append(Paragraph("3. Click <b>Save Rates</b>. Calculations update immediately for new files in your console.", bullet_style))
    
    # Billing summary box
    billing_data = [
        [
            Paragraph("<b>Cash Collection Flow Tip:</b> Before clicking <i>Approve & Print</i> in manual mode, confirm the total price shown in the <b>Collect Price</b> badge (e.g. <i>₹12.00</i>). Collect cash or standard QR payment from the customer, then trigger the approval to spool the physical printout.", note_style)
        ]
    ]
    billing_table = Table(billing_data, colWidths=[504])
    billing_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#EFF6FF')),
        ('BORDER', (0,0), (-1,-1), 1, colors.HexColor('#BFDBFE')),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('LEFTPADDING', (0,0), (-1,-1), 12),
        ('RIGHTPADDING', (0,0), (-1,-1), 12),
    ]))
    story.append(billing_table)
    story.append(Spacer(1, 15))
    
    # Troubleshooting & Support Table
    story.append(Paragraph("4. Operational Troubleshooting", h1_style))
    
    trouble_data = [
        [Paragraph("<b>Symptom</b>", h2_style), Paragraph("<b>Likely Cause</b>", h2_style), Paragraph("<b>Resolution Checklist</b>", h2_style)],
        [
            Paragraph("Dashboard shows <b>🔴 Agent Offline</b>", body_style),
            Paragraph("• Windows agent is closed.<br/>• PC went to sleep.<br/>• No internet connection.", body_style),
            Paragraph("1. Check Windows system tray for the icon.<br/>2. Double-click <b>AutoPrint.exe</b> to restart.<br/>3. Turn off PC Sleep Mode in Windows settings.", body_style)
        ],
        [
            Paragraph("Job Status shows <b>Failed</b>", body_style),
            Paragraph("• PDF reader path invalid.<br/>• Spooler is offline.<br/>• Jammed/out of paper.", body_style),
            Paragraph("1. Right-click tray and verify the selected printer name.<br/>2. Open the job details in the console to read error logs.<br/>3. Click <b>Retry</b> once paper is cleared.", body_style)
        ],
        [
            Paragraph("Incorrect price calculation", body_style),
            Paragraph("• Standard base rates need adjusting.", body_style),
            Paragraph("1. Access <b>Change Rates</b> setting.<br/>2. Save settings and reload page.", body_style)
        ]
    ]
    trouble_table = Table(trouble_data, colWidths=[130, 174, 200])
    trouble_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#FEF2F2')),
        ('TEXTCOLOR', (0,0), (-1,0), colors.HexColor('#991B1B')),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#FCA5A5')),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#FEE2E2')),
    ]))
    story.append(trouble_table)
    story.append(Spacer(1, 15))
    
    # Pilot contact info
    contact_data = [
        [
            Paragraph("<b>Need Help? Pilot Operations Support:</b> Contact your AutoPrint representative immediately for any hardware configuration, software bugs, or general feedback. We are here to support your operations!", note_style)
        ]
    ]
    contact_table = Table(contact_data, colWidths=[504])
    contact_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#F0FDF4')),
        ('BORDER', (0,0), (-1,-1), 1, colors.HexColor('#BBF7D0')),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 12),
        ('RIGHTPADDING', (0,0), (-1,-1), 12),
    ]))
    story.append(contact_table)

    # Build the document
    doc.build(story, canvasmaker=NumberedCanvas)

if __name__ == "__main__":
    output_pdf = "AutoPrint_Shopkeeper_Guide.pdf"
    if len(sys.argv) > 1:
        output_pdf = sys.argv[1]
    
    print(f"Generating guide PDF to: {output_pdf}...")
    create_guide_pdf(output_pdf)
    print("PDF generation complete.")
