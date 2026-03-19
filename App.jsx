import { useState, useMemo, useEffect, useRef } from 'react'
import axios from 'axios'
import { CheckCircle2, XCircle, AlertCircle, FileText, ScanBarcode, Upload, Layers, LayoutGrid, List as ListIcon, ArrowUpDown, ArrowUp, ArrowDown, Power, Eye, EyeOff, Maximize2, Settings, Box, Tag } from 'lucide-react'

function App() {
  const [poData, setPoData] = useState(null)
  const [labelData, setLabelData] = useState(null) 
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [viewMode, setViewMode] = useState('grid')
  const [analysisMode, setAnalysisMode] = useState('standard') 

  // --- PREVIEW STATE ---
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewType, setPreviewType] = useState(null)
  const [showPreview, setShowPreview] = useState(true)

  // --- IMAGE STATE ---
  const [imgScale, setImgScale] = useState(1)
  const [imgPos, setImgPos] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  
  const imgRef = useRef(null)
  const containerRef = useRef(null)

  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'ascending' })

  useEffect(() => { setImgPos({ x: 0, y: 0 }) }, [previewUrl])
  useEffect(() => { return () => { if (previewUrl) URL.revokeObjectURL(previewUrl) } }, [previewUrl])

  const handleImageLoad = () => {
    if (!imgRef.current || !containerRef.current) return;
    const { naturalWidth, naturalHeight } = imgRef.current;
    const { clientWidth, clientHeight } = containerRef.current;
    const scaleToFit = Math.min(clientWidth / naturalWidth, clientHeight / naturalHeight, 1) * 0.95;
    setImgScale(scaleToFit);
    setImgPos({ x: 0, y: 0 });
  };

  const handleMouseDown = (e) => { if (previewType === 'image') { setIsDragging(true); e.preventDefault() } }
  const handleMouseMove = (e) => {
    if (isDragging && previewType === 'image') {
        setImgPos(prev => ({ x: prev.x + e.movementX, y: prev.y + e.movementY }))
    }
  }
  const handleMouseUp = () => setIsDragging(false)
  const handleWheel = (e) => {
    if (previewType === 'image') {
        const delta = e.deltaY > 0 ? -0.15 : 0.15
        setImgScale(prev => Math.min(Math.max(0.1, prev + delta), 8))
    }
  }

  // --- UTILS DE COMPARAISON ---

  const getLevenshteinDistance = (a, b) => {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
            }
        }
    }
    return matrix[b.length][a.length];
  };

  const isFuzzyMatch = (source, target, threshold = 0.8) => {
    if (!source || !target) return false;
    const s = source.toLowerCase().replace(/[^a-z0-9]/g, '');
    const t = target.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (t.includes(s)) return true;
    
    const distance = getLevenshteinDistance(s, t);
    const longest = Math.max(s.length, t.length);
    return (longest - distance) / longest >= threshold;
  };

  // Normalisateur "Smart" (Gère la confusion OCR Lettres/Chiffres)
  const smartNormalize = (str) => {
      if (!str) return "";
      return str.toUpperCase()
          .replace(/O/g, '0') // O -> 0
          .replace(/I/g, '1') // I -> 1
          .replace(/L/g, '1') // l -> 1
          .replace(/Z/g, '2') // Z -> 2
          .replace(/S/g, '5') // S -> 5
          .replace(/B/g, '8') // B -> 8
          .replace(/[^A-Z0-9]/g, ''); // Nettoyage strict
  };

  // Match Robuste par Token (Idéal pour trouver une REF dans un long texte)
  const robustTokenMatch = (sourceValue, hugeText, threshold = 0.85) => {
      if (!sourceValue || !hugeText) return false;
      
      const normSource = smartNormalize(sourceValue);
      // Découpage en mots pour analyser chaque bloc de texte
      const tokens = hugeText.split(/[\s,.:;()\[\]\-_]+/);
      
      return tokens.some(token => {
          // 1. Check rapide brut
          if (token.includes(sourceValue)) return true;
          
          // 2. Check Normalisé (Gère CE192OO1 vs CE192001)
          const normToken = smartNormalize(token);
          // Si threshold est 1.0 (Strict), on exige l'égalité parfaite
          if (threshold >= 0.99) {
              return normToken === normSource || normToken.includes(normSource);
          }

          // 3. Fuzzy (Seulement si threshold < 1.0)
          const distance = getLevenshteinDistance(normSource, normToken);
          const longest = Math.max(normSource.length, normToken.length);
          const score = (longest - distance) / longest;
          
          return score >= threshold;
      });
  };

  const handleShutdown = async () => {
    if (confirm("Voulez-vous vraiment fermer l'application ?")) {
        try { await axios.post('/shutdown') } catch (err) { console.log("Shutdown signal sent") } 
        finally { window.close(); document.body.innerHTML = "<h1 style='text-align:center;padding-top:50px'>Application Fermée</h1>"; }
    }
  }

  const handlePoUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const formData = new FormData(); formData.append('file', file);
    try {
      setLoading(true); setError(null);
      const res = await axios.post('/upload-po', formData);
      if (res.data.status === 'success') setPoData(res.data.data);
      else setError("Erreur PO: " + (res.data.detail || "Fichier invalide"));
    } catch (err) { setError("Erreur serveur (Backend hors ligne ?)"); } 
    finally { setLoading(false); }
  }

  const handleLabelUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setPreviewType(file.type === 'application/pdf' ? 'pdf' : 'image');
    setShowPreview(true);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('mode', analysisMode);

    try {
      setLoading(true); setError(null); setLabelData(null); 
      const res = await axios.post('/upload-label', formData);
      if (res.data.status === 'success') setLabelData(res.data);
      else setError("Erreur Analyse: " + (res.data.detail || "Impossible de lire"));
    } catch (err) { setError("Erreur réseau ou format incorrect."); } 
    finally { setLoading(false); }
  }

  // --- LOGIC DE MATCHING V6.2.0 (STRICT HYBRIDE) ---
  const checkMatch = (field, sourceValue, productEan, labelContext) => {
    const mkRes = (status, debugText = null) => ({ status, debugText: debugText || sourceValue })
    if (!sourceValue || !labelContext || !labelContext.clusters) return mkRes("pending")
    
    // 1. Identification du Cluster
    let targetCluster = null;
    if (analysisMode === 'insert') {
        targetCluster = labelContext.clusters[0]; 
    } else {
        const cleanProductEan = (productEan || "").replace(/[^0-9]/g, '');
        targetCluster = labelContext.clusters.find(c => {
            const cEan = c.ean.replace(/[^0-9]/g, '');
            return cEan.includes(cleanProductEan) || cEan === "NO_EAN" || cEan === "NO_EAN_FOUND" || cEan === "NO_EAN_CARE";
        });
    }

    if (!targetCluster) return mkRes("fail", "Cluster introuvable");

    const localText = targetCluster.extracted_text || "";
    // Pour EAN uniquement: on crée une soupe de chiffres globale
    const globalDigits = localText.replace(/[^0-9]/g, ''); 

    // --- LOGIQUE EAN (Correction Faux Négatifs) ---
    if (field === 'ean') {
        const cleanEan = (productEan || "").replace(/[^0-9]/g, '');
        
        // Mode Insert : On cherche la séquence dans la soupe globale (ignore les espaces 3 6 6...)
        if (analysisMode === 'insert') {
            if (globalDigits.includes(cleanEan)) {
                return mkRes("pass", `EAN trouvé (Global Digits)`);
            } else {
                return mkRes("fail", `EAN ${productEan} absent.`);
            }
        }
        
        // Mode Standard : Priorité Code-barres
        const cEan = targetCluster.ean.replace(/[^0-9]/g, '');
        if (cEan.includes(cleanEan)) return mkRes("pass", "EAN Scanné");
        if (globalDigits.includes(cleanEan)) return mkRes("pass", "EAN OCR");
        
        return mkRes("fail", "EAN manquant");
    }
    
    // --- LOGIQUE REF (Correction Faux Positifs) ---
    if (field === 'ref') {
        const exactRef = (sourceValue || "").trim();
        // 1. Exact brut
        if (localText.includes(exactRef)) return mkRes("pass", "Ref Exacte");
        
        // 2. Analyse de la nature de la REF (Code vs Texte)
        const hasDigits = /\d/.test(exactRef);
        
        // Si la REF contient des chiffres (ex: CE192001), on active le mode STRICT (1.0)
        // Cela empêche CE192001 de matcher CE192002 via Fuzzy
        // Mais smartNormalize permet toujours de matcher CE192OO1 (OCR error)
        const threshold = hasDigits ? 1.0 : 0.85; 
        
        if (robustTokenMatch(sourceValue, localText, threshold)) {
             return mkRes("pass", hasDigits ? "Ref Validée (Code Strict)" : "Ref Validée (Fuzzy)");
        }
        
        return mkRes("fail", `Ref "${sourceValue}" introuvable.`);
    }

    // --- LOGIQUE PO (ORDER) ---
    if (field === 'po') {
        if (localText.includes(`ORDER_FOUND:${sourceValue}`)) return mkRes("pass", "PO Validé (Meta)");
        if (localText.includes(sourceValue)) return mkRes("pass", "PO Exact");
        // PO est numérique => seuil élevé
        if (robustTokenMatch(sourceValue, localText, 0.90)) return mkRes("pass", "PO Fuzzy");
        return mkRes("fail", `PO "${sourceValue}" non trouvé.`);
    }

    // --- LOGIQUE TAILLE (SIZE) ---
    if (field === 'size') {
        const normalizeSize = (s) => (s || "").toUpperCase().replace(/O/g, '0').replace(/[^0-9X]/g, '');
        const targetSize = normalizeSize(sourceValue);
        const cleanLocal = normalizeSize(localText);
        
        if (cleanLocal.includes(targetSize) && targetSize.length > 2) return mkRes("pass", `Taille ${targetSize}`);
        
        const parts = targetSize.split('X');
        if (parts.length === 2) {
            const regex = new RegExp(`${parts[0]}\\s*[xX]\\s*${parts[1]}`, 'i');
            if (regex.test(localText)) return mkRes("pass", "Taille (Regex)");
        }
        return mkRes("fail", `Taille "${sourceValue}" non trouvée.`);
    }
    
    // --- LOGIQUE COULEUR ---
    if (field === 'color') {
        if (robustTokenMatch(sourceValue, localText, 0.85)) return mkRes("pass");
        return mkRes("fail", `Couleur "${sourceValue}" introuvable.`);
    }

    // --- LOGIQUE COMPOSITION ---
    if (field === 'composition') {
        if (analysisMode === 'shipping') return mkRes("pending", "Ignoré (Carton)"); 
        if (!sourceValue || sourceValue === "Not Found") return mkRes("pending");
        
        const normalizeComp = (str) => {
            return str.toLowerCase().replace(/\.0%/g, '%').replace(/\s+/g, '')
                .replace(/cotton/g, 'coton').replace(/linen/g, 'lin')
                .replace(/velvet/g, 'velours').replace(/polyester/g, 'polyester');
        }
        
        const parts = sourceValue.split(' ');
        const normLocal = normalizeComp(localText);
        
        const localMatch = parts.every(part => {
            const normPart = normalizeComp(part);
            return normLocal.includes(normPart) || isFuzzyMatch(normPart, normLocal, 0.85);
        });
        
        if (localMatch) return mkRes("pass");
        return mkRes("fail", "Compo non trouvée");
    }

    return mkRes("fail", "Champ inconnu");
  }

  // --- SORTING ---
  const requestSort = (key) => {
    let direction = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') direction = 'descending';
    setSortConfig({ key, direction });
  };

  const sortedProducts = useMemo(() => {
    if (!poData || !poData.products) return [];
    let sortableItems = [...poData.products];
    if (sortConfig.key !== null) {
      sortableItems.sort((a, b) => {
        let aVal = a[sortConfig.key] || "";
        let bVal = b[sortConfig.key] || "";
        if (sortConfig.key === 'qty') { aVal = parseFloat(aVal) || 0; bVal = parseFloat(bVal) || 0; }
        else { aVal = aVal.toString().toLowerCase(); bVal = bVal.toString().toLowerCase(); }
        if (aVal < bVal) return sortConfig.direction === 'ascending' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'ascending' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [poData, sortConfig]);

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 pb-20">
      {/* HEADER */}
      <header className="bg-white border-b sticky top-0 z-20 shadow-sm">
        <div className="max-w-[1920px] mx-auto px-4 py-3 flex flex-col md:flex-row justify-between items-center gap-4">
            <div>
                <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                    <CheckCircle2 className="text-emerald-600" /> Stof QC Verifier <span className="text-xs bg-indigo-100 text-indigo-800 px-2 py-1 rounded">V6.2.0</span>
                </h1>
            </div>
            
            <div className="flex items-center gap-3">
                 <button onClick={handleShutdown} className="p-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-600 hover:text-white border border-red-200 transition-colors" title="Fermer"><Power size={18} /></button>
                 <div className="h-6 w-px bg-slate-200 mx-2"></div>
                 <div className="bg-slate-100 p-1 rounded-lg flex border border-slate-200">
                    <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded-md ${viewMode === 'grid' ? 'bg-white shadow text-indigo-600' : 'text-slate-400'}`}><LayoutGrid size={18} /></button>
                    <button onClick={() => setViewMode('list')} className={`p-1.5 rounded-md ${viewMode === 'list' ? 'bg-white shadow text-indigo-600' : 'text-slate-400'}`}><ListIcon size={18} /></button>
                 </div>
                 {previewUrl && (
                    <button onClick={() => setShowPreview(!showPreview)} className={`p-2 rounded-lg border transition-colors flex items-center gap-2 text-sm font-medium ${showPreview ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-600 border-slate-300'}`}>
                        {showPreview ? <Eye size={18}/> : <EyeOff size={18}/>} <span className="hidden sm:inline">Doc</span>
                    </button>
                 )}
                 <div className="h-6 w-px bg-slate-200 mx-2"></div>
                 <UploadButton label={poData ? `PO: ${poData.po_number}` : "Upload PO"} icon={<FileText size={16}/>} onChange={handlePoUpload} active={!!poData} accept=".pdf"/>
                 
                 {/* --- PRESET SELECTOR --- */}
                 <div className="flex bg-white rounded-lg border border-slate-300 overflow-hidden divide-x divide-slate-300">
                    <select 
                        value={analysisMode} 
                        onChange={(e) => setAnalysisMode(e.target.value)}
                        className="px-3 py-1.5 bg-slate-50 text-sm font-medium text-slate-700 hover:bg-slate-100 outline-none cursor-pointer appearance-none text-center min-w-[100px]"
                        title="Mode d'Analyse"
                    >
                        <option value="standard">Standard</option>
                        <option value="insert">Inserts</option>
                        <option value="shipping">Cartons</option>
                        <option value="care">Care lbl</option>
                    </select>
                    <UploadButton label="Labels" icon={<ScanBarcode size={16}/>} onChange={handleLabelUpload} active={!!labelData} color="indigo" accept=".pdf, image/*" noWrapper/>
                 </div>
            </div>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="max-w-[1920px] mx-auto px-4 py-6">
        {loading && <LoadingSpinner />}
        {error && <ErrorBanner msg={error} />}
        {!poData && !loading && <WelcomeState />}

        {poData && (
            <div className="flex flex-col lg:flex-row gap-6 items-start">
                <div className={`flex-1 min-w-0 transition-all duration-300 ${showPreview && previewUrl ? 'lg:w-3/5' : 'w-full'}`}>
                    <div className="flex justify-between items-end mb-4">
                        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            Validation Results 
                            <span className="text-xs font-normal bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full flex items-center gap-1">
                                {analysisMode === 'shipping' ? <Box size={10}/> : analysisMode === 'insert' ? <Layers size={10}/> : <Tag size={10}/>}
                                {analysisMode.toUpperCase()}
                            </span>
                        </h2>
                    </div>

                    {viewMode === 'grid' ? (
                        <div className={`grid grid-cols-1 gap-4 ${showPreview && previewUrl ? 'xl:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3'}`}>
                            {sortedProducts.map((product, idx) => (
                                <ProductCard key={`${product.ref}-${idx}`} product={product} poNumber={poData.po_number} labelData={labelData} checkMatch={checkMatch} />
                            ))}
                        </div>
                    ) : (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-bold text-xs">
                                    <tr>
                                        <SortableHeader label="Ref" sortKey="ref" currentSort={sortConfig} requestSort={requestSort} />
                                        <SortableHeader label="Desc" sortKey="description" currentSort={sortConfig} requestSort={requestSort} />
                                        <SortableHeader label="PO" sortKey="po" currentSort={sortConfig} requestSort={requestSort} center />
                                        <SortableHeader label="EAN" sortKey="ean" currentSort={sortConfig} requestSort={requestSort} center />
                                        <SortableHeader label="Color" sortKey="color" currentSort={sortConfig} requestSort={requestSort} center />
                                        <SortableHeader label="Size" sortKey="size" currentSort={sortConfig} requestSort={requestSort} center />
                                        <SortableHeader label="Comp" sortKey="composition" currentSort={sortConfig} requestSort={requestSort} center />
                                        <SortableHeader label="Qty" sortKey="qty" currentSort={sortConfig} requestSort={requestSort} right />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {sortedProducts.map((product, idx) => (
                                        <ProductRow key={`${product.ref}-${idx}`} product={product} poNumber={poData.po_number} labelData={labelData} checkMatch={checkMatch} />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {labelData && <DebugSection labelData={labelData} />}
                </div>

                {/* PREVIEW */}
                {showPreview && previewUrl && (
                    <div className="w-full lg:w-[45%] xl:w-[40%] shrink-0 sticky top-24 h-[calc(100vh-120px)] bg-slate-800 rounded-xl overflow-hidden shadow-xl border border-slate-700 flex flex-col">
                        <div className="bg-slate-900 text-slate-300 px-4 py-2 text-xs font-bold flex justify-between items-center border-b border-slate-700">
                            <span className="flex items-center gap-2"><Maximize2 size={14}/> Preview</span>
                            <div className="flex gap-3">
                                {previewType === 'image' && <span className="text-[10px] text-slate-500 italic hidden xl:inline">Zoom: Molette</span>}
                                <button onClick={() => setShowPreview(false)} className="hover:text-white transition-colors"><XCircle size={16}/></button>
                            </div>
                        </div>
                        <div className="flex-1 bg-slate-900 relative overflow-hidden" onWheel={handleWheel} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
                            {previewType === 'pdf' ? <iframe src={previewUrl} className="w-full h-full" title="PDF"></iframe> : 
                            <div ref={containerRef} className="w-full h-full flex justify-center items-center">
                                <img ref={imgRef} src={previewUrl} className="max-w-none transition-transform duration-75 ease-out select-none" style={{ transform: `translate(${imgPos.x}px, ${imgPos.y}px) scale(${imgScale})`, cursor: isDragging ? 'grabbing' : 'grab' }} alt="Preview" draggable="false" onLoad={handleImageLoad} />
                            </div>}
                        </div>
                    </div>
                )}
            </div>
        )}
      </main>
    </div>
  )
}

// --- HELPERS (Identiques) ---
function SortableHeader({ label, sortKey, currentSort, requestSort, center, right }) {
    const isActive = currentSort.key === sortKey;
    const alignClass = center ? "justify-center" : right ? "justify-end" : "justify-start";
    return <th className={`px-4 py-3 cursor-pointer hover:bg-slate-100 ${center?'text-center':right?'text-right':'text-left'}`} onClick={() => requestSort(sortKey)}><div className={`flex items-center gap-1 ${alignClass}`}>{label} <div className="text-slate-400">{isActive ? (currentSort.direction==='ascending'?<ArrowUp size={14}/>:<ArrowDown size={14}/>) : <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-50"/>}</div></div></th>
}

function UploadButton({ label, icon, onChange, active, color = 'slate', accept, noWrapper }) {
    const bgClass = active ? (color === 'indigo' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-white') : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50';
    const btn = <button className={`px-3 py-1.5 ${noWrapper ? '' : 'rounded-lg border'} flex items-center gap-2 text-sm font-medium transition-colors ${bgClass} ${noWrapper ? 'h-full border-0' : ''}`}>{icon} {label}</button>;
    return noWrapper ? <div className="relative group cursor-pointer"><input type="file" onChange={onChange} accept={accept} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />{btn}</div> : <div className="relative group"><input type="file" onChange={onChange} accept={accept} className="absolute inset-0 w-full opacity-0 cursor-pointer" />{btn}</div>
}

function ProductCard({ product, poNumber, labelData, checkMatch }) {
    const checks = {
        po: checkMatch('po', poNumber, product.ean, labelData),
        ean: checkMatch('ean', product.ean, product.ean, labelData),
        ref: checkMatch('ref', product.ref, product.ean, labelData),
        color: checkMatch('color', product.color, product.ean, labelData),
        size: checkMatch('size', product.size, product.ean, labelData),
        comp: checkMatch('composition', product.composition, product.ean, labelData)
    }
    const statuses = Object.values(checks).map(c => c.status);
    const statusBorder = statuses.includes("fail") ? "border-red-400 ring-1 ring-red-100 bg-red-50/10" : statuses.every(v => v === "pass") ? "border-emerald-500 ring-1 ring-emerald-100 bg-emerald-50/10" : "border-slate-200";
    return (
        <div className={`bg-white rounded-xl shadow-sm border p-4 transition-all ${statusBorder}`}>
            <div className="flex justify-between items-start mb-3"><div><h3 className="font-bold text-base text-slate-900">{product.ref}</h3><p className="text-xs text-slate-500 line-clamp-1">{product.description}</p></div><span className="text-xs font-bold bg-slate-100 px-2 py-1 rounded text-slate-600">x{product.qty}</span></div>
            <div className="space-y-1.5">
                <CheckRow label="PO" value={poNumber} checkResult={checks.po} />
                <CheckRow label="EAN" value={product.ean} checkResult={checks.ean} />
                <CheckRow label="REF" value={product.ref} checkResult={checks.ref} />
                <CheckRow label="Size" value={product.size} checkResult={checks.size} />
                <CheckRow label="Color" value={product.color} checkResult={checks.color} />
                <CheckRow label="Comp" value={product.composition} checkResult={checks.comp} truncate />
            </div>
        </div>
    )
}

function ProductRow({ product, poNumber, labelData, checkMatch }) {
    const checks = {
        po: checkMatch('po', poNumber, product.ean, labelData),
        ean: checkMatch('ean', product.ean, product.ean, labelData),
        ref: checkMatch('ref', product.ref, product.ean, labelData),
        color: checkMatch('color', product.color, product.ean, labelData),
        size: checkMatch('size', product.size, product.ean, labelData),
        comp: checkMatch('composition', product.composition, product.ean, labelData)
    }
    const statuses = Object.values(checks).map(c => c.status);
    const rowClass = statuses.includes("fail") ? "bg-red-50 hover:bg-red-100" : statuses.every(v => v === "pass") ? "bg-green-50 hover:bg-green-100" : "hover:bg-slate-50";
    return (
        <tr className={`transition-colors ${rowClass}`}>
            <td className="px-4 py-3 font-bold text-slate-900"><StatusBadge checkResult={checks.ref} value={product.ref} /></td>
            <td className="px-4 py-3 text-slate-500 text-xs max-w-[150px] truncate">{product.description}</td>
            <td className="px-4 py-3 text-center"><StatusBadge checkResult={checks.po} value={poNumber} truncate /></td>
            <td className="px-4 py-3 text-center"><StatusBadge checkResult={checks.ean} value={product.ean} /></td>
            <td className="px-4 py-3 text-center"><StatusBadge checkResult={checks.color} value={product.color} /></td>
            <td className="px-4 py-3 text-center"><StatusBadge checkResult={checks.size} value={product.size} /></td>
            <td className="px-4 py-3 text-center"><StatusBadge checkResult={checks.comp} value={product.composition} truncate /></td>
            <td className="px-4 py-3 text-right font-mono text-xs">{product.qty}</td>
        </tr>
    )
}

function StatusBadge({ checkResult, value, truncate }) {
    const status = checkResult?.status || "pending";
    if (!value || value === "Not Found") return <span className="text-slate-300">-</span>;
    const color = status === "pass" ? "bg-emerald-100 text-emerald-700 border border-emerald-200" : status === "fail" ? "bg-red-100 text-red-700 border border-red-200 cursor-help" : "bg-slate-100 text-slate-500";
    return <span className={`inline-block px-2 py-1 rounded text-xs font-bold max-w-[100px] ${truncate ? 'truncate align-bottom' : ''} ${color}`} title={checkResult?.debugText || value}>{value}</span>
}

function CheckRow({ label, value, checkResult, truncate }) {
    const status = checkResult?.status || "pending";
    const icon = status === "pass" ? <CheckCircle2 size={16} className="text-emerald-500" /> : status === "fail" ? <XCircle size={16} className="text-red-500 cursor-help" /> : <div className="w-2 h-2 rounded-full bg-slate-200"></div>;
    return <div className="flex items-center justify-between text-sm"><span className="text-slate-400 w-10 text-xs font-bold uppercase">{label}</span><div className={`flex items-center gap-2 flex-1 justify-end ${status === "pass" ? "text-emerald-700 font-medium" : status === "fail" ? "text-red-600 font-medium" : "text-slate-400"}`}><span className={`text-right block ${truncate ? 'truncate max-w-[120px]' : ''}`} title={checkResult?.debugText || value}>{value || "—"}</span>{icon}</div></div>
}

function DebugSection({ labelData }) {
    return (
        <div className="mt-12 pt-8 border-t border-slate-200">
            <details className="cursor-pointer group">
                <summary className="text-sm font-bold text-slate-400 hover:text-slate-600 flex items-center gap-2 select-none"><Layers size={16}/> Show Debug Analysis ({labelData.mode})</summary>
                <div className="mt-4 space-y-4">
                    <div className="bg-amber-50 p-4 rounded border border-amber-100 text-amber-900 text-xs font-mono max-h-40 overflow-auto"><strong className="block mb-2 text-amber-700">GLOBAL CONTEXT:</strong> {labelData.global_text || "Empty"}</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {labelData.clusters?.map((c, i) => (
                            <div key={i} className="bg-slate-100 p-3 rounded text-xs font-mono border border-slate-200">
                                <p className="font-bold text-indigo-600 mb-1 border-b border-slate-200 pb-1">Cluster {i+1} (EAN: {c.ean})</p>
                                <p className="text-slate-600 break-words">{c.extracted_text.substring(0, 300)}...</p>
                            </div>
                        ))}
                    </div>
                </div>
            </details>
        </div>
    )
}

function LoadingSpinner() { return <div className="text-center py-12"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600 mx-auto mb-4"></div><p className="text-slate-400">Processing Document...</p></div> }
function ErrorBanner({ msg }) { return <div className="bg-red-50 text-red-700 px-4 py-3 rounded mb-4 flex items-center gap-2 border border-red-100"><AlertCircle size={16}/> {msg}</div> }
function WelcomeState() { return (<div className="text-center py-20 border-2 border-dashed border-slate-300 rounded-xl bg-white/50"><Upload className="mx-auto h-12 w-12 text-slate-300 mb-4" /><h3 className="text-lg font-medium text-slate-900">Upload Purchase Order to Start</h3></div>) }

export default App