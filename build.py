import PyInstaller.__main__
import os
import pyzbar
import cv2

# 1. Find pyzbar location to bundle DLLs
pyzbar_dir = os.path.dirname(pyzbar.__file__)
print(f"Found pyzbar at: {pyzbar_dir}")

# 2. Define arguments
args = [
    'main.py',
    '--noconfirm',
    '--onefile',
    '--windowed',
    '--name=StofQCVerifier',
    
    # --- METADATA & VERSIONING ---
    '--version-file=version_info.txt',

    # Bundle the Frontend (UI)
    '--add-data=app_ui;app_ui',
    
    # Bundle pyzbar DLLs (Critical for barcode reading)
    f'--add-data={pyzbar_dir};pyzbar',

    # --- OPENCV & OCR SUPPORT (NOUVEAU) ---
    '--collect-submodules=cv2',
    '--collect-data=cv2',
    '--hidden-import=numpy',
    '--hidden-import=pytesseract',

    # --- PDF SUPPORT DEPENDENCIES ---
    '--hidden-import=pypdfium2',
    '--hidden-import=pdfplumber',

    # Hidden imports for Uvicorn/FastAPI
    '--hidden-import=uvicorn.logging',
    '--hidden-import=uvicorn.loops',
    '--hidden-import=uvicorn.loops.auto',
    '--hidden-import=uvicorn.protocols',
    '--hidden-import=uvicorn.protocols.http',
    '--hidden-import=uvicorn.protocols.http.auto',
    '--hidden-import=uvicorn.lifespan',
    '--hidden-import=uvicorn.lifespan.on',
    
    # Nécessaire pour les formulaires FastAPI
    '--hidden-import=python-multipart',
]

# 3. Run build
print("Starting build with OpenCV and Version Info...")
PyInstaller.__main__.run(args)
print("Build complete! Check the 'dist' folder.")