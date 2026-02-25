import { useState } from "react";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie, Legend
} from "recharts";

const AREAS = ["Downtown Dubai","Dubai Marina","Palm Jumeirah","Business Bay","Jumeirah","Emirates Hills","Arabian Ranches","Dubai Hills Estate","JBR","DIFC"];
const COMPETITORS = ["Bayut","PropertyFinder","Dubizzle","Allsopp & Allsopp","Betterhomes"];

function rnd(min, max) { return Math.random() * (max - min) + min; }
function rndInt(min, max) { return Math.floor(rnd(min, max)); }

function genTrend(days = 90, basePrice = 2_000_000) {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (days - i));
    return {
      date: d.toISOString().slice(0,10),
      avg_price_aed: Math.round(basePrice * (1 + i * rnd(0.001, 0.003)) * rnd(0.97, 1.03)),
      avg_price_per_sqft: Math.round(basePrice / 1500 * (1 + i * rnd(0.001, 0.002)) * rnd(0.97, 1.03)),
      new_listings: Math.max(1, Math.round(12 * rnd(0.5, 1.8))),
    };
  });
}

const AREA_DATA = Object.fromEntries(AREAS.map(a => {
  const bp = {"Palm Jumeirah":12e6,"Emirates Hills":22e6,"Downtown Dubai":3.5e6,"DIFC":4e6,"Dubai Marina":2.8e6,"Business Bay":2.2e6,"Dubai Hills Estate":4.5e6,"JBR":3e6,"Jumeirah":5.5e6,"Arabian Ranches":3.8e6}[a]||2.5e6;
  return [a, { avg_price_aed:Math.round(bp*rnd(0.9,1.1)), median_price_aed:Math.round(bp*rnd(0.85,1.05)),
    heat_index:rnd(35,92), total_active:rndInt(150,700), new_listings_7d:rndInt(10,80),
    velocity_ratio:rnd(0.7,2.1), trend:genTrend(90,bp), price_per_sqft:Math.round(bp/1800*rnd(0.9,1.1)) }];
}));

const COMP_DATA = COMPETITORS.map(name => ({
  name, listing_count:rndInt(200,1200), avg_price_aed:rndInt(1.8e6,5.5e6), avg_price_per_sqft:rndInt(900,2800)
}));

const ALERTS = [
  {id:"1",type:"PRICE_SURGE",severity:"CRITICAL",area:"Palm Jumeirah",title:"Price Surge: Palm Jumeirah",description:"Average villa price increased 8.2% in the last 14 days, driven by ultra-luxury demand.",triggered_at:new Date(Date.now()-3600000).toISOString(),is_acknowledged:false},
  {id:"2",type:"VELOCITY_SPIKE",severity:"WARNING",area:"Dubai Hills Estate",title:"Listing Velocity Spike: Dubai Hills Estate",description:"New listings appearing 1.8× faster than 30-day average – potential oversupply signal.",triggered_at:new Date(Date.now()-7200000).toISOString(),is_acknowledged:false},
  {id:"3",type:"HIGH_HEAT_INDEX",severity:"WARNING",area:"Downtown Dubai",title:"Hot Market: Downtown Dubai",description:"Market heat index reached 81.5/100. Expect competitive bidding on new listings.",triggered_at:new Date(Date.now()-14400000).toISOString(),is_acknowledged:false},
  {id:"4",type:"PRICE_DROP",severity:"INFO",area:"Business Bay",title:"Price Softening: Business Bay",description:"Median apartment price declined 3.1% vs prior month.",triggered_at:new Date(Date.now()-86400000).toISOString(),is_acknowledged:true},
  {id:"5",type:"LISTING_FLOOD",severity:"WARNING",area:"JBR",title:"Listing Flood: JBR",description:"42 new listings added by Bayut in 24 hours – unusual activity detected.",triggered_at:new Date(Date.now()-172800000).toISOString(),is_acknowledged:true},
];

const fmtAED = v => v>=1e6?`AED ${(v/1e6).toFixed(2)}M`:`AED ${(v/1000).toFixed(0)}K`;
const fmtDate = iso => new Date(iso).toLocaleDateString("en-AE",{month:"short",day:"numeric"});
const timeAgo = iso => { const h=Math.floor((Date.now()-new Date(iso))/3600000); return h<1?"just now":h<24?`${h}h ago`:`${Math.floor(h/24)}d ago`; };

const C = {bg:"#0d1117",surface:"#161b27",border:"#1e2638",gold:"#c9a84c",white:"#f1f5f9",muted:"#64748b",text:"#cbd5e1",red:"#ef4444",yellow:"#f59e0b",green:"#22c55e",blue:"#60a5fa"};

function HeatBadge({value}) {
  const {l,c} = value>=75?{l:"HOT",c:C.red}:value>=50?{l:"ACTIVE",c:C.yellow}:value>=25?{l:"BALANCED",c:C.green}:{l:"COOL",c:C.muted};
  return <span style={{background:c+"22",color:c,border:`1px solid ${c}44`,padding:"2px 7px",borderRadius:4,fontSize:9,fontWeight:700,letterSpacing:1}}>{l}</span>;
}
function SevBadge({s}) {
  const x={CRITICAL:{c:C.red},WARNING:{c:C.yellow},INFO:{c:C.blue}}[s]||{c:C.muted};
  return <span style={{background:x.c+"20",color:x.c,border:`1px solid ${x.c}44`,padding:"2px 7px",borderRadius:4,fontSize:9,fontWeight:700}}>{s}</span>;
}
function Tip({active,payload,label}) {
  if(!active||!payload?.length) return null;
  return <div style={{background:"#1a1f2e",border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 14px"}}>
    <div style={{color:C.muted,fontSize:11,marginBottom:4}}>{label}</div>
    {payload.map(p=><div key={p.dataKey} style={{color:p.color,fontSize:13,fontWeight:600}}>
      {p.dataKey==="avg_price_aed"?fmtAED(p.value):p.dataKey==="avg_price_per_sqft"?`AED ${p.value}/sqft`:p.value}
    </div>)}
  </div>;
}

export default function App() {
  const [tab,setTab] = useState("overview");
  const [area,setArea] = useState("Downtown Dubai");
  const [alerts,setAlerts] = useState(ALERTS);
  const [unreadOnly,setUnreadOnly] = useState(false);
  const d = AREA_DATA[area];
  const last30 = d.trend.slice(-30);

  const ov = {
    total: Object.values(AREA_DATA).reduce((s,a)=>s+a.total_active,0),
    avgPrice: Math.round(Object.values(AREA_DATA).reduce((s,a)=>s+a.avg_price_aed,0)/AREAS.length),
    new7d: Object.values(AREA_DATA).reduce((s,a)=>s+a.new_listings_7d,0),
    unread: alerts.filter(a=>!a.is_acknowledged).length,
  };

  const card = {background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:24};
  const title = {fontSize:11,color:C.muted,textTransform:"uppercase",letterSpacing:1.5,marginBottom:16,fontWeight:600};
  const sel = {background:C.surface,border:`1px solid ${C.border}`,color:C.white,padding:"8px 12px",borderRadius:8,fontSize:13,cursor:"pointer",outline:"none"};

  const Nav = ({id,icon,lbl}) => (
    <button onClick={()=>setTab(id)} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 20px",
      cursor:"pointer",border:"none",background:tab===id?`${C.gold}18`:"transparent",
      color:tab===id?C.gold:C.muted,fontSize:13,fontWeight:tab===id?600:400,textAlign:"left",
      width:"100%",borderLeft:tab===id?`2px solid ${C.gold}`:"2px solid transparent"}}>
      <span style={{fontSize:15}}>{icon}</span><span>{lbl}</span>
      {id==="alerts"&&ov.unread>0&&<span style={{marginLeft:"auto",background:C.red,color:"#fff",borderRadius:10,padding:"1px 7px",fontSize:10,fontWeight:700}}>{ov.unread}</span>}
    </button>
  );

  const ACOLS = [C.gold,C.blue,"#a78bfa","#34d399","#fb7185"];

  return (
    <div style={{background:C.bg,minHeight:"100vh",fontFamily:"'DM Sans','Helvetica Neue',sans-serif",color:C.white,display:"flex"}}>
      {/* Sidebar */}
      <div style={{width:210,background:C.surface,borderRight:`1px solid ${C.border}`,padding:"24px 0",display:"flex",flexDirection:"column",flexShrink:0}}>
        <div style={{padding:"0 20px 24px",borderBottom:`1px solid ${C.border}`,marginBottom:8}}>
          <div style={{fontSize:15,fontWeight:700,color:C.gold,letterSpacing:1.5,textTransform:"uppercase"}}>BI Properties</div>
          <div style={{fontSize:10,color:C.muted,letterSpacing:2,marginTop:2}}>MARKET INTELLIGENCE</div>
        </div>
        <Nav id="overview" icon="◈" lbl="Overview"/>
        <Nav id="price" icon="₿" lbl="Price Tracker"/>
        <Nav id="velocity" icon="⚡" lbl="Listing Velocity"/>
        <Nav id="competitors" icon="◎" lbl="Competitors"/>
        <Nav id="alerts" icon="⚑" lbl="Alerts"/>
        <div style={{marginTop:"auto",padding:"16px 20px",borderTop:`1px solid ${C.border}`,fontSize:11,color:C.muted}}>
          <div>Updated every 6h</div><div style={{marginTop:3}}>5 sources · 10 areas</div>
        </div>
      </div>

      {/* Main */}
      <div style={{flex:1,padding:"28px 32px",overflowY:"auto"}}>

        {tab==="overview" && <>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:28}}>
            <div>
              <div style={{fontSize:22,fontWeight:700,letterSpacing:-.3}}>Market Intelligence</div>
              <div style={{fontSize:12,color:C.muted,marginTop:2}}>UAE Residential Property · {new Date().toLocaleTimeString("en-AE")}</div>
            </div>
            <select style={sel} value={area} onChange={e=>setArea(e.target.value)}>{AREAS.map(a=><option key={a}>{a}</option>)}</select>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:20}}>
            {[{l:"Active Listings",v:ov.total.toLocaleString(),ch:"+4.2%",pos:true},{l:"Avg Price",v:fmtAED(ov.avgPrice),ch:"+2.8%",pos:true},{l:"New (7d)",v:ov.new7d,ch:"+18%",pos:true},{l:"Alerts",v:ov.unread,ch:"unread",pos:false}]
              .map(s=><div key={s.l} style={{...card,padding:"18px 20px"}}>
                <div style={{fontSize:24,fontWeight:700}}>{s.v}</div>
                <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginTop:4}}>{s.l}</div>
                <div style={{fontSize:11,color:s.pos?C.green:C.red,marginTop:5,fontWeight:600}}>{s.ch}</div>
              </div>)}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
            <div style={card}>
              <div style={title}>Price Trend — {area}</div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={last30} margin={{top:4,right:4,bottom:0,left:0}}>
                  <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.gold} stopOpacity={0.3}/><stop offset="95%" stopColor={C.gold} stopOpacity={0}/></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                  <XAxis dataKey="date" tickFormatter={fmtDate} tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={false} interval={6}/>
                  <YAxis tickFormatter={v=>`${(v/1e6).toFixed(1)}M`} tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={false}/>
                  <Tooltip content={<Tip/>}/>
                  <Area type="monotone" dataKey="avg_price_aed" stroke={C.gold} strokeWidth={2} fill="url(#g1)" dot={false}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div style={card}>
              <div style={title}>Listing Velocity — {area}</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={last30} margin={{top:4,right:4,bottom:0,left:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
                  <XAxis dataKey="date" tickFormatter={fmtDate} tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={false} interval={6}/>
                  <YAxis tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={false}/>
                  <Tooltip content={<Tip/>}/>
                  <Bar dataKey="new_listings" fill={C.blue} radius={[3,3,0,0]} opacity={0.85}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div style={card}>
            <div style={title}>Market Heat Index — All Areas</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10}}>
              {AREAS.map(a=>{const x=AREA_DATA[a];const h=x.heat_index;const bc=h>=75?C.red:h>=50?C.yellow:h>=25?C.green:C.muted;return(
                <div key={a} onClick={()=>setArea(a)} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:"14px 12px",cursor:"pointer",outline:area===a?`1px solid ${C.gold}`:"none"}}>
                  <div style={{fontSize:10,color:C.muted,marginBottom:7,fontWeight:500}}>{a}</div>
                  <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:5}}>
                    <span style={{fontSize:20,fontWeight:700,color:bc}}>{h.toFixed(0)}</span><HeatBadge value={h}/>
                  </div>
                  <div style={{height:3,background:bc+"22",borderRadius:2}}><div style={{height:3,width:`${h}%`,background:bc,borderRadius:2}}/></div>
                  <div style={{fontSize:9,color:C.muted,marginTop:5}}>{fmtAED(x.avg_price_aed)}</div>
                </div>
              );})}
            </div>
          </div>
        </>}

        {tab==="price" && <>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:28}}>
            <div><div style={{fontSize:22,fontWeight:700}}>Price Tracker</div><div style={{fontSize:12,color:C.muted,marginTop:2}}>Historical trends & area comparison</div></div>
            <select style={sel} value={area} onChange={e=>setArea(e.target.value)}>{AREAS.map(a=><option key={a}>{a}</option>)}</select>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:20}}>
            {[{l:"Avg Price",v:fmtAED(d.avg_price_aed)},{l:"Median",v:fmtAED(d.median_price_aed)},{l:"Price/SqFt",v:`AED ${d.price_per_sqft}`},{l:"Heat Index",v:`${d.heat_index.toFixed(0)}/100`}]
              .map(s=><div key={s.l} style={{...card,padding:"18px 20px"}}><div style={{fontSize:22,fontWeight:700}}>{s.v}</div><div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginTop:4}}>{s.l}</div></div>)}
          </div>
          <div style={card}>
            <div style={title}>90-Day Price History — {area}</div>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={d.trend} margin={{top:4,right:4,bottom:0,left:0}}>
                <defs>
                  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.gold} stopOpacity={0.25}/><stop offset="95%" stopColor={C.gold} stopOpacity={0}/></linearGradient>
                  <linearGradient id="g3" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.blue} stopOpacity={0.2}/><stop offset="95%" stopColor={C.blue} stopOpacity={0}/></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                <XAxis dataKey="date" tickFormatter={fmtDate} tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={false} interval={11}/>
                <YAxis yAxisId="p" tickFormatter={v=>`${(v/1e6).toFixed(1)}M`} tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={false}/>
                <YAxis yAxisId="s" orientation="right" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={false}/>
                <Tooltip content={<Tip/>}/>
                <Area yAxisId="p" type="monotone" dataKey="avg_price_aed" stroke={C.gold} strokeWidth={2} fill="url(#g2)" dot={false}/>
                <Area yAxisId="s" type="monotone" dataKey="avg_price_per_sqft" stroke={C.blue} strokeWidth={1.5} fill="url(#g3)" dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div style={{...card,marginTop:16}}>
            <div style={title}>Area Comparison</div>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr style={{borderBottom:`1px solid ${C.border}`}}>{["Area","Avg Price","Price/sqft","Active","Heat","Trend"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",fontSize:9,color:C.muted,letterSpacing:1,textTransform:"uppercase",fontWeight:600}}>{h}</th>)}</tr></thead>
              <tbody>{AREAS.map(a=>{const x=AREA_DATA[a];const ch=(x.trend.at(-1).avg_price_aed-x.trend.at(-30).avg_price_aed)/x.trend.at(-30).avg_price_aed*100;return(
                <tr key={a} onClick={()=>setArea(a)} style={{borderBottom:`1px solid ${C.border}22`,cursor:"pointer",background:area===a?`${C.gold}08`:"transparent"}}>
                  <td style={{padding:"10px",fontSize:12,color:C.white,fontWeight:area===a?600:400}}>{a}</td>
                  <td style={{padding:"10px",fontSize:12,color:C.gold}}>{fmtAED(x.avg_price_aed)}</td>
                  <td style={{padding:"10px",fontSize:11,color:C.text}}>AED {x.price_per_sqft}</td>
                  <td style={{padding:"10px",fontSize:11,color:C.text}}>{x.total_active.toLocaleString()}</td>
                  <td style={{padding:"10px"}}><HeatBadge value={x.heat_index}/></td>
                  <td style={{padding:"10px",fontSize:11,color:ch>=0?C.green:C.red,fontWeight:600}}>{ch>=0?"▲":"▼"} {Math.abs(ch).toFixed(1)}%</td>
                </tr>);})}
              </tbody>
            </table>
          </div>
        </>}

        {tab==="velocity" && <>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:28}}>
            <div><div style={{fontSize:22,fontWeight:700}}>Listing Velocity</div><div style={{fontSize:12,color:C.muted,marginTop:2}}>Market momentum signals</div></div>
            <select style={sel} value={area} onChange={e=>setArea(e.target.value)}>{AREAS.map(a=><option key={a}>{a}</option>)}</select>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16,marginBottom:20}}>
            {[()=>{const vc=d.velocity_ratio>1.5?C.red:d.velocity_ratio>1.2?C.yellow:d.velocity_ratio>0.8?C.green:C.muted;return(
              <div style={{...card,padding:"18px 20px"}}>
                <div style={{fontSize:24,fontWeight:700,color:vc}}>{d.velocity_ratio.toFixed(2)}×</div>
                <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginTop:4}}>Velocity Ratio</div>
                <div style={{fontSize:11,color:vc,marginTop:6,fontWeight:700}}>{d.velocity_ratio>1.5?"ACCELERATING 🔥":d.velocity_ratio>1.2?"RISING":d.velocity_ratio<0.8?"SLOWING":"STABLE"}</div>
              </div>);},
              ()=><div style={{...card,padding:"18px 20px"}}><div style={{fontSize:24,fontWeight:700}}>{d.new_listings_7d}</div><div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginTop:4}}>New Listings (7d)</div></div>,
              ()=><div style={{...card,padding:"18px 20px"}}><div style={{fontSize:24,fontWeight:700}}>{d.total_active.toLocaleString()}</div><div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginTop:4}}>Total Active</div></div>
            ].map((Comp,i)=><Comp key={i}/>)}
          </div>
          <div style={card}>
            <div style={title}>Daily New Listings — {area} (60 days)</div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={d.trend.slice(-60)} margin={{top:4,right:4,bottom:0,left:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
                <XAxis dataKey="date" tickFormatter={fmtDate} tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={false} interval={9}/>
                <YAxis tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={false}/>
                <Tooltip content={<Tip/>}/>
                <Bar dataKey="new_listings" radius={[3,3,0,0]}>
                  {d.trend.slice(-60).map((x,i)=><Cell key={i} fill={x.new_listings>20?C.red:x.new_listings>12?C.yellow:C.blue} fillOpacity={0.85}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{...card,marginTop:16}}>
            <div style={title}>All Areas Velocity</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8}}>
              {AREAS.map(a=>{const x=AREA_DATA[a];const c=x.velocity_ratio>1.5?C.red:x.velocity_ratio>1.2?C.yellow:x.velocity_ratio>0.8?C.green:C.muted;return(
                <div key={a} onClick={()=>setArea(a)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 14px",background:C.bg,borderRadius:8,border:`1px solid ${C.border}`,cursor:"pointer",outline:area===a?`1px solid ${C.gold}`:"none"}}>
                  <div><div style={{fontSize:12,color:C.white,fontWeight:500}}>{a}</div><div style={{fontSize:10,color:C.muted,marginTop:2}}>{x.new_listings_7d} new this week</div></div>
                  <div style={{textAlign:"right"}}><div style={{fontSize:17,fontWeight:700,color:c}}>{x.velocity_ratio.toFixed(1)}×</div><div style={{fontSize:9,color:c,fontWeight:600}}>{x.velocity_ratio>1.5?"HOT":x.velocity_ratio>1.2?"RISING":x.velocity_ratio<0.8?"SLOW":"STABLE"}</div></div>
                </div>);})}
            </div>
          </div>
        </>}

        {tab==="competitors" && <>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:28}}>
            <div><div style={{fontSize:22,fontWeight:700}}>Competitor Analysis</div><div style={{fontSize:12,color:C.muted,marginTop:2}}>Market share & pricing by source</div></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
            <div style={card}>
              <div style={title}>Listings by Competitor</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={COMP_DATA} layout="vertical" margin={{left:20,right:10}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false}/>
                  <XAxis type="number" tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={false}/>
                  <YAxis type="category" dataKey="name" tick={{fill:C.text,fontSize:11}} tickLine={false} axisLine={false} width={100}/>
                  <Tooltip/>
                  <Bar dataKey="listing_count" radius={[0,4,4,0]}>{COMP_DATA.map((_,i)=><Cell key={i} fill={ACOLS[i%ACOLS.length]} fillOpacity={0.85}/>)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={card}>
              <div style={title}>Market Share</div>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={COMP_DATA} dataKey="listing_count" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={40} paddingAngle={3}>
                    {COMP_DATA.map((_,i)=><Cell key={i} fill={ACOLS[i%ACOLS.length]}/>)}
                  </Pie>
                  <Tooltip formatter={(v,n)=>[v.toLocaleString()+" listings",n]}/>
                  <Legend iconType="circle" wrapperStyle={{fontSize:11,color:C.muted}}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div style={card}>
            <div style={title}>Average Price by Competitor</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={COMP_DATA} margin={{top:4,right:16,bottom:0,left:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
                <XAxis dataKey="name" tick={{fill:C.muted,fontSize:10}} tickLine={false} axisLine={false}/>
                <YAxis tickFormatter={v=>`${(v/1e6).toFixed(1)}M`} tick={{fill:C.muted,fontSize:9}} tickLine={false} axisLine={false}/>
                <Tooltip formatter={v=>[fmtAED(v),"Avg Price"]}/>
                <Bar dataKey="avg_price_aed" radius={[4,4,0,0]}>{COMP_DATA.map((_,i)=><Cell key={i} fill={ACOLS[i%ACOLS.length]} fillOpacity={0.85}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{...card,marginTop:16}}>
            <div style={title}>Competitor Details</div>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr style={{borderBottom:`1px solid ${C.border}`}}>{["Competitor","Listings","Avg Price","Price/sqft","Type"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",fontSize:9,color:C.muted,letterSpacing:1,textTransform:"uppercase",fontWeight:600}}>{h}</th>)}</tr></thead>
              <tbody>{COMP_DATA.map((c,i)=>(
                <tr key={c.name} style={{borderBottom:`1px solid ${C.border}22`}}>
                  <td style={{padding:"11px 10px",fontSize:12,color:ACOLS[i%ACOLS.length],fontWeight:600}}>{c.name}</td>
                  <td style={{padding:"11px 10px",fontSize:12,color:C.white}}>{c.listing_count.toLocaleString()}</td>
                  <td style={{padding:"11px 10px",fontSize:12,color:C.gold}}>{fmtAED(c.avg_price_aed)}</td>
                  <td style={{padding:"11px 10px",fontSize:11,color:C.text}}>AED {c.avg_price_per_sqft}</td>
                  <td style={{padding:"11px 10px",fontSize:10,color:C.muted}}>{"Bayut,PropertyFinder,Dubizzle".includes(c.name)?"PORTAL":"AGENCY"}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        </>}

        {tab==="alerts" && <>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:28}}>
            <div><div style={{fontSize:22,fontWeight:700}}>Alerts & Signals</div><div style={{fontSize:12,color:C.muted,marginTop:2}}>{ov.unread} unacknowledged</div></div>
            <div style={{display:"flex",gap:8}}>
              {[{lbl:"All",v:false},{lbl:"Unread",v:true}].map(b=>(
                <button key={b.lbl} onClick={()=>setUnreadOnly(b.v)} style={{padding:"6px 14px",borderRadius:20,border:`1px solid ${unreadOnly===b.v?C.gold:C.border}`,background:unreadOnly===b.v?`${C.gold}18`:"transparent",color:unreadOnly===b.v?C.gold:C.muted,cursor:"pointer",fontSize:12,fontWeight:unreadOnly===b.v?600:400}}>{b.lbl}</button>))}
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {(unreadOnly?alerts.filter(a=>!a.is_acknowledged):alerts).map(al=>{
              const icon={PRICE_SURGE:"📈",PRICE_DROP:"📉",VELOCITY_SPIKE:"⚡",HIGH_HEAT_INDEX:"🔥",LISTING_FLOOD:"🌊"}[al.type]||"⚠️";
              const lc={CRITICAL:C.red,WARNING:C.yellow,INFO:C.blue}[al.severity];
              return(
                <div key={al.id} style={{...card,display:"flex",alignItems:"flex-start",gap:14,opacity:al.is_acknowledged?0.55:1,borderLeft:`3px solid ${lc}`}}>
                  <span style={{fontSize:26,marginTop:2}}>{icon}</span>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:5}}>
                      <span style={{fontSize:13,fontWeight:700}}>{al.title}</span>
                      <SevBadge s={al.severity}/>
                      {al.area&&<span style={{fontSize:10,color:C.muted,background:C.border,padding:"2px 7px",borderRadius:4}}>{al.area}</span>}
                    </div>
                    <div style={{fontSize:12,color:C.text,lineHeight:1.5,marginBottom:6}}>{al.description}</div>
                    <div style={{fontSize:10,color:C.muted}}>{timeAgo(al.triggered_at)}</div>
                  </div>
                  {!al.is_acknowledged&&<button onClick={()=>setAlerts(p=>p.map(a=>a.id===al.id?{...a,is_acknowledged:true}:a))} style={{padding:"6px 12px",background:`${C.gold}18`,border:`1px solid ${C.gold}44`,color:C.gold,borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}>Acknowledge</button>}
                </div>);})}
          </div>
        </>}

      </div>
    </div>
  );
}
