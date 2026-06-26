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
const BURDEN_MULTIPLIER = 1.3; // Employer NI + pension + overhead
const PRODUCTIVE_HOURS = 1650; // 220 working days × 7.5 hours

function salaryToRate(salary) { return Math.round((salary * BURDEN_MULTIPLIER) / PRODUCTIVE_HOURS * 100) / 100; }
function rateToSalary(rate) { return Math.round((rate * PRODUCTIVE_HOURS) / BURDEN_MULTIPLIER); }

const DEFAULT_ROLES = [
  { id: "partner", name: "Partner / Owner", salary: 150000, rate: salaryToRate(150000) },
  { id: "manager", name: "Manager", salary: 55000, rate: salaryToRate(55000) },
  { id: "senior", name: "Senior / Qualified", salary: 38000, rate: salaryToRate(38000) },
  { id: "junior", name: "Junior / Trainee", salary: 25000, rate: salaryToRate(25000) },
  { id: "admin", name: "Admin / Support", salary: 22000, rate: salaryToRate(22000) },
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
    id: "patient-intake-healthcare", name: "Patient Intake & Assessment", industry: "Healthcare",
    description: "Private clinic intake from referral to completed assessment report.",
    annualVolume: 200,
    steps: [
      { name: "Referral or self-referral received", roleId: "admin", minutes: 10, friction: "low", workType: "manual" },
      { name: "Eligibility & insurance check", roleId: "admin", minutes: 20, friction: "medium", workType: "manual" },
      { name: "Send intake questionnaire to patient", roleId: "admin", minutes: 10, friction: "low", workType: "manual" },
      { name: "Chase incomplete questionnaire", roleId: "admin", minutes: 25, friction: "high", workType: "waiting" },
      { name: "Book assessment appointment", roleId: "admin", minutes: 15, friction: "medium", workType: "manual" },
      { name: "Send appointment confirmation & reminders", roleId: "admin", minutes: 10, friction: "low", workType: "manual" },
      { name: "Pre-assessment clinician review", roleId: "partner", minutes: 20, friction: "low", workType: "decision" },
      { name: "Conduct assessment", roleId: "partner", minutes: 90, friction: "low", workType: "decision" },
      { name: "Write up assessment report", roleId: "partner", minutes: 60, friction: "medium", workType: "manual" },
      { name: "Clinical review & sign-off", roleId: "manager", minutes: 20, friction: "low", workType: "decision" },
      { name: "Send report to patient / referrer", roleId: "admin", minutes: 10, friction: "low", workType: "manual" },
      { name: "Process payment / insurance claim", roleId: "admin", minutes: 20, friction: "high", workType: "manual" },
      { name: "Chase outstanding payment", roleId: "admin", minutes: 20, friction: "very-high", workType: "waiting" },
      { name: "Update patient record & archive", roleId: "admin", minutes: 10, friction: "low", workType: "manual" },
    ],
  },
  {
    id: "project-delivery-construction", name: "Project Delivery (Construction)", industry: "Construction",
    description: "From tender award through to practical completion and final invoice.",
    annualVolume: 24,
    steps: [
      { name: "Receive tender award & review contract", roleId: "partner", minutes: 60, friction: "low", workType: "decision" },
      { name: "Mobilisation planning & team assignment", roleId: "manager", minutes: 45, friction: "low", workType: "decision" },
      { name: "Subcontractor procurement & quotes", roleId: "manager", minutes: 90, friction: "high", workType: "manual" },
      { name: "Verify subcontractor compliance docs", roleId: "admin", minutes: 30, friction: "high", workType: "manual" },
      { name: "Programme & schedule creation", roleId: "manager", minutes: 60, friction: "medium", workType: "manual" },
      { name: "Site setup & H&S documentation", roleId: "senior", minutes: 45, friction: "medium", workType: "manual" },
      { name: "Daily site reports & progress logs", roleId: "senior", minutes: 20, friction: "medium", workType: "manual" },
      { name: "Variation order capture & pricing", roleId: "manager", minutes: 40, friction: "high", workType: "manual" },
      { name: "Client progress meeting & minutes", roleId: "partner", minutes: 60, friction: "low", workType: "decision" },
      { name: "Subcontractor invoice checking & approval", roleId: "manager", minutes: 30, friction: "medium", workType: "manual" },
      { name: "Interim application for payment", roleId: "manager", minutes: 45, friction: "high", workType: "manual" },
      { name: "Chase interim payment", roleId: "admin", minutes: 30, friction: "very-high", workType: "waiting" },
      { name: "Snagging & defects inspection", roleId: "senior", minutes: 90, friction: "medium", workType: "decision" },
      { name: "Practical completion sign-off", roleId: "partner", minutes: 30, friction: "low", workType: "decision" },
      { name: "Final account & retention invoice", roleId: "manager", minutes: 45, friction: "high", workType: "manual" },
      { name: "Chase retention release", roleId: "admin", minutes: 25, friction: "very-high", workType: "waiting" },
      { name: "Project close-out & archive", roleId: "admin", minutes: 20, friction: "low", workType: "manual" },
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
function Badge({ children, light = false }) {
  return (
    <span style={{ display:"inline-flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:100,background:light?"rgba(110,231,168,0.15)":"#d4ede2",color:light?"#6ee7a8":"#1b4332",fontSize:"0.75rem",fontWeight:600,letterSpacing:"0.02em" }}>
      <span style={{width:5,height:5,borderRadius:"50%",background:light?"#6ee7a8":"#2d6a4f"}}/>
      {children}
    </span>
  );
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
    <input type="number" value={value} min={min} onChange={e=>onChange(Number(e.target.value)||0)} style={{width:70,padding:"8px 10px",borderRadius:8,border:"1px solid #e5e2dc",background:"#EFEFEF",fontFamily:"'Fraunces',serif",fontWeight:700,fontSize:"cost.95rem",color:"#1a1f2e",outline:"none",textAlign:"center"}}/>
    {suffix&&<span style={{fontSize:"0.8rem",color:"#6b7280"}}>{suffix}</span>}
  </div>;
}

function SalaryInput({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(String(value));
  const formatted = (value||0).toLocaleString("en-GB");
  return <div style={{display:"flex",alignItems:"center",gap:4}}>
    <span style={{fontSize:"0.85rem",color:"#6b7280",fontWeight:500}}>£</span>
    {editing ? (
      <input type="text" inputMode="numeric" autoFocus value={raw}
        onChange={e=>{const v=e.target.value.replace(/[^0-9]/g,"");setRaw(v);onChange(Number(v)||0);}}
        onBlur={()=>setEditing(false)}
        style={{width:110,padding:"8px 10px",borderRadius:8,border:"1px solid #2d6a4f",background:"#fff",fontFamily:"'Fraunces',serif",fontWeight:700,fontSize:"0.95rem",color:"#1a1f2e",outline:"none",textAlign:"right"}}/>
    ) : (
      <div onClick={()=>{setRaw(String(value));setEditing(true);}}
        style={{width:110,padding:"8px 10px",borderRadius:8,border:"1px solid #e5e2dc",background:"#EFEFEF",fontFamily:"'Fraunces',serif",fontWeight:700,fontSize:"0.95rem",color:"#1a1f2e",cursor:"text",textAlign:"right"}}>
        {formatted}
      </div>
    )}
  </div>;
}

function Select({ value, onChange, options, style }) {
  // 1. Determine the arrow color (defaults to dark if not provided in style)
  const arrowColor = (style && style.color) ? encodeURIComponent(style.color) : "%231a1f2e";
  
  // 2. Determine the background color (defaults to light grey if not provided)
  const bgColor = (style && style.background) || "#f2f2f2";

  const selectStyle = {
    WebkitAppearance: "none",
    MozAppearance: "none",
    appearance: "none",

    // We build the background dynamically so the arrow always stays
    background: `${bgColor} url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='${arrowColor}' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e") no-repeat right 12px center`,
    
    backgroundSize: "12px",
    padding: "8px 32px 8px 12px",
    borderRadius: 8,
    border: "1px solid #e5e2dc",
    fontFamily: "'DM Sans',sans-serif",
    fontSize: "0.88rem",
    color: "#1a1f2e",
    outline: "none",
    cursor: "pointer",
    ...style, // Any extra styles (like font-weight) will merge here
    
    // Safety: ensure background isn't accidentally nuked by the spread above
    background: undefined, 
  };

  // Explicitly set the background one last time to be safe
  selectStyle.background = `${bgColor} url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='${arrowColor}' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e") no-repeat right 12px center`;

  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={selectStyle}>
      {options.map(o => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
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
  const [transitioning, setTransitioning] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { const t = setTimeout(() => setMounted(true), 30); return () => clearTimeout(t); }, []);

  const handleTemplateClick = (t) => {
    if (t.steps.length === 0) { onTemplate(t); return; }
    setSelectedTemplate(t.id);
    setTransitioning(true);
    setTimeout(() => onTemplate(t), 480);
  };

  const heroStyle = {
    opacity: transitioning ? 0 : mounted ? 1 : 0,
    transform: transitioning ? "translateY(-60px)" : mounted ? "translateY(0)" : "translateY(0)",
    transition: transitioning ? "opacity 0.4s ease, transform 0.4s ease" : "opacity 0.5s ease",
  };

  const cardsStyle = (i) => ({
    opacity: transitioning ? 0 : mounted ? 1 : 0,
    transform: transitioning ? "translateY(40px)" : mounted ? "translateY(0)" : "translateY(24px)",
    transition: transitioning
      ? `opacity 0.3s ease ${i * 0.03}s, transform 0.3s ease ${i * 0.03}s`
      : `opacity 0.5s ease ${0.15 + i * 0.04}s, transform 0.5s ease ${0.15 + i * 0.04}s`,
  });

  return (
    <div style={{ minHeight: "100vh", position: "relative" }}>

      {/* NAV */}
      <div style={{ position:"absolute", top:0, left:0, right:0, zIndex:10,
        display:"flex", justifyContent:"space-between", alignItems:"center",
        padding:"20px 40px",
      }}>
        <div style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? "translateY(0)" : "translateY(-12px)",
          transition: "opacity 0.5s ease, transform 0.5s ease",
        }}>
          <span style={{ fontFamily:"'Fraunces',serif", fontWeight:700, fontSize:"1.5rem",
            color:"#ffffff", letterSpacing:"-0.02em" }}>
            cost<span style={{ color:"#6ee7a8" }}>clock</span>
          </span>
          <span style={{ fontSize:"0.72rem", color:"rgba(255,255,255,0.45)",
            fontFamily:"'DM Sans',sans-serif", fontWeight:400, marginLeft:8 }}>
            by workthru
          </span>
        </div>
        <div style={{
          opacity: mounted ? 1 : 0,
          transition: "opacity 0.5s ease 0.1s",
        }}>
          {auth.user ? (
            <button onClick={auth.signOut} style={{ fontSize:"0.82rem", color:"rgba(255,255,255,0.6)",
              background:"none", border:"none", cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
              Sign out
            </button>
          ) : (
            <button onClick={onSignIn} style={{ fontSize:"0.82rem", color:"rgba(255,255,255,0.85)",
              fontWeight:600, background:"none", border:"none", cursor:"pointer",
              fontFamily:"'DM Sans',sans-serif" }}>
              Already have an account? Sign in
            </button>
          )}
        </div>
      </div>

      {/* DARK HERO */}
      <div style={{ background:"#1a1f2e", padding:"120px 40px 80px", position:"relative", overflow:"hidden", ...heroStyle }}>
        <div style={{ position:"absolute", inset:0,
          backgroundImage:"url(/topography-dark.svg)", backgroundSize:"600px 600px",
          opacity:0.6, pointerEvents:"none",
        }} />
        <div className="hero-grid" style={{ maxWidth:1080, margin:"0 auto", position:"relative",
          display:"grid", gridTemplateColumns:"1fr 1fr", gap:60, alignItems:"center",
        }}>
          {/* Left — headline */}
          <div>
            <Badge light>Free process cost calculator</Badge>
            <h1 style={{ fontFamily:"'Fraunces',serif",
              fontSize:"clamp(2rem, 4.5vw, 3rem)",
              fontWeight:700, lineHeight:1.15, letterSpacing:"-0.025em",
              color:"#ffffff", margin:"24px 0 0",
            }}>
              Your biggest operational cost isn't salaries.{" "}
              <em style={{ fontStyle:"italic", color:"#6ee7a8", fontWeight:500 }}>
                It's what salaries get spent on.
              </em>
            </h1>
          </div>
          {/* Right — quote panel */}
          <div style={{ borderLeft:"3px solid #6ee7a8", paddingLeft:32 }}>
            <p style={{ fontFamily:"'Fraunces',serif",
              fontSize:"clamp(1rem, 1.8vw, 1.15rem)",
              fontStyle:"italic", fontWeight:400,
              color:"rgba(255,255,255,0.82)", lineHeight:1.7, margin:0,
            }}>
              "Your team is capable of far more than chasing documents and re-entering
              data. Map any process below and see exactly how much of your wage bill is
              going to work that{" "}
              <strong style={{ fontStyle:"normal", color:"#ffffff" }}>automation could handle</strong>
              {" "}— freeing your people to do what you actually hired them for."
            </p>
          </div>
        </div>
      </div>

      {/* TEMPLATE CARDS */}
      <div style={{ maxWidth:1080, margin:"0 auto", padding:"48px 40px 60px", position:"relative" }}>

        {auth.user && savedProcesses.length > 0 && (
          <div style={{ marginBottom:36 }}>
            <h3 style={{ fontFamily:"'Fraunces',serif", fontSize:"1rem", fontWeight:700, marginBottom:10 }}>
              Your saved processes
            </h3>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {savedProcesses.map((p,idx) => {
                const { totalCost, annualCost } = calcCosts(p.roles||DEFAULT_ROLES, p.steps, p.annual_volume||p.annualVolume);
                return (
                  <Card key={p.id||idx} hover onClick={()=>onLoadSaved(idx)} style={{padding:"14px 20px",cursor:"pointer"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
                      <div>
                        <div style={{fontWeight:600,fontSize:"0.92rem"}}>{p.name||p.processName}</div>
                        <div style={{fontSize:"0.75rem",color:"#6b7280",marginTop:2}}>
                          {(p.steps||[]).length} steps · {p.annual_volume||p.annualVolume}×/year · £{annualCost.toLocaleString("en-GB",{maximumFractionDigits:0})}/year
                        </div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:16}}>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontFamily:"'Fraunces',serif",fontWeight:700,color:"#2d6a4f",fontSize:"1.05rem"}}>£{totalCost.toFixed(0)}</div>
                          <div style={{fontSize:"0.7rem",color:"#6b7280"}}>per run</div>
                        </div>
                        <button onClick={e=>{e.stopPropagation();onDeleteSaved(idx);}}
                          style={{background:"none",border:"none",color:"#b84a5a",cursor:"pointer",fontSize:"1rem",padding:4}}>×</button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        <div style={cardsStyle(0)}>
          <h3 style={{ fontFamily:"'Fraunces',serif", fontSize:"1rem", fontWeight:700, marginBottom:6 }}>
            Start from a template
          </h3>
          <p style={{ fontSize:"0.85rem", color:"#6b7280", marginBottom:20 }}>
            Pre-built process maps with realistic data. Adjust rates and volume to match your firm.
          </p>
        </div>

        <div className="template-grid" style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
          {TEMPLATES.map((t, i) => {
            const isSelected = selectedTemplate === t.id;
            return (
              <div key={t.id} onClick={() => handleTemplateClick(t)} style={{
                background:"#fff",
                border: isSelected ? "1.5px solid #2d6a4f" : "1px solid #e5e2dc",
                borderRadius:16, padding:"18px 20px", cursor:"pointer",
                transform: isSelected ? "scale(1.03)" : undefined,
                boxShadow: isSelected ? "0 8px 30px rgba(45,106,79,0.15)" : undefined,
                ...cardsStyle(i + 1),
                transition: [
                  cardsStyle(i + 1).transition,
                  "border-color 0.2s, box-shadow 0.2s, transform 0.2s",
                ].join(", "),
              }}
              onMouseEnter={e => { if (!isSelected) {
                e.currentTarget.style.borderColor="#2d6a4f";
                e.currentTarget.style.boxShadow="0 8px 30px rgba(26,31,46,0.1)";
                e.currentTarget.style.transform="translateY(-2px)";
              }}}
              onMouseLeave={e => { if (!isSelected) {
                e.currentTarget.style.borderColor="#e5e2dc";
                e.currentTarget.style.boxShadow="none";
                e.currentTarget.style.transform="translateY(0)";
              }}}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
                  <span style={{ fontWeight:600, fontSize:"0.9rem" }}>{t.name}</span>
                  <span style={{ fontSize:"0.65rem", fontWeight:600, padding:"2px 8px", borderRadius:100,
                    background: t.id==="custom" ? "#f3f1ed" : "#d4ede2",
                    color: t.id==="custom" ? "#6b7280" : "#1b4332",
                    flexShrink:0, marginLeft:8,
                  }}>{t.industry}</span>
                </div>
                <p style={{ fontSize:"0.78rem", color:"#6b7280", lineHeight:1.5, marginBottom:6 }}>{t.description}</p>
                {t.steps.length > 0 && (
                  <div style={{ fontSize:"0.72rem", color:"#3d4455" }}>
                    {t.steps.length} steps · {t.steps.filter(s=>isSaveable(s)).length} saving opportunities
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display:"flex", gap:40, justifyContent:"center", flexWrap:"wrap",
          paddingTop:36, marginTop:36, borderTop:"1px solid #e5e2dc", ...cardsStyle(TEMPLATES.length + 1) }}>
          {[
            { num:"£847", label:"Average onboarding cost per client" },
            { num:"18.5 hrs", label:"Staff time per onboarding" },
            { num:"42%", label:"Of steps have saving potential" },
          ].map((s,i) => (
            <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
              <strong style={{ fontFamily:"'Fraunces',serif", fontSize:"1.4rem", fontWeight:700, color:"#2d6a4f" }}>{s.num}</strong>
              <span style={{ fontSize:"0.78rem", color:"#6b7280", fontWeight:500, maxWidth:140, textAlign:"center" }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SetupScreen({ roles, setRoles, processName, setProcessName, annualVolume, setAnnualVolume, onNext, onBack }) {
  const addRole=()=>{setRoles([...roles,{id:`r-${Date.now()}`,name:"New Role",salary:35000,rate:salaryToRate(35000)}]);};
  const updateRole=(i,f,v)=>{
    const u=[...roles];
    if(f==="salary"){u[i]={...u[i],salary:v,rate:salaryToRate(v)};}
    else if(f==="rate"){u[i]={...u[i],rate:v,salary:rateToSalary(v)};}
    else{u[i]={...u[i],[f]:v};}
    setRoles(u);
  };
  const removeRole=(i)=>{if(roles.length>1)setRoles(roles.filter((_,j)=>j!==i));};
  return (
    <div style={{maxWidth:640,margin:"0 auto",padding:"120px 24px 80px",position:"relative"}}>
      <Badge>Step 1 of 3</Badge>
      <h2 style={{fontFamily:"'Fraunces',serif",fontSize:"clamp(1.6rem,3.5vw,2.2rem)",fontWeight:700,lineHeight:1.2,letterSpacing:"-0.02em",margin:"20px 0 8px"}}>Set up your team and process</h2>
      <p style={{fontSize:"1rem",color:"#3d4455",marginBottom:36,lineHeight:1.7}}>Define the roles in your team. Enter their annual salary and we'll calculate the true fully-loaded hourly cost.</p>
      <Card style={{marginBottom:20}}>
        <label style={{fontSize:"0.72rem",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",color:"#6b7280",display:"block",marginBottom:10}}>Process name</label>
        <input type="text" value={processName} onChange={e=>setProcessName(e.target.value)} placeholder="e.g. Client Onboarding" style={{width:"100%",padding:"10px 14px",borderRadius:8,border:"1px solid #e5e2dc",background:"#EFEFEF",fontFamily:"'DM Sans',sans-serif",fontSize:"0.92rem",color:"#1a1f2e",outline:"none",marginBottom:16,boxSizing:"border-box"}}/>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:"0.85rem",color:"#3d4455"}}>How many times per year?</span>
          <NumberInput value={annualVolume} onChange={setAnnualVolume} suffix="/year"/>
        </div>
      </Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <label style={{fontSize:"0.72rem",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",color:"#6b7280"}}>Team roles</label>
        <button onClick={addRole} style={{fontSize:"0.8rem",color:"#2d6a4f",fontWeight:600,background:"none",border:"none",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>+ Add role</button>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {roles.map((role,i)=>{const rc=getRoleColor(role,roles);return(
          <Card key={role.id} style={{padding:"16px 20px"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
              <div style={{width:10,height:10,borderRadius:"50%",background:rc,flexShrink:0}}/>
              <input type="text" value={role.name} onChange={e=>updateRole(i,"name",e.target.value)} style={{flex:1,minWidth:140,padding:"6px 10px",borderRadius:6,border:"1px solid #e5e2dc",fontFamily:"'DM Sans',sans-serif",fontSize:"0.88rem",fontWeight:600,outline:"none",background:"transparent"}}/>
              {roles.length>1&&<button onClick={()=>removeRole(i)} style={{background:"none",border:"none",color:"#b84a5a",cursor:"pointer",fontSize:"1rem",padding:4}}>×</button>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:12,paddingLeft:20}}>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{fontSize:"0.78rem",color:"#6b7280"}}>Salary</span>
                <SalaryInput value={role.salary||rateToSalary(role.rate)} onChange={v=>updateRole(i,"salary",v)}/>
              </div>
              <div style={{fontSize:"0.78rem",color:"#6b7280"}}>→</div>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{fontFamily:"'Fraunces',serif",fontWeight:700,fontSize:"1rem",color:rc}}>£{Math.round(role.rate)}/hr</span>
                <span style={{fontSize:"0.72rem",color:"#6b7280"}}>fully loaded</span>
              </div>
            </div>
          </Card>
        )})}
      </div>
      <p style={{fontSize:"0.72rem",color:"#6b7280",marginTop:10,lineHeight:1.6}}>Hourly rates are calculated automatically: annual salary × {BURDEN_MULTIPLIER} (employer NI, pension & overhead) ÷ {PRODUCTIVE_HOURS.toLocaleString()} productive hours per year.</p>
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
  const addRole=()=>{setRoles([...roles,{id:`r-${Date.now()}`,name:"New Role",salary:35000,rate:salaryToRate(35000)}]);};
  const updateRole=(i,f,v)=>{
    const u=[...roles];
    if(f==="salary"){u[i]={...u[i],salary:v,rate:salaryToRate(v)};}
    else if(f==="rate"){u[i]={...u[i],rate:v,salary:rateToSalary(v)};}
    else{u[i]={...u[i],[f]:v};}
    setRoles(u);
  };
  const removeRole=(i)=>{if(roles.length>1)setRoles(roles.filter((_,j)=>j!==i));};
  const totalMinutes=steps.reduce((s,st)=>s+st.minutes,0);
  const totalCost=steps.reduce((s,st)=>{const r=roles.find(rl=>rl.id===st.roleId);return s+(r?(st.minutes/60)*r.rate:0);},0);

  return (
    <div style={{maxWidth:900,margin:"0 auto",padding:"120px 24px 80px",position:"relative"}}>
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
                  {r.name.split(" ")[0]} £{Math.round(r.rate)}/hr
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
            <div style={{display:"flex",alignItems:"center",gap:12,marginTop:16,marginBottom:16}}>
              <span style={{fontSize:"0.82rem",color:"#3d4455"}}>How many times per year?</span>
              <NumberInput value={annualVolume} onChange={setAnnualVolume} suffix="/year"/>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <label style={{fontSize:"0.72rem",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",color:"#6b7280"}}>Team roles</label>
              <button onClick={addRole} style={{fontSize:"0.78rem",color:"#2d6a4f",fontWeight:600,background:"none",border:"none",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>+ Add role</button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {roles.map((role,i)=>{const rc=getRoleColor(role,roles);return(
                <div key={role.id} style={{padding:"12px 14px",borderRadius:10,background:"#EFEFEF",border:"1px solid #e5e2dc"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                    <div style={{width:10,height:10,borderRadius:"50%",background:rc,flexShrink:0}}/>
                    <input type="text" value={role.name} onChange={e=>updateRole(i,"name",e.target.value)} style={{flex:1,minWidth:100,padding:"4px 8px",borderRadius:6,border:"1px solid #e5e2dc",fontFamily:"'DM Sans',sans-serif",fontSize:"0.88rem",fontWeight:600,outline:"none",background:"#fff"}}/>
                    {roles.length>1&&<button onClick={()=>removeRole(i)} style={{background:"none",border:"none",color:"#b84a5a",cursor:"pointer",fontSize:"0.9rem",padding:"0 4px"}}>×</button>}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:12,paddingLeft:20}}>
                    <div style={{display:"flex",alignItems:"center",gap:4}}>
                      <span style={{fontSize:"0.75rem",color:"#6b7280"}}>Salary</span>
                      <SalaryInput value={role.salary||rateToSalary(role.rate)} onChange={v=>updateRole(i,"salary",v)}/>
                    </div>
                    <div style={{fontSize:"0.75rem",color:"#6b7280"}}>→</div>
                    <div style={{display:"flex",alignItems:"center",gap:4}}>
                      <span style={{fontFamily:"'Fraunces',serif",fontWeight:700,fontSize:"0.95rem",color:rc}}>£{Math.round(role.rate)}/hr</span>
                      <span style={{fontSize:"0.68rem",color:"#6b7280"}}>fully loaded</span>
                    </div>
                  </div>
                </div>
              )})}
            </div>
            <p style={{fontSize:"0.72rem",color:"#6b7280",marginTop:10,lineHeight:1.6}}>Hourly rates are calculated automatically: annual salary × {BURDEN_MULTIPLIER} (employer NI, pension & overhead) ÷ {PRODUCTIVE_HOURS.toLocaleString()} productive hours per year.</p>
          </div>
        )}
      </Card>

      {(()=>{
        const automatableMins=steps.filter(s=>s.workType==="manual"&&isSaveable(s)).reduce((sum,s)=>sum+s.minutes,0);
        const delayMins=steps.filter(s=>s.workType==="waiting").reduce((sum,s)=>sum+s.minutes,0);
        const fmtMins=(m)=>m>=60?`${Math.floor(m/60)}h ${m%60}m`:`${m}m`;
        return(
          <div style={{position:"sticky",top:64,zIndex:50,background:"rgba(250,249,247,0.95)",backdropFilter:"blur(12px)",borderRadius:12,border:"1px solid #e5e2dc",padding:"14px 20px",marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
            <div style={{display:"flex",gap:20,flexWrap:"wrap",alignItems:"center"}}>
              <span style={{fontSize:"0.82rem",color:"#6b7280"}}>Steps: <strong style={{color:"#1a1f2e"}}>{steps.length}</strong></span>
              <span style={{fontSize:"0.82rem",color:"#6b7280"}}>Time: <strong style={{color:"#1a1f2e"}}>{totalMinutes>=60?`${Math.floor(totalMinutes/60)}h ${totalMinutes%60}m`:`${totalMinutes}m`}</strong></span>
              <span style={{fontSize:"0.82rem",color:"#6b7280"}}>Cost: <strong style={{fontFamily:"'Fraunces',serif",color:"#2d6a4f"}}>£{totalCost.toFixed(0)}</strong></span>
              {automatableMins>0&&<span style={{fontSize:"0.82rem",color:"#1b4332",background:"#d4ede2",padding:"3px 10px",borderRadius:100,fontWeight:600}}>⚡ Automatable: {fmtMins(automatableMins)}</span>}
              {delayMins>0&&<span style={{fontSize:"0.82rem",color:"#8a6a1e",background:"#faf0d6",padding:"3px 10px",borderRadius:100,fontWeight:600}}>⏳ Delay time: {fmtMins(delayMins)}</span>}
            </div>
            <span style={{fontSize:"0.82rem",color:"#6b7280"}}>Saving opportunities: <strong style={{color:"#c4942a"}}>{steps.filter(s=>isSaveable(s)).length}/{steps.length}</strong></span>
          </div>
        );
      })()}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {steps.map((step,idx)=>{
          const role=roles.find(r=>r.id===step.roleId);
          const rc=role?getRoleColor(role,roles):"#e5e2dc";
          const cost=role?(step.minutes/60)*role.rate:0;
          const wt=WORK_TYPES.find(w=>w.value===step.workType)||WORK_TYPES[0];
          const isAutoOpportunity=step.workType==="manual"&&isSaveable(step);
          const isDelayRisk=step.workType==="waiting";
          const cardBg=isAutoOpportunity?"linear-gradient(135deg, #f0faf5 0%, #ffffff 60%)":isDelayRisk?"linear-gradient(135deg, #fdf8ec 0%, #ffffff 60%)":"#ffffff";
          const cardBorder=isAutoOpportunity?"1px solid #a8dcc0":isDelayRisk?"1px solid #e8dbb8":"1px solid #e5e2dc";
          return(
            <div key={step.id} style={{background:cardBg,border:cardBorder,borderLeft:isAutoOpportunity?"4px solid #2d6a4f":isDelayRisk?"4px solid #c4942a":`4px solid ${rc}`,borderRadius:16,padding:"18px 22px",transition:"all 0.2s"}}>
              <div style={{display:"flex",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
                <span style={{fontFamily:"'Fraunces',serif",fontWeight:700,fontSize:"0.9rem",color:"#6b7280",minWidth:24}}>{idx+1}</span>
                <div style={{flex:1,minWidth:200}}>
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12}}>
                    <input type="text" value={step.name} onChange={e=>updateStep(idx,"name",e.target.value)} placeholder="What happens at this step?" style={{flex:1,padding:"6px 0",border:"none",borderBottom:"1px solid #e5e2dc",fontFamily:"'DM Sans',sans-serif",fontSize:"0.92rem",color:"#1a1f2e",outline:"none",background:"transparent"}}/>
                    {isAutoOpportunity&&<span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:"0.68rem",fontWeight:700,padding:"3px 10px",borderRadius:100,flexShrink:0,background:"#d4ede2",color:"#1b4332",letterSpacing:"0.02em"}}>⚡ Automation opportunity</span>}
                    {isDelayRisk&&<span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:"0.68rem",fontWeight:700,padding:"3px 10px",borderRadius:100,flexShrink:0,background:"#faf0d6",color:"#8a6a1e",letterSpacing:"0.02em"}}>⏳ Delay risk</span>}
                  </div>
                  <div style={{display:"flex",gap:10,marginTop:12,flexWrap:"wrap",alignItems:"center"}}>
                    <Select value={step.roleId} onChange={v=>updateStep(idx,"roleId",v)} options={roles.map(r=>({value:r.id,label:r.name}))} style={{minWidth:130}}/>
                    <NumberInput value={step.minutes} onChange={v=>updateStep(idx,"minutes",v)} suffix="min" min={1}/>
                    <Select value={step.friction} onChange={v=>updateStep(idx,"friction",v)} options={FRICTION_LEVELS.map(f=>({value:f.value,label:`${f.label} friction`}))} style={{minWidth:110}}/>
                    <Select value={step.workType||"manual"} onChange={v=>updateStep(idx,"workType",v)} options={WORK_TYPES.map(w=>({value:w.value,label:`${w.icon} ${w.short}`}))} style={{minWidth:100,background:wt.bg,color:wt.color,fontWeight:600,border:`1px solid ${wt.color}30`}}/>
                  </div>
                </div>
                <div style={{textAlign:"right",minWidth:70}}>
                  <div style={{fontFamily:"'Fraunces',serif",fontWeight:700,fontSize:"1.3rem",color:rc}}>£{cost.toFixed(0)}</div>
                  <div style={{fontSize:"0.75rem",color:"#6b7280"}}>{step.minutes}m</div>
                  {isAutoOpportunity&&<div style={{fontSize:"0.65rem",color:"#2d6a4f",fontWeight:600,marginTop:2}}>recoverable</div>}
                  {isDelayRisk&&<div style={{fontSize:"0.65rem",color:"#c4942a",fontWeight:600,marginTop:2}}>delay cost</div>}
                </div>
                <button onClick={()=>removeStep(idx)} style={{background:"none",border:"none",color:"#b84a5a",cursor:"pointer",fontSize:"1.1rem",padding:"0 4px",alignSelf:"flex-start"}}>×</button>
              </div>
            </div>
          );
        })}
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
        {!isSaved && (
          <div onClick={handleSave} style={{background:"linear-gradient(135deg, #2d6a4f 0%, #1b4332 100%)",borderRadius:16,padding:"24px 28px",marginBottom:20,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",transition:"all 0.2s",boxShadow:"0 4px 16px rgba(45,106,79,0.25)",...anim(0.12)}}
            onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 24px rgba(45,106,79,0.3)";}}
            onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="0 4px 16px rgba(45,106,79,0.25)";}}>
            <div>
              <div style={{color:"#fff",fontFamily:"'Fraunces',serif",fontSize:"1.15rem",fontWeight:700,marginBottom:4}}>Save your results & get a free AI analysis</div>
              <div style={{color:"rgba(255,255,255,0.65)",fontSize:"0.85rem"}}>Register to save your process data and receive personalised insights — free, no obligation.</div>
            </div>
            <div style={{background:"#fff",color:"#1b4332",padding:"12px 24px",borderRadius:10,fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:"0.92rem",flexShrink:0,marginLeft:20}}>Save & register →</div>
          </div>
        )}
        {isSaved && (
          <div style={{background:"#d4ede2",borderRadius:12,padding:"16px 20px",marginBottom:20,display:"flex",alignItems:"center",gap:10,...anim(0.12)}}>
            <span style={{color:"#1b4332",fontWeight:700,fontSize:"0.95rem"}}>✓ Saved</span>
            <span style={{color:"#2d6a4f",fontSize:"0.85rem"}}>Your process data is saved to your account.</span>
          </div>
        )}
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:24,...anim(0.15)}}>
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
  const [screenFading,setScreenFading]=useState(false);
  const [navMounted,setNavMounted]=useState(true);
  const setScreen=(s)=>{
    const wasWelcome=screen==="welcome";
    setScreenFading(true);
    setNavMounted(false);
    setTimeout(()=>{
      setScreenRaw(s);
      window.scrollTo(0,0);
      setScreenFading(false);
      if(wasWelcome){setTimeout(()=>setNavMounted(true),30);}
    },220);
  };
  const [roles,setRoles]=useState(DEFAULT_ROLES);
  const [processName,setProcessName]=useState("");
  const [annualVolume,setAnnualVolume]=useState(80);
  const [steps,setSteps]=useState([]);
  const [saved,setSaved]=useState([]);
  const [savedIdx,setSavedIdx]=useState(null);
  const [user,setUser]=useState(null);
  const [showAuth,setShowAuth]=useState(false);
  const [templateUsed,setTemplateUsed]=useState(null);

  const handleTemplate=(t)=>{
    setProcessName(t.name);setAnnualVolume(t.annualVolume);
    setSteps(t.steps.map((s,i)=>({...s,id:Date.now()+i})));
    setTemplateUsed(t.id);setSavedIdx(null);
    setScreen(t.steps.length>0?"build":"setup");
  };

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

  // Auto-load template from URL param: ?template=patient-intake-healthcare
  useEffect(()=>{
    const params = new URLSearchParams(window.location.search);
    const templateId = params.get("template");
    if (templateId) {
      const t = TEMPLATES.find(t => t.id === templateId);
      if (t && t.steps.length > 0) {
        handleTemplate(t);
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const reset=()=>{setScreen("welcome");setProcessName("");setAnnualVolume(80);setSteps([]);setSavedIdx(null);setTemplateUsed(null);};

  const authCtx={user,signOut:()=>{sbSignOut();setUser(null);setSaved([]);reset();}};

  return (
    <AuthContext.Provider value={authCtx}>
      <div style={{background:"#EFEFEF",minHeight:"100vh",position:"relative"}}>
        {screen!=="welcome"&&<TopoBg />}
        {showAuth&&<AuthModal mode="register" onClose={()=>setShowAuth(false)} onAuth={handleAuth}/>}

        {screen!=="welcome"&&(
          <nav style={{position:"fixed",top:0,left:0,right:0,zIndex:100,background:"rgba(250,249,247,0.92)",backdropFilter:"blur(12px)",borderBottom:"1px solid #e5e2dc",height:64,display:"flex",alignItems:"center",padding:"0 24px"}}>
            <div style={{maxWidth:780,width:"100%",margin:"0 auto",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <button onClick={reset} style={{
                fontFamily:"'Fraunces',serif",fontWeight:700,fontSize:"1.2rem",color:"#1a1f2e",
                background:"none",border:"none",cursor:"pointer",letterSpacing:"-0.02em",
                opacity: navMounted ? 1 : 0,
                transform: navMounted ? "translateX(0)" : "translateX(-16px)",
                transition: "opacity 0.4s ease, transform 0.4s ease",
              }}>
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

        <div style={{ opacity:screenFading?0:1, transition:"opacity 0.2s ease" }}>
          {screen==="welcome"&&<WelcomeScreen onTemplate={handleTemplate} savedProcesses={saved} onLoadSaved={handleLoad} onDeleteSaved={handleDelete} onSignIn={()=>setShowAuth(true)}/>}
          {screen==="setup"&&<SetupScreen roles={roles} setRoles={setRoles} processName={processName} setProcessName={setProcessName} annualVolume={annualVolume} setAnnualVolume={setAnnualVolume} onNext={()=>setScreen("build")} onBack={reset}/>}
          {screen==="build"&&<BuildScreen roles={roles} setRoles={setRoles} steps={steps} setSteps={setSteps} processName={processName} annualVolume={annualVolume} setAnnualVolume={setAnnualVolume} onNext={()=>setScreen("results")} onBack={()=>setScreen(templateUsed?"welcome":"setup")} fromTemplate={!!templateUsed}/>}
          {screen==="results"&&<ResultsScreen roles={roles} steps={steps} processName={processName} annualVolume={annualVolume} templateUsed={templateUsed} onBack={()=>setScreen("build")} onReset={reset} onSave={handleSave} isSaved={savedIdx!==null}/>}
        </div>

        <footer style={{padding:"30px 24px",textAlign:"center",fontSize:"0.78rem",color:"#6b7280",borderTop:"1px solid #e5e2dc"}}>
          <a href="https://www.workthru.co.uk" target="_blank" rel="noopener noreferrer" style={{color:"#2d6a4f",textDecoration:"none",fontWeight:600}}>workthru.co.uk</a>
          <span style={{margin:"0 8px"}}>·</span>Operational audits & workflow automation for SMEs
          {user&&<span style={{marginLeft:16,color:"#6b7280"}}>Signed in as {user.email}</span>}
        </footer>
      </div>
    </AuthContext.Provider>
  );
}
