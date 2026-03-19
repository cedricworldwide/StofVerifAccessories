# StofVerifAccessories
# 🏷️ Stof QC Verifier (V6.2.0)

**Stof QC Verifier** est une application desktop automatisée conçue pour le contrôle qualité des étiquettes textiles. Elle compare intelligemment les données extraites d'un Bon de Commande (Purchase Order) avec les informations lues sur des étiquettes physiques ou maquettes numériques via reconnaissance optique de caractères (OCR) et lecture de codes-barres.

## ✨ Fonctionnalités Principales

- **Extraction Automatique des PO :** Parse les PDF de Bons de Commande pour en extraire l'EAN, la Référence, le PO, la Taille, la Couleur et la Composition.
- **Moteur d'Analyse Multi-Stratégies (OCR) :**
  - 🔵 **Standard :** Analyse mixte avec clustering spatial autour du code-barres.
  - 🟣 **Inserts :** Analyse 360° pour les artworks marketing et band rolls (lecture des tranches).
  - 🟤 **Cartons (Shipping) :** Prétraitement d'image agressif pour les étiquettes logistiques.
  - 🟠 **Lavage (Care Labels) :** Détection haute densité spécialisée sur les mentions "Lot n°" et compositions.
- **Validation "Fuzzy Logic" & Smart OCR :** Corrige automatiquement les erreurs de lecture fréquentes (ex: la lettre "O" lue à la place du chiffre "0") et tolère les imperfections d'impression grâce à la distance de Levenshtein.
- **Interface Avancée :** Visualiseur de documents intégré (Zoom molette, Pan) et vues modifiables (Grille / Liste).

## 🛠️ Stack Technique

- **Backend :** Python 3, FastAPI, Uvicorn
- **Traitement Image / OCR :** OpenCV, PyTesseract, PyZbar, PyPDFium2, PDFPlumber
- **Frontend :** React, Vite, TailwindCSS, Lucide Icons
- **Compilation :** PyInstaller (Mode OneFile Standalone)

## 🚀 Installation & Développement (Hot Reload)

Le projet utilise une architecture découplée en développement, reliée par un proxy Vite.

### Prérequis
- Node.js & npm
- Python 3.10+
- Tesseract-OCR installé sur la machine (ou intégré dans un dossier `Tesseract-OCR` à la racine).

### 1. Démarrer le Backend (Terminal 1)
```bash
# Activer l'environnement virtuel (recommandé)
pip install -r requirements.txt
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
