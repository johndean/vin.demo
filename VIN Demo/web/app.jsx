/* VIN Demo console — app shell, routing, theme persistence */

function App() {
  const [route, setRoute] = useState(() => location.hash.replace("#", "") || "dashboard");
  const [param, setParam] = useState(null);

  // Console is light-only by design.
  useEffect(() => { document.documentElement.setAttribute("data-theme", "light"); localStorage.removeItem("vd-theme"); }, []);
  useEffect(() => { document.querySelector(".main")?.scrollTo(0, 0); }, [route, param]);
  useEffect(() => { const b = document.getElementById("boot"); if (b) { b.style.opacity = "0"; b.style.pointerEvents = "none"; setTimeout(() => { b.style.display = "none"; }, 320); } }, []);

  const go = (r, p = null) => { setRoute(r); setParam(p); location.hash = r; };

  const views = {
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

  return (
    <div className="app">
      <Topbar cost="84.10" />
      <div className="shell">
        <Sidebar route={route} go={go} />
        <main className="main scroll" key={route + (param || "")}>{views[route] || views.dashboard}</main>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
