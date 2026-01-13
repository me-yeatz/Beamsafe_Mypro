
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
    <div className="min-h-screen flex flex-col items-center px-4 py-8 md:py-12">
      {/* Header */}
      <header className="w-full max-w-7xl mb-12 flex flex-col md:flex-row justify-between items-center gap-6 no-print">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-2xl shadow-blue-500/20">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tighter text-white uppercase italic">
              BeamSafe <span className="text-blue-500">Suite</span>
            </h1>
            <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.3em]">Foundation & Beam Master • v3.5</p>
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          <button onClick={copySummary} className={`px-5 py-2.5 rounded-xl border text-xs font-black uppercase tracking-widest transition-all ${copying ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-800 text-slate-500 hover:text-white hover:border-slate-600'}`}>
            {copying ? 'Copied' : 'Copy'}
          </button>
          <button onClick={() => window.print()} className="px-5 py-2.5 rounded-xl border border-slate-800 text-slate-500 text-xs font-black uppercase tracking-widest hover:text-white hover:border-slate-600">
            Report
          </button>
          <button onClick={generateStructuralImage} disabled={isGenerating} className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-black uppercase tracking-widest hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50">
            {isGenerating ? 'Drawing...' : 'AI Concept'}
          </button>
        </div>
      </header>

      <main className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Workspace: Inputs */}
        <div className="lg:col-span-4 space-y-6 no-print">
          <section className="glass-card rounded-[2rem] p-8 border-l-4 border-blue-500">
            <h2 className="text-xs font-black text-blue-500 mb-6 uppercase tracking-[0.2em]">01. Primary Geometry</h2>
            <div className="space-y-4">
              <SleekInput label="Span (m)" name="span" value={inputs.span} onChange={handleInputChange} placeholder="4.0" />
              <div className="grid grid-cols-2 gap-4">
                <SleekInput label="Width (mm)" name="width" value={inputs.width} onChange={handleInputChange} placeholder="Auto" />
                <SleekInput label="Depth (mm)" name="depth" value={inputs.depth} onChange={handleInputChange} placeholder="Auto" />
              </div>
            </div>
          </section>

          <section className="glass-card rounded-[2rem] p-8 border-l-4 border-indigo-500">
            <h2 className="text-xs font-black text-indigo-500 mb-6 uppercase tracking-[0.2em]">02. Loads & Soil Physics</h2>
            <div className="space-y-4">
              <SleekInput label="Trib. Width (m)" name="tributaryWidth" value={inputs.tributaryWidth} onChange={handleInputChange} placeholder="3.0" />
              <SleekInput label="Wall Ht (m)" name="wallHeight" value={inputs.wallHeight} onChange={handleInputChange} placeholder="3.0" />
              <SleekInput label="Live Load (kPa)" name="liveLoad" value={inputs.liveLoad} onChange={handleInputChange} placeholder="1.5" />
              <SleekInput label="Soil Capacity (kPa)" name="soilCapacity" value={inputs.soilCapacity} onChange={handleInputChange} placeholder="150" />
            </div>
          </section>

          <section className="glass-card rounded-[2rem] p-8 border-l-4 border-slate-500">
            <h2 className="text-xs font-black text-slate-500 mb-6 uppercase tracking-[0.2em]">03. Column & Foundation</h2>
            <div className="space-y-4">
              <SleekInput label="Floor Height (m)" name="colHeight" value={inputs.colHeight} onChange={handleInputChange} placeholder="3.0" />
            </div>
          </section>

          <section className="glass-card rounded-[2rem] p-8 border-l-4 border-emerald-500">
            <h2 className="text-xs font-black text-emerald-500 mb-6 uppercase tracking-[0.2em]">04. Ground Beam Design</h2>
            <div className="space-y-4">
              <SleekInput label="Span (m)" name="groundBeamSpan" value={inputs.groundBeamSpan} onChange={handleInputChange} placeholder="3.0" />
              <div className="grid grid-cols-2 gap-4">
                <SleekInput label="Width (mm)" name="groundBeamWidth" value={inputs.groundBeamWidth} onChange={handleInputChange} placeholder="200" />
                <SleekInput label="Depth (mm)" name="groundBeamDepth" value={inputs.groundBeamDepth} onChange={handleInputChange} placeholder="350" />
              </div>
              <SleekInput label="Load (kN/m)" name="groundBeamLoad" value={inputs.groundBeamLoad} onChange={handleInputChange} placeholder="10.0" />
            </div>
          </section>
        </div>

        {/* Display: Results & AI */}
        <div className="lg:col-span-8 space-y-8 print:w-full">
          {result ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              
              {/* Dashboard Left */}
              <div className="space-y-6">
                <div className={`p-8 rounded-[2rem] flex items-center justify-between border-2 shadow-2xl ${result.status === 'SAFE' ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-rose-500/5 border-rose-500/20'}`}>
                  <div>
                    <p className={`text-[9px] font-black uppercase tracking-[0.3em] mb-1 ${result.status === 'SAFE' ? 'text-emerald-500' : 'text-rose-500'}`}>System Integrity</p>
                    <h2 className={`text-5xl font-black ${result.status === 'SAFE' ? 'text-emerald-400' : 'text-rose-400'}`}>{result.status}</h2>
                    <p className="text-slate-500 text-[10px] mt-2 font-bold uppercase tracking-widest">Util: {result.utilization}%</p>
                  </div>
                </div>

                {/* Beam Detail */}
                <div className="glass-card rounded-[2rem] p-8 space-y-5">
                   <h3 className="text-[10px] font-black text-blue-500 uppercase tracking-widest border-b border-slate-800 pb-3">Beam Reinforcement Layout</h3>
                   <ResultRow label="Top Reinforcement" value={result.topBar} color="text-slate-400" />
                   <ResultRow label="Bottom Reinforcement" value={result.mainBar} color="text-blue-400" />
                   <ResultRow label="Shear Links" value={result.shearLinks} />
                   <ResultRow label="Total Moment" value={`${result.moment} kNm`} />
                </div>

                {/* Foundation Detail */}
                <div className="glass-card rounded-[2rem] p-8 space-y-5 border-t-2 border-indigo-500/30">
                   <h3 className="text-[10px] font-black text-indigo-500 uppercase tracking-widest border-b border-slate-800 pb-3">Footing & Steel</h3>
                   <ResultRow label="Footing Reinforce" value={result.footingSteel} color="text-emerald-400" />
                   <ResultRow label="Footing Size" value={`${result.footingSize}m x ${result.footingSize}m`} />
                   <ResultRow label="Total Pressure" value={`${(result.reaction / (result.footingSize * result.footingSize)).toFixed(1)} kPa`} />
                </div>

                {/* Ground Beam Detail */}
                <div className="glass-card rounded-[2rem] p-8 space-y-5 border-t-2 border-emerald-500/30">
                   <h3 className="text-[10px] font-black text-emerald-500 uppercase tracking-widest border-b border-slate-800 pb-3">Ground Beam Design</h3>
                   <ResultRow label="Status" value={result.groundBeamStatus} color={result.groundBeamStatus === 'SAFE' ? 'text-emerald-400' : 'text-rose-400'} />
                   <ResultRow label="Utilization" value={`${result.groundBeamUtilization}%`} />
                   <ResultRow label="Top Reinforcement" value={result.groundBeamTopBar} color="text-slate-400" />
                   <ResultRow label="Bottom Reinforcement" value={result.groundBeamMainBar} color="text-emerald-400" />
                   <ResultRow label="Shear Links" value={result.groundBeamShearLinks} />
                   <ResultRow label="Moment" value={`${result.groundBeamMoment} kNm`} />
                </div>
              </div>

              {/* Dashboard Right */}
              <div className="space-y-6">
                <div className="glass-card rounded-[2rem] p-8 flex flex-col items-center justify-center min-h-[350px]">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-6 no-print">Section & Steel Preview</h3>
                  <StructuralSVG result={result} />
                  <div className="mt-8 text-center px-4">
                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest leading-relaxed">
                      Schematic showing {result.mainBar} and {result.footingSteel} mesh
                    </p>
                  </div>
                </div>

                {aiImage && (
                  <div className="glass-card rounded-[2.5rem] p-2 overflow-hidden shadow-2xl border-2 border-blue-500/20 group relative">
                    <img src={aiImage} alt="Structural Detail" className="w-full h-auto rounded-[2rem] opacity-70 group-hover:opacity-100 transition-opacity duration-700" />
                    <div className="absolute inset-x-0 bottom-0 p-8 bg-gradient-to-t from-slate-900 via-slate-900/80 to-transparent">
                       <p className="text-white font-black text-xs uppercase tracking-widest mb-1">AI Technical Concept</p>
                       <p className="text-slate-400 text-[9px] uppercase tracking-widest">Generative blueprint based on calculated steel</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="glass-card rounded-[2.5rem] p-12 flex flex-col items-center justify-center text-center h-[500px] border-dashed border-slate-800">
               <h2 className="text-slate-500 text-lg font-black uppercase tracking-[0.2em]">Analysis Standby</h2>
               <p className="text-slate-600 text-xs mt-3 max-w-xs uppercase font-bold tracking-tighter">Enter structural parameters to begin design synthesis.</p>
            </div>
          )}
        </div>
      </main>

      {/* Print Footer */}
      <footer className="print-only mt-10 text-black border-t-2 border-black pt-6 w-full max-w-4xl mx-auto">
        <h3 className="text-xl font-bold mb-4 uppercase">Technical Specification Sheet</h3>
        <p className="text-sm italic">Generated via BeamSafe MY Pro v3.5. All reinforcement schedules must be cross-verified against site-specific requirements.</p>
      </footer>
    </div>
  );
};

const SleekInput: React.FC<{ label: string; name: string; value: string; onChange: (e: any) => void; placeholder: string }> = ({ label, name, value, onChange, placeholder }) => (
  <div className="relative group">
    <label className="block text-[9px] font-black text-slate-600 mb-2 uppercase tracking-widest group-focus-within:text-blue-500 transition-colors">
      {label}
    </label>
    <input
      type="number"
      name={name}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="w-full bg-slate-900/50 border border-slate-800 rounded-xl p-4 text-white font-bold text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all placeholder:text-slate-800"
    />
  </div>
);

const ResultRow: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div className="flex justify-between items-center py-1">
    <span className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">{label}</span>
    <span className={`text-sm font-black tracking-tight ${color || 'text-white'}`}>{value}</span>
  </div>
);

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
      <line x1="10" y1="210" x2="230" y2="210" stroke="#1e293b" strokeWidth="1.5" strokeDasharray="5 5" />

      {/* Footing Rebar (Bottom dots/mesh representation) */}
      <rect x={120 - footingW/2} y={210} width={footingW} height={footingH} fill="#0f172a" stroke="#3b82f6" strokeWidth="1.5" />
      <line x1={120 - footingW/2 + 5} y1={210 + footingH - 4} x2={120 + footingW/2 - 5} y2={210 + footingH - 4} stroke="#10b981" strokeWidth="2" strokeLinecap="round" />

      {/* Column */}
      <rect x={120 - colW/2} y={105} width={colW} height={105} fill="#0f172a" stroke="#6366f1" strokeWidth="1.5" />

      {/* Primary Beam Rebar Representation */}
      <rect x={30} y={105 - beamH} width={180} height={beamH} fill="#0f172a" stroke="#3b82f6" strokeWidth="2" />
      {/* Top Bars */}
      <line x1="35" y1={105 - beamH + 6} x2="205" y2={105 - beamH + 6} stroke="#94a3b8" strokeWidth="1.5" />
      {/* Bottom Bars */}
      <line x1="35" y1={105 - 6} x2="205" y2={105 - 6} stroke="#3b82f6" strokeWidth="2" />

      {/* Ground Beam - Positioned below the column */}
      <rect x={120 - groundBeamW/2} y={210 - footingH - groundBeamH} width={groundBeamW} height={groundBeamH} fill="#0f172a" stroke="#10b981" strokeWidth="1.5" />
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
