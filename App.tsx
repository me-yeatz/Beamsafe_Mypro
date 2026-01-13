
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
  span: string;
  width: string;
  depth: string;
  fcu: string;
  tributaryWidth: string;
  wallHeight: string;
  liveLoad: string;
  colHeight: string;
  soilCapacity: string;
  groundBeamSpan: string;
  groundBeamWidth: string;
  groundBeamDepth: string;
  groundBeamLoad: string;
}

interface DesignResult {
  width: number;
  depth: number;
  totalUDL: number;
  moment: number;
  reaction: number;
  asRequired: number;
  mainBar: string;
  topBar: string;
  shearLinks: string;
  status: 'SAFE' | 'UNSAFE' | 'IDLE';
  utilization: number;
  colSize: number;
  colStatus: 'SAFE' | 'UNSAFE';
  footingSize: number;
  footingSteel: string;
  // Ground beam properties
  groundBeamWidth: number;
  groundBeamDepth: number;
  groundBeamMoment: number;
  groundBeamAsRequired: number;
  groundBeamMainBar: string;
  groundBeamTopBar: string;
  groundBeamShearLinks: string;
  groundBeamStatus: 'SAFE' | 'UNSAFE';
  groundBeamUtilization: number;
}

const App: React.FC = () => {
  const [inputs, setInputs] = useState<DesignInput>(() => {
    const saved = localStorage.getItem('beamsafe_pro_inputs_v3');
    return saved ? JSON.parse(saved) : {
      span: '4.0',
      width: '150',
      depth: '450',
      fcu: '25',
      tributaryWidth: '3.0',
      wallHeight: '3.0',
      liveLoad: '1.5',
      colHeight: '3.0',
      soilCapacity: '150',
      groundBeamSpan: '3.0',
      groundBeamWidth: '200',
      groundBeamDepth: '350',
      groundBeamLoad: '10.0'
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
    const L = parseFloat(inputs.span);
    const fcu = parseFloat(inputs.fcu);
    const trib = parseFloat(inputs.tributaryWidth || '0');
    const wallH = parseFloat(inputs.wallHeight || '0');
    const LL = parseFloat(inputs.liveLoad || '1.5');
    const soil = parseFloat(inputs.soilCapacity || '150');
    const colH = parseFloat(inputs.colHeight || '3.0');

    // Ground beam inputs
    const groundBeamL = parseFloat(inputs.groundBeamSpan || '3.0');
    const groundBeamW = parseFloat(inputs.groundBeamWidth || '200');
    const groundBeamH = parseFloat(inputs.groundBeamDepth || '350');
    const groundBeamLoad = parseFloat(inputs.groundBeamLoad || '10.0');

    if (!L || isNaN(L) || L <= 0) {
      setResult(null);
      return;
    }

    let b = parseFloat(inputs.width);
    let h = parseFloat(inputs.depth);

    if (!b || !h) {
      h = h || Math.max(300, Math.ceil((L * 1000 / 14) / 25) * 25);
      b = b || Math.max(150, Math.ceil((h / 2.5) / 25) * 25);
    }

    // --- Beam Calcs ---
    const sw = (b / 1000) * (h / 1000) * CONCRETE_DENSITY;
    const deadLoad = sw + (SLAB_DL_UNIT * trib) + (WALL_DL_UNIT * wallH);
    const liveLoadTotal = LL * trib;
    const totalUDL = (GAMMA_G * deadLoad) + (GAMMA_Q * liveLoadTotal);
    const M = (totalUDL * L * L) / 8;
    const reaction = (totalUDL * L) / 2;

    const d = h - COVER - 8 - 10;
    const K = (M * 1e6) / (b * Math.pow(d, 2) * fcu);
    const utilization = Math.min(100, Math.round((K / 0.156) * 100));

    let status: 'SAFE' | 'UNSAFE' = K <= 0.156 ? 'SAFE' : 'UNSAFE';
    let mainBar = "None";
    let topBar = "2T12 (Hangers)";
    let shearLinks = "R6-250";
    let asRequired = 0;

    if (status === 'SAFE') {
      const z = Math.min(d * (0.5 + Math.sqrt(0.25 - K / 0.9)), 0.95 * d);
      asRequired = (M * 1e6) / (0.95 * FY * z);
      const minAs = 0.0013 * b * h;
      asRequired = Math.max(asRequired, minAs);

      if (asRequired < 226) mainBar = "2T12 Bottom";
      else if (asRequired < 402) mainBar = "2T16 Bottom";
      else if (asRequired < 603) mainBar = "3T16 Bottom";
      else if (asRequired < 942) mainBar = "3T20 Bottom";
      else mainBar = "4T20 Bottom";

      const V = reaction;
      const v = (V * 1000) / (b * d);
      shearLinks = v > 0.4 ? "R8 @ 175mm" : "R6 @ 200mm";
      if (v > 0.8 * Math.sqrt(fcu)) status = 'UNSAFE';
    }

    // --- Ground Beam Calculations (Following Malaysian Standards) ---
    const groundBeamSw = (groundBeamW / 1000) * (groundBeamH / 1000) * CONCRETE_DENSITY;
    const groundBeamTotalUDL = groundBeamLoad + groundBeamSw; // Including self-weight
    const groundBeamM = (groundBeamTotalUDL * groundBeamL * groundBeamL) / 8;
    const groundBeamReaction = (groundBeamTotalUDL * groundBeamL) / 2;

    const groundBeamD = groundBeamH - COVER - 8 - 10;
    const groundBeamK = (groundBeamM * 1e6) / (groundBeamW * Math.pow(groundBeamD, 2) * fcu);
    const groundBeamUtilization = Math.min(100, Math.round((groundBeamK / 0.156) * 100));

    let groundBeamStatus: 'SAFE' | 'UNSAFE' = groundBeamK <= 0.156 ? 'SAFE' : 'UNSAFE';
    let groundBeamMainBar = "None";
    let groundBeamTopBar = "2T12 (Hangers)";
    let groundBeamShearLinks = "R6-250";
    let groundBeamAsRequired = 0;

    if (groundBeamStatus === 'SAFE') {
      const z = Math.min(groundBeamD * (0.5 + Math.sqrt(0.25 - groundBeamK / 0.9)), 0.95 * groundBeamD);
      groundBeamAsRequired = (groundBeamM * 1e6) / (0.95 * FY * z);
      const groundBeamMinAs = 0.0013 * groundBeamW * groundBeamH;
      groundBeamAsRequired = Math.max(groundBeamAsRequired, groundBeamMinAs);

      if (groundBeamAsRequired < 226) groundBeamMainBar = "2T12 Bottom";
      else if (groundBeamAsRequired < 402) groundBeamMainBar = "2T16 Bottom";
      else if (groundBeamAsRequired < 603) groundBeamMainBar = "3T16 Bottom";
      else if (groundBeamAsRequired < 942) groundBeamMainBar = "3T20 Bottom";
      else groundBeamMainBar = "4T20 Bottom";

      const V = groundBeamReaction;
      const v = (V * 1000) / (groundBeamW * groundBeamD);
      groundBeamShearLinks = v > 0.4 ? "R8 @ 175mm" : "R6 @ 200mm";
      if (v > 0.8 * Math.sqrt(fcu)) groundBeamStatus = 'UNSAFE';
    }

    // --- Column & Footing Calcs ---
    const axialLoad = reaction + (0.2 * 0.2 * colH * 24 * 1.4);
    const colSize = 200;
    const ac = colSize * colSize;
    const asc = ac * 0.008;
    const colCapacity = (0.35 * fcu * ac + 0.67 * FY * asc) / 1000;
    const colStatus = axialLoad < colCapacity ? 'SAFE' : 'UNSAFE';

    // Footing Reinforcement
    const footingArea = axialLoad / soil;
    const footingSize = Math.ceil(Math.sqrt(footingArea) * 10) / 10;

    // Simplified Footing Steel: Min 0.13% or calculation based on cantilever
    const footingP = axialLoad / (footingSize * footingSize);
    const cantL = (footingSize - (colSize/1000)) / 2;
    const footingM = (footingP * Math.pow(cantL, 2)) / 2;
    const footingD = 300 - 50; // 300mm standard depth, 50mm cover
    const footingAs = (footingM * 1e6) / (0.95 * FY * (0.95 * footingD));
    const footingMinAs = 0.0013 * 1000 * 300; // per meter
    const finalFootingAs = Math.max(footingAs, footingMinAs);

    let footingSteel = "T12 @ 250mm B1/B2";
    if (finalFootingAs > 452) footingSteel = "T12 @ 200mm B1/B2";
    if (finalFootingAs > 600) footingSteel = "T12 @ 150mm B1/B2";

    setResult({
      width: b,
      depth: h,
      totalUDL: Number(totalUDL.toFixed(2)),
      moment: Number(M.toFixed(2)),
      reaction: Number(reaction.toFixed(2)),
      asRequired: Math.round(asRequired),
      mainBar,
      topBar,
      shearLinks,
      status,
      utilization,
      colSize,
      colStatus,
      footingSize,
      footingSteel,
      // Ground beam properties
      groundBeamWidth: groundBeamW,
      groundBeamDepth: groundBeamH,
      groundBeamMoment: Number(groundBeamM.toFixed(2)),
      groundBeamAsRequired: Math.round(groundBeamAsRequired),
      groundBeamMainBar,
      groundBeamTopBar,
      groundBeamShearLinks,
      groundBeamStatus,
      groundBeamUtilization
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
      Section 1: Reinforced concrete beam ${result.width}x${result.depth}mm with ${result.topBar} and ${result.mainBar}, showing shear links ${result.shearLinks}.
      Section 2: Foundation footing plan ${result.footingSize}m x ${result.footingSize}m with reinforcement mesh ${result.footingSteel}.
      Section 3: Ground beam ${result.groundBeamWidth}x${result.groundBeamDepth}mm with ${result.groundBeamTopBar} and ${result.groundBeamMainBar}, showing shear links ${result.groundBeamShearLinks}.
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
    const summary = `BeamSafe Suite Report\nPrimary Beam: ${result.width}x${result.depth}mm\nMain: ${result.mainBar}\nTop: ${result.topBar}\nStatus: ${result.status}\n\nFooting: ${result.footingSize}m sq\nReinforcement: ${result.footingSteel}\n\nGround Beam: ${result.groundBeamWidth}x${result.groundBeamDepth}mm\nMain: ${result.groundBeamMainBar}\nTop: ${result.groundBeamTopBar}\nStatus: ${result.groundBeamStatus}`;
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
            <h2 className="input-title">01. Primary Geometry</h2>
          </div>
          <div className="input-grid">
            <div className="input-field">
              <label className="input-label">Span (m)</label>
              <input
                type="number"
                name="span"
                value={inputs.span}
                onChange={handleInputChange}
                placeholder="4.0"
                className="input-control"
              />
            </div>
            <div className="input-field">
              <label className="input-label">Width (mm)</label>
              <input
                type="number"
                name="width"
                value={inputs.width}
                onChange={handleInputChange}
                placeholder="Auto"
                className="input-control"
              />
            </div>
            <div className="input-field">
              <label className="input-label">Depth (mm)</label>
              <input
                type="number"
                name="depth"
                value={inputs.depth}
                onChange={handleInputChange}
                placeholder="Auto"
                className="input-control"
              />
            </div>
          </div>
        </div>

        <div className="input-section">
          <div className="input-header">
            <h2 className="input-title">02. Loads & Soil Physics</h2>
          </div>
          <div className="input-grid">
            <div className="input-field">
              <label className="input-label">Trib. Width (m)</label>
              <input
                type="number"
                name="tributaryWidth"
                value={inputs.tributaryWidth}
                onChange={handleInputChange}
                placeholder="3.0"
                className="input-control"
              />
            </div>
            <div className="input-field">
              <label className="input-label">Wall Ht (m)</label>
              <input
                type="number"
                name="wallHeight"
                value={inputs.wallHeight}
                onChange={handleInputChange}
                placeholder="3.0"
                className="input-control"
              />
            </div>
            <div className="input-field">
              <label className="input-label">Live Load (kPa)</label>
              <input
                type="number"
                name="liveLoad"
                value={inputs.liveLoad}
                onChange={handleInputChange}
                placeholder="1.5"
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
            <h2 className="input-title">03. Column & Foundation</h2>
          </div>
          <div className="input-grid">
            <div className="input-field">
              <label className="input-label">Floor Height (m)</label>
              <input
                type="number"
                name="colHeight"
                value={inputs.colHeight}
                onChange={handleInputChange}
                placeholder="3.0"
                className="input-control"
              />
            </div>
          </div>
        </div>

        <div className="input-section">
          <div className="input-header">
            <h2 className="input-title">04. Ground Beam Design</h2>
          </div>
          <div className="input-grid">
            <div className="input-field">
              <label className="input-label">Span (m)</label>
              <input
                type="number"
                name="groundBeamSpan"
                value={inputs.groundBeamSpan}
                onChange={handleInputChange}
                placeholder="3.0"
                className="input-control"
              />
            </div>
            <div className="input-field">
              <label className="input-label">Width (mm)</label>
              <input
                type="number"
                name="groundBeamWidth"
                value={inputs.groundBeamWidth}
                onChange={handleInputChange}
                placeholder="200"
                className="input-control"
              />
            </div>
            <div className="input-field">
              <label className="input-label">Depth (mm)</label>
              <input
                type="number"
                name="groundBeamDepth"
                value={inputs.groundBeamDepth}
                onChange={handleInputChange}
                placeholder="350"
                className="input-control"
              />
            </div>
            <div className="input-field">
              <label className="input-label">Load (kN/m)</label>
              <input
                type="number"
                name="groundBeamLoad"
                value={inputs.groundBeamLoad}
                onChange={handleInputChange}
                placeholder="10.0"
                className="input-control"
              />
            </div>
          </div>
        </div>

        {/* Results Section */}
        <div className="results-section">
          {result ? (
            <>
              <div className="status-display" style={{backgroundColor: result.status === 'SAFE' ? '#e8f5e9' : '#ffebee', borderColor: result.status === 'SAFE' ? '#4caf50' : '#f44336'}}>
                <div>
                  <div className="status-label">System Integrity</div>
                  <div className="status-value">{result.status}</div>
                </div>
                <div>
                  <div className="status-label">Utilization</div>
                  <div className="status-value">{result.utilization}%</div>
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
                  <div className="result-title">Beam Reinforcement</div>
                  <div className="result-value">Top: {result.topBar}</div>
                  <div className="result-value">Bottom: {result.mainBar}</div>
                  <div className="result-value">Shear: {result.shearLinks}</div>
                  <div className="result-value">Moment: {result.moment} kNm</div>
                </div>

                <div className="result-card">
                  <div className="result-title">Footing Design</div>
                  <div className="result-value">Reinforce: {result.footingSteel}</div>
                  <div className="result-value">Size: {result.footingSize}m sq</div>
                  <div className="result-value">Pressure: {(result.reaction / (result.footingSize * result.footingSize)).toFixed(1)} kPa</div>
                  <div className="result-value">Col Status: {result.colStatus}</div>
                </div>

                <div className="result-card">
                  <div className="result-title">Ground Beam</div>
                  <div className="result-value">Status: {result.groundBeamStatus}</div>
                  <div className="result-value">Top: {result.groundBeamTopBar}</div>
                  <div className="result-value">Bottom: {result.groundBeamMainBar}</div>
                  <div className="result-value">Shear: {result.groundBeamShearLinks}</div>
                </div>
              </div>

              <div className="visualization-area">
                <h3 className="visualization-title no-print">Structural Visualization</h3>
                <StructuralSVG result={result} />
                <div className="mt-4 text-center">
                  <p className="text-xs uppercase font-bold">
                    Schematic showing {result.mainBar} and {result.footingSteel} mesh
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
              <p className="text-gray-600 mt-2">Enter structural parameters to begin design synthesis.</p>
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
  const beamH = 35;
  const colW = 25;
  const footingW = result.footingSize * 45;
  const footingH = 12;
  // Scale ground beam dimensions proportionally
  const groundBeamW = Math.min(180, (result.groundBeamWidth / 300) * 180); // Max width 180
  const groundBeamH = Math.min(40, (result.groundBeamDepth / 400) * 40); // Max height 40

  return (
    <svg width="240" height="240" viewBox="0 0 240 240">
      {/* Soil */}
      <line x1="10" y1="210" x2="230" y2="210" stroke="#2d4059" strokeWidth="1.5" strokeDasharray="5 5" />

      {/* Footing Rebar (Bottom dots/mesh representation) */}
      <rect x={120 - footingW/2} y={210} width={footingW} height={footingH} fill="#1a3a5f" stroke="#3b82f6" strokeWidth="1.5" />
      <line x1={120 - footingW/2 + 5} y1={210 + footingH - 4} x2={120 + footingW/2 - 5} y2={210 + footingH - 4} stroke="#10b981" strokeWidth="2" strokeLinecap="round" />

      {/* Column */}
      <rect x={120 - colW/2} y={105} width={colW} height={105} fill="#1a3a5f" stroke="#6366f1" strokeWidth="1.5" />

      {/* Primary Beam Rebar Representation */}
      <rect x={30} y={105 - beamH} width={180} height={beamH} fill="#1a3a5f" stroke="#3b82f6" strokeWidth="2" />
      {/* Top Bars */}
      <line x1="35" y1={105 - beamH + 6} x2="205" y2={105 - beamH + 6} stroke="#94a3b8" strokeWidth="1.5" />
      {/* Bottom Bars */}
      <line x1="35" y1={105 - 6} x2="205" y2={105 - 6} stroke="#3b82f6" strokeWidth="2" />

      {/* Ground Beam - Positioned below the column */}
      <rect x={120 - groundBeamW/2} y={210 - footingH - groundBeamH} width={groundBeamW} height={groundBeamH} fill="#1a3a5f" stroke="#10b981" strokeWidth="1.5" />
      {/* Ground Beam Top Bars */}
      <line x1={120 - groundBeamW/2 + 5} y1={210 - footingH - groundBeamH + 4} x2={120 + groundBeamW/2 - 5} y2={210 - footingH - groundBeamH + 4} stroke="#94a3b8" strokeWidth="1" />
      {/* Ground Beam Bottom Bars */}
      <line x1={120 - groundBeamW/2 + 5} y1={210 - footingH - 4} x2={120 + groundBeamW/2 - 5} y2={210 - footingH - 4} stroke="#10b981" strokeWidth="1.5" />

      {/* Text Labels */}
      <text x="120" y="238" textAnchor="middle" fill="#10b981" fontSize="8" fontWeight="900" className="uppercase tracking-widest">{result.footingSteel}</text>
      <text x="120" y="85" textAnchor="middle" fill="#3b82f6" fontSize="8" fontWeight="900" className="uppercase tracking-widest">{result.mainBar}</text>
      <text x="120" y="200" textAnchor="middle" fill="#10b981" fontSize="7" fontWeight="900" className="uppercase tracking-widest">{result.groundBeamMainBar}</text>
    </svg>
  );
};

export default App;
