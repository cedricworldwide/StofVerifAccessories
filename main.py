import sys
import os
import webbrowser
import threading
import io
import re
import math
import numpy as np
import cv2

# --- 0. SYSTEM SETUP ---
if sys.stdout is None: sys.stdout = open(os.devnull, "w")
if sys.stderr is None: sys.stderr = open(os.devnull, "w")

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import pdfplumber
import pypdfium2 as pdfium
import pytesseract
from pytesseract import Output
from pyzbar.pyzbar import decode
from PIL import Image, ImageOps

# --- 1. PATH FINDER ---
def get_resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except AttributeError:
        base_path = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_path, relative_path)

# --- 2. TESSERACT CONFIG ---
base_dir = os.path.dirname(os.path.abspath(__file__)) if not hasattr(sys, '_MEIPASS') else sys._MEIPASS
local_tesseract = os.path.join(base_dir, "Tesseract-OCR", "tesseract.exe")
if os.path.exists(local_tesseract):
    pytesseract.pytesseract.tesseract_cmd = local_tesseract
else:
    pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

# --- 3. APP INIT ---
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

def clean_text(text):
    if not text: return ""
    return " ".join(text.split())

# --- 4. COMPOSITION EXTRACTION (Shared Utility for PO & Labels) ---
def extract_composition_smart(raw_text):
    if not raw_text: return "Not Found"
    KNOWN_MATERIALS = [
        "COTTON", "COTON", "COTONE", "POLYESTER", "POLYESTERE", "LINEN", "LIN", "LINO",
        "VISCOSE", "RAYON", "ACRYLIC", "ACRYLIQUE", "NYLON", "POLYAMIDE",
        "VELVET", "VELOURS", "WOOL", "LAINE", "JUTE", "BAMBOO", "BAMBOU"
    ]
    text = raw_text.upper().replace('\n', ' ')
    percentages = list(re.finditer(r"(\d+(?:[\.,]\d+)?\s*%)", text))
    assignments = []
    for match in percentages:
        pct_val = match.group(1).replace(" ", "")
        snippet = text[match.end():match.end()+60]
        found_mat = None
        best_idx = 999
        for mat in KNOWN_MATERIALS:
            idx = snippet.find(mat)
            if idx != -1 and idx < best_idx:
                best_idx = idx
                found_mat = mat
        if found_mat:
            if found_mat == "COTTON": found_mat = "COTON"
            if found_mat == "LINEN": found_mat = "LIN"
            if found_mat == "VELVET": found_mat = "VELOURS"
            assignments.append(f"{pct_val} {found_mat}")
    return " ".join(assignments) if assignments else "Not Found"

# --- 5. IMAGE PROCESSING STRATEGIES (V6 ARCHITECTURE) ---

def basic_image_prep(pil_image):
    """Préparation standard pour OCR"""
    if pil_image.mode != 'RGB': pil_image = pil_image.convert('RGB')
    cv_img = np.array(pil_image)
    img = cv_img[:, :, ::-1].copy() # RGB to BGR
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return Image.fromarray(thresh)

class OCRStrategy:
    def process(self, images):
        """Returns (clusters: list, global_text: str)"""
        raise NotImplementedError

class StandardStrategy(OCRStrategy):
    """
    MODE: STANDARD
    Cible : Étiquettes mixtes / Stickers simples
    Technique : Clustering Spatial (0°/180°)
    """
    def process(self, images):
        raw_clusters = []
        global_text_parts = []
        
        for img in images:
            for rotation in [0, 180]:
                rotated_img = img.rotate(rotation, expand=True) if rotation else img
                prep_img = basic_image_prep(rotated_img)
                prep_img = ImageOps.expand(prep_img, border=50, fill='white')
                
                decoded = decode(rotated_img)
                clusters = []
                for obj in decoded:
                    rect = obj.rect
                    clusters.append({
                        "ean": obj.data.decode("utf-8"),
                        "center": (rect.left + rect.width/2, rect.top + rect.height/2),
                        "content": []
                    })
                
                data = pytesseract.image_to_data(prep_img, config='--psm 11 --oem 3', output_type=Output.DICT)
                full_text_page = []
                
                for i in range(len(data['level'])):
                    text = data['text'][i].strip()
                    if len(text) < 2: continue
                    full_text_page.append(text)
                    
                    c_x = data['left'][i] + data['width'][i]/2
                    c_y = data['top'][i] + data['height'][i]/2
                    
                    best_cluster = None
                    min_dist = 600
                    
                    for c in clusters:
                        dist = math.hypot(c['center'][0] - c_x, c['center'][1] - c_y)
                        if dist < min_dist:
                            min_dist = dist
                            best_cluster = c
                    
                    if best_cluster:
                        best_cluster['content'].append(text)
                
                global_text_parts.append(" ".join(full_text_page))
                for c in clusters:
                    raw_clusters.append({"ean": c['ean'], "extracted_text": " ".join(c['content'])})

        return self.merge_clusters(raw_clusters), " ".join(global_text_parts)

    def merge_clusters(self, clusters):
        merged = {}
        for c in clusters:
            ean = c['ean']
            if ean not in merged: merged[ean] = ""
            merged[ean] += " " + c['extracted_text']
        return [{"ean": k, "extracted_text": clean_text(v)} for k, v in merged.items()]

class InsertStrategy(OCRStrategy):
    """
    MODE: INSERTS
    Cible : Band Rolls, Packaging, Artworks
    Technique : Global Text (Pas de spatial) + Multi-angles (0/90/180/270)
    """
    def process(self, images):
        global_accumulated_text = ""
        found_eans = set()
        
        for img in images:
            for angle in [0, 90, 180, 270]:
                rot_img = img.rotate(angle, expand=True) if angle else img
                
                decoded = decode(rot_img)
                for obj in decoded:
                    found_eans.add(obj.data.decode("utf-8"))
                
                prep_img = basic_image_prep(rot_img)
                text = pytesseract.image_to_string(prep_img, config='--psm 3')
                global_accumulated_text += " " + text

        clean_global = clean_text(global_accumulated_text)
        
        final_clusters = []
        if not found_eans:
            final_clusters.append({"ean": "NO_EAN_FOUND", "extracted_text": clean_global})
        else:
            for ean in found_eans:
                final_clusters.append({"ean": ean, "extracted_text": clean_global})
                
        return final_clusters, clean_global

class ShippingMarkStrategy(OCRStrategy):
    """
    MODE: CARTONS (SHIPPING MARKS)
    Cible : Étiquettes logistiques
    Technique : Threshold Adaptatif + Injections Regex (Order, PCB)
    """
    def process(self, images):
        raw_clusters = []
        global_text_parts = []
        
        for img in images:
            for angle in [0, 180]:
                rot_img = img.rotate(angle, expand=True) if angle else img
                
                cv_img = np.array(rot_img.convert('RGB'))
                gray = cv2.cvtColor(cv_img, cv2.COLOR_RGB2GRAY)
                thresh = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
                prep_img = Image.fromarray(thresh)
                
                decoded = decode(rot_img)
                local_eans = [obj.data.decode("utf-8") for obj in decoded]
                
                text = pytesseract.image_to_string(prep_img, config='--psm 6')
                global_text_parts.append(text)
                
                injections = []
                order_match = re.search(r"(?:Order|Commande)\s*[:.]?\s*(\d+)", text, re.IGNORECASE)
                if order_match: injections.append(f"ORDER_FOUND:{order_match.group(1)}")
                
                pcb_match = re.search(r"PCB\s*[:.]?\s*(\d+)", text, re.IGNORECASE)
                if pcb_match: injections.append(f"PCB_FOUND:{pcb_match.group(1)}")
                
                enhanced_text = text + " " + " ".join(injections)
                
                for ean in local_eans:
                    raw_clusters.append({"ean": ean, "extracted_text": enhanced_text})

        combined_text = " ".join(global_text_parts)
        
        merged = {}
        for c in raw_clusters:
            ean = c['ean']
            if ean not in merged: merged[ean] = ""
            merged[ean] += " " + c['extracted_text']
            
        final_clusters = [{"ean": k, "extracted_text": clean_text(v)} for k, v in merged.items()]
        
        if not final_clusters and combined_text:
             final_clusters.append({"ean": "NO_EAN", "extracted_text": clean_text(combined_text)})
             
        return final_clusters, clean_text(combined_text)

class CareLabelStrategy(OCRStrategy):
    """
    MODE: CARE LABELS (LAVAGE)
    Cible : Étiquettes cousues / Stickers produits
    Technique : Recherche 'Lot n°' -> Injection PO
    """
    def process(self, images):
        raw_clusters = []
        global_text_parts = []
        
        for img in images:
            # Sécurité 4 angles car parfois l'étiquette est scannée verticalement
            for angle in [0, 90, 180, 270]: 
                rot_img = img.rotate(angle, expand=True) if angle else img
                prep_img = basic_image_prep(rot_img)
                
                decoded = decode(rot_img)
                local_eans = [obj.data.decode("utf-8") for obj in decoded]
                
                # PSM 6 (Block) est souvent meilleur pour ces étiquettes denses
                text = pytesseract.image_to_string(prep_img, config='--psm 6')
                global_text_parts.append(text)
                
                injections = []
                # Regex Spécifique Care Label : "Lot n°207184"
                lot_match = re.search(r"(?:Lot\s*n[°o]\.?|Lot)\s*[:.]?\s*(\d+)", text, re.IGNORECASE)
                if lot_match:
                     injections.append(f"ORDER_FOUND:{lot_match.group(1)}")
                
                enhanced_text = text + " " + " ".join(injections)
                
                for ean in local_eans:
                    raw_clusters.append({"ean": ean, "extracted_text": enhanced_text})

        combined_text = " ".join(global_text_parts)
        
        merged = {}
        for c in raw_clusters:
            ean = c['ean']
            if ean not in merged: merged[ean] = ""
            merged[ean] += " " + c['extracted_text']
        
        final_clusters = [{"ean": k, "extracted_text": clean_text(v)} for k, v in merged.items()]
        
        # Fallback pour Care Label sans EAN (rare mais possible si coupé)
        if not final_clusters and combined_text:
             final_clusters.append({"ean": "NO_EAN_CARE", "extracted_text": clean_text(combined_text)})
             
        return final_clusters, clean_text(combined_text)

# --- 6. API ENDPOINTS ---

@app.post("/upload-po")
async def upload_po(file: UploadFile = File(...)):
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="File must be a PDF")
    contents = await file.read()
    response_data = {"po_number": "Unknown", "products": []}
    BLACKLIST_EANS = ["3014627500109"]
    try:
        with pdfplumber.open(io.BytesIO(contents)) as pdf:
            first_page_text = pdf.pages[0].extract_text() or ""
            lot_match = re.search(r"Order No\.\s*(\d+)", first_page_text)
            if lot_match: response_data["po_number"] = lot_match.group(1)
            found_eans = set()
            for page in pdf.pages:
                tables = page.extract_tables()
                for table in tables:
                    for row in table:
                        clean_row = [str(cell).replace('\n', ' ').strip() if cell else '' for cell in row]
                        if len(clean_row) > 3 and len(clean_row[1]) > 3:
                            ref_candidate = clean_row[1]
                            raw_desc_text = clean_row[3]
                            if "REF." in ref_candidate or "DESCRIPTION" in raw_desc_text: continue
                            product = {
                                "ref": ref_candidate,
                                "description": clean_text(raw_desc_text),
                                "ean": None, "color": None, "size": None, "composition": "Not Found",
                                "qty": clean_row[7] if len(clean_row) > 7 else "0"
                            }
                            ean_match = re.search(r"(3\d{12})", raw_desc_text)
                            if ean_match: product["ean"] = ean_match.group(1)
                            color_match = re.search(r"Color\s*:\s*([A-Z0-9]+(?:\s(?!Composition|Treatment|Folding)[A-Z0-9]+)*)", raw_desc_text, re.IGNORECASE)
                            if color_match: product["color"] = color_match.group(1)
                            elif "(" in product["description"]:
                                paren_match = re.search(r"\(([A-Z]+)\)", product["description"])
                                if paren_match: product["color"] = paren_match.group(1)
                            size_match = re.search(r"(\d+\s*[xX]\s*\d+)", raw_desc_text)
                            if size_match: product["size"] = size_match.group(1).upper()
                            product["composition"] = extract_composition_smart(raw_desc_text)
                            if product["ref"] and product["ean"]:
                                if product["ean"] not in BLACKLIST_EANS:
                                    response_data["products"].append(product)
                                    found_eans.add(product["ean"])
                page_text = page.extract_text() or ""
                text_ean_matches = re.finditer(r"(3\d{12})", page_text)
                for match in text_ean_matches:
                    ean = match.group(1)
                    if ean in found_eans or ean in BLACKLIST_EANS: continue
                    start_idx = max(0, match.start() - 150)
                    end_idx = min(len(page_text), match.end() + 400)
                    context = page_text[start_idx:end_idx].replace('\n', ' ')
                    ref_candidates = re.findall(r"\b([A-Z0-9]{5,15})\b", context)
                    blacklist_words = ["DESCRIPTION", "SUPPLIER", "REF", "CODE", "AMOUNT", "TOTAL", "PAYMENT", "PAGE", "DATE", "ORDER", "PARCELS", "VOLUME", "PCBS", "UNITS", "VAT", "HSCODE", "INCOTERM"]
                    if response_data["po_number"] != "Unknown": blacklist_words.append(response_data["po_number"])
                    valid_refs = []
                    for r in ref_candidates:
                        if (r.upper() not in blacklist_words and not r.isdigit() and len(re.findall(r'\d', r)) > 0 and not re.match(r'^\d+\s*[xX]\s*\d+$', r, re.IGNORECASE)):
                            valid_refs.append(r)
                    ref = valid_refs[0] if valid_refs else "UNKNOWN_REF"
                    bracket_match = re.search(r"\[.*?\]", context)
                    desc_clean = context[bracket_match.start():] if bracket_match else context.replace(ref, "").strip()
                    product = {"ref": ref, "description": clean_text(desc_clean[:150]), "ean": ean, "qty": "1", "color": None, "size": None, "composition": "Not Found"}
                    unit_anchor = re.search(r"(Units?|Pcb|U\.|st\.)", context, re.IGNORECASE)
                    if unit_anchor:
                        before_text = context[max(0, unit_anchor.start()-30):unit_anchor.start()]
                        qty_number_match = re.findall(r"([\d,]+(?:\.\d+)?)", before_text)
                        if qty_number_match:
                            q_val = qty_number_match[-1]
                            q_unit = unit_anchor.group(1)
                            if "202" not in q_val:
                                final_qty_str = f"{q_val} {q_unit}"
                                after_text = context[unit_anchor.end():unit_anchor.end()+100]
                                pcb_match = re.search(r"(\(.*?(?:Pcb|PCB).*?\))", after_text, re.IGNORECASE)
                                if not pcb_match: pcb_match = re.search(r"(\d+\s*(?:Pcb|PCB)\s*\d*)", after_text, re.IGNORECASE)
                                if pcb_match: final_qty_str += f" {clean_text(pcb_match.group(1))}"
                                product["qty"] = clean_text(final_qty_str)
                    color_match = re.search(r"Color\s*:\s*([A-Z0-9]+(?:\s(?!Composition|Treatment|Folding)[A-Z0-9]+)*)", context, re.IGNORECASE)
                    if color_match: product["color"] = color_match.group(1)
                    size_match = re.search(r"(\d+\s*[xX]\s*\d+)", context)
                    if size_match: product["size"] = size_match.group(1).upper()
                    product["composition"] = extract_composition_smart(context)
                    response_data["products"].append(product)
                    found_eans.add(ean)
        return {"status": "success", "data": response_data}
    except Exception as e:
        print(f"Error parsing PO: {e}")
        return {"status": "error", "detail": str(e)}

@app.post("/upload-label")
async def upload_label(
    file: UploadFile = File(...),
    mode: str = Form("standard")
):
    try:
        contents = await file.read()
        images_to_process = []
        is_pdf_vector = False

        if file.filename.lower().endswith('.pdf'):
            pdf = pdfium.PdfDocument(io.BytesIO(contents))
            # Extraction Vecteur pour Inserts uniquement
            if mode == 'insert':
                full_text = ""
                for page in pdf:
                    full_text += page.get_textpage().get_text_range() + " "
                if len(full_text.strip()) > 50:
                    is_pdf_vector = True
                    final_clusters = [{"ean": "PDF_VECTOR", "extracted_text": clean_text(full_text)}]
                    global_text = clean_text(full_text)
            
            if not is_pdf_vector:
                for i in range(len(pdf)):
                    page = pdf[i]
                    # Haute DPI pour Shipping et Care pour lire les petits caractères
                    scale = 4 if mode in ['shipping', 'care'] else 3
                    pil_image = page.render(scale=scale).to_pil()
                    images_to_process.append(pil_image)
        else:
            images_to_process.append(Image.open(io.BytesIO(contents)))

        if is_pdf_vector:
            return {"status": "success", "filename": file.filename, "clusters": final_clusters, "global_text": global_text, "mode": mode}

        # SÉLECTION DE STRATÉGIE
        processor = None
        if mode == 'shipping':
            processor = ShippingMarkStrategy()
        elif mode == 'insert':
            processor = InsertStrategy()
        elif mode == 'care':
            processor = CareLabelStrategy()
        else:
            processor = StandardStrategy()

        final_clusters, global_text = processor.process(images_to_process)

        return {
            "status": "success", 
            "filename": file.filename,
            "clusters": final_clusters,
            "global_text": global_text,
            "mode": mode
        }
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"status": "error", "detail": f"Processing Failed ({mode}): " + str(e)}

@app.post("/shutdown")
async def shutdown():
    def kill(): os._exit(0)
    threading.Timer(0.1, kill).start()
    return {"status": "shutdown", "message": "Application is closing..."}

# --- 7. SERVE UI ---
app_ui_path = get_resource_path("app_ui")
assets_path = os.path.join(app_ui_path, "assets")
if os.path.exists(assets_path):
    app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

@app.get("/{full_path:path}")
async def serve_react_app(full_path: str):
    file_path = os.path.join(app_ui_path, full_path)
    if os.path.exists(file_path) and os.path.isfile(file_path): return FileResponse(file_path)
    index_path = os.path.join(app_ui_path, "index.html")
    if os.path.exists(index_path): return FileResponse(index_path)
    return {"error": "UI files not found."}

if __name__ == "__main__":
    def open_browser(): webbrowser.open("http://localhost:8000")
    threading.Timer(1.5, open_browser).start()
    uvicorn.run(app, host="0.0.0.0", port=8000, log_config=None)