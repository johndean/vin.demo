'use client';
/* VIN Demo console — app shell + routing (ported from web/app.jsx).
   Client-side view switching mirrors the prototype's hash router. */
import { useState, useEffect } from 'react';
import { Topbar, Sidebar, type Go } from './shell';
import { Dashboard, Products } from './views-core';
import { Knowledge, DemoGraphs, Environments, Personas } from './views-build';
import { Customers, Sessions, Safety, Governance, Evals, Costs, Settings } from './views-ops';
import { Experience, Journeys, ExperienceMap } from './views-experience';
import { OrgChart } from './views-orgchart';
import { AiHistory, AiControl } from './views-ai';
import { DataProvider } from './data-context';
import { AskPanel } from './AskPanel';
import type { VDType } from './data';

export default function ConsoleApp({ data, operator }: { data: VDType; operator?: string }) {
  const [route, setRoute] = useState('dashboard');
  const [param, setParam] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);

  useEffect(() => {
    const h = window.location.hash.replace('#', '');
    if (h) setRoute(h);
  }, []);
  useEffect(() => { document.querySelector('.main')?.scrollTo(0, 0); }, [route, param]);

  const go: Go = (r, p = null) => {
    setRoute(r);
    setParam(p ?? null);
    if (typeof window !== 'undefined') window.location.hash = r;
  };

  const views: Record<string, React.ReactNode> = {
    dashboard: <Dashboard go={go} />,
    products: <Products go={go} selected={param} />,
    knowledge: <Knowledge go={go} />,
    graphs: <DemoGraphs go={go} />,
    environments: <Environments go={go} />,
    personas: <Personas go={go} />,
    chain: <ExperienceMap go={go} />,
    experience: <Experience go={go} />,
    orgchart: <OrgChart go={go} />,
    aicontrol: <AiControl go={go} />,
    aihistory: <AiHistory go={go} />,
    journeys: <Journeys go={go} />,
    customers: <Customers go={go} selected={param} />,
    sessions: <Sessions go={go} />,
    safety: <Safety go={go} />,
    governance: <Governance go={go} />,
    evals: <Evals go={go} />,
    costs: <Costs go={go} />,
    settings: <Settings go={go} />,
  };

  const mtd = (data.mtdSpend ?? 0).toFixed(2);
  // Real, live nav counts derived from the loaded collections (was hardcoded 6/8/3/4/5).
  const navCounts: Record<string, number> = {
    products: data.products.length,
    knowledge: data.knowledge.length,
    personas: data.personas.filter((p) => !p.archived).length,
    customers: data.customers.filter((c) => !c.archived).length,
    sessions: data.sessions.length,
  };
  return (
    <DataProvider value={data}>
      <div className="app">
        <Topbar cost={mtd} workspace={data.workspace} operator={operator} onAsk={() => setAsk(true)} />
        <div className="shell">
          <Sidebar route={route} go={go} counts={navCounts} />
          <main className="main scroll" key={route + (param || '')}>{views[route] || views.dashboard}</main>
        </div>
      </div>
      {ask && <AskPanel onClose={() => setAsk(false)} />}
    </DataProvider>
  );
}
