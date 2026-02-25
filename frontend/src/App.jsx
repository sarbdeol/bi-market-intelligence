import { useState, useEffect, useCallback } from "react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadialBarChart, RadialBar, Cell, PieChart, Pie, Legend
} from "recharts";

// ─── Mock data (mirrors the backend API response shape) ────────────────
const AREAS = [
  "Downtown Dubai","Dubai Marina","Palm Jumeirah","Business Bay",
  "Jumeirah","Emirates Hills","Arabian Ranches","Dubai Hills Estate","JBR","DIFC"
];

const COMPETITORS = ["Bayut","PropertyFinder","Dubizzle","Allsopp & Allsopp","Betterhomes"];

function rnd(min, max) { return Math.random() * (max - min) + min; }
function rndInt(min, max) { return Math.floor(rnd(min, max)); }

function genTrend(days = 90, basePrice = 2_000_000, baseVelocity = 12) {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (days - i));
    const trend = 1 + i * rnd(0.001, 0.003);
    const noise = rnd(0.97, 1.03);
    return {
      date: d.toISOString().slice(0,10),
      avg_price_aed: Math.round(basePrice * trend * noise),
      avg_price_per_sqft: Math.round(basePrice * trend * noise / 1500),
      new_listings: Math.max(1, Math.round(baseVelocity * rnd(0.5, 1.8))),
      total_active: rndInt(200, 600),
    };
  });
}

const AREA_DATA = Object.fromEntries(AREAS.map(a => {
  const basePrice = { "Palm Jumeirah": 12_000_000, "Emirates Hills": 22_000_000,
    "Downtown Dubai": 3_500_000, "DIFC": 4_000_000, "Dubai Marina": 2_800_000,
    "Business Bay": 2_200_000, "Dubai Hills Estate": 4_500_000,
    "JBR": 3_000_000, "Jumeirah": 5_500_000, "Arabian Ranches": 3_800_000 }[a] || 2_500_000;
  const heat = rnd(35, 92);
  return [a, {
    avg_price_aed: Math.round(basePrice * rnd(0.9, 1.1)),
    median_price_aed: Math.round(basePrice * rnd(0.85, 1.05)),
    heat_index: heat,
    total_active: rndInt(150, 700),
    new_listings_7d: rndInt(10, 80),
    velocity_ratio: rnd(0.7, 2.1),
    trend: genTrend(90, basePrice),
    price_per_sqft: Math.round(basePrice / 1800 * rnd(0.9, 1.1)),
  }];
}));

const COMPETITOR_DATA = COMPETITORS.map(name => ({
  name,
  listing_count: rndInt(200, 1200),
  avg_price_aed: rndInt(1_800_000, 5_500_000),
  avg_price_per_sqft: rndInt(900, 2800),
  market_share: rnd(8, 35),
}));

const ALERTS_DATA = [
  { id:"1", type:"PRICE_SURGE", severity:"CRITICAL", area:"Palm Jumeirah",
    title:"Price Surge: Palm Jumeirah", description:"Average villa price increased 8.2% in the last 14 days, driven by ultra-luxury demand.", metric_value:8.2, triggered_at: new Date(Date.now()-3600000).toISOString(), is_acknowledged: false },
  { id:"2", type:"VELOCITY_SPIKE", severity:"WARNING", area:"Dubai Hills Estate",
    title:"Listing Velocity Spike: Dubai Hills Estate", description:"New listings appearing 1.8× faster than 30-day average – potential oversupply signal.", metric_value:1.8, triggered_at: new Date(Date.now()-7200000).toISOString(), is_acknowledged: false },
  { id:"3", type:"HIGH_HEAT_INDEX", severity:"WARNING", area:"Downtown Dubai",
    title:"Hot Market: Downtown Dubai", description:"Market heat index reached 81.5/100. Expect competitive bidding on new listings.", metric_value:81.5, triggered_at: new Date(Date.now()-14400000).toISOString(), is_acknowledged: false },
  { id:"4", type:"PRICE_DROP", severity:"INFO", area:"Business Bay",
    title:"Price Softening: Business Bay", description:"Median apartment price declined 3.1% vs prior month.", metric_value:-3.1, triggered_at: new Date(Date.now()-86400000).toISOString(), is_acknowledged: true },
  { id:"5", type:"LISTING_FLOOD", severity:"WARNING", area:"JBR",
    title:"Listing Flood: JBR", description:"42 new listings added by Bayut in 24 hours – unusual activity detected.", metric_value:42, triggered_at: new Date(Date.now()-172800000).toISOString(), is_acknowledged: true },
];

// ─── Formatters ────────────────────────────────────────────────────────
const fmtAED = v => v >= 1_000_000
  ? `AED ${(v/1_000_000).toFixed(2)}M`
  : `AED ${(v/1000).toFixed(0)}K`;

const fmtDate = iso => {
  const d = new Date(iso);
  return d.toLocaleDateString("en-AE", { month:"short", day:"numeric" });
};

const timeAgo = iso => {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
};

// ─── Heat Badge ────────────────────────────────────────────────────────
function HeatBadge({ value }) {
  const { label, color } =
    value >= 75 ? { label:"HOT", color:"#ef4444" } :
    value >= 50 ? { label:"ACTIVE", color:"#f59e0b" } :
    value >= 25 ? { label:"BALANCED", color:"#22c55e" } :
                 { label:"COOL", color:"#64748b" };
  return (
    <span style={{ background: color + "22", color, border: `1px solid ${color}44`,
      padding:"2px 8px", borderRadius:4, fontSize:10, fontWeight:700, letterSpacing:1 }}>
      {label}
    </span>
  );
}

// ─── Severity Badge ────────────────────────────────────────────────────
function SeverityBadge({ severity }) {
  const cfg = { CRITICAL: { bg:"#ef444420", c:"#ef4444", b:"#ef444440" },
    WARNING: { bg:"#f59e0b20", c:"#f59e0b", b:"#f59e0b40" },
    INFO: { bg:"#3b82f620", c:"#60a5fa", b:"#3b82f640" } }[severity] || {};
  return (
    <span style={{ background:cfg.bg, color:cfg.c, border:`1px solid ${cfg.b}`,
      padding:"2px 8px", borderRadius:4, fontSize:10, fontWeight:700, letterSpacing:1 }}>
      {severity}
    </span>
  );
}

// ─── Custom Tooltip ────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, priceKey = "avg_price_aed" }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:"#1a1f2e", border:"1px solid #2d3448", borderRadius:8, padding:"10px 14px" }}>
      <div style={{ color:"#94a3b8", fontSize:11, marginBottom:4 }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ color: p.color, fontSize:13, fontWeight:600 }}>
          {p.dataKey === "avg_price_aed" ? fmtAED(p.value) :
           p.dataKey === "avg_price_per_sqft" ? `AED ${p.value}/sqft` :
           p.value}
        </div>
      ))}
    </div>
  );
}

// ─── MAIN APP ──────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("overview");
  const [selectedArea, setSelectedArea] = useState("Downtown Dubai");
  const [alerts, setAlerts] = useState(ALERTS_DATA);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const areaData = AREA_DATA[selectedArea];
  const trend = areaData.trend;
  const last30 = trend.slice(-30);
  const last7  = trend.slice(-7);

  const overview = {
    total_active_listings: Object.values(AREA_DATA).reduce((s,a) => s + a.total_active, 0),
    total_competitors: COMPETITORS.length,
    unread_alerts: alerts.filter(a => !a.is_acknowledged).length,
    tracked_areas: AREAS.length,
    avg_price_aed: Math.round(Object.values(AREA_DATA).reduce((s,a) => s + a.avg_price_aed, 0) / AREAS.length),
    new_listings_7d: Object.values(AREA_DATA).reduce((s,a) => s + a.new_listings_7d, 0),
  };

  const acknowledgeAlert = id => setAlerts(prev => prev.map(a => a.id === id ? {...a, is_acknowledged: true} : a));

  // ─── Styles ────────────────────────────────────────────────────────
  const colors = {
    bg: "#0d1117", surface: "#161b27", border: "#1e2638",
    gold: "#c9a84c", goldLight: "#e8c97a", white: "#f1f5f9",
    muted: "#64748b", text: "#cbd5e1",
    red: "#ef4444", yellow: "#f59e0b", green: "#22c55e", blue: "#60a5fa",
  };

  const S = {
    app: { background: colors.bg, minHeight:"100vh", fontFamily:"'DM Sans', 'Helvetica Neue', sans-serif", color: colors.white },
    sidebar: { width:220, background: colors.surface, borderRight:`1px solid ${colors.border}`,
      padding:"24px 0", display:"flex", flexDirection:"column", position:"fixed", top:0, left:0, height:"100vh", zIndex:10 },
    logo: { padding:"0 20px 28px", borderBottom:`1px solid ${colors.border}`, marginBottom:8 },
    logoText: { fontSize:16, fontWeight:700, color: colors.gold, letterSpacing:1.5, textTransform:"uppercase" },
    logoSub: { fontSize:10, color: colors.muted, letterSpacing:2, marginTop:2 },
    navBtn: (active) => ({
      display:"flex", alignItems:"center", gap:10, padding:"11px 20px",
      cursor:"pointer", border:"none", background: active ? `${colors.gold}18` : "transparent",
      color: active ? colors.gold : colors.muted, fontSize:13, fontWeight: active ? 600 : 400,
      textAlign:"left", width:"100%", borderLeft: active ? `2px solid ${colors.gold}` : "2px solid transparent",
      transition:"all .15s",
    }),
    main: { marginLeft:220, padding:"32px 36px" },
    header: { display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:32 },
    title: { fontSize:24, fontWeight:700, color: colors.white, letterSpacing:-.3 },
    subtitle: { fontSize:13, color: colors.muted, marginTop:2 },
    card: { background: colors.surface, border:`1px solid ${colors.border}`, borderRadius:12, padding:24 },
    cardTitle: { fontSize:11, color: colors.muted, textTransform:"uppercase", letterSpacing:1.5, marginBottom:16, fontWeight:600 },
    grid2: { display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, marginBottom:20 },
    grid3: { display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:20, marginBottom:20 },
    grid4: { display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:20, marginBottom:20 },
    statCard: { background: colors.surface, border:`1px solid ${colors.border}`, borderRadius:12, padding:"20px 24px" },
    statValue: { fontSize:26, fontWeight:700, color: colors.white },
    statLabel: { fontSize:11, color: colors.muted, textTransform:"uppercase", letterSpacing:1, marginTop:4 },
    statChange: (pos) => ({ fontSize:11, color: pos ? colors.green : colors.red, marginTop:6, fontWeight:600 }),
    select: { background: colors.surface, border:`1px solid ${colors.border}`, color: colors.white,
      padding:"8px 12px", borderRadius:8, fontSize:13, cursor:"pointer", outline:"none" },
    pill: (active) => ({ padding:"6px 14px", borderRadius:20, border:`1px solid ${active ? colors.gold : colors.border}`,
      background: active ? `${colors.gold}18` : "transparent", color: active ? colors.gold : colors.muted,
      cursor:"pointer", fontSize:12, fontWeight: active ? 600 : 400, transition:"all .15s" }),
  };

  const NavItem = ({ id, icon, label }) => (
    <button style={S.navBtn(tab === id)} onClick={() => setTab(id)}>
      <span style={{ fontSize:16 }}>{icon}</span>
      <span>{label}</span>
      {id === "alerts" && overview.unread_alerts > 0 && (
        <span style={{ marginLeft:"auto", background:colors.red, color:"#fff",
          borderRadius:10, padding:"1px 7px", fontSize:10, fontWeight:700 }}>
          {overview.unread_alerts}
        </span>
      )}
    </button>
  );

  // ─── Views ────────────────────────────────────────────────────────

  const OverviewView = () => (
    <>
      <div style={S.header}>
        <div>
          <div style={S.title}>Market Intelligence</div>
          <div style={S.subtitle}>UAE Residential Property · Last updated {new Date().toLocaleTimeString("en-AE")}</div>
        </div>
        <select style={S.select} value={selectedArea} onChange={e => setSelectedArea(e.target.value)}>
          {AREAS.map(a => <option key={a}>{a}</option>)}
        </select>
      </div>

      {/* KPI Strip */}
      <div style={S.grid4}>
        {[
          { label:"Active Listings", value: overview.total_active_listings.toLocaleString(), change:"+4.2% vs last month", pos:true },
          { label:"Avg Market Price", value: fmtAED(overview.avg_price_aed), change:"+2.8% vs last month", pos:true },
          { label:"New Listings (7d)", value: overview.new_listings_7d.toLocaleString(), change:"+18% vs prior week", pos:true },
          { label:"Unread Alerts", value: overview.unread_alerts, change:"3 critical", pos:false },
        ].map(stat => (
          <div key={stat.label} style={S.statCard}>
            <div style={S.statValue}>{stat.value}</div>
            <div style={S.statLabel}>{stat.label}</div>
            <div style={S.statChange(stat.pos)}>{stat.change}</div>
          </div>
        ))}
      </div>

      <div style={S.grid2}>
        {/* Price Trend */}
        <div style={S.card}>
          <div style={S.cardTitle}>Price Trend — {selectedArea}</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={last30} margin={{ top:5, right:5, bottom:0, left:0 }}>
              <defs>
                <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colors.gold} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={colors.gold} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill:colors.muted, fontSize:10 }} tickLine={false} axisLine={false} interval={6} />
              <YAxis tickFormatter={v => `${(v/1e6).toFixed(1)}M`} tick={{ fill:colors.muted, fontSize:10 }} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="avg_price_aed" stroke={colors.gold} strokeWidth={2} fill="url(#priceGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Listing Velocity */}
        <div style={S.card}>
          <div style={S.cardTitle}>Listing Velocity — {selectedArea}</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={last30} margin={{ top:5, right:5, bottom:0, left:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill:colors.muted, fontSize:10 }} tickLine={false} axisLine={false} interval={6} />
              <YAxis tick={{ fill:colors.muted, fontSize:10 }} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="new_listings" fill={colors.blue} radius={[3,3,0,0]} opacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Heat Map */}
      <div style={S.card}>
        <div style={S.cardTitle}>Market Heat Index — All Areas</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:12 }}>
          {AREAS.map(area => {
            const d = AREA_DATA[area];
            const h = d.heat_index;
            const barColor = h >= 75 ? "#ef4444" : h >= 50 ? "#f59e0b" : h >= 25 ? "#22c55e" : "#64748b";
            return (
              <div key={area} style={{ background: colors.bg, border:`1px solid ${colors.border}`,
                borderRadius:10, padding:"16px 14px", cursor:"pointer",
                outline: selectedArea === area ? `1px solid ${colors.gold}` : "none" }}
                onClick={() => setSelectedArea(area)}>
                <div style={{ fontSize:11, color: colors.muted, marginBottom:8, fontWeight:500 }}>{area}</div>
                <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", marginBottom:6 }}>
                  <span style={{ fontSize:22, fontWeight:700, color: barColor }}>{h.toFixed(0)}</span>
                  <HeatBadge value={h} />
                </div>
                <div style={{ height:4, background:`${barColor}22`, borderRadius:2 }}>
                  <div style={{ height:4, width:`${h}%`, background: barColor, borderRadius:2, transition:"width .5s" }} />
                </div>
                <div style={{ fontSize:10, color: colors.muted, marginTop:6 }}>{fmtAED(d.avg_price_aed)} avg</div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );

  const PriceTrackerView = () => {
    const data = AREA_DATA[selectedArea];
    return (
      <>
        <div style={S.header}>
          <div>
            <div style={S.title}>Price Tracker</div>
            <div style={S.subtitle}>Historical price trends and statistics per area</div>
          </div>
          <select style={S.select} value={selectedArea} onChange={e => setSelectedArea(e.target.value)}>
            {AREAS.map(a => <option key={a}>{a}</option>)}
          </select>
        </div>

        <div style={S.grid4}>
          {[
            { label:"Avg Price", value: fmtAED(data.avg_price_aed) },
            { label:"Median Price", value: fmtAED(data.median_price_aed) },
            { label:"Price / SqFt", value: `AED ${data.price_per_sqft}` },
            { label:"Heat Index", value: data.heat_index.toFixed(0) + " / 100" },
          ].map(s => (
            <div key={s.label} style={S.statCard}>
              <div style={S.statValue}>{s.value}</div>
              <div style={S.statLabel}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={S.card}>
          <div style={S.cardTitle}>90-Day Price History — {selectedArea}</div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={trend} margin={{ top:5, right:5, bottom:0, left:0 }}>
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colors.gold} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={colors.gold} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colors.blue} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={colors.blue} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill:colors.muted, fontSize:10 }} tickLine={false} axisLine={false} interval={11} />
              <YAxis yAxisId="price" orientation="left" tickFormatter={v => `${(v/1e6).toFixed(1)}M`} tick={{ fill:colors.muted, fontSize:10 }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="psf" orientation="right" tick={{ fill:colors.muted, fontSize:10 }} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Area yAxisId="price" type="monotone" dataKey="avg_price_aed" stroke={colors.gold} strokeWidth={2} fill="url(#g1)" dot={false} name="Avg Price" />
              <Area yAxisId="psf" type="monotone" dataKey="avg_price_per_sqft" stroke={colors.blue} strokeWidth={1.5} fill="url(#g2)" dot={false} name="Price/sqft" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Area comparison table */}
        <div style={{...S.card, marginTop:20}}>
          <div style={S.cardTitle}>Area Comparison — Current Snapshot</div>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${colors.border}` }}>
                {["Area","Avg Price","Price/sqft","Active Listings","Heat Index","Trend"].map(h => (
                  <th key={h} style={{ padding:"8px 12px", textAlign:"left", fontSize:10,
                    color:colors.muted, letterSpacing:1, textTransform:"uppercase", fontWeight:600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {AREAS.map((area, i) => {
                const d = AREA_DATA[area];
                const priceChange = (d.trend.at(-1).avg_price_aed - d.trend.at(-30).avg_price_aed) / d.trend.at(-30).avg_price_aed * 100;
                return (
                  <tr key={area} style={{ borderBottom:`1px solid ${colors.border}22`, cursor:"pointer",
                    background: selectedArea === area ? `${colors.gold}08` : "transparent" }}
                    onClick={() => setSelectedArea(area)}>
                    <td style={{ padding:"12px", fontSize:13, color:colors.white, fontWeight: selectedArea===area ? 600 : 400 }}>{area}</td>
                    <td style={{ padding:"12px", fontSize:13, color:colors.gold }}>{fmtAED(d.avg_price_aed)}</td>
                    <td style={{ padding:"12px", fontSize:12, color:colors.text }}>AED {d.price_per_sqft}</td>
                    <td style={{ padding:"12px", fontSize:12, color:colors.text }}>{d.total_active.toLocaleString()}</td>
                    <td style={{ padding:"12px" }}><HeatBadge value={d.heat_index} /></td>
                    <td style={{ padding:"12px", fontSize:12, color: priceChange >= 0 ? colors.green : colors.red, fontWeight:600 }}>
                      {priceChange >= 0 ? "▲" : "▼"} {Math.abs(priceChange).toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  const VelocityView = () => {
    const data = AREA_DATA[selectedArea];
    const velocityColor = data.velocity_ratio > 1.5 ? colors.red : data.velocity_ratio > 1.2 ? colors.yellow : data.velocity_ratio > 0.8 ? colors.green : colors.muted;
    return (
      <>
        <div style={S.header}>
          <div>
            <div style={S.title}>Listing Velocity</div>
            <div style={S.subtitle}>New listing rate and market momentum signals</div>
          </div>
          <select style={S.select} value={selectedArea} onChange={e => setSelectedArea(e.target.value)}>
            {AREAS.map(a => <option key={a}>{a}</option>)}
          </select>
        </div>

        <div style={S.grid3}>
          <div style={S.statCard}>
            <div style={{ ...S.statValue, color: velocityColor }}>{data.velocity_ratio.toFixed(2)}×</div>
            <div style={S.statLabel}>Velocity Ratio (vs 30d avg)</div>
            <div style={{ fontSize:12, color: velocityColor, marginTop:8, fontWeight:700 }}>
              {data.velocity_ratio > 1.5 ? "ACCELERATING 🔥" : data.velocity_ratio > 1.2 ? "RISING" : data.velocity_ratio < 0.8 ? "SLOWING" : "STABLE"}
            </div>
          </div>
          <div style={S.statCard}>
            <div style={S.statValue}>{data.new_listings_7d}</div>
            <div style={S.statLabel}>New Listings (Last 7 Days)</div>
          </div>
          <div style={S.statCard}>
            <div style={S.statValue}>{data.total_active.toLocaleString()}</div>
            <div style={S.statLabel}>Total Active Listings</div>
          </div>
        </div>

        <div style={S.card}>
          <div style={S.cardTitle}>Daily New Listings — {selectedArea}</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={trend.slice(-60)} margin={{ top:5, right:5, bottom:0, left:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill:colors.muted, fontSize:10 }} tickLine={false} axisLine={false} interval={9} />
              <YAxis tick={{ fill:colors.muted, fontSize:10 }} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="new_listings" radius={[3,3,0,0]}>
                {trend.slice(-60).map((d, i) => (
                  <Cell key={i} fill={d.new_listings > 20 ? colors.red : d.new_listings > 12 ? colors.yellow : colors.blue} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* All areas velocity table */}
        <div style={{...S.card, marginTop:20}}>
          <div style={S.cardTitle}>Velocity Comparison — All Areas</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:10 }}>
            {AREAS.map(area => {
              const d = AREA_DATA[area];
              const c = d.velocity_ratio > 1.5 ? colors.red : d.velocity_ratio > 1.2 ? colors.yellow : d.velocity_ratio > 0.8 ? colors.green : colors.muted;
              return (
                <div key={area} style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                  padding:"12px 16px", background:colors.bg, borderRadius:8, border:`1px solid ${colors.border}`,
                  cursor:"pointer", outline: selectedArea===area ? `1px solid ${colors.gold}` : "none" }}
                  onClick={() => setSelectedArea(area)}>
                  <div>
                    <div style={{ fontSize:13, color:colors.white, fontWeight:500 }}>{area}</div>
                    <div style={{ fontSize:11, color:colors.muted, marginTop:2 }}>{d.new_listings_7d} new this week</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:18, fontWeight:700, color:c }}>{d.velocity_ratio.toFixed(1)}×</div>
                    <div style={{ fontSize:10, color:c, fontWeight:600 }}>
                      {d.velocity_ratio>1.5?"HOT":d.velocity_ratio>1.2?"RISING":d.velocity_ratio<0.8?"SLOW":"STABLE"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </>
    );
  };

  const CompetitorView = () => {
    const COLORS = [colors.gold, colors.blue, "#a78bfa", "#34d399", "#fb7185"];
    return (
      <>
        <div style={S.header}>
          <div>
            <div style={S.title}>Competitor Analysis</div>
            <div style={S.subtitle}>Market share, pricing and listing volume by competitor</div>
          </div>
          <select style={S.select} value={selectedArea} onChange={e => setSelectedArea(e.target.value)}>
            <option value="">All Areas</option>
            {AREAS.map(a => <option key={a}>{a}</option>)}
          </select>
        </div>

        <div style={S.grid2}>
          {/* Listing count bar chart */}
          <div style={S.card}>
            <div style={S.cardTitle}>Listings by Competitor</div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={COMPETITOR_DATA} layout="vertical" margin={{ left:20, right:10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={colors.border} horizontal={false} />
                <XAxis type="number" tick={{ fill:colors.muted, fontSize:10 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill:colors.text, fontSize:12 }} tickLine={false} axisLine={false} width={110} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="listing_count" radius={[0,4,4,0]}>
                  {COMPETITOR_DATA.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.85} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Market share pie */}
          <div style={S.card}>
            <div style={S.cardTitle}>Market Share</div>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={COMPETITOR_DATA} dataKey="listing_count" nameKey="name"
                  cx="50%" cy="50%" outerRadius={90} innerRadius={50} paddingAngle={3}>
                  {COMPETITOR_DATA.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v, n) => [v.toLocaleString() + " listings", n]} />
                <Legend iconType="circle" wrapperStyle={{ fontSize:12, color:colors.muted }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Avg price comparison */}
        <div style={S.card}>
          <div style={S.cardTitle}>Average Price per Competitor</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={COMPETITOR_DATA} margin={{ top:5, right:20, bottom:0, left:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
              <XAxis dataKey="name" tick={{ fill:colors.muted, fontSize:11 }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={v => `${(v/1e6).toFixed(1)}M`} tick={{ fill:colors.muted, fontSize:10 }} tickLine={false} axisLine={false} />
              <Tooltip formatter={v => [fmtAED(v), "Avg Price"]} />
              <Bar dataKey="avg_price_aed" radius={[4,4,0,0]}>
                {COMPETITOR_DATA.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.85} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Detail table */}
        <div style={{...S.card, marginTop:20}}>
          <div style={S.cardTitle}>Competitor Details</div>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${colors.border}` }}>
                {["Competitor","Listings","Avg Price","Price/sqft","Source"].map(h => (
                  <th key={h} style={{ padding:"8px 12px", textAlign:"left", fontSize:10,
                    color:colors.muted, letterSpacing:1, textTransform:"uppercase", fontWeight:600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPETITOR_DATA.map((c, i) => (
                <tr key={c.name} style={{ borderBottom:`1px solid ${colors.border}22` }}>
                  <td style={{ padding:"12px", fontSize:13, color:COLORS[i % COLORS.length], fontWeight:600 }}>{c.name}</td>
                  <td style={{ padding:"12px", fontSize:13, color:colors.white }}>{c.listing_count.toLocaleString()}</td>
                  <td style={{ padding:"12px", fontSize:13, color:colors.gold }}>{fmtAED(c.avg_price_aed)}</td>
                  <td style={{ padding:"12px", fontSize:12, color:colors.text }}>AED {c.avg_price_per_sqft}</td>
                  <td style={{ padding:"12px", fontSize:11, color:colors.muted }}>
                    {["Bayut","PropertyFinder","Dubizzle"].includes(c.name) ? "PORTAL" : "AGENCY"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  const AlertsView = () => {
    const filtered = unreadOnly ? alerts.filter(a => !a.is_acknowledged) : alerts;
    const typeIcon = { PRICE_SURGE:"📈", PRICE_DROP:"📉", VELOCITY_SPIKE:"⚡", HIGH_HEAT_INDEX:"🔥", LISTING_FLOOD:"🌊", NEW_COMPETITOR:"👀" };
    return (
      <>
        <div style={S.header}>
          <div>
            <div style={S.title}>Alerts & Signals</div>
            <div style={S.subtitle}>{alerts.filter(a => !a.is_acknowledged).length} unacknowledged alerts</div>
          </div>
          <button style={{ ...S.pill(!unreadOnly), marginRight:8 }} onClick={() => setUnreadOnly(false)}>All</button>
          <button style={S.pill(unreadOnly)} onClick={() => setUnreadOnly(true)}>Unread only</button>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {filtered.map(alert => (
            <div key={alert.id} style={{ ...S.card, display:"flex", alignItems:"flex-start", gap:16,
              opacity: alert.is_acknowledged ? 0.6 : 1,
              borderLeft: `3px solid ${{CRITICAL:colors.red,WARNING:colors.yellow,INFO:colors.blue}[alert.severity]}` }}>
              <div style={{ fontSize:28, marginTop:2 }}>{typeIcon[alert.type] || "⚠️"}</div>
              <div style={{ flex:1 }}>
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:6 }}>
                  <span style={{ fontSize:14, fontWeight:700, color:colors.white }}>{alert.title}</span>
                  <SeverityBadge severity={alert.severity} />
                  {alert.area && (
                    <span style={{ fontSize:11, color:colors.muted, background:`${colors.border}`, padding:"2px 8px", borderRadius:4 }}>
                      {alert.area}
                    </span>
                  )}
                </div>
                <div style={{ fontSize:13, color:colors.text, lineHeight:1.5, marginBottom:8 }}>{alert.description}</div>
                <div style={{ fontSize:11, color:colors.muted }}>{timeAgo(alert.triggered_at)}</div>
              </div>
              {!alert.is_acknowledged && (
                <button onClick={() => acknowledgeAlert(alert.id)} style={{ padding:"6px 14px",
                  background:`${colors.gold}18`, border:`1px solid ${colors.gold}44`, color:colors.gold,
                  borderRadius:6, cursor:"pointer", fontSize:12, fontWeight:600, whiteSpace:"nowrap" }}>
                  Acknowledge
                </button>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ ...S.card, textAlign:"center", padding:48, color:colors.muted }}>
              ✅ No alerts to show
            </div>
          )}
        </div>
      </>
    );
  };

  const views = { overview: <OverviewView />, price: <PriceTrackerView />, velocity: <VelocityView />, competitors: <CompetitorView />, alerts: <AlertsView /> };

  return (
    <div style={S.app}>
      {/* Sidebar */}
      <div style={S.sidebar}>
        <div style={S.logo}>
          <div style={S.logoText}>BI Properties</div>
          <div style={S.logoSub}>MARKET INTELLIGENCE</div>
        </div>
        <NavItem id="overview"     icon="◈" label="Overview" />
        <NavItem id="price"        icon="₿" label="Price Tracker" />
        <NavItem id="velocity"     icon="⚡" label="Listing Velocity" />
        <NavItem id="competitors"  icon="◎" label="Competitors" />
        <NavItem id="alerts"       icon="⚑" label="Alerts" />
        <div style={{ marginTop:"auto", padding:"16px 20px", borderTop:`1px solid ${colors.border}`, fontSize:11, color:colors.muted }}>
          <div>Data updated every 6h</div>
          <div style={{ marginTop:4 }}>5 sources · {AREAS.length} areas</div>
        </div>
      </div>

      {/* Main */}
      <div style={S.main}>{views[tab]}</div>
    </div>
  );
}
