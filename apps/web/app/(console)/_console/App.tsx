'use client';
/* VIN Demo console — app shell + routing (ported from web/app.jsx).
   Client-side view switching mirrors the prototype's hash router. */
import { useState, useEffect } from 'react';
import { Topbar, Sidebar, type Go } from './shell';
import { Dashboard, Products } from './views-core';
import { Knowledge, DemoGraphs, Environments, Personas } from './views-build';
import { Customers, Sessions, Safety, Evals, Costs, Settings } from './views-ops';
import { DataProvider } from './data-context';
import type { VDType } from './data';

export default function ConsoleApp({ data, operator }: { data: VDType; operator?: string }) {
  const [route, setRoute] = useState('dashboard');
  const [param, setParam] = useState<string | null>(null);

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
    customers: <Customers go={go} selected={param} />,
    sessions: <Sessions go={go} />,
    safety: <Safety go={go} />,
    evals: <Evals go={go} />,
    costs: <Costs go={go} />,
    settings: <Settings go={go} />,
  };

  const mtd = data.costBreakdown.reduce((a, c) => a + c.v, 0).toFixed(2);
  return (
    <DataProvider value={data}>
      <div className="app">
        <Topbar cost={mtd} workspace={data.workspace} operator={operator} />
        <div className="shell">
          <Sidebar route={route} go={go} />
          <main className="main scroll" key={route + (param || '')}>{views[route] || views.dashboard}</main>
        </div>
      </div>
    </DataProvider>
  );
}
