import { useState, useEffect, useCallback, createContext, useContext } from "react";
import {
  supabase, isSupabaseConfigured,
  signUp as sbSignUp, signInWithMagicLink, getSession, getUser,
  signOut as sbSignOut, saveProcess as sbSaveProcess,
  loadProcesses, deleteProcess as sbDeleteProcess, trackEvent
} from "./supabase.js";

// Auth context
const AuthContext = createContext(null);
function useAuth() { return useContext(AuthContext); }

// Topography background pattern — served as static files from /public
const TopoBg = ({dark=false}) => (
  <div style={{position:"fixed",inset:0,backgroundImage:`url(${dark?"/topography-dark.svg":"/topography-light.svg"})`,backgroundSize:"600px 600px",pointerEvents:"none",zIndex:0}}/>
);

// CONSTANTS
// ═══════════════════════════════════════════════════
const DEFAULT_ROLES = [
  { id: "partner", name: "Partner / Owner", rate: 125 },
  { id: "manager", name: "Manager", rate: 75 },
  { id: "senior", name: "Senior / Qualified", rate: 45 },
  { id: "junior", name: "Junior / Trainee", rate: 32 },
  { id: "admin", name: "Admin / Support", rate: 28 },
];

// Dynamic role colors: red (expensive) → amber → green (cheap)
function getRoleColor(role, allRoles) {
  if (!allRoles || allRoles.length === 0) return "#6b7280";
  const rates = allRoles.map(r => r.rate).sort((a, b) => b - a);
  const maxRate = rates[0];
  const minRate = rates[rates.length - 1];
  if (maxRate === minRate) return "#c4942a";
  const t = (role.rate - minRate) / (maxRate - minRate); // 1 = most expensive, 0 = cheapest
  // Interpolate: green(0) → amber(0.5) → red(1)
  if (t <= 0.5) {
    const p = t * 2;
    const r = Math.round(45 + p * (196 - 45));
    const g = Math.round(106 + p * (148 - 106));
    const b = Math.round(79 + p * (42 - 79));
    return `rgb(${r},${g},${b})`;
  } else {
    const p = (t - 0.5) * 2;
    const r = Math.round(196 + p * (184 - 196));
    const g = Math.round(148 + p * (74 - 148));
    const b = Math.round(42 + p * (90 - 42));
    return `rgb(${r},${g},${b})`;
  }
}

// Work type categories — replaces binary "automatable" flag
const WORK_TYPES = [
  { value: "manual", label: "Manual / Repetitive", short: "Manual", color: "#c4942a", bg: "#faf0d6", icon: "⟳", saveable: true, desc: "Same thing every time — data entry, standard emails, filing" },
  { value: "waiting", label: "Waiting / Chasing", short: "Waiting", color: "#b84a5a", bg: "#f5e0e3", icon: "⏳", saveable: true, desc: "Blocked on someone else — chasing docs, awaiting approval" },
  { value: "decision", label: "Decision / Judgement", short: "Decision", color: "#2d6a4f", bg: "#d4ede2", icon: "◆", saveable: false, desc: "Needs human expertise — review, sign-off, advisory" },
];

const FRICTION_LEVELS = [
  { value: "low", label: "Low", color: "#d4ede2", text: "#1b4332" },
  { value: "medium", label: "Medium", color: "#faf0d6", text: "#8a6a1e" },
  { value: "high", label: "High", color: "#f5e0e3", text: "#b84a5a" },
  { value: "very-high", label: "Very High", color: "#b84a5a", text: "#fff" },
];

const INDUSTRIES = ["Accounting & Tax", "Legal", "Recruitment", "Financial Advice", "Property Management", "Healthcare", "Construction & Trades", "E-commerce", "Other"];

const TEMPLATES = [
  {
    id: "onboarding-accounting", name: "Client Onboarding", industry: "Accounting",
    description: "Full 21-step client onboarding from enquiry to first deliverable.",
    annualVolume: 80,
    steps: [
      { name: "Enquiry received & logged", roleId: "admin", minutes: 10, friction: "low", workType: "manual" },
      { name: "Initial qualification call", roleId: "partner", minutes: 20, friction: "medium", workType: "decision" },
      { name: "Send information pack", roleId: "admin", minutes: 15, friction: "low", workType: "manual" },
      { name: "Follow-up & scheduling", roleId: "admin", minutes: 25, friction: "high", workType: "waiting" },
      { name: "Prepare fee proposal", roleId: "manager", minutes: 45, friction: "medium", workType: "manual" },
      { name: "Internal review & sign-off", roleId: "partner", minutes: 15, friction: "low", workType: "decision" },
      { name: "Send proposal to client", roleId: "admin", minutes: 10, friction: "low", workType: "manual" },
      { name: "Client review period (chasing)", roleId: "admin", minutes: 30, friction: "high", workType: "waiting" },
      { name: "Engagement letter signing", roleId: "admin", minutes: 20, friction: "high", workType: "manual" },
      { name: "ID verification request", roleId: "admin", minutes: 15, friction: "medium", workType: "manual" },
      { name: "AML screening", roleId: "manager", minutes: 30, friction: "medium", workType: "manual" },
      { name: "Risk assessment", roleId: "manager", minutes: 20, friction: "low", workType: "decision" },
      { name: "Compliance sign-off", roleId: "partner", minutes: 10, friction: "low", workType: "decision" },
      { name: "Send document request list", roleId: "senior", minutes: 20, friction: "medium", workType: "manual" },
      { name: "Chase missing documents", roleId: "admin", minutes: 45, friction: "very-high", workType: "waiting" },
      { name: "Upload & organise documents", roleId: "junior", minutes: 30, friction: "medium", workType: "manual" },
      { name: "Create client in practice mgmt", roleId: "admin", minutes: 20, friction: "medium", workType: "manual" },
      { name: "Set up in Xero / accounting software", roleId: "senior", minutes: 30, friction: "medium", workType: "manual" },
      { name: "Configure recurring tasks & deadlines", roleId: "manager", minutes: 20, friction: "low", workType: "manual" },
      { name: "Assign team & notify", roleId: "manager", minutes: 10, friction: "low", workType: "manual" },
      { name: "Welcome call with client", roleId: "manager", minutes: 30, friction: "low", workType: "decision" },
    ],
  },
  {
    id: "tax-return", name: "Tax Return Filing", industry: "Accounting",
    description: "End-to-end tax return from data collection to HMRC submission.", annualVolume: 200,
    steps: [
      { name: "Send tax return checklist to client", roleId: "admin", minutes: 10, friction: "low", workType: "manual" },
      { name: "Chase client for information", roleId: "admin", minutes: 30, friction: "very-high", workType: "waiting" },
      { name: "Review documents received", roleId: "senior", minutes: 20, friction: "medium", workType: "decision" },
      { name: "Request missing information", roleId: "senior", minutes: 15, friction: "high", workType: "manual" },
      { name: "Prepare tax computation", roleId: "senior", minutes: 90, friction: "low", workType: "decision" },
      { name: "Manager review", roleId: "manager", minutes: 30, friction: "low", workType: "decision" },
      { name: "Amend and finalise", roleId: "senior", minutes: 20, friction: "low", workType: "decision" },
      { name: "Partner sign-off", roleId: "partner", minutes: 10, friction: "low", workType: "decision" },
      { name: "Send to client for approval", roleId: "admin", minutes: 10, friction: "low", workType: "manual" },
      { name: "Chase client approval", roleId: "admin", minutes: 20, friction: "high", workType: "waiting" },
      { name: "File with HMRC", roleId: "senior", minutes: 15, friction: "low", workType: "manual" },
      { name: "Confirm filing & archive", roleId: "admin", minutes: 10, friction: "low", workType: "manual" },
    ],
  },
  {
    id: "new-matter-legal", name: "New Matter Opening", industry: "Legal",
    description: "Opening a new legal matter from instruction to active case management.", annualVolume: 120,
    steps: [
      { name: "Receive instruction & log enquiry", roleId: "admin", minutes: 15, friction: "low", workType: "manual" },
      { name: "Conflict of interest check", roleId: "manager", minutes: 25, friction: "medium", workType: "manual" },
      { name: "Client ID verification & AML", roleId: "admin", minutes: 20, friction: "medium", workType: "manual" },
      { name: "Prepare engagement letter", roleId: "manager", minutes: 30, friction: "medium", workType: "manual" },
      { name: "Send letter & chase signature", roleId: "admin", minutes: 20, friction: "high", workType: "waiting" },
      { name: "Open matter in case management", roleId: "admin", minutes: 15, friction: "medium", workType: "manual" },
      { name: "Set up in accounts system", roleId: "admin", minutes: 10, friction: "medium", workType: "manual" },
      { name: "Request client documents", roleId: "senior", minutes: 15, friction: "medium", workType: "manual" },
      { name: "Chase missing documents", roleId: "admin", minutes: 35, friction: "very-high", workType: "waiting" },
      { name: "Initial file review", roleId: "senior", minutes: 45, friction: "low", workType: "decision" },
      { name: "Assign fee earner & notify team", roleId: "manager", minutes: 10, friction: "low", workType: "manual" },
      { name: "Set key dates & court deadlines", roleId: "senior", minutes: 15, friction: "medium", workType: "manual" },
    ],
  },
  {
    id: "placement-recruitment", name: "Candidate Placement", industry: "Recruitment",
    description: "From sourcing through to placement confirmation and invoicing.", annualVolume: 60,
    steps: [
      { name: "Receive job brief from client", roleId: "manager", minutes: 20, friction: "low", workType: "decision" },
      { name: "Post job across boards", roleId: "admin", minutes: 25, friction: "medium", workType: "manual" },
      { name: "Screen incoming applications", roleId: "senior", minutes: 45, friction: "medium", workType: "decision" },
      { name: "Shortlist & contact candidates", roleId: "senior", minutes: 30, friction: "low", workType: "decision" },
      { name: "Schedule interviews", roleId: "admin", minutes: 20, friction: "high", workType: "manual" },
      { name: "Prep candidates for interview", roleId: "senior", minutes: 15, friction: "low", workType: "decision" },
      { name: "Collect interview feedback", roleId: "admin", minutes: 15, friction: "medium", workType: "manual" },
      { name: "Request references", roleId: "admin", minutes: 10, friction: "low", workType: "manual" },
      { name: "Chase references", roleId: "admin", minutes: 30, friction: "very-high", workType: "waiting" },
      { name: "Right-to-work & compliance docs", roleId: "admin", minutes: 20, friction: "high", workType: "manual" },
      { name: "Prepare offer & negotiate", roleId: "manager", minutes: 30, friction: "low", workType: "decision" },
      { name: "Generate contract & send", roleId: "admin", minutes: 15, friction: "medium", workType: "manual" },
      { name: "Raise invoice to client", roleId: "admin", minutes: 10, friction: "low", workType: "manual" },
    ],
  },
  {
    id: "tenant-onboarding", name: "Tenant Onboarding", industry: "Property Management",
    description: "New tenant from viewing through to move-in.", annualVolume: 100,
    steps: [
      { name: "Enquiry received & respond", roleId: "admin", minutes: 10, friction: "low", workType: "manual" },
      { name: "Schedule & conduct viewing", roleId: "senior", minutes: 30, friction: "low", workType: "decision" },
      { name: "Application form & ID collection", roleId: "admin", minutes: 20, friction: "medium", workType: "manual" },
      { name: "Referencing check", roleId: "admin", minutes: 15, friction: "medium", workType: "manual" },
      { name: "Chase outstanding references", roleId: "admin", minutes: 25, friction: "high", workType: "waiting" },
      { name: "Prepare tenancy agreement", roleId: "manager", minutes: 25, friction: "medium", workType: "manual" },
      { name: "Send agreement & chase signature", roleId: "admin", minutes: 20, friction: "high", workType: "waiting" },
      { name: "Collect deposit & first month rent", roleId: "admin", minutes: 15, friction: "medium", workType: "manual" },
      { name: "Register deposit with scheme", roleId: "admin", minutes: 10, friction: "low", workType: "manual" },
      { name: "Inventory / check-in report", roleId: "senior", minutes: 60, friction: "low", workType: "decision" },
      { name: "Set up in property management system", roleId: "admin", minutes: 15, friction: "medium", workType: "manual" },
      { name: "Key handover & welcome pack", roleId: "admin", minutes: 20, friction: "low", workType: "decision" },
    ],
  },
  {
    id: "client-review-ifa", name: "Annual Client Review", industry: "Financial Advice",
    description: "Ongoing client review cycle from preparation to implementation.", annualVolume: 150,
    steps: [
      { name: "Pull client valuations from platforms", roleId: "admin", minutes: 25, friction: "high", workType: "manual" },
      { name: "Prepare review pack", roleId: "senior", minutes: 30, friction: "medium", workType: "manual" },
      { name: "Schedule review meeting", roleId: "admin", minutes: 15, friction: "medium", workType: "manual" },
      { name: "Adviser pre-read & preparation", roleId: "partner", minutes: 20, friction: "low", workType: "decision" },
      { name: "Conduct review meeting", roleId: "partner", minutes: 60, friction: "low", workType: "decision" },
      { name: "Write up meeting notes & actions", roleId: "senior", minutes: 25, friction: "medium", workType: "decision" },
      { name: "Draft suitability letter", roleId: "senior", minutes: 45, friction: "medium", workType: "manual" },
      { name: "Compliance review of letter", roleId: "manager", minutes: 20, friction: "low", workType: "decision" },
      { name: "Send letter to client for approval", roleId: "admin", minutes: 10, friction: "low", workType: "manual" },
      { name: "Chase client approval", roleId: "admin", minutes: 20, friction: "high", workType: "waiting" },
      { name: "Submit platform transactions", roleId: "admin", minutes: 20, friction: "medium", workType: "manual" },
      { name: "Confirm completion & update CRM", roleId: "admin", minutes: 10, friction: "low", workType: "manual" },
    ],
  },
  {
    id: "custom", name: "Start from scratch", industry: "Any",
    description: "Build your own process map from a blank canvas.", annualVolume: 50, steps: [],
  },
];

// ═══════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════
function isSaveable(step) {
  const wt = WORK_TYPES.find(w => w.value === step.workType);
  // Backwards compat: if step has old automatable field, use it
  if (!wt && step.automatable !== undefined) return step.automatable;
  return wt ? wt.saveable : false;
}

function calcCosts(roles, steps, annualVolume) {
  const totalCost = steps.reduce((s, st) => { const r = roles.find(rl => rl.id === st.roleId); return s + (r ? (st.minutes / 60) * r.rate : 0); }, 0);
  const saveableCost = steps.filter(s => isSaveable(s)).reduce((s, st) => { const r = roles.find(rl => rl.id === st.roleId); return s + (r ? (st.minutes / 60) * r.rate : 0); }, 0);
  return { totalCost, annualCost: totalCost * annualVolume, potentialSaving: saveableCost * annualVolume * 0.7 };
}

function generateReport(processName, roles, steps, annualVolume) {
  const { totalCost, annualCost, potentialSaving } = calcCosts(roles, steps, annualVolume);
  const totalMinutes = steps.reduce((s, st) => s + st.minutes, 0);
  const saveableSteps = steps.filter(s => isSaveable(s));
  let t = `COSTCLOCK — PROCESS COST REPORT\nGenerated by CostClock (costclock.workthru.co.uk)\n${"═".repeat(56)}\n\n`;
  t += `Process:          ${processName}\nAnnual volume:    ${annualVolume}× per year\n\n`;
  t += `KEY FINDINGS\n${"─".repeat(40)}\n`;
  t += `Cost per run:          £${totalCost.toFixed(0)}\nTime per run:          ${Math.floor(totalMinutes/60)}h ${totalMinutes%60}m\n`;
  t += `Annual cost:           £${annualCost.toLocaleString("en-GB",{maximumFractionDigits:0})}\n`;
  t += `Saving opportunities:  ${saveableSteps.length} of ${steps.length} steps\nPotential annual saving: £${potentialSaving.toLocaleString("en-GB",{maximumFractionDigits:0})}\n\n`;
  t += `STEP BREAKDOWN\n${"─".repeat(40)}\n`;
  steps.forEach((st, i) => {
    const r = roles.find(rl => rl.id === st.roleId);
    const c = r ? (st.minutes/60)*r.rate : 0;
    const wt = WORK_TYPES.find(w => w.value === st.workType);
    t += `\n${String(i+1).padStart(2)}. ${st.name}\n    Owner: ${r?.name||"—"}  ·  Time: ${st.minutes}m  ·  Cost: £${c.toFixed(0)}  ·  Friction: ${st.friction}  ·  ${wt?.label||"Manual"}${isSaveable(st)?"  ★ Saving opportunity":""}\n`;
  });
  t += `\n${"═".repeat(56)}\n\nThis is one process. What about the rest?\nBook a free call: cal.com/workthru/15min\nworkthru.co.uk\n`;
  return t;
}

// ═══════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════
function Badge({ children }) {
  return <span style={{ display:"inline-flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:100,background:"#d4ede2",color:"#1b4332",fontSize:"0.75rem",fontWeight:600,letterSpacing:"0.02em" }}><span style={{width:5,height:5,borderRadius:"50%",background:"#2d6a4f"}}/>{children}</span>;
}

function FrictionBadge({ level }) {
  const f = FRICTION_LEVELS.find(l => l.value === level) || FRICTION_LEVELS[0];
  return <span style={{ display:"inline-block",padding:"3px 12px",borderRadius:100,fontSize:"0.72rem",fontWeight:600,background:f.color,color:f.text }}>{f.label}</span>;
}

function Card({ children, style, hover, onClick }) {
  const [h, setH] = useState(false);
  return <div onClick={onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)} style={{ background:"#fff",border:h&&hover?"1.5px solid #2d6a4f":"1px solid #e5e2dc",borderRadius:16,padding:28,transition:"all 0.3s",transform:h&&hover?"translateY(-2px)":"none",boxShadow:h&&hover?"0 8px 30px rgba(26,31,46,0.1)":"none",cursor:onClick?"pointer":"default",...style }}>{children}</div>;
}

function NumberInput({ value, onChange, prefix, suffix, min=0 }) {
  return <div style={{display:"flex",alignItems:"center",gap:4}}>
    {prefix&&<span style={{fontSize:"0.85rem",color:"#6b7280",fontWeight:500}}>{prefix}</span>}
    <input type="number" value={value} min={min} onChange={e=>onChange(Number(e.target.value)||0)} style={{width:70,padding:"8px 10px",borderRadius:8,border:"1px solid #e5e2dc",background:"#EFEFEF",fontFamily:"'Fraunces',serif",fontWeight:700,fontSize:"0.95rem",color:"#1a1f2e",outline:"none",textAlign:"center"}}/>
    {suffix&&<span style={{fontSize:"0.8rem",color:"#6b7280"}}>{suffix}</span>}
  </div>;
}

function Select({ value, onChange, options, style }) {
  return <select value={value} onChange={e=>onChange(e.target.value)} style={{padding:"8px 12px",borderRadius:8,border:"1px solid #e5e2dc",background:"#EFEFEF",fontFamily:"'DM Sans',sans-serif",fontSize:"0.88rem",color:"#1a1f2e",outline:"none",cursor:"pointer",...style}}>
    {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
  </select>;
}

function Button({ children, primary, small, onClick, style, disabled }) {
  const [h,setH]=useState(false);
  return <button onClick={onClick} disabled={disabled} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)} style={{
    display:"inline-flex",alignItems:"center",gap:8,padding:small?"8px 16px":primary?"14px 28px":"10px 20px",
    borderRadius:10,border:primary?"none":"1.5px solid #e5e2dc",
    background:primary?(h?"#1b4332":"#2d6a4f"):(h?"#f3f1ed":"#fff"),color:primary?"#fff":"#1a1f2e",
    fontFamily:"'DM Sans',sans-serif",fontWeight:600,fontSize:small?"0.82rem":primary?"1rem":"0.88rem",
    cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.5:1,transition:"all 0.2s",
    transform:h&&!disabled?"translateY(-1px)":"none",boxShadow:primary?"0 2px 8px rgba(45,106,79,0.2)":"none",...style
  }}>{children}</button>;
}

// ═══════════════════════════════════════════════════
// AUTH MODAL
// ═══════════════════════════════════════════════════
function AuthModal({ onClose, onAuth, mode: initMode }) {
  const [mode, setMode] = useState(initMode || "register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [industry, setIndustry] = useState("");
  const [firmSize, setFirmSize] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [magicSent, setMagicSent] = useState(false);

  const handleRegister = async () => {
    if (!name || !email) { setError("Name and email are required"); return; }
    setLoading(true); setError("");
    try {
      const pw = crypto.randomUUID();
      const { data, error: signUpError } = await sbSignUp(email, pw, { name, company, industry, firm_size: firmSize });
      if (signUpError) { setError(signUpError.message || "Registration failed"); setLoading(false); return; }
      // Also insert into users table
      
      onAuth({ id: data.user?.id, email, name, company, industry });
    } catch (e) { setError("Something went wrong. Please try again."); }
    setLoading(false);
  };

  const handleMagicLink = async () => {
    if (!email) { setError("Enter your email"); return; }
    setLoading(true); setError("");
    try {
      await signInWithMagicLink(email);
      setMagicSent(true);
    } catch { setError("Failed to send login link"); }
    setLoading(false);
  };

  return (
    <div style={{ position:"fixed",inset:0,zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:24 }} onClick={onClose}>
      <div style={{ position:"absolute",inset:0,background:"rgba(26,31,46,0.6)",backdropFilter:"blur(4px)" }}/>
      <div onClick={e=>e.stopPropagation()} style={{ position:"relative",background:"#fff",borderRadius:20,padding:"40px 36px",maxWidth:440,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }}>
        <button onClick={onClose} style={{position:"absolute",top:16,right:16,background:"none",border:"none",fontSize:"1.2rem",color:"#6b7280",cursor:"pointer"}}>×</button>

        {mode === "register" && !magicSent && (
          <>
            <Badge>Free — no credit card</Badge>
            <h3 style={{fontFamily:"'Fraunces',serif",fontSize:"1.4rem",fontWeight:700,margin:"16px 0 8px"}}>Save your process & get AI insights</h3>
            <p style={{fontSize:"0.88rem",color:"#6b7280",lineHeight:1.6,marginBottom:24}}>Register to save your work and receive a personalised AI analysis of your process data — free.</p>
            {error && <div style={{background:"#f5e0e3",color:"#b84a5a",padding:"10px 14px",borderRadius:8,fontSize:"0.85rem",marginBottom:16}}>{error}</div>}
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div>
                <label style={{fontSize:"0.72rem",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:"#6b7280",display:"block",marginBottom:4}}>Name *</label>
                <input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" style={{width:"100%",padding:"10px 14px",borderRadius:8,border:"1px solid #e5e2dc",fontFamily:"'DM Sans',sans-serif",fontSize:"0.92rem",outline:"none",boxSizing:"border-box"}}/>
              </div>
              <div>
                <label style={{fontSize:"0.72rem",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:"#6b7280",display:"block",marginBottom:4}}>Email *</label>
                <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.co.uk" style={{width:"100%",padding:"10px 14px",borderRadius:8,border:"1px solid #e5e2dc",fontFamily:"'DM Sans',sans-serif",fontSize:"0.92rem",outline:"none",boxSizing:"border-box"}}/>
              </div>
              <div style={{display:"flex",gap:12}}>
                <div style={{flex:1}}>
                  <label style={{fontSize:"0.72rem",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:"#6b7280",display:"block",marginBottom:4}}>Company</label>
                  <input value={company} onChange={e=>setCompany(e.target.value)} placeholder="Optional" style={{width:"100%",padding:"10px 14px",borderRadius:8,border:"1px solid #e5e2dc",fontFamily:"'DM Sans',sans-serif",fontSize:"0.92rem",outline:"none",boxSizing:"border-box"}}/>
                </div>
                <div style={{flex:1}}>
                  <label style={{fontSize:"0.72rem",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:"#6b7280",display:"block",marginBottom:4}}>Industry</label>
                  <select value={industry} onChange={e=>setIndustry(e.target.value)} style={{width:"100%",padding:"10px 14px",borderRadius:8,border:"1px solid #e5e2dc",fontFamily:"'DM Sans',sans-serif",fontSize:"0.92rem",outline:"none",cursor:"pointer",boxSizing:"border-box"}}>
                    <option value="">Select...</option>
                    {INDUSTRIES.map(i=><option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{fontSize:"0.72rem",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:"#6b7280",display:"block",marginBottom:4}}>Firm size</label>
                <select value={firmSize} onChange={e=>setFirmSize(e.target.value)} style={{width:"100%",padding:"10px 14px",borderRadius:8,border:"1px solid #e5e2dc",fontFamily:"'DM Sans',sans-serif",fontSize:"0.92rem",outline:"none",cursor:"pointer",boxSizing:"border-box"}}>
                  <option value="">Select...</option>
                  <option value="1-5">1–5 people</option>
                  <option value="6-15">6–15 people</option>
                  <option value="16-30">16–30 people</option>
                  <option value="31-50">31–50 people</option>
                  <option value="50+">50+ people</option>
                </select>
              </div>
            </div>
            <Button primary onClick={handleRegister} disabled={loading} style={{width:"100%",justifyContent:"center",marginTop:20}}>
              {loading ? "Creating account..." : "Save & get AI analysis →"}
            </Button>
            <p style={{fontSize:"0.78rem",color:"#6b7280",textAlign:"center",marginTop:12}}>
              Already registered? <button onClick={()=>setMode("login")} style={{color:"#2d6a4f",fontWeight:600,background:"none",border:"none",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:"0.78rem"}}>Sign in</button>
            </p>
          </>
        )}

        {mode === "login" && !magicSent && (
          <>
            <h3 style={{fontFamily:"'Fraunces',serif",fontSize:"1.4rem",fontWeight:700,margin:"0 0 8px"}}>Welcome back</h3>
            <p style={{fontSize:"0.88rem",color:"#6b7280",lineHeight:1.6,marginBottom:24}}>Enter your email and we'll send you a login link.</p>
            {error && <div style={{background:"#f5e0e3",color:"#b84a5a",padding:"10px 14px",borderRadius:8,fontSize:"0.85rem",marginBottom:16}}>{error}</div>}
            <div>
              <label style={{fontSize:"0.72rem",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",color:"#6b7280",display:"block",marginBottom:4}}>Email</label>
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.co.uk" style={{width:"100%",padding:"10px 14px",borderRadius:8,border:"1px solid #e5e2dc",fontFamily:"'DM Sans',sans-serif",fontSize:"0.92rem",outline:"none",boxSizing:"border-box"}}/>
            </div>
            <Button primary onClick={handleMagicLink} disabled={loading} style={{width:"100%",justifyContent:"center",marginTop:16}}>
              {loading ? "Sending..." : "Send login link"}
            </Button>
            <p style={{fontSize:"0.78rem",color:"#6b7280",textAlign:"center",marginTop:12}}>
              Don't have an account? <button onClick={()=>setMode("register")} style={{color:"#2d6a4f",fontWeight:600,background:"none",border:"none",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:"0.78rem"}}>Register</button>
            </p>
          </>
        )}

        {magicSent && (
          <div style={{textAlign:"center",padding:"20px 0"}}>
            <div style={{width:56,height:56,borderRadius:"50%",background:"#d4ede2",color:"#2d6a4f",fontSize:"1.5rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}>✓</div>
            <h3 style={{fontFamily:"'Fraunces',serif",fontSize:"1.2rem",fontWeight:700,marginBottom:8}}>Check your inbox</h3>
            <p style={{fontSize:"0.88rem",color:"#6b7280",lineHeight:1.6}}>We've sent a login link to <strong>{email}</strong>. Click it to access your saved processes.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// SCREENS (same UI as before, with auth integration)
// ═══════════════════════════════════════════════════

function WelcomeScreen({ onTemplate, savedProcesses, onLoadSaved, onDeleteSaved, onSignIn }) {
  const auth = useAuth();
  return (
    <div style={{ minHeight: "100vh", padding: "60px 24px 60px", position: "relative" }}>
      <div style={{ maxWidth: 960, margin: "0 auto", position: "relative" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{marginBottom:20}}>
            <span style={{fontFamily:"'Fraunces',serif",fontWeight:700,fontSize:"1.5rem",color:"#1a1f2e",letterSpacing:"-0.02em"}}>cost<span style={{color:"#2d6a4f"}}>clock</span></span>
            <span style={{fontSize:"0.75rem",color:"#6b7280",fontFamily:"'DM Sans',sans-serif",fontWeight:400,marginLeft:10}}>by workthru</span>
          </div>
          <Badge>Free process cost calculator</Badge>
          <h1 style={{ fontFamily:"'Fraunces',serif",fontSize:"clamp(1.8rem,4.5vw,2.6rem)",fontWeight:700,lineHeight:1.15,letterSpacing:"-0.025em",margin:"16px 0 12px",color:"#1a1f2e" }}>
            Find out what your processes <em style={{fontStyle:"italic",color:"#2d6a4f",fontWeight:500}}>really cost</em>
          </h1>
          <p style={{ fontSize:"1rem",color:"#3d4455",lineHeight:1.7,maxWidth:520,margin:"0 auto" }}>
            Map any business process step by step, assign who does what, and see the true fully-loaded cost. Register to save your work and get a free AI-powered analysis.
          </p>
        </div>

        {auth.user && savedProcesses.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <h3 style={{ fontFamily:"'Fraunces',serif",fontSize:"1rem",fontWeight:700,marginBottom:10 }}>Your saved processes</h3>
            <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
              {savedProcesses.map((p,idx)=>{
                const {totalCost,annualCost}=calcCosts(p.roles||DEFAULT_ROLES,p.steps,p.annual_volume||p.annualVolume);
                return (
                  <Card key={p.id||idx} hover onClick={()=>onLoadSaved(idx)} style={{padding:"14px 20px",cursor:"pointer"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
                      <div>
                        <div style={{fontWeight:600,fontSize:"0.92rem"}}>{p.name||p.processName}</div>
                        <div style={{fontSize:"0.75rem",color:"#6b7280",marginTop:2}}>{(p.steps||[]).length} steps · {p.annual_volume||p.annualVolume}×/year · £{annualCost.toLocaleString("en-GB",{maximumFractionDigits:0})}/year</div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:16}}>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontFamily:"'Fraunces',serif",fontWeight:700,color:"#2d6a4f",fontSize:"1.05rem"}}>£{totalCost.toFixed(0)}</div>
                          <div style={{fontSize:"0.7rem",color:"#6b7280"}}>per run</div>
                        </div>
                        <button onClick={e=>{e.stopPropagation();onDeleteSaved(idx);}} style={{background:"none",border:"none",color:"#b84a5a",cursor:"pointer",fontSize:"1rem",padding:4}}>×</button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {!auth.user && (
          <div style={{textAlign:"center",marginBottom:24}}>
            <button onClick={onSignIn} style={{fontSize:"0.82rem",color:"#2d6a4f",fontWeight:600,background:"none",border:"none",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              Already have an account? Sign in to load your saved processes →
            </button>
          </div>
        )}

        <div style={{marginBottom:32}}>
          <h3 style={{fontFamily:"'Fraunces',serif",fontSize:"1rem",fontWeight:700,marginBottom:6}}>Start from a template</h3>
          <p style={{fontSize:"0.85rem",color:"#6b7280",marginBottom:12}}>Pre-built process maps with realistic data. Adjust rates and volume to match your firm.</p>
          <div className="template-grid" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
            {TEMPLATES.map(t=>(
              <Card key={t.id} hover onClick={()=>onTemplate(t)} style={{padding:"18px 20px",cursor:"pointer"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                  <span style={{fontWeight:600,fontSize:"0.9rem"}}>{t.name}</span>
                  <span style={{fontSize:"0.65rem",fontWeight:600,padding:"2px 8px",borderRadius:100,background:t.id==="custom"?"#f3f1ed":"#d4ede2",color:t.id==="custom"?"#6b7280":"#1b4332",flexShrink:0,marginLeft:8}}>{t.industry}</span>
                </div>
                <p style={{fontSize:"0.78rem",color:"#6b7280",lineHeight:1.5,marginBottom:6}}>{t.description}</p>
                {t.steps.length>0&&<div style={{fontSize:"0.72rem",color:"#3d4455"}}>{t.steps.length} steps · {t.steps.filter(s=>isSaveable(s)).length} saving opportunities</div>}
              </Card>
            ))}
          </div>
        </div>

        <div style={{display:"flex",gap:40,justifyContent:"center",flexWrap:"wrap",paddingTop:28,borderTop:"1px solid #e5e2dc"}}>
          {[{num:"£847",label:"Average onboarding cost per client"},{num:"18.5 hrs",label:"Staff time per onboarding"},{num:"42%",label:"Of steps have saving potential"}].map((s,i)=>(
            <div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
              <strong style={{fontFamily:"'Fraunces',serif",fontSize:"1.4rem",fontWeight:700,color:"#2d6a4f"}}>{s.num}</strong>
              <span style={{fontSize:"0.78rem",color:"#6b7280",fontWeight:500,maxWidth:140,textAlign:"center"}}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SetupScreen({ roles, setRoles, processName, setProcessName, annualVolume, setAnnualVolume, onNext, onBack }) {
  const addRole=()=>{const c=["#2d6a4f","#40916c","#52b788","#74c69d","#95d5b2"];setRoles([...roles,{id:`r-${Date.now()}`,name:"New Role",rate:40,color:c[roles.length%c.length]}]);};
  const updateRole=(i,f,v)=>{const u=[...roles];u[i]={...u[i],[f]:v};setRoles(u);};
  const removeRole=(i)=>{if(roles.length>1)setRoles(roles.filter((_,j)=>j!==i));};
  return (
    <div style={{maxWidth:640,margin:"0 auto",padding:"120px 24px 80px",position:"relative"}}>
      <Badge>Step 1 of 3</Badge>
      <h2 style={{fontFamily:"'Fraunces',serif",fontSize:"clamp(1.6rem,3.5vw,2.2rem)",fontWeight:700,lineHeight:1.2,letterSpacing:"-0.02em",margin:"20px 0 8px"}}>Set up your team and process</h2>
      <p style={{fontSize:"1rem",color:"#3d4455",marginBottom:36,lineHeight:1.7}}>Define the roles and their fully-loaded hourly rates. UK averages are pre-filled.</p>
      <Card style={{marginBottom:20}}>
        <label style={{fontSize:"0.72rem",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",color:"#6b7280",display:"block",marginBottom:10}}>Process name</label>
        <input type="text" value={processName} onChange={e=>setProcessName(e.target.value)} placeholder="e.g. Client Onboarding" style={{width:"100%",padding:"10px 14px",borderRadius:8,border:"1px solid #e5e2dc",background:"#EFEFEF",fontFamily:"'DM Sans',sans-serif",fontSize:"0.92rem",color:"#1a1f2e",outline:"none",marginBottom:16,boxSizing:"border-box"}}/>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:"0.85rem",color:"#3d4455"}}>How many times per year?</span>
          <NumberInput value={annualVolume} onChange={setAnnualVolume} suffix="/year"/>
        </div>
      </Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <label style={{fontSize:"0.72rem",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",color:"#6b7280"}}>Team roles & hourly rates</label>
        <button onClick={addRole} style={{fontSize:"0.8rem",color:"#2d6a4f",fontWeight:600,background:"none",border:"none",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>+ Add role</button>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {roles.map((role,i)=>(
          <Card key={role.id} style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <div style={{width:10,height:10,borderRadius:"50%",background:role.color,flexShrink:0}}/>
            <input type="text" value={role.name} onChange={e=>updateRole(i,"name",e.target.value)} style={{flex:1,minWidth:140,padding:"6px 10px",borderRadius:6,border:"1px solid #e5e2dc",fontFamily:"'DM Sans',sans-serif",fontSize:"0.88rem",outline:"none",background:"transparent"}}/>
            <NumberInput value={role.rate} onChange={v=>updateRole(i,"rate",v)} prefix="£" suffix="/hr"/>
            {roles.length>1&&<button onClick={()=>removeRole(i)} style={{background:"none",border:"none",color:"#b84a5a",cursor:"pointer",fontSize:"1rem",padding:4}}>×</button>}
          </Card>
        ))}
      </div>
      <p style={{fontSize:"0.78rem",color:"#6b7280",marginTop:12,lineHeight:1.6}}>Fully-loaded rates include salary, employer NI, pension, and overhead allocation.</p>
      <div style={{marginTop:32,display:"flex",justifyContent:"space-between"}}>
        <Button onClick={onBack}>← Back</Button>
        <Button primary onClick={onNext} disabled={!processName}>Next: Map the steps →</Button>
      </div>
    </div>
  );
}

function BuildScreen({ roles, setRoles, steps, setSteps, processName, annualVolume, setAnnualVolume, onNext, onBack, fromTemplate }) {
  const [rolesOpen, setRolesOpen] = useState(false);
  const addStep=()=>setSteps([...steps,{id:Date.now(),name:"",roleId:roles[0]?.id||"",minutes:15,friction:"low",workType:"manual"}]);
  const updateStep=(i,f,v)=>{const u=[...steps];u[i]={...u[i],[f]:v};setSteps(u);};
  const removeStep=(i)=>setSteps(steps.filter((_,j)=>j!==i));
  const addRole=()=>{const c=["#2d6a4f","#40916c","#52b788","#74c69d","#95d5b2"];setRoles([...roles,{id:`r-${Date.now()}`,name:"New Role",rate:40,color:c[roles.length%c.length]}]);};
  const updateRole=(i,f,v)=>{const u=[...roles];u[i]={...u[i],[f]:v};setRoles(u);};
  const removeRole=(i)=>{if(roles.length>1)setRoles(roles.filter((_,j)=>j!==i));};
  const totalMinutes=steps.reduce((s,st)=>s+st.minutes,0);
  const totalCost=steps.reduce((s,st)=>{const r=roles.find(rl=>rl.id===st.roleId);return s+(r?(st.minutes/60)*r.rate:0);},0);

  return (
    <div style={{maxWidth:780,margin:"0 auto",padding:"120px 24px 80px",position:"relative"}}>
      <Badge>Step {fromTemplate ? "1" : "2"} of {fromTemplate ? "2" : "3"}</Badge>
      <h2 style={{fontFamily:"'Fraunces',serif",fontSize:"clamp(1.6rem,3.5vw,2.2rem)",fontWeight:700,lineHeight:1.2,letterSpacing:"-0.02em",margin:"20px 0 8px"}}>Map the steps in "{processName}"</h2>
      <p style={{fontSize:"1rem",color:"#3d4455",marginBottom:20,lineHeight:1.7}}>Walk through the process from start to finish. Estimates are fine.</p>

      {/* Collapsible roles & settings panel */}
      <Card style={{marginBottom:20,padding:0,overflow:"hidden"}}>
        <button onClick={()=>setRolesOpen(!rolesOpen)} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 20px",background:"none",border:"none",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <span style={{fontSize:"0.82rem",fontWeight:600,color:"#1a1f2e"}}>Team roles & rates</span>
            <div style={{display:"flex",gap:6}}>
              {roles.map(r=>{const rc=getRoleColor(r,roles);return(
                <span key={r.id} style={{fontSize:"0.68rem",fontWeight:600,padding:"2px 8px",borderRadius:100,background:`${rc}15`,color:rc}}>
                  {r.name.split(" ")[0]} £{r.rate}
                </span>
              )})}
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:"0.72rem",color:"#6b7280"}}>{annualVolume}×/year</span>
            <span style={{fontSize:"0.8rem",color:"#6b7280",transform:rolesOpen?"rotate(180deg)":"rotate(0)",transition:"transform 0.2s"}}>▾</span>
          </div>
        </button>
        {rolesOpen && (
          <div style={{padding:"0 20px 20px",borderTop:"1px solid #e5e2dc"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginTop:16,marginBottom:12}}>
              <span style={{fontSize:"0.82rem",color:"#3d4455"}}>How many times per year?</span>
              <NumberInput value={annualVolume} onChange={setAnnualVolume} suffix="/year"/>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <label style={{fontSize:"0.72rem",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",color:"#6b7280"}}>Hourly rates (fully loaded)</label>
              <button onClick={addRole} style={{fontSize:"0.78rem",color:"#2d6a4f",fontWeight:600,background:"none",border:"none",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>+ Add role</button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {roles.map((role,i)=>{const rc=getRoleColor(role,roles);return(
                <div key={role.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:8,background:"#EFEFEF"}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:rc,flexShrink:0}}/>
                  <input type="text" value={role.name} onChange={e=>updateRole(i,"name",e.target.value)} style={{flex:1,minWidth:100,padding:"4px 8px",borderRadius:6,border:"1px solid #e5e2dc",fontFamily:"'DM Sans',sans-serif",fontSize:"0.85rem",outline:"none",background:"transparent"}}/>
                  <NumberInput value={role.rate} onChange={v=>updateRole(i,"rate",v)} prefix="£" suffix="/hr"/>
                  {roles.length>1&&<button onClick={()=>removeRole(i)} style={{background:"none",border:"none",color:"#b84a5a",cursor:"pointer",fontSize:"0.9rem",padding:"0 2px"}}>×</button>}
                </div>
              )})}
            </div>
            <p style={{fontSize:"0.72rem",color:"#6b7280",marginTop:8}}>Fully-loaded rates include salary, employer NI, pension, and overhead allocation.</p>
          </div>
        )}
      </Card>

      <div style={{position:"sticky",top:64,zIndex:50,background:"rgba(250,249,247,0.95)",backdropFilter:"blur(12px)",borderRadius:12,border:"1px solid #e5e2dc",padding:"14px 20px",marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
        <div style={{display:"flex",gap:24,flexWrap:"wrap"}}>
          <span style={{fontSize:"0.82rem",color:"#6b7280"}}>Steps: <strong style={{color:"#1a1f2e"}}>{steps.length}</strong></span>
          <span style={{fontSize:"0.82rem",color:"#6b7280"}}>Time: <strong style={{color:"#1a1f2e"}}>{totalMinutes>=60?`${Math.floor(totalMinutes/60)}h ${totalMinutes%60}m`:`${totalMinutes}m`}</strong></span>
          <span style={{fontSize:"0.82rem",color:"#6b7280"}}>Cost: <strong style={{fontFamily:"'Fraunces',serif",color:"#2d6a4f"}}>£{totalCost.toFixed(0)}</strong></span>
        </div>
        <span style={{fontSize:"0.82rem",color:"#6b7280"}}>Saving opportunities: <strong style={{color:"#c4942a"}}>{steps.filter(s=>isSaveable(s)).length}/{steps.length}</strong></span>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {steps.map((step,idx)=>{const role=roles.find(r=>r.id===step.roleId);const rc=role?getRoleColor(role,roles):"#e5e2dc";const cost=role?(step.minutes/60)*role.rate:0;const wt=WORK_TYPES.find(w=>w.value===step.workType)||WORK_TYPES[0];return(
          <Card key={step.id} style={{padding:"18px 22px",borderLeft:`4px solid ${rc}`}}>
            <div style={{display:"flex",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
              <span style={{fontFamily:"'Fraunces',serif",fontWeight:700,fontSize:"0.9rem",color:"#6b7280",minWidth:24}}>{idx+1}</span>
              <div style={{flex:1,minWidth:200}}>
                <input type="text" value={step.name} onChange={e=>updateStep(idx,"name",e.target.value)} placeholder="What happens at this step?" style={{width:"100%",padding:"6px 0",border:"none",borderBottom:"1px solid #e5e2dc",fontFamily:"'DM Sans',sans-serif",fontSize:"0.92rem",color:"#1a1f2e",outline:"none",background:"transparent"}}/>
                <div style={{display:"flex",gap:10,marginTop:12,flexWrap:"wrap",alignItems:"center"}}>
                  <Select value={step.roleId} onChange={v=>updateStep(idx,"roleId",v)} options={roles.map(r=>({value:r.id,label:r.name}))} style={{minWidth:130}}/>
                  <NumberInput value={step.minutes} onChange={v=>updateStep(idx,"minutes",v)} suffix="min" min={1}/>
                  <Select value={step.friction} onChange={v=>updateStep(idx,"friction",v)} options={FRICTION_LEVELS.map(f=>({value:f.value,label:f.label}))} style={{minWidth:90}}/>
                  <Select value={step.workType||"manual"} onChange={v=>updateStep(idx,"workType",v)} options={WORK_TYPES.map(w=>({value:w.value,label:`${w.icon} ${w.short}`}))} style={{minWidth:100,background:wt.bg,color:wt.color,fontWeight:600,border:`1px solid ${wt.color}30`}}/>
                </div>
              </div>
              <div style={{textAlign:"right",minWidth:60}}>
                <div style={{fontFamily:"'Fraunces',serif",fontWeight:700,fontSize:"1.05rem",color:rc}}>£{cost.toFixed(0)}</div>
                <div style={{fontSize:"0.72rem",color:"#6b7280"}}>{step.minutes}m</div>
              </div>
              <button onClick={()=>removeStep(idx)} style={{background:"none",border:"none",color:"#b84a5a",cursor:"pointer",fontSize:"1.1rem",padding:"0 4px",alignSelf:"flex-start"}}>×</button>
            </div>
          </Card>
        );})}
      </div>
      <button onClick={addStep} style={{width:"100%",padding:16,marginTop:12,borderRadius:12,border:"2px dashed #e5e2dc",background:"transparent",color:"#6b7280",fontSize:"0.9rem",fontWeight:500,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>+ Add step</button>
      <div style={{marginTop:32,display:"flex",justifyContent:"space-between"}}>
        <Button onClick={onBack}>← {fromTemplate ? "Templates" : "Back"}</Button>
        <Button primary onClick={onNext} disabled={steps.filter(s=>s.name.trim()).length===0}>See the results →</Button>
      </div>
    </div>
  );
}

function ResultsScreen({ roles, steps, processName, annualVolume, templateUsed, onBack, onReset, onSave, isSaved }) {
  const auth = useAuth();
  const [revealed,setRevealed]=useState(false);
  const [copied,setCopied]=useState(false);
  const [showAuth,setShowAuth]=useState(false);
  useEffect(()=>{const t=setTimeout(()=>setRevealed(true),300);return()=>clearTimeout(t);},[]);

  const {totalCost,annualCost,potentialSaving}=calcCosts(roles,steps,annualVolume);
  const totalMinutes=steps.reduce((s,st)=>s+st.minutes,0);
  const totalHours=totalMinutes/60;
  const saveableSteps=steps.filter(s=>isSaveable(s));
  const saveableMins=saveableSteps.reduce((s,st)=>s+st.minutes,0);
  const highFriction=steps.filter(s=>s.friction==="high"||s.friction==="very-high");

  const roleBreakdown=roles.map(role=>{const rc=getRoleColor(role,roles);const rs=steps.filter(s=>s.roleId===role.id);const m=rs.reduce((s,st)=>s+st.minutes,0);return{...role,color:rc,mins:m,cost:(m/60)*role.rate,stepCount:rs.length};}).filter(r=>r.stepCount>0).sort((a,b)=>b.cost-a.cost);
  const maxRC=Math.max(...roleBreakdown.map(r=>r.cost));

  const handleSave=()=>{if(!auth.user){setShowAuth(true);}else{onSave();}};
  const handleCopy=()=>{navigator.clipboard.writeText(generateReport(processName,roles,steps,annualVolume)).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});};
  const handleDownload=()=>{const b=new Blob([generateReport(processName,roles,steps,annualVolume)],{type:"text/plain"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download=`costclock-${processName.toLowerCase().replace(/[^a-z0-9]+/g,"-")}.txt`;a.click();URL.revokeObjectURL(u);};
  const anim=(d)=>({opacity:revealed?1:0,transform:revealed?"translateY(0)":"translateY(20px)",transition:`all 0.6s ease ${d}s`});

  return (
    <div style={{padding:"120px 24px 80px"}}>
      {showAuth && <AuthModal mode="register" onClose={()=>setShowAuth(false)} onAuth={(user)=>{setShowAuth(false);onSave();}} />}

      <div style={{background:"#1a1f2e",borderRadius:20,padding:"60px 40px",textAlign:"center",color:"#fff",maxWidth:800,margin:"0 auto 40px",...anim(0)}}>
        <Badge>Your results</Badge>
        <h2 style={{fontFamily:"'Fraunces',serif",fontSize:"clamp(1.5rem,3.5vw,2rem)",fontWeight:700,lineHeight:1.2,margin:"20px 0 8px",color:"#fff"}}>Each "{processName}" costs you</h2>
        <div style={{fontFamily:"'Fraunces',serif",fontSize:"clamp(3rem,8vw,4.5rem)",fontWeight:700,color:"#6ee7a8",letterSpacing:"-0.02em",margin:"8px 0"}}>£{totalCost.toFixed(0)}</div>
        <p style={{color:"rgba(255,255,255,0.6)",fontSize:"1.05rem",marginBottom:32}}>across {totalHours.toFixed(1)} hours and {new Set(steps.map(s=>s.roleId)).size} roles</p>
        <div style={{display:"flex",gap:1,background:"rgba(255,255,255,0.1)",borderRadius:12,overflow:"hidden",maxWidth:500,margin:"0 auto"}}>
          {[{label:"Annual cost",value:`£${annualCost.toLocaleString("en-GB",{maximumFractionDigits:0})}`,sub:`${annualVolume}× per year`,bg:"rgba(255,255,255,0.06)"},{label:"Potential saving",value:`£${potentialSaving.toLocaleString("en-GB",{maximumFractionDigits:0})}`,sub:"per year with automation",bg:"rgba(45,106,79,0.2)"}].map((item,i)=>(
            <div key={i} style={{flex:1,padding:"20px 16px",background:item.bg}}>
              <div style={{fontSize:"0.7rem",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",color:"rgba(255,255,255,0.5)",marginBottom:8}}>{item.label}</div>
              <div style={{fontFamily:"'Fraunces',serif",fontSize:"1.5rem",fontWeight:700,color:i===1?"#6ee7a8":"#fff"}}>{item.value}</div>
              <div style={{fontSize:"0.75rem",color:"rgba(255,255,255,0.4)",marginTop:4}}>{item.sub}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{maxWidth:800,margin:"0 auto"}}>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:24,...anim(0.15)}}>
          <Button small onClick={handleSave} style={isSaved?{background:"#d4ede2",color:"#1b4332",border:"1.5px solid #2d6a4f"}:{}}>{isSaved?"✓ Saved":auth.user?"💾 Save process":"💾 Save (free account)"}</Button>
          <Button small onClick={handleCopy}>{copied?"✓ Copied!":"📋 Copy report"}</Button>
          <Button small onClick={handleDownload}>📄 Download report</Button>
        </div>

        <Card style={{marginBottom:20,...anim(0.2)}}>
          <h3 style={{fontFamily:"'Fraunces',serif",fontSize:"1.05rem",fontWeight:700,marginBottom:20}}>Cost by role</h3>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {roleBreakdown.map(role=>(
              <div key={role.id}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{fontSize:"0.88rem",color:"#3d4455",fontWeight:500}}>{role.name}</span>
                  <span style={{fontSize:"0.88rem"}}><strong style={{fontFamily:"'Fraunces',serif",color:"#2d6a4f"}}>£{role.cost.toFixed(0)}</strong><span style={{color:"#6b7280",fontSize:"0.78rem"}}> · {role.mins}m · {role.stepCount} steps</span></span>
                </div>
                <div style={{height:8,background:"#f3f1ed",borderRadius:4,overflow:"hidden"}}><div style={{height:"100%",borderRadius:4,background:role.color,width:`${(role.cost/maxRC)*100}%`,transition:"width 1s ease"}}/></div>
              </div>
            ))}
          </div>
        </Card>

        <Card style={{marginBottom:20,padding:0,overflow:"hidden",...anim(0.3)}}>
          <div style={{padding:"20px 24px 0"}}><h3 style={{fontFamily:"'Fraunces',serif",fontSize:"1.05rem",fontWeight:700,marginBottom:4}}>Full step breakdown</h3></div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr>{["Step","Owner","Time","Cost","Friction","Type"].map(h=><th key={h} style={{textAlign:"left",fontSize:"0.7rem",textTransform:"uppercase",letterSpacing:"0.06em",color:"#6b7280",padding:"12px 16px",borderBottom:"1.5px solid #e5e2dc",fontWeight:600}}>{h}</th>)}</tr></thead>
              <tbody>{steps.map(step=>{const role=roles.find(r=>r.id===step.roleId);const cost=role?(step.minutes/60)*role.rate:0;return(
                <tr key={step.id} style={{borderBottom:"1px solid #e5e2dc"}}>
                  <td style={{padding:"14px 16px",fontSize:"0.88rem",fontWeight:500,color:"#1a1f2e"}}>{step.name}</td>
                  <td style={{padding:"14px 16px",fontSize:"0.85rem",color:"#3d4455"}}>{role?.name||"—"}</td>
                  <td style={{padding:"14px 16px",fontSize:"0.85rem",color:"#3d4455"}}>{step.minutes}m</td>
                  <td style={{padding:"14px 16px",fontFamily:"'Fraunces',serif",fontWeight:700,fontSize:"0.9rem",color:role?getRoleColor(role,roles):"#2d6a4f"}}>£{cost.toFixed(0)}</td>
                  <td style={{padding:"14px 16px"}}><FrictionBadge level={step.friction}/></td>
                  <td style={{padding:"14px 16px"}}>{(()=>{const wt=WORK_TYPES.find(w=>w.value===step.workType)||WORK_TYPES[0];return <span style={{fontSize:"0.72rem",fontWeight:600,padding:"3px 10px",borderRadius:100,background:wt.bg,color:wt.color}}>{wt.icon} {wt.short}</span>;})()}</td>
                </tr>);})}</tbody>
            </table>
          </div>
        </Card>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:16,marginBottom:20,...anim(0.4)}}>
          <Card style={{background:"#f5e0e3",border:"1px solid #e5c4c9"}}><div style={{fontSize:"0.7rem",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",color:"#b84a5a",marginBottom:8}}>High-friction steps</div><div style={{fontFamily:"'Fraunces',serif",fontSize:"1.8rem",fontWeight:700,color:"#b84a5a"}}>{highFriction.length}</div><div style={{fontSize:"0.8rem",color:"#8a4a57",marginTop:4}}>of {steps.length} steps</div></Card>
          <Card style={{background:"#faf0d6",border:"1px solid #e8dbb8"}}><div style={{fontSize:"0.7rem",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",color:"#8a6a1e",marginBottom:8}}>Saving opportunities</div><div style={{fontFamily:"'Fraunces',serif",fontSize:"1.8rem",fontWeight:700,color:"#8a6a1e"}}>{saveableSteps.length}</div><div style={{fontSize:"0.8rem",color:"#8a6a1e",marginTop:4}}>saving {saveableMins}m per run</div></Card>
          <Card style={{background:"#faf0d6",border:"1px solid #e8dbb8"}}><div style={{fontSize:"0.7rem",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",color:"#8a6a1e",marginBottom:8}}>Most expensive role</div><div style={{fontFamily:"'Fraunces',serif",fontSize:"1.3rem",fontWeight:700,color:"#8a6a1e"}}>{roleBreakdown[0]?.name}</div><div style={{fontSize:"0.8rem",color:"#8a6a1e",marginTop:4}}>£{roleBreakdown[0]?.cost.toFixed(0)} per run</div></Card>
        </div>

        <div style={{background:"#1a1f2e",borderRadius:16,padding:"40px 36px",textAlign:"center",color:"#fff",marginTop:32,...anim(0.5)}}>
          <h3 style={{fontFamily:"'Fraunces',serif",fontSize:"1.4rem",fontWeight:700,marginBottom:12}}>This is one process. <em style={{fontStyle:"italic",color:"#c4942a",fontWeight:500}}>What about the rest?</em></h3>
          <p style={{color:"rgba(255,255,255,0.6)",fontSize:"0.95rem",maxWidth:440,margin:"0 auto 24px",lineHeight:1.7}}>A full Workthru operational audit maps 3–5 core processes across your entire practice, with stakeholder interviews and a prioritised automation roadmap.</p>
          <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap"}}>
            <a href="https://cal.com/workthru/15min?overlayCalendar=true&source=costclock" target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:8,padding:"14px 28px",borderRadius:10,background:"#fff",color:"#1a1f2e",fontFamily:"'DM Sans',sans-serif",fontWeight:600,fontSize:"1rem",textDecoration:"none"}}>Book a free discovery call →</a>
            <a href="https://www.workthru.co.uk" target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:8,padding:"14px 28px",borderRadius:10,border:"1.5px solid rgba(255,255,255,0.25)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontWeight:600,fontSize:"0.92rem",textDecoration:"none"}}>Learn more about Workthru</a>
          </div>
        </div>

        <div style={{display:"flex",justifyContent:"space-between",marginTop:32}}>
          <Button onClick={onBack}>← Edit steps</Button>
          <Button onClick={onReset}>Map another process</Button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════
export default function CostClock() {
  const [screen,setScreenRaw]=useState("welcome");
  const setScreen=(s)=>{setScreenRaw(s);window.scrollTo(0,0);};
  const [roles,setRoles]=useState(DEFAULT_ROLES);
  const [processName,setProcessName]=useState("");
  const [annualVolume,setAnnualVolume]=useState(80);
  const [steps,setSteps]=useState([]);
  const [saved,setSaved]=useState([]);
  const [savedIdx,setSavedIdx]=useState(null);
  const [user,setUser]=useState(null);
  const [showAuth,setShowAuth]=useState(false);
  const [templateUsed,setTemplateUsed]=useState(null);

  // Restore session & load data
  useEffect(()=>{
    (async()=>{
      const session = await getSession();
      if(session){
        const u = await getUser();
        if(u){setUser(u);loadUserProcesses(u.id);}
      }
    })();
    // Listen for auth state changes (magic link callback)
    if(supabase){
      const { data: { subscription } } = supabase.auth.onAuthStateChange(async(event, session)=>{
        if(event === 'SIGNED_IN' && session?.user){
          setUser(session.user);
          loadUserProcesses(session.user.id);
        }
      });
      return ()=>subscription.unsubscribe();
    }
  },[]);

  const loadUserProcesses=async(userId)=>{
    try{
      const data = await loadProcesses(userId);
      setSaved(data);
    }catch{}
  };

  const handleAuth=async(userData)=>{
    setUser(userData);
    
    // Save the current process immediately after registration
    if(steps.length>0&&processName){
      await saveProcess(userData.id);
    }
    await loadUserProcesses(userData.id);
  };

  const saveProcess=async(userId)=>{
    const uid=userId||user?.id;
    if(!uid)return;
    const {totalCost,annualCost,potentialSaving}=calcCosts(roles,steps,annualVolume);
    const processData={
      user_id:uid, name:processName, annual_volume:annualVolume,
      roles:roles, steps:steps,
      total_cost:totalCost, annual_cost:annualCost, potential_saving:potentialSaving,
      template_used:templateUsed, updated_at:new Date().toISOString()
    };
    try{
      if(savedIdx!==null&&saved[savedIdx]?.id){
        const { data: updated } = await sbSaveProcess(uid, { ...processData, id: saved[savedIdx].id });
        const upd=[...saved];upd[savedIdx]={...upd[savedIdx],...processData};setSaved(upd);
      }else{
        const { data: inserted } = await sbSaveProcess(uid, processData);
        if(inserted&&inserted[0]){setSaved([inserted[0],...saved]);setSavedIdx(0);}
      }
    }catch(e){console.error("Save failed",e);}
  };

  const handleSave=async()=>{
    if(!user){setShowAuth(true);return;}
    await saveProcess();
  };

  const handleDelete=async(idx)=>{
    const p=saved[idx];
    if(p?.id){try{await sbDeleteProcess(p.id);}catch{}}
    setSaved(saved.filter((_,j)=>j!==idx));
    if(savedIdx===idx)setSavedIdx(null);
  };

  const handleLoad=(idx)=>{
    const p=saved[idx];
    setProcessName(p.name||p.processName);setAnnualVolume(p.annual_volume||p.annualVolume);
    setSteps((p.steps||[]).map((s,j)=>({...s,id:Date.now()+j})));
    if(p.roles)setRoles(p.roles);
    setSavedIdx(idx);setScreen("results");
  };

  const handleTemplate=(t)=>{
    setProcessName(t.name);setAnnualVolume(t.annualVolume);
    setSteps(t.steps.map((s,i)=>({...s,id:Date.now()+i})));
    setTemplateUsed(t.id);setSavedIdx(null);
    setScreen(t.steps.length>0?"build":"setup");
  };

  const reset=()=>{setScreen("welcome");setProcessName("");setAnnualVolume(80);setSteps([]);setSavedIdx(null);setTemplateUsed(null);};

  const authCtx={user,signOut:()=>{sbSignOut();setUser(null);setSaved([]);reset();}};

  return (
    <AuthContext.Provider value={authCtx}>
      <div style={{background:"#EFEFEF",minHeight:"100vh",position:"relative"}}>
        <TopoBg />
        {showAuth&&<AuthModal mode="register" onClose={()=>setShowAuth(false)} onAuth={handleAuth}/>}

        {screen!=="welcome"&&(
          <nav style={{position:"fixed",top:0,left:0,right:0,zIndex:100,background:"rgba(250,249,247,0.92)",backdropFilter:"blur(12px)",borderBottom:"1px solid #e5e2dc",height:64,display:"flex",alignItems:"center",padding:"0 24px"}}>
            <div style={{maxWidth:780,width:"100%",margin:"0 auto",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <button onClick={reset} style={{fontFamily:"'Fraunces',serif",fontWeight:700,fontSize:"1.2rem",color:"#1a1f2e",background:"none",border:"none",cursor:"pointer",letterSpacing:"-0.02em"}}>
                cost<span style={{color:"#2d6a4f"}}>clock</span>
                <span style={{fontSize:"0.7rem",color:"#6b7280",fontFamily:"'DM Sans',sans-serif",fontWeight:400,marginLeft:8}}>by workthru</span>
              </button>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{display:"flex",gap:6}}>
                  {["Setup","Map","Results"].map((label,i)=>{const sm=["setup","build","results"];const active=sm.indexOf(screen)>=i;return<div key={label} style={{padding:"4px 14px",borderRadius:100,background:active?"#d4ede2":"#f3f1ed",color:active?"#1b4332":"#6b7280",fontSize:"0.75rem",fontWeight:600}}>{label}</div>;})}
                </div>
                {user?(
                  <button onClick={authCtx.signOut} style={{fontSize:"0.78rem",color:"#6b7280",background:"none",border:"none",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>Sign out</button>
                ):(
                  <button onClick={()=>setShowAuth(true)} style={{fontSize:"0.78rem",color:"#2d6a4f",fontWeight:600,background:"none",border:"none",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>Sign in</button>
                )}
              </div>
            </div>
          </nav>
        )}

        {screen==="welcome"&&<WelcomeScreen onTemplate={handleTemplate} savedProcesses={saved} onLoadSaved={handleLoad} onDeleteSaved={handleDelete} onSignIn={()=>setShowAuth(true)}/>}
        {screen==="setup"&&<SetupScreen roles={roles} setRoles={setRoles} processName={processName} setProcessName={setProcessName} annualVolume={annualVolume} setAnnualVolume={setAnnualVolume} onNext={()=>setScreen("build")} onBack={reset}/>}
        {screen==="build"&&<BuildScreen roles={roles} setRoles={setRoles} steps={steps} setSteps={setSteps} processName={processName} annualVolume={annualVolume} setAnnualVolume={setAnnualVolume} onNext={()=>setScreen("results")} onBack={()=>setScreen(templateUsed?"welcome":"setup")} fromTemplate={!!templateUsed}/>}
        {screen==="results"&&<ResultsScreen roles={roles} steps={steps} processName={processName} annualVolume={annualVolume} templateUsed={templateUsed} onBack={()=>setScreen("build")} onReset={reset} onSave={handleSave} isSaved={savedIdx!==null}/>}

        <footer style={{padding:"30px 24px",textAlign:"center",fontSize:"0.78rem",color:"#6b7280",borderTop:"1px solid #e5e2dc"}}>
          <a href="https://www.workthru.co.uk" target="_blank" rel="noopener noreferrer" style={{color:"#2d6a4f",textDecoration:"none",fontWeight:600}}>workthru.co.uk</a>
          <span style={{margin:"0 8px"}}>·</span>Operational audits & workflow automation for SMEs
          {user&&<span style={{marginLeft:16,color:"#6b7280"}}>Signed in as {user.email}</span>}
        </footer>
      </div>
    </AuthContext.Provider>
  );
}
