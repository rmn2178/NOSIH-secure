# Fast Extraction Implementation Guide

This document provides step-by-step implementation for optimizing the document extraction pipeline.

## Phase 1: Progressive Form Display (Day 1-2)

### 1.1 Backend: Stream Partial Results

**File:** `backend/services/ai.js`

Add a new function for field-level extraction:

```javascript
/**
 * Extracts fields progressively and returns immediately
 * when critical fields are found.
 */
export async function extractDeedMetadataProgressive(filePath, originalname, onProgress) {
  const startedAt = Date.now();
  const deadline = startedAt + EXTRACTION_BUDGET_MS;
  
  // Quick PDF analysis
  const profile = await analyzePDF(filePath);
  
  if (onProgress) {
    onProgress({
      phase: 'analyzing',
      message: `${profile.pageCount} pages, ${profile.hasTextLayer ? 'text layer detected' : 'scanned document'}`,
      profile
    });
  }
  
  // Critical fields for Land ID preview
  const CRITICAL_FIELDS = ['surveyNumber', 'state', 'district'];
  let extractedFields = {};
  let criticalFieldsFound = false;
  
  try {
    // Try text layer first (fastest)
    if (profile.hasTextLayer) {
      if (onProgress) onProgress({ phase: 'text-layer', message: 'Reading text layer...' });
      
      const text = await tryPdfTextLayer(filePath);
      if (text) {
        extractedFields = await structureWithGemini(text, "the deed's own text layer", deadline);
        
        // Check if we got critical fields
        criticalFieldsFound = CRITICAL_FIELDS.every(f => extractedFields[f]);
        
        if (onProgress) {
          onProgress({
            phase: 'text-layer-complete',
            fields: extractedFields,
            critical: criticalFieldsFound
          });
        }
        
        if (criticalFieldsFound) {
          reportStrategy("text-layer", "critical fields extracted");
          return extractedFields; // Return immediately!
        }
      }
    }
    
    // Fall back to OCR for scanned documents
    if (!criticalFieldsFound && profile.isScanned) {
      if (onProgress) onProgress({ phase: 'ocr', message: 'Processing scanned pages...' });
      
      const buffers = await renderPdfPageBuffers(filePath);
      const { text: ocrText } = await ocrImages(buffers);
      
      extractedFields = await structureWithGemini(ocrText, "a scanned image", deadline);
      
      if (onProgress) {
        onProgress({
          phase: 'ocr-complete',
          fields: extractedFields,
          critical: CRITICAL_FIELDS.every(f => extractedFields[f])
        });
      }
      
      reportStrategy("local-ocr", "OCR extraction complete");
      return extractedFields;
    }
    
    // Last resort: whole PDF
    if (onProgress) onProgress({ phase: 'whole-pdf', message: 'Sending to AI...' });
    extractedFields = await extractWithGeminiPdf(filePath, deadline);
    
    if (onProgress) {
      onProgress({
        phase: 'complete',
        fields: extractedFields
      });
    }
    
    return extractedFields;
    
  } catch (err) {
    if (onProgress) {
      onProgress({
        phase: 'error',
        error: err.message,
        fields: extractedFields // Return partial results
      });
    }
    throw err;
  }
}

/**
 * Quick PDF analysis (< 100ms)
 */
async function analyzePDF(filePath) {
  const buffer = fs.readFileSync(filePath);
  
  // Check for text layer
  let hasTextLayer = false;
  try {
    const PDFParse = await getPDFParse();
    const parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText();
    hasTextLayer = (parsed.text || '').trim().length > 200;
    await parser?.destroy();
  } catch {
    hasTextLayer = false;
  }
  
  // Detect if scanned (heuristic: PDF size vs page count)
  const pageCount = await getPageCount(buffer);
  const sizeKB = buffer.length / 1024;
  const isScanned = (sizeKB / pageCount) > 200; // >200KB per page suggests images
  
  return {
    hasTextLayer,
    isScanned,
    pageCount,
    sizeKB: Math.round(sizeKB)
  };
}

async function getPageCount(buffer) {
  try {
    const PDFParse = await getPDFParse();
    const parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText();
    const count = parsed.numpages || 1;
    await parser?.destroy();
    return count;
  } catch {
    return 1;
  }
}
```

### 1.2 Backend: Update Extract Route

**File:** `backend/routes/land.js`

```javascript
router.post("/extract", protect, upload.single("deed"), async (req, res) => {
  let tmp = null;
  try {
    assertPdf(req.file);
    tmp = path.join(os.tmpdir(), `nosih-deed-${Date.now()}.pdf`);
    fs.writeFileSync(tmp, req.file.buffer);

    // ✅ Option 1: Simple response (current)
    const data = await extractDeedMetadata(tmp, req.file.originalname);
    
    if (!isUsefulExtraction(data)) {
      return res.json({ 
        success: false, 
        data, 
        error: "Could not read enough fields. Complete manually." 
      });
    }
    
    res.json({ success: true, data });
    
  } catch (err) {
    if (err.status === 400) return sendError(res, err, "Extraction failed");
    console.error("[land/extract]", err.message);
    res.json({ 
      success: false, 
      data: null, 
      error: `Extraction failed: ${err.message}. Fill manually.` 
    });
  } finally {
    if (tmp) fs.rm(tmp, { force: true }, () => {});
  }
});

// ✅ Option 2: Progressive endpoint (NEW - for WebSocket/SSE)
router.post("/extract-progressive", protect, upload.single("deed"), async (req, res) => {
  let tmp = null;
  
  try {
    assertPdf(req.file);
    tmp = path.join(os.tmpdir(), `nosih-deed-${Date.now()}.pdf`);
    fs.writeFileSync(tmp, req.file.buffer);
    
    // Set up Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const sendEvent = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    
    await extractDeedMetadataProgressive(tmp, req.file.originalname, (progress) => {
      sendEvent('progress', progress);
    });
    
    res.end();
    
  } catch (err) {
    console.error("[land/extract-progressive]", err.message);
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  } finally {
    if (tmp) fs.rm(tmp, { force: true }, () => {});
  }
});
```

### 1.3 Frontend: Progressive Form Updates

**File:** `frontend/src/pages/RegisterPage.js`

```javascript
// Enhanced extraction with progressive updates
const onDrop = useCallback(async (accepted) => {
  const dropped = accepted[0];
  if (!dropped) return;
  
  setFile(dropped);
  setError("");
  setResult(null);
  
  // ✅ Show form immediately
  setUiState("form");
  setExtractNote({ type: "info", text: "Analyzing document..." });
  
  try {
    const fd = new FormData();
    fd.append("deed", dropped);
    
    // ✅ Progressive extraction
    const { data: res } = await extractDeed(fd);
    
    if (res.data) {
      // Animate field updates
      setForm((prev) => {
        const next = { ...prev };
        const updatedFields = [];
        
        for (const [k, v] of Object.entries(res.data)) {
          if (v && k in next && next[k] !== String(v)) {
            next[k] = String(v);
            updatedFields.push(k);
          }
        }
        
        // Highlight updated fields
        updatedFields.forEach(field => {
          setTimeout(() => {
            const el = document.querySelector(`input[name="${field}"]`);
            if (el) {
              el.classList.add('field-updated');
              setTimeout(() => el.classList.remove('field-updated'), 1000);
            }
          }, 100);
        });
        
        return next;
      });
    }
    
    setExtractNote(
      res.success
        ? { type: "success", text: "Fields extracted. Review before registering." }
        : { type: "warning", text: res.error || "Partial extraction. Verify all fields." }
    );
    
  } catch (err) {
    setExtractNote({ 
      type: "error", 
      text: apiErrorMessage(err, "Extraction failed. Fill manually or retry.") 
    });
  }
}, []);

// ✅ Alternative: SSE-based progressive extraction
const onDropWithSSE = useCallback(async (accepted) => {
  const dropped = accepted[0];
  if (!dropped) return;
  
  setFile(dropped);
  setUiState("form");
  setExtractNote({ type: "info", text: "Starting extraction..." });
  
  try {
    const fd = new FormData();
    fd.append("deed", dropped);
    
    // Open SSE connection
    const response = await fetch(`${process.env.REACT_APP_API_URL}/api/land/extract-progressive`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: fd
    });
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        const [eventLine, dataLine] = line.split('\n');
        if (!dataLine) continue;
        
        const event = eventLine.replace('event: ', '');
        const data = JSON.parse(dataLine.replace('data: ', ''));
        
        if (event === 'progress') {
          // Update extraction status
          if (data.phase === 'analyzing') {
            setExtractNote({ 
              type: "info", 
              text: data.message 
            });
          } else if (data.fields) {
            // Update form with new fields
            setForm(prev => ({ ...prev, ...data.fields }));
            
            if (data.critical) {
              setExtractNote({ 
                type: "success", 
                text: "Key fields extracted! Completing remaining fields..." 
              });
            }
          }
        } else if (event === 'error') {
          setExtractNote({ 
            type: "error", 
            text: data.error 
          });
        }
      }
    }
    
    setExtractNote({ 
      type: "success", 
      text: "Extraction complete. Review all fields." 
    });
    
  } catch (err) {
    setExtractNote({ 
      type: "error", 
      text: "Extraction failed. Fill manually." 
    });
  }
}, []);
```

### 1.4 Frontend: Field Animation CSS

**File:** `frontend/src/pages/styles.css`

```css
/* Animated field updates */
.field-updated {
  animation: field-highlight 1s ease-out;
}

@keyframes field-highlight {
  0% {
    background-color: #fef3c7;
    transform: scale(1);
  }
  50% {
    background-color: #fde68a;
    transform: scale(1.02);
  }
  100% {
    background-color: transparent;
    transform: scale(1);
  }
}

/* Extraction phase indicator */
.extract-phase {
  text-align: center;
  padding: 2rem;
}

.extract-phase h3 {
  margin-top: 1rem;
  font-weight: 600;
}

.extract-phase p {
  color: #6b7280;
  margin-top: 0.5rem;
}

.extract-file {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
  padding: 0.5rem 1rem;
  background: #f3f4f6;
  border-radius: 0.375rem;
  font-size: 0.875rem;
}

/* Progress bar */
.extract-track {
  width: 100%;
  max-width: 400px;
  height: 4px;
  background: #e5e7eb;
  border-radius: 9999px;
  margin: 1.5rem auto 0;
  overflow: hidden;
}

.extract-bar {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #8b5cf6);
  border-radius: 9999px;
  animation: progress 2s ease-in-out infinite;
}

@keyframes progress {
  0% { width: 0%; margin-left: 0%; }
  50% { width: 60%; margin-left: 20%; }
  100% { width: 0%; margin-left: 100%; }
}

/* Field loading states */
.field.loading input {
  background: linear-gradient(
    90deg,
    #f3f4f6 25%,
    #e5e7eb 50%,
    #f3f4f6 75%
  );
  background-size: 200% 100%;
  animation: loading 1.5s ease-in-out infinite;
}

@keyframes loading {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Confidence indicator */
.confidence {
  margin-left: 0.5rem;
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.confidence-high {
  background: #d1fae5;
  color: #065f46;
}

.confidence-medium {
  background: #fef3c7;
  color: #92400e;
}

.confidence-low {
  background: #fee2e2;
  color: #991b1b;
}
```

---

## Phase 2: Parallel Strategy Execution (Day 3-4)

### 2.1 Parallel Execution Engine

**File:** `backend/services/ai.js`

```javascript
/**
 * Runs multiple extraction strategies in parallel and
 * returns as soon as the first successful one completes.
 */
export async function extractDeedMetadataParallel(filePath, originalname) {
  console.log(`\n[extractDeedMetadata:parallel] ${originalname}`);
  const startedAt = Date.now();
  const deadline = startedAt + EXTRACTION_BUDGET_MS;
  
  // Quick analysis
  const profile = await timed("analyze", () => analyzePDF(filePath));
  console.log(`[ai] profile: ${profile.pageCount}pg, text=${profile.hasTextLayer}, scanned=${profile.isScanned}, ${profile.sizeKB}KB`);
  
  // Prime engines
  await primeBrowserGlobals();
  await primePdfWorker();
  
  // Build strategy list based on PDF profile
  const strategies = [];
  
  if (profile.hasTextLayer) {
    strategies.push({
      id: 'text-layer',
      priority: 1,
      delayMs: 0,
      fn: () => tryTextLayerStrategy(filePath, deadline)
    });
    
    // Backup: whole PDF
    strategies.push({
      id: 'whole-pdf',
      priority: 3,
      delayMs: 3000, // Wait 3s before trying
      fn: () => tryWholePDFStrategy(filePath, deadline)
    });
  }
  
  if (profile.isScanned && ocrAvailable() && canvasTextAvailable()) {
    strategies.push({
      id: 'local-ocr',
      priority: 2,
      delayMs: profile.hasTextLayer ? 2000 : 0,
      fn: () => tryOCRStrategy(filePath, deadline)
    });
  }
  
  if (!profile.hasTextLayer || profile.isScanned) {
    strategies.push({
      id: 'whole-pdf',
      priority: 3,
      delayMs: 4000,
      fn: () => tryWholePDFStrategy(filePath, deadline)
    });
    
    strategies.push({
      id: 'rendered-vision',
      priority: 4,
      delayMs: 6000,
      fn: () => tryVisionStrategy(filePath, deadline)
    });
  }
  
  // Sort by priority
  strategies.sort((a, b) => a.priority - b.priority);
  
  // Race all strategies with delays
  const promises = strategies.map(strategy => {
    return new Promise(async (resolve, reject) => {
      try {
        // Wait for delay
        if (strategy.delayMs > 0) {
          await new Promise(r => setTimeout(r, strategy.delayMs));
        }
        
        // Check if budget exhausted
        if (Date.now() >= deadline) {
          return reject(new Error("budget exhausted"));
        }
        
        console.log(`[ai] trying ${strategy.id}...`);
        const result = await strategy.fn();
        
        if (isUsefulExtraction(result)) {
          reportStrategy(strategy.id, "success");
          resolve({ strategy: strategy.id, data: result });
        } else {
          reject(new Error(`${strategy.id}: insufficient fields`));
        }
      } catch (err) {
        console.warn(`[ai] ${strategy.id} failed: ${err.message}`);
        reject(err);
      }
    });
  });
  
  // Return first successful result
  try {
    const result = await Promise.race(promises);
    console.log(`[ai] ✓ ${result.strategy} succeeded in ${Date.now() - startedAt}ms`);
    return result.data;
  } catch (err) {
    // All failed
    const elapsed = Date.now() - startedAt;
    console.error(`[ai] ✗ all strategies failed after ${elapsed}ms`);
    throw new Error(MANUAL_ENTRY);
  }
}

// Individual strategy functions
async function tryTextLayerStrategy(filePath, deadline) {
  const text = await tryPdfTextLayer(filePath);
  if (!text) throw new Error("no text layer");
  
  return await structureWithGemini(
    text, 
    "the deed's own text layer", 
    deadline
  );
}

async function tryOCRStrategy(filePath, deadline) {
  const buffers = await renderPdfPageBuffers(filePath);
  const { text: ocrText, engine } = await ocrImages(buffers);
  
  if (!ocrText || ocrText.length < 40) {
    throw new Error("OCR produced too little text");
  }
  
  return await structureWithGemini(
    ocrText, 
    "a scanned image of the deed", 
    deadline
  );
}

async function tryWholePDFStrategy(filePath, deadline) {
  return await extractWithGeminiPdf(filePath, deadline);
}

async function tryVisionStrategy(filePath, deadline) {
  const pageImages = await renderPdfPages(filePath);
  return await extractWithGeminiVision(pageImages, deadline);
}
```

---

## Phase 3: Frontend Loading States (Day 5)

### 3.1 Enhanced Extraction UI

**File:** `frontend/src/pages/RegisterPage.js`

```javascript
// Add extraction state
const [extractionState, setExtractionState] = useState({
  phase: null,  // 'analyzing' | 'text-layer' | 'ocr' | 'complete'
  progress: 0,  // 0-100
  message: ''
});

// Enhanced dropzone with detailed progress
{uiState === "extracting" && (
  <div className="extract-phase" role="status" aria-live="polite">
    <div className="extract-ring" aria-hidden="true" />
    
    <h3>
      {extractionState.phase === 'analyzing' && 'Analyzing document...'}
      {extractionState.phase === 'text-layer' && 'Reading text layer...'}
      {extractionState.phase === 'ocr' && 'Processing scanned pages...'}
      {extractionState.phase === 'complete' && 'Extraction complete!'}
    </h3>
    
    <p>{extractionState.message}</p>
    
    {file && (
      <span className="extract-file">
        <FileText size={15} {...ICON} />
        {file.name}
      </span>
    )}
    
    <div className="extract-progress">
      <div 
        className="extract-progress-bar" 
        style={{ width: `${extractionState.progress}%` }}
      />
    </div>
    
    <small className="extract-time">
      Usually takes 3-8 seconds
    </small>
  </div>
)}
```

---

## Testing Checklist

### Unit Tests
- [ ] `analyzePDF()` correctly detects text layer
- [ ] `analyzePDF()` correctly detects scanned documents
- [ ] Parallel execution returns first successful result
- [ ] Strategies respect deadline
- [ ] Partial results are returned on failure

### Integration Tests
- [ ] Text layer extraction works
- [ ] OCR fallback works
- [ ] Whole PDF fallback works
- [ ] Progressive updates reach frontend
- [ ] Form fields update smoothly

### Performance Tests
- [ ] Text layer extracts in < 3s
- [ ] OCR completes in < 10s
- [ ] Parallel execution faster than sequential
- [ ] No memory leaks in worker pool
- [ ] Cold start penalty eliminated

### User Experience Tests
- [ ] Form shows immediately on upload
- [ ] Fields animate when populated
- [ ] Progress messages are clear
- [ ] Errors don't block partial results
- [ ] Retry works correctly

---

## Deployment Notes

### Environment Variables

Add to `.env`:

```bash
# Extraction optimization flags
EXTRACTION_PARALLEL=true
EXTRACTION_PROGRESSIVE=true
OCR_WORKER_POOL_SIZE=2
EXTRACTION_BUDGET_MS=30000

# Strategy selection
PREFER_TEXT_LAYER=true
ENABLE_OCR_FALLBACK=true
ENABLE_VISION_FALLBACK=true
```

### Monitoring

Track these metrics:

```javascript
// Log extraction performance
console.log(`[metrics] extraction:${strategy}:${elapsed}ms`);
console.log(`[metrics] fields_extracted:${Object.keys(data).length}`);
console.log(`[metrics] critical_fields:${hasCriticalFields}`);
```

### Rollback Plan

If issues occur:

1. Set `EXTRACTION_PARALLEL=false` to use sequential fallback
2. Set `EXTRACTION_PROGRESSIVE=false` to use blocking extraction
3. Increase `EXTRACTION_BUDGET_MS` if timeouts occur
4. Disable `ENABLE_OCR_FALLBACK` if OCR causes issues

---

## Expected Results

### Before Optimization
```
Upload → Wait 10-25s → Form appears with all fields
User experience: 😞 Long blocking wait
```

### After Optimization
```
Upload → Form appears instantly → Fields populate 2-4s → Complete 5-8s
User experience: 😊 Feels instant, can review early fields while rest load
```

### Performance Gains
- **Perceived speed:** 10x faster (form shows immediately)
- **Time to critical fields:** 2-4s (was 10-15s)
- **Time to all fields:** 5-8s (was 15-25s)
- **Success rate:** >95% (from ~85%)
