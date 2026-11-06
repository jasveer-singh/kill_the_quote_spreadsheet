/**
 * Fabricates an RFx for IT hardware & peripherals plus five messy vendor responses.
 * Run: npm run generate:dataset
 *
 * Every vendor's price derives from the same base price per item (vendor factor + small
 * seeded jitter), so extracted numbers can be sanity-checked against data/ground-truth.json.
 */
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import type {
  GroundTruth,
  GroundTruthLine,
  GroundTruthVendor,
  Rfx,
  RfxItem,
} from "../lib/rfx-types";

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");
const OUT = path.join(DATA, "vendor-responses");
const FX = 83; // INR per USD, used only for vendor C

// ---------- seeded randomness ----------
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- RFx ----------
type Seed = RfxItem & { basePriceINR: number };
const L = (
  itemCode: string,
  description: string,
  spec: string,
  quantity: number,
  basePriceINR: number,
  unit = "Nos",
): Seed => ({ itemCode, description, spec, quantity, unit, basePriceINR });

const SEED_ITEMS: Seed[] = [
  L("LAP-001", 'Business Laptop 14"', "Intel Core i5-1335U, 16GB DDR5, 512GB NVMe SSD, Windows 11 Pro, 3-yr on-site warranty", 120, 68500),
  L("LAP-002", 'Business Laptop 15.6"', "Intel Core i7-1355U, 32GB DDR5, 1TB NVMe SSD, Windows 11 Pro, 3-yr on-site warranty", 40, 99000),
  L("LAP-003", 'Mobile Workstation 16"', "AMD Ryzen 9 7940HS, 64GB DDR5, 2TB SSD, NVIDIA RTX A2000 8GB, Windows 11 Pro", 10, 185000),
  L("LAP-004", 'Ultraportable Laptop 13.3"', "Intel Core i5-1340P, 16GB LPDDR5, 512GB SSD, 1.2kg, Windows 11 Pro", 60, 82000),
  L("DSK-001", "Mini Desktop PC", "Intel Core i5-13500T, 16GB DDR4, 512GB SSD, Wi-Fi 6, VESA mount, Windows 11 Pro", 50, 52000),
  L("MON-001", 'Monitor 24" FHD', "24-inch IPS, 1920x1080, 75Hz, HDMI + DisplayPort, height-adjustable stand", 150, 9800),
  L("MON-002", 'Monitor 27" QHD', "27-inch IPS, 2560x1440, 75Hz, HDMI + DP + USB hub, height-adjustable", 80, 17500),
  L("MON-003", 'Monitor 32" 4K USB-C', "32-inch IPS, 3840x2160, USB-C 90W PD, KVM, HDR400", 25, 38500),
  L("MON-004", 'Monitor 34" Ultrawide', "34-inch curved VA, 3440x1440, 100Hz, HDMI + DP + USB-C", 15, 41000),
  L("DOC-001", "USB-C Docking Station 65W", "USB-C, dual 4K HDMI, 3x USB-A, RJ45 GbE, 65W pass-through charging", 100, 7200),
  L("DOC-002", "Thunderbolt 4 Docking Station", "TB4, 96W charging, dual 4K60 DP, 4x USB-A, SD reader, 2.5GbE", 40, 18500),
  L("DOC-003", "Universal USB 3.0 Dual-Display Dock", "DisplayLink, 2x HDMI, 4x USB 3.0, GbE, audio in/out", 30, 5600),
  L("KEY-001", "Wired USB Keyboard", "Full-size, membrane, spill-resistant, UK/US layout, USB-A", 200, 650),
  L("KEY-002", "Wireless Keyboard + Mouse Combo", "2.4GHz USB receiver, low-profile keys, 12-month battery life", 150, 1800, "Set"),
  L("KEY-003", "Mechanical Keyboard", "TKL, hot-swappable red switches, USB-C detachable cable, backlit", 20, 4800),
  L("MOU-001", "Wired Optical Mouse", "USB-A, 1000 DPI, 3 buttons, 1.5m cable", 200, 350),
  L("MOU-002", "Wireless Ergonomic Mouse", "Vertical grip, 2.4GHz + Bluetooth, 4000 DPI, rechargeable", 100, 1450),
  L("MOU-003", "Bluetooth Travel Mouse", "Compact, silent click, Bluetooth 5.0, AA battery", 60, 1250),
  L("CAB-001", "HDMI Cable 2m", "HDMI 2.0, 4K60, gold-plated connectors, braided", 250, 380),
  L("CAB-002", "DisplayPort Cable 2m", "DisplayPort 1.4, 8K30 / 4K144, latching connector", 150, 620),
  L("CAB-003", "USB-C to USB-C Cable 1m", "USB 3.2 Gen2, 100W PD, 10Gbps, e-marked", 300, 540),
  L("CAB-004", "Cat6 Patch Cable 3m", "UTP Cat6, snagless boot, 24AWG, blue", 400, 180),
  L("CAB-005", "USB-C to HDMI Adapter", "USB-C to HDMI 2.0, 4K60, aluminium shell", 120, 850),
  L("WEB-001", "Webcam 1080p", "Full HD 1080p/30fps, autofocus, dual mic, privacy shutter, USB-A", 100, 2400),
  L("WEB-002", "4K Conference Webcam", "4K/30fps, 90-degree FOV, AI auto-framing, dual noise-cancelling mics, USB-C", 20, 11500),
  L("HDS-001", "USB Wired Headset with Mic", "Over-ear, noise-cancelling boom mic, inline controls, USB-A, MS Teams certified", 150, 1900),
  L("HDS-002", "Wireless ANC Headset", "Bluetooth 5.2, active noise cancelling, 30h battery, USB dongle, Teams certified", 40, 8900),
  L("BAG-001", 'Laptop Backpack 15.6"', "Water-resistant, padded laptop compartment, anti-theft pocket", 120, 1450),
  L("PWR-001", "Universal 65W USB-C Charger", "GaN, 65W PD 3.0, foldable pins, 1.8m cable included", 80, 2100),
  L("STN-001", "Aluminium Laptop Stand", "Adjustable height/angle, foldable, fits 11-17 inch laptops", 90, 1350),
];

const rfx: Rfx = {
  rfxId: "RFX-2026-0417",
  title: "Supply of IT Hardware & Peripherals - FY26-27 Refresh",
  buyer: "Meridian Logistics Pvt. Ltd.",
  issuedOn: "2026-10-12",
  responseDueBy: "2026-10-26",
  deliveryLocation: "Pune, Maharashtra (single consignee)",
  items: SEED_ITEMS.map(({ basePriceINR: _p, ...item }) => item),
};
const BASE = new Map(SEED_ITEMS.map((i) => [i.itemCode, i.basePriceINR]));
const ITEM = new Map(rfx.items.map((i) => [i.itemCode, i]));

// ---------- vendor price model ----------
interface VendorDef {
  id: string;
  name: string;
  file: string;
  factor: number;
  seed: number;
}
const VENDORS: Record<"a" | "b" | "c" | "d" | "e", VendorDef> = {
  a: { id: "vendor-a", name: "Nexa Tech Supplies", file: "vendor-a.xlsx", factor: 1.0, seed: 11 },
  b: { id: "vendor-b", name: "Sundaram Infosystems Pvt. Ltd.", file: "vendor-b.pdf", factor: 1.04, seed: 22 },
  c: { id: "vendor-c", name: "Brightwave Global Trading LLC", file: "vendor-c.docx", factor: 0.97, seed: 33 },
  d: { id: "vendor-d", name: "Shree Ganesh Computers", file: "vendor-d.png", factor: 1.02, seed: 44 },
  e: { id: "vendor-e", name: "QuickByte Traders", file: "vendor-e.txt", factor: 1.01, seed: 55 },
};

function roundPrice(p: number): number {
  const step = p >= 10000 ? 100 : p >= 1000 ? 50 : 5;
  return Math.round(p / step) * step;
}
function unitPriceINR(v: VendorDef, code: string): number {
  const rnd = mulberry32(v.seed * 1000 + code.split("").reduce((s, c) => s * 31 + c.charCodeAt(0), 7));
  const jitter = 1 + (rnd() - 0.5) * 0.04; // +/-2%
  return roundPrice(BASE.get(code)! * v.factor * jitter);
}

const inr = (n: number) => n.toLocaleString("en-IN");
const usd = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- RFx outputs ----------
async function writeRfx() {
  fs.writeFileSync(path.join(DATA, "rfx.json"), JSON.stringify(rfx, null, 2));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RFx Template");
  ws.addRow([rfx.title]).font = { bold: true, size: 14 };
  ws.addRow([`${rfx.rfxId} | Buyer: ${rfx.buyer} | Response due: ${rfx.responseDueBy}`]);
  ws.addRow([]);
  const h = ws.addRow(["Item Code", "Description", "Specification", "Quantity", "UoM", "Unit Price (INR)", "Total (INR)"]);
  h.font = { bold: true };
  rfx.items.forEach((i) => ws.addRow([i.itemCode, i.description, i.spec, i.quantity, i.unit, null, null]));
  [12, 34, 70, 10, 8, 16, 16].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  await wb.xlsx.writeFile(path.join(DATA, "rfx-template.xlsx"));
}

// ---------- Vendor A: clean xlsx, own layout, INR ----------
async function vendorA(): Promise<GroundTruthLine[]> {
  const v = VENDORS.a;
  // vendor sorts by its own category order, not RFx order
  const order = [...rfx.items].sort((x, y) => x.itemCode.slice(0, 3).localeCompare(y.itemCode.slice(0, 3)) || x.itemCode.localeCompare(y.itemCode));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Quotation");
  ws.addRow([v.name.toUpperCase()]).font = { bold: true, size: 16 };
  ws.addRow(["Quotation No. NTS/Q/26-27/1183  |  Date: 15-Oct-2026  |  Ref: " + rfx.rfxId]);
  ws.addRow(["All rates in Indian Rupees (INR), exclusive of GST. Validity: 30 days. Delivery: 3-4 weeks ARO."]);
  ws.addRow([]);
  const hdr = ws.addRow(["S.No", "Product / Model Description", "Our Part Ref", "Order Qty", "Rate (Rs.)", "GST %", "Line Amount (Rs.)", "Warranty", "Remarks"]);
  hdr.font = { bold: true, color: { argb: "FFFFFFFF" } };
  hdr.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } }));
  const lines: GroundTruthLine[] = [];
  let grand = 0;
  order.forEach((it, idx) => {
    const p = unitPriceINR(v, it.itemCode);
    const row = ws.addRow([idx + 1, `${it.description} - ${it.spec}`, it.itemCode, it.quantity, p, 18, null, "3 Yrs", ""]);
    row.getCell(7).value = { formula: `D${row.number}*E${row.number}`, result: p * it.quantity };
    row.getCell(5).numFmt = "#,##0";
    row.getCell(7).numFmt = "#,##0";
    grand += p * it.quantity;
    lines.push({ itemCode: it.itemCode, quotedUnitPriceINR: p, statedValue: p, statedBasis: "per_unit", currency: "INR", referenceUnitPriceINR: p });
  });
  const tot = ws.addRow(["", "", "", "", "TOTAL (ex-GST)", "", null]);
  tot.getCell(7).value = { formula: `SUM(G6:G${5 + order.length})`, result: grand };
  tot.getCell(7).numFmt = "#,##0";
  tot.font = { bold: true };
  [6, 70, 14, 10, 14, 8, 18, 10, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  await wb.xlsx.writeFile(path.join(OUT, v.file));
  return lines;
}

// ---------- Vendor B: PDF, 27/30 lines, footnote discount, INR ----------
const B_MISSING = new Set(["LAP-003", "WEB-002", "STN-001"]);
const B_DISCOUNT = 0.05;
async function vendorB(): Promise<GroundTruthLine[]> {
  const v = VENDORS.b;
  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
  const stream = fs.createWriteStream(path.join(OUT, v.file));
  doc.pipe(stream);
  const W = doc.page.width;
  const letterhead = () => {
    doc.rect(0, 0, W, 78).fill("#0B3C5D");
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(18).text("SUNDARAM INFOSYSTEMS PVT. LTD.", 40, 20);
    doc.font("Helvetica").fontSize(8).text("Authorised Channel Partner | 14, MIDC Industrial Estate, Andheri East, Mumbai 400093 | GSTIN 27AABCS1429B1Z5", 40, 46);
    doc.text("sales@sundaram-infosys.example | +91 22 4000 1234", 40, 58);
    doc.fillColor("#000000");
  };
  letterhead();
  doc.font("Helvetica-Bold").fontSize(11).text("COMMERCIAL OFFER", 40, 96);
  doc.font("Helvetica").fontSize(9);
  doc.text(`Our Ref: SIPL/SALES/2026/0871      Date: 17 October 2026`, 40, 112);
  doc.text(`To: Procurement Dept, ${rfx.buyer}`, 40, 124);
  doc.text(`Subject: Your enquiry ${rfx.rfxId} - ${rfx.title}`, 40, 136);
  doc.text("Dear Sir/Madam, we thank you for the opportunity and are pleased to offer the following. All prices in INR*, per unit, exclusive of GST @18%.", 40, 154, { width: W - 80 });

  const cols = [
    { h: "Sl", x: 40, w: 24 },
    { h: "Item Code", x: 64, w: 56 },
    { h: "Description", x: 120, w: 230 },
    { h: "Qty", x: 350, w: 36 },
    { h: "Unit Price", x: 386, w: 70 },
    { h: "Amount", x: 456, w: 99 },
  ];
  let y = 190;
  const header = () => {
    doc.rect(40, y, W - 80, 16).fill("#E6EEF4");
    doc.fillColor("#000").font("Helvetica-Bold").fontSize(8);
    cols.forEach((c) => doc.text(c.h, c.x + 2, y + 4, { width: c.w - 4 }));
    y += 18;
  };
  header();
  const lines: GroundTruthLine[] = [];
  let sl = 0;
  for (const it of rfx.items) {
    const p = unitPriceINR(v, it.itemCode);
    if (B_MISSING.has(it.itemCode)) {
      lines.push({ itemCode: it.itemCode, quotedUnitPriceINR: null, statedValue: null, statedBasis: "not_stated", currency: "INR", referenceUnitPriceINR: p, note: "Line omitted from quote" });
      continue;
    }
    if (y > 770) {
      doc.addPage();
      letterhead();
      y = 96;
      header();
    }
    sl++;
    doc.font("Helvetica").fontSize(8).fillColor("#000");
    const desc = `${it.description} - ${it.spec}`;
    const h = Math.max(14, doc.heightOfString(desc, { width: cols[2].w - 4 }) + 4);
    doc.text(String(sl), cols[0].x + 2, y + 2, { width: cols[0].w - 4 });
    doc.text(it.itemCode, cols[1].x + 2, y + 2, { width: cols[1].w - 4 });
    doc.text(desc, cols[2].x + 2, y + 2, { width: cols[2].w - 4 });
    doc.text(String(it.quantity), cols[3].x + 2, y + 2, { width: cols[3].w - 4 });
    doc.text(inr(p), cols[4].x + 2, y + 2, { width: cols[4].w - 4, align: "right" });
    doc.text(inr(p * it.quantity), cols[5].x + 2, y + 2, { width: cols[5].w - 4, align: "right" });
    doc.moveTo(40, y + h).lineTo(W - 40, y + h).strokeColor("#CCCCCC").lineWidth(0.4).stroke();
    y += h;
    lines.push({ itemCode: it.itemCode, quotedUnitPriceINR: p, statedValue: p, statedBasis: "per_unit", currency: "INR", referenceUnitPriceINR: p, note: "5% footnote discount applies to whole quote" });
  }
  if (y > 700) {
    doc.addPage();
    letterhead();
    y = 96;
  }
  y += 14;
  doc.font("Helvetica").fontSize(9).fillColor("#000");
  doc.text("Terms: Payment 30 days from delivery. Delivery 4-5 weeks from PO. Warranty as per OEM. Prices valid for 21 days from date of offer.", 40, y, { width: W - 80 });
  y += 36;
  doc.text("Thanking you,\nFor Sundaram Infosystems Pvt. Ltd.\n\nAuthorised Signatory", 40, y);
  // tiny footnote at the very bottom of the last page
  doc.font("Helvetica").fontSize(5.5).fillColor("#777777");
  doc.text(
    "* Prices are in INR. A special discount of 5% on the total basic value shall be allowed if the order is confirmed within 15 days of this offer. E&OE.",
    40,
    doc.page.height - 48,
    { width: W - 80, lineBreak: true },
  );
  doc.end();
  await new Promise<void>((r) => stream.on("finish", () => r()));
  return lines;
}

// ---------- Vendor C: docx, prose pricing, USD ----------
async function vendorC(): Promise<GroundTruthLine[]> {
  const v = VENDORS.c;
  const rnd = mulberry32(v.seed);
  const lines: GroundTruthLine[] = [];
  const phrasings: Array<(d: string, p: string, q: number) => string> = [
    (d, p, q) => `For the ${d}, our price is USD ${p} per unit; for your requirement of ${q} we are happy to hold that rate.`,
    (d, p, q) => `The ${d} can be supplied at ${p} US dollars each (quantity ${q} as per your enquiry).`,
    (d, p, q) => `${d[0].toUpperCase() + d.slice(1)} - we quote $${p} a piece, and this covers the full ${q} units.`,
    (d, p, q) => `Regarding the ${d}: unit rate is USD ${p}. We have noted the ${q}-unit requirement.`,
    (d, p, q) => `Please note that the ${d} comes to $${p} per unit, which we can confirm for ${q} pieces.`,
  ];
  const groups: Array<[string, string, string[]]> = [
    ["Laptops and Desktops", "We are pleased to propose the following for compute devices.", ["LAP", "DSK"]],
    ["Displays", "On displays, our pricing is as follows.", ["MON"]],
    ["Docking Stations", "Docking solutions are priced in the paragraphs below.", ["DOC"]],
    ["Input Devices", "Keyboards and pointing devices are quoted as follows.", ["KEY", "MOU"]],
    ["Cables and Adapters", "For connectivity accessories we offer:", ["CAB"]],
    ["Video, Audio and Accessories", "Finally, for collaboration gear and accessories:", ["WEB", "HDS", "BAG", "PWR", "STN"]],
  ];
  const children: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: "Brightwave Global Trading LLC", bold: true })] }),
    new Paragraph({ children: [new TextRun({ text: "Jebel Ali Free Zone, Dubai, UAE  |  quotes@brightwave-global.example", size: 18, color: "666666" })] }),
    new Paragraph({ text: "" }),
    new Paragraph({ children: [new TextRun("Date: 19 October 2026")] }),
    new Paragraph({ children: [new TextRun(`Re: ${rfx.rfxId} - ${rfx.title}`)] }),
    new Paragraph({ text: "" }),
    new Paragraph({ children: [new TextRun(`Dear ${rfx.buyer} Procurement Team,`)] }),
    new Paragraph({
      spacing: { after: 160 },
      children: [new TextRun("Thank you for inviting us to respond to your enquiry. Please find our offer below. All prices in this letter are quoted in United States Dollars (USD), ex-works Dubai, exclusive of freight, insurance and any import duties or taxes in India. Our offer is valid for thirty (30) days.")],
    }),
  ];
  for (const [title, intro, prefixes] of groups) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(title)] }));
    const its = rfx.items.filter((i) => prefixes.some((p) => i.itemCode.startsWith(p)));
    const sentences: string[] = [intro];
    for (const it of its) {
      const pInr = unitPriceINR(v, it.itemCode);
      const pUsd = Math.round((pInr / FX) * 100) / 100;
      const d = `${it.description.replace(/"/g, " inch")} (${it.spec.split(",").slice(0, 3).join(",").trim()})`;
      sentences.push(phrasings[Math.floor(rnd() * phrasings.length)](d, usd(pUsd), it.quantity));
      lines.push({
        itemCode: it.itemCode,
        quotedUnitPriceINR: Math.round(pUsd * FX),
        statedValue: pUsd,
        statedBasis: "per_unit",
        currency: "USD",
        referenceUnitPriceINR: pInr,
        note: `USD ${pUsd} converted at ${FX} INR/USD`,
      });
    }
    // split into 2-3 sentence paragraphs so it reads like a letter
    for (let i = 0; i < sentences.length; i += 3) {
      children.push(new Paragraph({ spacing: { after: 140 }, alignment: AlignmentType.JUSTIFIED, children: [new TextRun(sentences.slice(i, i + 3).join(" "))] }));
    }
  }
  children.push(
    new Paragraph({ children: [new TextRun("Shipping terms are FCA Dubai; we will quote sea or air freight separately once you confirm the consignee address. Payment: 50% advance, 50% against shipping documents.")] }),
    new Paragraph({ text: "" }),
    new Paragraph({ children: [new TextRun("Yours sincerely,\nOmar Haddad\nSales Director, Brightwave Global Trading LLC")] }),
  );
  const doc = new Document({ sections: [{ children }] });
  fs.writeFileSync(path.join(OUT, v.file), await Packer.toBuffer(doc));
  return lines;
}

// ---------- Vendor D: rate-card PNG, rotated + noisy, price per box of 100 ----------
async function vendorD(): Promise<GroundTruthLine[]> {
  const v = VENDORS.d;
  const lines: GroundTruthLine[] = [];
  const rowH = 34;
  const W = 1180;
  const top = 150;
  const H = top + rowH * (rfx.items.length + 1) + 90;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  let rows = "";
  rfx.items.forEach((it, i) => {
    const p = unitPriceINR(v, it.itemCode);
    const box = p * 100;
    const y = top + rowH * (i + 1);
    const fill = i % 2 ? "#f4f1e8" : "#fffdf7";
    rows += `<rect x="30" y="${y}" width="${W - 60}" height="${rowH}" fill="${fill}" stroke="#8a8578" stroke-width="1"/>`;
    rows += `<text x="42" y="${y + 23}" font-size="17" font-family="Helvetica, Arial, sans-serif" fill="#222">${it.itemCode}</text>`;
    rows += `<text x="160" y="${y + 23}" font-size="17" font-family="Helvetica, Arial, sans-serif" fill="#222">${esc(it.description)}</text>`;
    rows += `<text x="610" y="${y + 23}" font-size="14" font-family="Helvetica, Arial, sans-serif" fill="#555">${esc(it.spec.split(",")[0].slice(0, 36))}</text>`;
    rows += `<text x="${W - 42}" y="${y + 23}" text-anchor="end" font-size="18" font-weight="bold" font-family="Helvetica, Arial, sans-serif" fill="#111">${inr(box)}</text>`;
    lines.push({
      itemCode: it.itemCode,
      quotedUnitPriceINR: p,
      statedValue: box,
      statedBasis: "per_box_100",
      currency: "INR",
      referenceUnitPriceINR: p,
      note: "Stated per box of 100 units; divide by 100 for unit price",
    });
  });
  const hy = top;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="100%" height="100%" fill="#fffdf7"/>
  <text x="40" y="52" font-size="34" font-weight="bold" font-family="Helvetica, Arial, sans-serif" fill="#7a1f1f">SHREE GANESH COMPUTERS</text>
  <text x="40" y="80" font-size="16" font-family="Helvetica, Arial, sans-serif" fill="#444">Wholesale IT Hardware | Nehru Place, New Delhi 110019 | Ph 98100 55xxx</text>
  <text x="40" y="118" font-size="22" font-weight="bold" font-family="Helvetica, Arial, sans-serif" fill="#111">RATE CARD - Oct 2026 (Ref: ${rfx.rfxId})</text>
  <text x="${W - 40}" y="118" text-anchor="end" font-size="16" font-family="Helvetica, Arial, sans-serif" fill="#444">Rates per BOX of 100 units, in Rs.</text>
  <rect x="30" y="${hy}" width="${W - 60}" height="${rowH}" fill="#d8d2bf" stroke="#8a8578" stroke-width="1"/>
  <text x="42" y="${hy + 23}" font-size="16" font-weight="bold" font-family="Helvetica, Arial, sans-serif">Code</text>
  <text x="160" y="${hy + 23}" font-size="16" font-weight="bold" font-family="Helvetica, Arial, sans-serif">Item</text>
  <text x="610" y="${hy + 23}" font-size="16" font-weight="bold" font-family="Helvetica, Arial, sans-serif">Details</text>
  <text x="${W - 42}" y="${hy + 23}" text-anchor="end" font-size="16" font-weight="bold" font-family="Helvetica, Arial, sans-serif">Price / Box (100 pcs)</text>
  ${rows}
  <text x="40" y="${H - 40}" font-size="15" font-family="Helvetica, Arial, sans-serif" fill="#444">GST extra @18%. Rates valid till 31-Oct. Ex-godown Delhi. Minimum 1 box.</text>
  </svg>`;

  const margin = 90;
  const desk = { r: 168, g: 160, b: 148 };
  const rotated = await sharp(Buffer.from(svg))
    .extend({ top: margin, bottom: margin, left: margin, right: margin, background: desk })
    .rotate(-10, { background: desk })
    .blur(0.9)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data, info } = rotated;
  const rnd = mulberry32(v.seed);
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.7; // ~N(0,~1)
  const out = Buffer.from(data);
  for (let yy = 0; yy < info.height; yy++) {
    for (let xx = 0; xx < info.width; xx++) {
      // soft lighting gradient (brighter top-left) + sensor noise
      const light = 1.06 - 0.16 * ((xx / info.width) * 0.6 + (yy / info.height) * 0.4);
      const n = gauss() * 9;
      const idx = (yy * info.width + xx) * info.channels;
      for (let c = 0; c < 3; c++) out[idx + c] = Math.max(0, Math.min(255, out[idx + c] * light + n));
    }
  }
  await sharp(out, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .blur(0.5)
    .png()
    .toFile(path.join(OUT, v.file));
  return lines;
}

// ---------- Vendor E: terse email text ----------
const E_EXPLICIT = ["LAP-001", "LAP-002", "MON-001", "MON-002", "DOC-001", "KEY-002", "MOU-002", "CAB-001", "CAB-003", "WEB-001", "HDS-001"];
async function vendorE(): Promise<GroundTruthLine[]> {
  const v = VENDORS.e;
  const lines: GroundTruthLine[] = [];
  const fmt = (code: string, p: number, i: number) => {
    const styles = [
      `${code} - ${inr(p)}/-`,
      `${code} @ ${p}`,
      `${code}: Rs ${inr(p)}`,
      p % 100 === 0 ? `${code} ${p / 100 / 10}k` : `${code} ${p} each`,
    ];
    return styles[i % styles.length];
  };
  const body: string[] = [];
  for (const it of rfx.items) {
    const p = unitPriceINR(v, it.itemCode);
    if (E_EXPLICIT.includes(it.itemCode)) {
      body.push(fmt(it.itemCode, p, E_EXPLICIT.indexOf(it.itemCode)));
      const m = body[body.length - 1];
      const kMatch = m.match(/ ([\d.]+)k$/);
      lines.push({ itemCode: it.itemCode, quotedUnitPriceINR: p, statedValue: kMatch ? Number(kMatch[1]) * 1000 : p, statedBasis: "per_unit", currency: "INR", referenceUnitPriceINR: p, note: kMatch ? "Stated as shorthand 'k'" : undefined });
    } else {
      lines.push({ itemCode: it.itemCode, quotedUnitPriceINR: null, statedValue: null, statedBasis: "not_stated", currency: "INR", referenceUnitPriceINR: p, note: "Covered only by 'rest same as last year, freight extra'; no price in this message" });
    }
  }
  const text = `Subject: Re: ${rfx.rfxId} IT hardware enquiry

Hi,

Got your list, thanks. Sending rates for the main ones below, all per piece, GST extra:

${body.join("\n")}

rest same as last year, freight extra. Can do the laptops from stock, others 2 wks.
Pls confirm qty and we will send PI.

Regards
Rajesh
QuickByte Traders
9820xxxxxx
`;
  fs.writeFileSync(path.join(OUT, v.file), text);
  return lines;
}

// ---------- main ----------
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  await writeRfx();
  const [a, b, c, d, e] = [await vendorA(), await vendorB(), await vendorC(), await vendorD(), await vendorE()];
  const mk = (v: VendorDef, currency: "INR" | "USD", flaws: string[], lines: GroundTruthLine[], hiddenDiscount = 0): GroundTruthVendor => ({
    vendorId: v.id,
    vendorName: v.name,
    file: `vendor-responses/${v.file}`,
    currency,
    flaws,
    hiddenDiscount,
    lines,
  });
  const truth: GroundTruth = {
    generatedFrom: rfx.rfxId,
    fxRateInrPerUsd: FX,
    vendors: [
      mk(VENDORS.a, "INR", ["Own column layout (not RFx template); rows reordered by category; GST column"], a),
      mk(VENDORS.b, "INR", ["Only 27 of 30 lines quoted (LAP-003, WEB-002, STN-001 missing)", "5% discount only in tiny footnote"], b, B_DISCOUNT),
      mk(VENDORS.c, "USD", ["Pricing in prose paragraphs, no table", "Prices in USD"], c),
      mk(VENDORS.d, "INR", ["Image of rate card, rotated ~10deg with noise/blur", "Price per box of 100, not per unit"], d),
      mk(VENDORS.e, "INR", ["Terse informal email", "Only 11 SKUs priced; the rest 'same as last year, freight extra'"], e),
    ],
  };
  fs.writeFileSync(path.join(DATA, "ground-truth.json"), JSON.stringify(truth, null, 2));
  console.log("Wrote RFx, ground truth and 5 vendor files to", path.relative(ROOT, DATA));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
