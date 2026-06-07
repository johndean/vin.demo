/* demo.vin — mock target product the consultant drives on stage (always light, own identity) */

function DemoApp({ screen }) {
  return (
    <div className="pa">
      <div className="pa__top">
        <div className="pa__logo"><span className="mk">DV</span> demo.vin</div>
        <nav className="pa__nav">
          <a className={["dashboard"].includes(screen) ? "on" : ""}>Dashboard</a>
          <a className={["approvals", "settings", "delegation", "newdelegation"].includes(screen) ? "on" : ""}>Approvals</a>
          <a>Requests</a>
          <a>Vendors</a>
          <a className={screen === "audit" ? "on" : ""}>Audit</a>
        </nav>
        <div className="pa__right"><span style={{ fontSize: 12, color: "#76859a" }}>Demo Tenant</span><span className="pa__ava">DT</span></div>
      </div>
      <div className="pa__body">{render(screen)}</div>
    </div>
  );
}

function render(screen) {
  switch (screen) {
    case "approvals": return <DemoApprovals />;
    case "settings": return <DemoSettings />;
    case "delegation": return <DemoDelegation />;
    case "newdelegation": return <DemoNewDelegation />;
    case "audit": return <DemoAudit />;
    default: return <DemoDashboard />;
  }
}

function DemoDashboard() {
  return (
    <>
      <h2 className="pa__h">Dashboard</h2>
      <p className="pa__sub">Demo tenant · 240 requests · 18 approvers</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 18 }}>
        {[["Pending approval", "12", "#9a6b1a"], ["Approved today", "34", "#1f7a52"], ["Avg. cycle time", "1.8d", "#283e5b"]].map(([l, v, c]) => (
          <div key={l} className="pa-card" style={{ padding: "14px 16px" }}><div style={{ fontSize: 11, fontWeight: 700, color: "#94a2b5", textTransform: "uppercase", letterSpacing: ".04em" }}>{l}</div><div style={{ fontSize: 26, fontWeight: 800, color: c, marginTop: 4 }}>{v}</div></div>
        ))}
      </div>
      <div className="pa-card">
        <div className="pa-row" style={{ background: "#fafbfd" }}><span className="pa-th" style={{ flex: 2 }}>Request</span><span className="pa-th" style={{ flex: 1 }}>Requester</span><span className="pa-th" style={{ flex: 1 }}>Amount</span><span className="pa-th" style={{ flex: 1 }}>Status</span></div>
        {[["REQ-4821", "Supply restock", "K. Alvarez", "$3,240", "pending"], ["REQ-4820", "Equipment", "M. Singh", "$11,500", "pending"], ["REQ-4818", "Software seats", "T. Okafor", "$2,100", "approved"]].map((r) => (
          <div key={r[0]} className="pa-row"><span style={{ flex: 2 }}><b style={{ color: "#283e5b" }}>{r[0]}</b> <span style={{ color: "#76859a" }}>· {r[1]}</span></span><span style={{ flex: 1, color: "#5a6b80" }}>{r[2]}</span><span style={{ flex: 1, fontWeight: 700, color: "#283e5b" }}>{r[3]}</span><span style={{ flex: 1 }}><span className={`pa-badge ${r[4]}`}>{r[4]}</span></span></div>
        ))}
      </div>
    </>
  );
}

function DemoApprovals() {
  return (
    <>
      <h2 className="pa__h">Approvals</h2>
      <p className="pa__sub">Queue · routing rules · delegation</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className="pa-btn ghost">Queue</button>
        <button className="pa-btn ghost" data-pa="settings-tab">Routing rules</button>
        <button className="pa-btn primary" data-pa="delegation-tab">Delegation</button>
      </div>
      <div className="pa-card">
        <div className="pa-row" style={{ background: "#fafbfd" }}><span className="pa-th" style={{ flex: 2 }}>Awaiting approval</span><span className="pa-th" style={{ flex: 1 }}>Approver</span><span className="pa-th" style={{ flex: 1 }}>Tier</span></div>
        {[["REQ-4821 · Supply restock", "S. Albright (Owner)", "Tier 2"], ["REQ-4820 · Equipment", "R. Vance (Exec)", "Tier 3"], ["REQ-4817 · Maintenance", "P. Raman (Mgr)", "Tier 1"]].map((r) => (
          <div key={r[0]} className="pa-row"><span style={{ flex: 2, color: "#283e5b", fontWeight: 600 }}>{r[0]}</span><span style={{ flex: 1, color: "#5a6b80" }}>{r[1]}</span><span style={{ flex: 1, color: "#5a6b80" }}>{r[2]}</span></div>
        ))}
      </div>
    </>
  );
}

function DemoSettings() {
  return (
    <>
      <h2 className="pa__h">Approval settings</h2>
      <p className="pa__sub">Routing rules &amp; thresholds</p>
      <div className="pa-card" style={{ padding: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {[["Tier 1 — up to $1,000", "Manager"], ["Tier 2 — up to $10,000", "Owner / delegate"], ["Tier 3 — above $10,000", "Executive + Owner"]].map((r) => (
            <div key={r[0]} className="pa-field" style={{ borderBottom: "1px solid #eef2f7", paddingBottom: 14 }}><label>{r[0]}</label><div style={{ display: "flex", alignItems: "center", gap: 10 }}><div className="pa-input" style={{ flex: 1 }}>{r[1]}</div></div></div>
          ))}
          <div data-pa="delegation-link" style={{ display: "flex", alignItems: "center", gap: 10, color: "#0861CE", fontWeight: 700, fontSize: 13 }}>Configure delegation rules →</div>
        </div>
      </div>
    </>
  );
}

function DemoDelegation() {
  return (
    <>
      <h2 className="pa__h">Delegation rules</h2>
      <p className="pa__sub">Temporarily reassign approval authority — thresholds and audit are preserved</p>
      <div className="pa-card" style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <div className="pa-field" data-pa="delegate-from"><label>Delegating approver</label><div className="pa-input">S. Albright — Owner</div></div>
          <div className="pa-field" data-pa="delegate-to"><label>Delegate to</label><div className="pa-input" style={{ borderColor: "#0861CE" }}>R. Vance — Executive</div></div>
          <div className="pa-field"><label>Window</label><div className="pa-input">Jun 9 – Jun 16, 2026</div></div>
          <div className="pa-field"><label>Threshold inherited</label><div className="pa-input">Tier 2 — up to $10,000</div></div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18, paddingTop: 16, borderTop: "1px solid #eef2f7" }} data-pa="audit-toggle">
          <div className="pa-toggle on" /><span style={{ fontSize: 13, color: "#283e5b", fontWeight: 600 }}>Log every delegated approval to the audit trail</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button className="pa-btn primary" data-pa="submit-delegation">Submit delegation</button>
        <button className="pa-btn ghost">Cancel</button>
      </div>
    </>
  );
}

function DemoNewDelegation() {
  return (
    <>
      <h2 className="pa__h">New delegation</h2>
      <p className="pa__sub">Out-of-office auto-delegation</p>
      <div className="pa-card" style={{ padding: 18 }}>
        <div className="pa-field" style={{ marginBottom: 16 }}><label>Trigger</label><div className="pa-input">When approver sets status to Out-of-Office</div></div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}><div className="pa-toggle on" /><span style={{ fontSize: 13, color: "#283e5b", fontWeight: 600 }}>Auto-route pending approvals to the named delegate</span></div>
      </div>
    </>
  );
}

function DemoAudit() {
  return (
    <>
      <h2 className="pa__h">Audit trail</h2>
      <p className="pa__sub">Every approval &amp; delegation event — immutable log</p>
      <div className="pa-card">
        <div className="pa-row" style={{ background: "#fafbfd" }}><span className="pa-th" style={{ flex: 1 }}>Time</span><span className="pa-th" style={{ flex: 2 }}>Event</span><span className="pa-th" style={{ flex: 1 }}>Actor</span></div>
        {[["09:41", "Delegation created · Owner → Executive", "S. Albright"], ["09:38", "REQ-4818 approved (delegated)", "R. Vance (for S. Albright)"], ["08:12", "Threshold rule updated · Tier 2", "Admin"]].map((r) => (
          <div key={r[0]} className="pa-row"><span style={{ flex: 1, color: "#76859a", fontFamily: "monospace", fontSize: 12 }}>{r[0]}</span><span style={{ flex: 2, color: "#283e5b" }}>{r[1]}</span><span style={{ flex: 1, color: "#5a6b80" }}>{r[2]}</span></div>
        ))}
      </div>
    </>
  );
}

Object.assign(window, { DemoApp });
