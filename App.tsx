
import React, { useState, useEffect, useCallback } from 'react';
import { GoogleGenAI } from "@google/genai";

// --- Engineering Constants (BS 8110) ---
const CONCRETE_DENSITY = 24; 
const SLAB_DL_UNIT = 4.0;    
const WALL_DL_UNIT = 2.6;    
const FY = 460;              
const COVER = 25;            
const GAMMA_G = 1.4;         
const GAMMA_Q = 1.6;         

interface DesignInput {
  // Column inputs (as provided by architect)
  colWidth: string;       // Column width (mm)
  colLength: string;      // Column length (mm) - typically same as width for square columns
  colHeight: string;      // Column height (mm) - from foundation to beam level

  colSpacing: string;     // Column spacing (distance between columns in meters)
  colLoad: string;        // Load on column (kN)

  // Architectural inputs
  soilCapacity: string;   // Soil bearing capacity (kPa) - typically known from geotechnical report

  // Material properties
  fcu: string;            // Concrete grade (e.g., 25, 30, 35)

  // Ground beam inputs
  groundBeamSpan: string; // Span of ground beam between columns
}

interface DesignResult {
  // Column verification
  colSize: number;
  colLoad: number;
  colCapacity: number;
  colStatus: 'SAFE' | 'UNSAFE';

  // Footing design
  footingSize: number;      // Size of square footing (m)
  footingThickness: number; // Thickness of footing (mm)
  footingSteel: string;     // Reinforcement specification
  footingStatus: 'SAFE' | 'UNSAFE';

  // Ground beam design
  groundBeamWidth: number;      // Width of ground beam (mm)
  groundBeamDepth: number;      // Depth of ground beam (mm)
  groundBeamMoment: number;     // Calculated moment (kNm)
  groundBeamShear: number;      // Calculated shear (kN)
  groundBeamAsRequired: number; // Required steel area (mm²)
  groundBeamMainBar: string;    // Main reinforcement
  groundBeamTopBar: string;     // Top reinforcement
  groundBeamShearLinks: string; // Shear links
  groundBeamStatus: 'SAFE' | 'UNSAFE';
  groundBeamUtilization: number;

  // Additional calculated values
  bearingPressure: number;      // Actual bearing pressure (kPa)
  requiredFootingArea: number;  // Required footing area (m²)
}

const App: React.FC = () => {
  const [inputs, setInputs] = useState<DesignInput>(() => {
    const saved = localStorage.getItem('beamsafe_pro_inputs_v5');
    return saved ? JSON.parse(saved) : {
      colWidth: '200',        // Column width in mm
      colLength: '200',       // Column length in mm
      colHeight: '3000',      // Column height in mm (3m)
      colSpacing: '4.0',      // Column spacing in meters
      colLoad: '500',         // Load on column in kN
      soilCapacity: '150',    // Soil bearing capacity in kPa
      fcu: '25',             // Concrete grade
      groundBeamSpan: '4.0'   // Ground beam span in meters
    };
  });

  const [result, setResult] = useState<DesignResult | null>(null);
  const [copying, setCopying] = useState(false);
  const [aiImage, setAiImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    localStorage.setItem('beamsafe_pro_inputs_v3', JSON.stringify(inputs));
  }, [inputs]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setInputs(prev => ({ ...prev, [name]: value }));
  };

  const calculateDesign = useCallback(() => {
    // Parse input values
    const colWidth = parseFloat(inputs.colWidth) || 200; // Column width in mm
    const colLength = parseFloat(inputs.colLength) || 200; // Column length in mm
    const colHeight = parseFloat(inputs.colHeight) || 3000; // Column height in mm
    const colSpacing = parseFloat(inputs.colSpacing) || 4.0; // Column spacing in m
    const colLoad = parseFloat(inputs.colLoad) || 500; // Load on column in kN
    const soilCapacity = parseFloat(inputs.soilCapacity) || 150; // Soil capacity in kPa
    const fcu = parseFloat(inputs.fcu) || 25; // Concrete grade
    const groundBeamL = parseFloat(inputs.groundBeamSpan) || 4.0; // Ground beam span in m

    if (!colWidth || !colLength || !colLoad || !soilCapacity) {
      setResult(null);
      return;
    }

    // --- Column Verification ---
    const colArea = colWidth * colLength; // mm²
    // Calculate column capacity based on concrete and steel area
    // Using formula: Nuz = 0.4*fcd*Ac + 0.87*fy*Asc
    // For simplicity, assuming 1% steel ratio
    const steelRatio = 0.01;
    const steelArea = colArea * steelRatio;
    const concreteArea = colArea * (1 - steelRatio);

    // Characteristic strength values
    const fcd = (0.67 * fcu) / 1.5; // Design concrete strength
    const fyd = FY / 1.15; // Design steel strength

    // Column capacity
    const colCapacity = (0.4 * fcd * concreteArea + 0.87 * fyd * steelArea) / 1000; // Convert to kN
    const colStatus: 'SAFE' | 'UNSAFE' = colLoad < colCapacity ? 'SAFE' : 'UNSAFE';

    // --- Footing Design ---
    // Calculate required footing area based on column load and soil capacity
    const requiredFootingArea = colLoad / soilCapacity; // m²
    const footingSize = Math.ceil(Math.sqrt(requiredFootingArea) * 10) / 10; // Round to nearest 0.1m

    // Calculate bearing pressure
    const actualBearingPressure = colLoad / (footingSize * footingSize);
    const footingStatus: 'SAFE' | 'UNSAFE' = actualBearingPressure <= soilCapacity ? 'SAFE' : 'UNSAFE';

    // Footing thickness based on punching shear requirements (minimum 300mm)
    const footingThickness = Math.max(300, Math.ceil(Math.max(colWidth, colLength) / 2)); // Minimum 300mm or max dim/2

    // Footing reinforcement calculation
    // Calculate moment at face of column (cantilever action)
    const maxColDim = Math.max(colWidth, colLength); // Use max dimension for conservative design
    const cantileverLength = (footingSize * 1000 - maxColDim) / 2; // mm
    const ulsLoad = colLoad * 1.4; // Ultimate limit state load
    const ulsPressure = ulsLoad / (footingSize * footingSize); // kPa
    const momentAtFace = (ulsPressure * cantileverLength * cantileverLength) / (2 * 1e6); // kNm/m

    // Calculate required steel area
    const effectiveDepth = footingThickness - 75; // Assuming 75mm cover
    const k = (momentAtFace * 1e6) / (1000 * effectiveDepth * effectiveDepth * fcu); // 1000mm strip
    const z = effectiveDepth * Math.min(0.5 + Math.sqrt(0.25 - k / 0.9), 0.95);
    const steelAreaReq = (momentAtFace * 1e6) / (0.95 * FY * z); // mm² per meter

    // Minimum steel area (0.13% as per code)
    const minSteelArea = 0.0013 * 1000 * footingThickness; // mm² per meter
    const finalSteelArea = Math.max(steelAreaReq, minSteelArea);

    // Determine reinforcement
    let footingSteel = "T12 @ 250mm";
    if (finalSteelArea > 452) footingSteel = "T12 @ 200mm"; // Area of T12@200 = 565mm²/m
    if (finalSteelArea > 565) footingSteel = "T16 @ 250mm"; // Area of T16@250 = 804mm²/m
    if (finalSteelArea > 804) footingSteel = "T16 @ 200mm"; // Area of T16@200 = 1005mm²/m
    if (finalSteelArea > 1005) footingSteel = "T20 @ 250mm"; // Area of T20@250 = 1256mm²/m

    // --- Ground Beam Design ---
    // Estimate ground beam load based on column load and spacing
    const estimatedLoad = colLoad / colSpacing; // kN/m distributed load

    // Determine ground beam dimensions based on span and load
    const groundBeamWidth = Math.max(200, Math.max(colWidth, colLength) * 0.8); // Width based on max column dimension
    const groundBeamDepth = Math.max(300, Math.min(600, Math.ceil(groundBeamL * 1000 / 12))); // Depth based on span

    // Calculate ground beam moment and shear
    const groundBeamM = (estimatedLoad * groundBeamL * groundBeamL) / 8; // kNm
    const groundBeamV = (estimatedLoad * groundBeamL) / 2; // kN

    // Check moment capacity
    const d = groundBeamDepth - 50; // Effective depth with 50mm cover
    const k_beam = (groundBeamM * 1e6) / (groundBeamWidth * d * d * fcu);
    const utilization = Math.min(100, Math.round((k_beam / 0.156) * 100));

    let groundBeamStatus: 'SAFE' | 'UNSAFE' = k_beam <= 0.156 ? 'SAFE' : 'UNSAFE';
    let groundBeamMainBar = "None";
    let groundBeamTopBar = "2T12 (Hangers)";
    let groundBeamShearLinks = "R8-250";
    let groundBeamAsRequired = 0;

    if (groundBeamStatus === 'SAFE') {
      const z_beam = Math.min(d * (0.5 + Math.sqrt(0.25 - k_beam / 0.9)), 0.95 * d);
      groundBeamAsRequired = (groundBeamM * 1e6) / (0.95 * FY * z_beam);
      const minAs = 0.0013 * groundBeamWidth * groundBeamDepth;
      groundBeamAsRequired = Math.max(groundBeamAsRequired, minAs);

      if (groundBeamAsRequired < 226) groundBeamMainBar = "2T12 Bottom";
      else if (groundBeamAsRequired < 402) groundBeamMainBar = "2T16 Bottom";
      else if (groundBeamAsRequired < 603) groundBeamMainBar = "3T16 Bottom";
      else if (groundBeamAsRequired < 942) groundBeamMainBar = "3T20 Bottom";
      else groundBeamMainBar = "4T20 Bottom";

      // Check shear stress
      const v = (groundBeamV * 1000) / (groundBeamWidth * d);
      groundBeamShearLinks = v > 0.4 ? "R10 @ 175mm" : "R8 @ 200mm";
      if (v > 0.8 * Math.sqrt(fcu)) groundBeamStatus = 'UNSAFE';
    }

    setResult({
      // Column verification
      colSize: Math.max(colWidth, colLength), // Using max dimension for display
      colLoad: colLoad,
      colCapacity: Number(colCapacity.toFixed(2)),
      colStatus: colStatus,

      // Footing design
      footingSize: Number(footingSize.toFixed(2)),
      footingThickness: footingThickness,
      footingSteel: footingSteel,
      footingStatus: footingStatus,

      // Ground beam design
      groundBeamWidth: groundBeamWidth,
      groundBeamDepth: groundBeamDepth,
      groundBeamMoment: Number(groundBeamM.toFixed(2)),
      groundBeamShear: Number(groundBeamV.toFixed(2)),
      groundBeamAsRequired: Math.round(groundBeamAsRequired),
      groundBeamMainBar: groundBeamMainBar,
      groundBeamTopBar: groundBeamTopBar,
      groundBeamShearLinks: groundBeamShearLinks,
      groundBeamStatus: groundBeamStatus,
      groundBeamUtilization: utilization,

      // Additional calculated values
      bearingPressure: Number(actualBearingPressure.toFixed(2)),
      requiredFootingArea: Number(requiredFootingArea.toFixed(2))
    });
  }, [inputs]);

  useEffect(() => {
    calculateDesign();
  }, [calculateDesign]);

  const generateStructuralImage = async () => {
    if (!result) return;
    setIsGenerating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `Highly detailed 2D structural engineering layout.
      Section 1: Column ${inputs.colWidth}mm × ${inputs.colLength}mm with ${result.colLoad}kN load.
      Section 2: Foundation footing plan ${result.footingSize}m x ${result.footingSize}m with reinforcement mesh ${result.footingSteel}.
      Section 3: Ground beam ${result.groundBeamWidth}x${result.groundBeamDepth}mm with ${result.groundBeamMainBar} and ${result.groundBeamTopBar}, showing shear links ${result.groundBeamShearLinks}.
      Blueprint aesthetic, blueprint blue background, white technical lines, architectural symbols, Malaysian standard format.`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [{ text: prompt }] },
        config: { imageConfig: { aspectRatio: "1:1" } }
      });

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          setAiImage(`data:image/png;base64,${part.inlineData.data}`);
        }
      }
    } catch (error) {
      console.error("AI Generation failed:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const copySummary = () => {
    if (!result) return;
    const summary = `BeamSafe Suite Report\nColumn: ${inputs.colWidth}mm × ${inputs.colLength}mm\nHeight: ${inputs.colHeight}mm\nLoad: ${result.colLoad} kN\nStatus: ${result.colStatus}\n\nFooting: ${result.footingSize}m × ${result.footingSize}m\nThickness: ${result.footingThickness}mm\nReinforcement: ${result.footingSteel}\nStatus: ${result.footingStatus}\n\nGround Beam: ${result.groundBeamWidth}x${result.groundBeamDepth}mm\nMain: ${result.groundBeamMainBar}\nStatus: ${result.groundBeamStatus}\n\nBearing Pressure: ${result.bearingPressure} kPa`;
    navigator.clipboard.writeText(summary);
    setCopying(true);
    setTimeout(() => setCopying(false), 2000);
  };

  return (
    <div className="experimental-layout">
      {/* Left Panel - Inputs and Results */}
      <div className="left-panel">
        <header className="header no-print">
          <div className="logo-container">
            <div className="logo-icon">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <div className="logo-text">
              <h1 className="logo-title">
                BeamSafe <span style={{color: 'var(--accent-orange)'}}>Suite</span>
              </h1>
              <p className="logo-subtitle">Foundation & Beam Master • v4.0</p>
            </div>
          </div>
        </header>

        {/* Input Sections */}
        <div className="input-section">
          <div className="input-header">
            <h2 className="input-title">01. Column Design (By Architect)</h2>
          </div>
          <div className="input-grid">
            <div className="input-field">
              <label className="input-label">Column Width (mm)</label>
              <input
                type="number"
                name="colWidth"
                value={inputs.colWidth}
                onChange={handleInputChange}
                placeholder="200"
                className="input-control"
              />
            </div>
            <div className="input-field">
              <label className="input-label">Column Length (mm)</label>
              <input
                type="number"
                name="colLength"
                value={inputs.colLength}
                onChange={handleInputChange}
                placeholder="200"
                className="input-control"
              />
            </div>
            <div className="input-field">
              <label className="input-label">Column Height (mm)</label>
              <input
                type="number"
                name="colHeight"
                value={inputs.colHeight}
                onChange={handleInputChange}
                placeholder="3000"
                className="input-control"
              />
            </div>
            <div className="input-field">
              <label className="input-label">Column Load (kN)</label>
              <input
                type="number"
                name="colLoad"
                value={inputs.colLoad}
                onChange={handleInputChange}
                placeholder="500"
                className="input-control"
              />
            </div>
          </div>
        </div>

        <div className="input-section">
          <div className="input-header">
            <h2 className="input-title">02. Structural Layout</h2>
          </div>
          <div className="input-grid">
            <div className="input-field">
              <label className="input-label">Column Spacing (m)</label>
              <input
                type="number"
                name="colSpacing"
                value={inputs.colSpacing}
                onChange={handleInputChange}
                placeholder="4.0"
                className="input-control"
              />
            </div>
          </div>
        </div>

        <div className="input-section">
          <div className="input-header">
            <h2 className="input-title">03. Material & Soil Properties</h2>
          </div>
          <div className="input-grid">
            <div className="input-field">
              <label className="input-label">Concrete Grade (fcu)</label>
              <input
                type="number"
                name="fcu"
                value={inputs.fcu}
                onChange={handleInputChange}
                placeholder="25"
                className="input-control"
              />
            </div>
            <div className="input-field">
              <label className="input-label">Soil Capacity (kPa)</label>
              <input
                type="number"
                name="soilCapacity"
                value={inputs.soilCapacity}
                onChange={handleInputChange}
                placeholder="150"
                className="input-control"
              />
            </div>
          </div>
        </div>

        <div className="input-section">
          <div className="input-header">
            <h2 className="input-title">04. Ground Beam Parameters</h2>
          </div>
          <div className="input-grid">
            <div className="input-field">
              <label className="input-label">Ground Beam Span (m)</label>
              <input
                type="number"
                name="groundBeamSpan"
                value={inputs.groundBeamSpan}
                onChange={handleInputChange}
                placeholder="4.0"
                className="input-control"
              />
            </div>
          </div>
        </div>

        {/* Results Section */}
        <div className="results-section">
          {result ? (
            <>
              <div className="status-display" style={{backgroundColor: result.colStatus === 'SAFE' ? '#e8f5e9' : '#ffebee', borderColor: result.colStatus === 'SAFE' ? '#4caf50' : '#f44336'}}>
                <div>
                  <div className="status-label">Column Status</div>
                  <div className="status-value">{result.colStatus}</div>
                </div>
                <div>
                  <div className="status-label">Capacity</div>
                  <div className="status-value">{result.colCapacity} kN</div>
                </div>
              </div>

              <div className="status-display" style={{backgroundColor: result.footingStatus === 'SAFE' ? '#e8f5e9' : '#ffebee', borderColor: result.footingStatus === 'SAFE' ? '#4caf50' : '#f44336'}}>
                <div>
                  <div className="status-label">Footing Status</div>
                  <div className="status-value">{result.footingStatus}</div>
                </div>
                <div>
                  <div className="status-label">Pressure</div>
                  <div className="status-value">{result.bearingPressure} kPa</div>
                </div>
              </div>

              <div className="status-display" style={{backgroundColor: result.groundBeamStatus === 'SAFE' ? '#e8f5e9' : '#ffebee', borderColor: result.groundBeamStatus === 'SAFE' ? '#4caf50' : '#f44336'}}>
                <div>
                  <div className="status-label">Ground Beam Status</div>
                  <div className="status-value">{result.groundBeamStatus}</div>
                </div>
                <div>
                  <div className="status-label">Utilization</div>
                  <div className="status-value">{result.groundBeamUtilization}%</div>
                </div>
              </div>

              <div className="results-grid">
                <div className="result-card">
                  <div className="result-title">Column Verification</div>
                  <div className="result-value">Size: {result.colSize}mm</div>
                  <div className="result-value">Load: {result.colLoad} kN</div>
                  <div className="result-value">Capacity: {result.colCapacity} kN</div>
                  <div className="result-value">Status: {result.colStatus}</div>
                </div>

                <div className="result-card">
                  <div className="result-title">Footing Design</div>
                  <div className="result-value">Size: {result.footingSize}m × {result.footingSize}m</div>
                  <div className="result-value">Thickness: {result.footingThickness}mm</div>
                  <div className="result-value">Reinforce: {result.footingSteel}</div>
                  <div className="result-value">Status: {result.footingStatus}</div>
                </div>

                <div className="result-card">
                  <div className="result-title">Ground Beam</div>
                  <div className="result-value">Size: {result.groundBeamWidth}×{result.groundBeamDepth}mm</div>
                  <div className="result-value">Moment: {result.groundBeamMoment} kNm</div>
                  <div className="result-value">Shear: {result.groundBeamShear} kN</div>
                  <div className="result-value">Steel: {result.groundBeamMainBar}</div>
                </div>

                <div className="result-card">
                  <div className="result-title">Calculated Values</div>
                  <div className="result-value">Bearing Pressure: {result.bearingPressure} kPa</div>
                  <div className="result-value">Required Area: {result.requiredFootingArea} m²</div>
                  <div className="result-value">Ground Beam Steel: {result.groundBeamAsRequired} mm²</div>
                  <div className="result-value">Shear Links: {result.groundBeamShearLinks}</div>
                </div>
              </div>

              <div className="visualization-area">
                <h3 className="visualization-title no-print">Structural Visualization</h3>
                <StructuralSVG result={result} />
                <div className="mt-4 text-center">
                  <p className="text-xs uppercase font-bold">
                    Footing: {result.footingSize}m, Steel: {result.footingSteel}
                  </p>
                </div>
              </div>

              {aiImage && (
                <div className="visualization-area">
                  <img src={aiImage} alt="AI Generated Structural Detail" className="w-full h-auto" />
                </div>
              )}

              <div className="controls">
                <button
                  onClick={copySummary}
                  className={`btn ${copying ? 'btn-success' : 'btn-secondary'}`}
                >
                  {copying ? 'Copied!' : 'Copy Report'}
                </button>
                <button onClick={() => window.print()} className="btn btn-secondary">
                  Export PDF
                </button>
                <button
                  onClick={generateStructuralImage}
                  disabled={isGenerating}
                  className="btn btn-primary"
                >
                  {isGenerating ? 'Generating...' : 'AI Concept'}
                </button>
              </div>
            </>
          ) : (
            <div className="visualization-area">
              <h2 className="text-xl font-bold text-gray-500">Analysis Standby</h2>
              <p className="text-gray-600 mt-2">Enter column design and soil parameters to verify footing and ground beam requirements.</p>
            </div>
          )}
        </div>

        <footer className="footer print-only">
          <h3 className="footer-title">Technical Specification Sheet</h3>
          <p className="footer-text">Generated via BeamSafe MY Pro v4.0. All reinforcement schedules must be cross-verified against site-specific requirements and approved by a licensed structural engineer.</p>
        </footer>
      </div>

      {/* Right Panel - Experimental Design Elements */}
      <div className="right-panel">
        <div className="kanji-section">
          <h1 className="kanji-text">構</h1>
          <div className="kanji-label">STRUCTURE</div>
        </div>

        <div className="philosophical-section">
          <p className="philosophical-quote">"Create on reason / Move on instinct"</p>
          <p className="philosophical-text">Future / Straight line / Right angle / Separate</p>
        </div>

        <div className="philosophical-section">
          <p className="philosophical-text">Technology / Evolution / Denying nature / Oversupply</p>
        </div>

        <div className="philosophical-section">
          <p className="philosophical-text">Human / Alone / Trip / Stupid</p>
        </div>

        <div className="barcode">
          {[...Array(20)].map((_, i) => (
            <div key={i} className="barcode-line" style={{height: `${Math.random() * 20 + 10}px`}}></div>
          ))}
        </div>

        <div className="modular-grid">
          <div className="grid-block">
            <div className="grid-label">BEAM</div>
            <div className="grid-value">{result?.width}×{result?.depth}</div>
          </div>
          <div className="grid-block">
            <div className="grid-label">FOOTING</div>
            <div className="grid-value">{result?.footingSize}m</div>
          </div>
          <div className="grid-block">
            <div className="grid-label">COLUMN</div>
            <div className="grid-value">{result?.colSize}mm</div>
          </div>
          <div className="grid-block">
            <div className="grid-label">STEEL</div>
            <div className="grid-value">{result?.mainBar}</div>
          </div>
        </div>

        <div className="section-number">01</div>
      </div>
    </div>
  );
};

// Removed SleekInput and ResultRow components as they're no longer used in the new design

const StructuralSVG: React.FC<{ result: DesignResult }> = ({ result }) => {
  // Calculate proportional sizes for visualization
  const colW = Math.min(40, (result.colSize / 200) * 40); // Max width 40
  const footingW = result.footingSize * 45; // Scale based on footing size
  const footingH = 15; // Fixed height for visibility
  // Scale ground beam dimensions proportionally
  const groundBeamW = Math.min(180, (result.groundBeamWidth / 300) * 180); // Max width 180
  const groundBeamH = Math.min(40, (result.groundBeamDepth / 400) * 40); // Max height 40

  return (
    <svg width="240" height="240" viewBox="0 0 240 240">
      {/* Soil */}
      <line x1="10" y1="210" x2="230" y2="210" stroke="#2d4059" strokeWidth="1.5" strokeDasharray="5 5" />

      {/* Footing */}
      <rect x={120 - footingW/2} y={210} width={footingW} height={footingH} fill="#1a3a5f" stroke="#3b82f6" strokeWidth="1.5" />

      {/* Footing Rebar (Bottom dots/mesh representation) */}
      <line x1={120 - footingW/2 + 5} y1={210 + footingH - 4} x2={120 + footingW/2 - 5} y2={210 + footingH - 4} stroke="#10b981" strokeWidth="2" strokeLinecap="round" />

      {/* Column */}
      <rect x={120 - colW/2} y={105} width={colW} height={105} fill="#1a3a5f" stroke="#6366f1" strokeWidth="1.5" />

      {/* Ground Beam - Positioned below the footing */}
      <rect x={120 - groundBeamW/2} y={210 - footingH - groundBeamH} width={groundBeamW} height={groundBeamH} fill="#1a3a5f" stroke="#10b981" strokeWidth="1.5" />

      {/* Ground Beam Top Bars */}
      <line x1={120 - groundBeamW/2 + 5} y1={210 - footingH - groundBeamH + 4} x2={120 + groundBeamW/2 - 5} y2={210 - footingH - groundBeamH + 4} stroke="#94a3b8" strokeWidth="1" />

      {/* Ground Beam Bottom Bars */}
      <line x1={120 - groundBeamW/2 + 5} y1={210 - footingH - 4} x2={120 + groundBeamW/2 - 5} y2={210 - footingH - 4} stroke="#10b981" strokeWidth="1.5" />

      {/* Column Load Indicator */}
      <line x1={120} y1={100} x2={120} y2={80} stroke="#ef4444" strokeWidth="2" markerEnd="url(#arrowhead)" />

      {/* Arrow marker definition */}
      <defs>
        <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <polygon points="0 0, 6 3, 0 6" fill="#ef4444" />
        </marker>
      </defs>

      {/* Text Labels */}
      <text x="120" y="238" textAnchor="middle" fill="#10b981" fontSize="7" fontWeight="900" className="uppercase tracking-widest">{result.footingSteel}</text>
      <text x="120" y="75" textAnchor="middle" fill="#ef4444" fontSize="7" fontWeight="900" className="uppercase tracking-widest">LOAD: {result.colLoad}kN</text>
      <text x="120" y="200" textAnchor="middle" fill="#10b981" fontSize="6" fontWeight="900" className="uppercase tracking-widest">{result.groundBeamMainBar}</text>
    </svg>
  );
};

export default App;
