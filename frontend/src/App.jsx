import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import './App.css'

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5001/api' })
const pages = [
  ['submit', 'New report', '＋'], ['user', 'User dashboard', '▤'], ['handler', 'Handler dashboard', '◉'],
  ['routing', 'Routing management', '⌁'], ['analytics', 'Analytics', '▥'],
]
const nextStatus = { Pending: 'Assigned', Assigned: 'In Progress', 'In Progress': 'Resolved' }
const statuses = ['Pending', 'Assigned', 'In Progress', 'Resolved']
const categories = ['Medical', 'Safety', 'Technical', 'Crowd', 'Cleanliness']
const priorities = ['Critical', 'High', 'Medium', 'Low']

function apiMessage(error) {
  const data = error.response?.data
  return data?.error?.message || error.message || 'Unable to reach the API.'
}

function App() {
  const [page, setPage] = useState(location.hash.slice(1) || 'submit')
  const [reports, setReports] = useState([])
  const [handlers, setHandlers] = useState([])
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 })
  const [stats, setStats] = useState(null)
  const [apiHealth, setApiHealth] = useState('Checking API…')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [handlersLoading, setHandlersLoading] = useState(false)
  const [filter, setFilter] = useState({ status: '', category: '', priority: '' })

  const navigate = (id) => { setPage(id); window.history.pushState(null, '', `#${id}`) }
  const loadReports = useCallback(async (pageNum = 1) => {
    setLoading(true); setError('')
    try {
      const params = { page: pageNum, limit: 50 }
      Object.entries(filter).forEach(([key, value]) => { if (value) params[key] = value })
      const { data } = await api.get('/anomalies', { params })
      setReports(data.data); setPagination(data.pagination)
    } catch (e) { setError(apiMessage(e)) } finally { setLoading(false) }
  }, [filter])
  const loadStats = useCallback(async () => {
    try { const { data } = await api.get('/anomalies/stats'); setStats(data.data) }
    catch (e) { setError(apiMessage(e)) }
  }, [])
  const loadHandlers = useCallback(async () => {
    setHandlersLoading(true); setError('')
    try { const { data } = await api.get('/handlers'); setHandlers(data.data) }
    catch (e) { setError(apiMessage(e)) } finally { setHandlersLoading(false) }
  }, [])

  useEffect(() => { const onPopState = () => setPage(window.location.hash.slice(1) || 'submit'); addEventListener('popstate', onPopState); return () => removeEventListener('popstate', onPopState) }, [])
  useEffect(() => { api.get('/health', { validateStatus: () => true }).then(({ data }) => setApiHealth(data.data?.database === 'connected' ? 'API connected' : `Database ${data.data?.database || 'unavailable'}`)).catch(() => setApiHealth('API unavailable')) }, [])
  useEffect(() => {
    if (page === 'submit') return undefined
    const timer = setTimeout(() => { void loadReports() }, 0)
    return () => clearTimeout(timer)
  }, [page, loadReports])
  useEffect(() => {
    if (page !== 'analytics') return undefined
    const timer = setTimeout(() => { void loadStats() }, 0)
    return () => clearTimeout(timer)
  }, [page, loadStats])
  useEffect(() => {
    if (page !== 'routing') return undefined
    const timer = setTimeout(() => { void loadHandlers() }, 0)
    return () => clearTimeout(timer)
  }, [page, loadHandlers])

  const updateStatus = async (report) => {
    setError('')
    try { await api.patch(`/anomalies/${report._id}/status`, { status: nextStatus[report.status] }); await loadReports(pagination.page); if (page === 'analytics') loadStats() }
    catch (e) { setError(apiMessage(e)) }
  }
  const updateHandler = async (key, changes) => {
    setError('')
    try {
      const { data } = await api.patch(`/handlers/${key}`, changes)
      setHandlers(current => current.map(handler => handler.key === key ? data.data : handler))
      return true
    } catch (e) { setError(apiMessage(e)); return false }
  }
  const handleCreated = () => { loadReports(1); loadStats() }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#submit"><span className="brand-icon">M</span><span>Metro<span className="brand-light">Watch</span><small>ANOMALY RESPONSE</small></span></a>
      <div className="nav-label">WORKSPACE</div>
      <nav>{pages.map(([id, label, icon]) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => navigate(id)}><span className="nav-icon">{icon}</span>{label}{id === 'submit' && <span className="nav-dot"/>}</button>)}</nav>
      <div className="sidebar-bottom"><span className="live-dot"/>API connection<br/><small>{api.defaults.baseURL}</small></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumb">METRO OPERATIONS <span>/</span> <b>{pages.find(([id]) => id === page)?.[1]?.toUpperCase()}</b></div><div className="top-actions"><span className={`api-state ${apiHealth === 'API unavailable' || apiHealth.startsWith('Database') ? 'api-down' : ''}`}><i/> {apiHealth}</span><span className="avatar">MO</span></div></header>
      <div className="content">
        {error && <div className="alert" role="alert"><span>!</span>{error}<button onClick={() => setError('')} aria-label="Dismiss">×</button></div>}
        {page === 'submit' && <Submission onCreated={handleCreated} onView={() => navigate('user')} />}
        {page === 'user' && <ReportList title="User dashboard" eyebrow="REPORT TRACKER" intro="Follow submitted reports and their latest response status." reports={reports} loading={loading} pagination={pagination} reload={loadReports} statuses={false} onUpdate={updateStatus} filter={filter} setFilter={setFilter} />}
        {page === 'handler' && <ReportList title="Handler dashboard" eyebrow="RESPONSE QUEUE" intro="Review assigned work and move reports through the response workflow." reports={reports.filter(r => r.status !== 'Resolved')} loading={loading} pagination={pagination} reload={loadReports} statuses onUpdate={updateStatus} filter={filter} setFilter={setFilter} />}
        {page === 'routing' && <Routing reports={reports} loading={loading} handlers={handlers} handlersLoading={handlersLoading} pagination={pagination} reload={loadReports} reloadHandlers={loadHandlers} updateHandler={updateHandler} statuses onUpdate={updateStatus} filter={filter} setFilter={setFilter} />}
        {page === 'analytics' && <Analytics stats={stats} reports={reports} loading={loading} />}
      </div>
    </main>
  </div>
}

function Submission({ onCreated, onView }) {
  const [form, setForm] = useState({ stationCode: '', anomalyCode: '', description: '' })
  const [busy, setBusy] = useState(false); const [result, setResult] = useState(null); const [error, setError] = useState(null)
  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }))
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(null); setResult(null)
    try { const { data } = await api.post('/anomalies', { ...form, stationCode: form.stationCode.trim().toUpperCase(), anomalyCode: form.anomalyCode.trim().toUpperCase() }); setResult(data.data); onCreated() }
    catch (e) { setError(e.response?.data?.error || { message: e.message }) } finally { setBusy(false) }
  }
  return <>
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> FIELD OPERATIONS</div><h1>Report an anomaly</h1><p className="lede">Submit a station incident for classification and response routing.</p></div><div className="secure"><span>⌑</span> SECURE REPORTING</div></div>
    <div className="submission-grid">
      <section className="panel form-panel"><div className="panel-heading"><div><span className="step">01</span><h2>Incident details</h2></div><span className="required-note">* REQUIRED FIELDS</span></div>
        <form onSubmit={submit}>
          <div className="form-row"><label>Station code<span className="req">*</span><input required value={form.stationCode} maxLength="8" placeholder="e.g. STAAB123" onChange={e => set('stationCode', e.target.value.toUpperCase())}/><small>Format: STA + 2 letters + 3 digits</small></label>
          <label>Anomaly code<span className="req">*</span><select required value={form.anomalyCode} onChange={e => set('anomalyCode', e.target.value)}><option value="">Select anomaly type</option><option value="A01">A01 · Medical</option><option value="A02">A02 · Safety</option><option value="A03">A03 · Technical</option><option value="A04">A04 · Crowd</option><option value="A05">A05 · Cleanliness</option><option value="A06">A06 · Unmapped code</option></select><small>Category is assigned by the backend codebook</small></label></div>
          <label>Description<span className="req">*</span><textarea required minLength="5" maxLength="2000" rows="5" placeholder="Describe what happened, where it occurred, and any immediate risk…" value={form.description} onChange={e => set('description', e.target.value)}/><div className="field-foot"><small>Include relevant details to help responders act quickly.</small><small>{form.description.length} / 2000</small></div></label>
          {error && <div className="inline-error"><strong>{error.code || 'REQUEST_FAILED'}</strong><span>{error.message}</span>{error.details && <details><summary>Validation details</summary><pre>{JSON.stringify(error.details, null, 2)}</pre></details>}</div>}
          <div className="form-actions"><span><span className="lock">⌑</span> Your report is handled securely</span><button className="primary-btn" disabled={busy}>{busy ? 'Submitting…' : 'Submit report'} <span>↗</span></button></div>
        </form>
      </section>
      <aside className="side-column"><div className="routing-card"><div className="card-kicker">WHAT HAPPENS NEXT</div><h3>From report to response.</h3><div className="flow"><div><i>01</i><span><b>Validate</b><small>Codes checked by Regex & DFA</small></span></div><div><i>02</i><span><b>Classify</b><small>Category and priority assigned</small></span></div><div><i>03</i><span><b>Route</b><small>Matched to the right response team</small></span></div></div><div className="demo-note"><span>ⓘ</span> Routing destinations are configured demonstration values.</div></div><div className="help-card"><span className="help-icon">?</span><div><b>Need guidance?</b><p>Use the station and anomaly code format provided by your operations team.</p></div></div></aside>
    </div>
    {result && <div className="modal-backdrop"><section className="success-card"><div className="success-check">✓</div><div className="eyebrow">REPORT RECEIVED</div><h2>Report submitted</h2><p>Your report is now in the response system.</p><div className="report-id"><small>GENERATED REPORT ID</small><code>{result._id}</code></div><div className="result-grid"><Result label="Category" value={result.category}/><Result label="Priority" value={result.priority}/><Result label="Status" value={result.status}/><Result label="Handler assignment" value={result.destination}/></div><button className="primary-btn full" onClick={() => { setResult(null); onView() }}>View report tracker <span>→</span></button><button className="text-btn" onClick={() => { setResult(null); setForm({ stationCode: '', anomalyCode: '', description: '' }) }}>Submit another report</button></section></div>}
  </>
}

function Result({ label, value }) { return <div className="result-item"><small>{label}</small><b>{value || '—'}</b></div> }

function ReportList({ title, eyebrow, intro, reports, loading, pagination, reload, statuses: canUpdate, onUpdate, filter, setFilter }) {
  return <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> {eyebrow}</div><h1>{title}</h1><p className="lede">{intro}</p></div><button className="outline-btn" onClick={() => reload(pagination.page)}>↻ Refresh</button></div>
    <FilterBar filter={filter} setFilter={setFilter}/><ReportsTable reports={reports} loading={loading} canUpdate={canUpdate} onUpdate={onUpdate}/><Pagination pagination={pagination} reload={reload}/></>
}

function FilterBar({ filter, setFilter }) { return <div className="filterbar"><span>FILTER REPORTS</span>{[['status', statuses], ['category', categories], ['priority', priorities]].map(([key, items]) => <select key={key} value={filter[key]} onChange={e => setFilter(f => ({ ...f, [key]: e.target.value }))}><option value="">All {key}</option>{items.map(i => <option key={i}>{i}</option>)}</select>)}<button className="outline-btn" onClick={() => setFilter({ status: '', category: '', priority: '' })}>Clear</button></div> }

function ReportsTable({ reports, loading, canUpdate, onUpdate }) { return <div className="panel table-panel"><div className="table-title"><div><span className="eyebrow">LIVE FROM DATABASE</span><h2>Recent reports</h2></div><span className="record-count">{reports.length} RECORDS</span></div>{loading ? <div className="empty-state">Loading reports…</div> : reports.length === 0 ? <div className="empty-state">No reports match this view.</div> : <div className="table-wrap"><table><thead><tr><th>REPORT</th><th>STATION / TYPE</th><th>CLASSIFICATION</th><th>ASSIGNED TO</th><th>STATUS</th>{canUpdate && <th>ACTION</th>}</tr></thead><tbody>{reports.map(r => <tr key={r._id}><td><code className="id-code">{r._id}</code><small>{new Date(r.createdAt).toLocaleString()}</small></td><td><b>{r.stationCode}</b><small>{r.anomalyCode} · {r.description}</small></td><td><b>{r.category}</b><small><Priority value={r.priority}/></small></td><td>{r.destination || '—'}<small>{r.corridor}</small></td><td><Status value={r.status}/></td>{canUpdate && <td>{nextStatus[r.status] ? <button className="mini-btn" onClick={() => onUpdate(r)}>Mark {nextStatus[r.status]}</button> : '—'}</td>}</tr>)}</tbody></table></div>}</div> }

function Status({ value }) { return <span className={`status status-${value.toLowerCase().replaceAll(' ', '-')}`}><i/>{value}</span> }
function Priority({ value }) { return <span className={`priority priority-${value.toLowerCase()}`}>{value}</span> }
function Pagination({ pagination, reload }) { return <div className="pagination"><span>{pagination.total || 0} total reports · page {pagination.page || 1} of {Math.max(1, pagination.pages || 1)}</span><div><button disabled={(pagination.page || 1) <= 1} onClick={() => reload(pagination.page - 1)}>← Previous</button><button disabled={(pagination.page || 1) >= (pagination.pages || 1)} onClick={() => reload(pagination.page + 1)}>Next →</button></div></div> }

function Routing({ reports, loading, handlers, handlersLoading, pagination, reload, reloadHandlers, updateHandler, statuses: canUpdate, onUpdate, filter, setFilter }) { return <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> CONTROL ROOM OPERATIONS</div><h1>Routing management</h1><p className="lede">Manage availability and capacity for configured demonstration handlers.</p></div><button className="outline-btn" onClick={() => { reload(pagination.page); reloadHandlers() }}>↻ Refresh</button></div><div className="route-summary">{handlersLoading ? <div className="panel empty-state">Loading handlers…</div> : handlers.map(handler => <HandlerCard key={handler.key} handler={handler} onUpdate={updateHandler}/>)}</div><FilterBar filter={filter} setFilter={setFilter}/><ReportsTable reports={reports} loading={loading} canUpdate={canUpdate} onUpdate={onUpdate}/><Pagination pagination={pagination} reload={reload}/></> }

function HandlerCard({ handler, onUpdate }) {
  const [capacity, setCapacity] = useState(String(handler.maxCapacity))
  const [saving, setSaving] = useState(false)
  const active = handler.activeReportCount || 0
  const ratio = handler.maxCapacity > 0 ? Math.min(100, active / handler.maxCapacity * 100) : (active ? 100 : 0)
  const saveCapacity = async (event) => {
    event.preventDefault(); setSaving(true)
    const saved = await onUpdate(handler.key, { maxCapacity: Number(capacity) })
    if (!saved) setCapacity(String(handler.maxCapacity))
    setSaving(false)
  }
  return <section className="route-card handler-card">
    <div className="route-top"><span className="route-symbol">⌁</span><span className={`route-online ${handler.available ? '' : 'route-offline'}`}><i/>{handler.available ? 'AVAILABLE' : 'UNAVAILABLE'}</span></div>
    <h3>{handler.destination}</h3><small>CONFIGURED HANDLER · {handler.key}</small>
    <div className="workload-row"><span>Active assignments</span><b>{active} / {handler.maxCapacity}</b></div>
    <div className="workload-track"><i style={{ width: `${ratio}%` }}/></div>
    <div className="handler-controls">
      <button className="mini-btn" onClick={() => onUpdate(handler.key, { available: !handler.available })}>{handler.available ? 'Set unavailable' : 'Set available'}</button>
      <form onSubmit={saveCapacity}><label htmlFor={`capacity-${handler.key}`}>Max capacity</label><input id={`capacity-${handler.key}`} type="number" min="0" step="1" required value={capacity} onChange={e => setCapacity(e.target.value)}/><button className="mini-btn" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></form>
    </div>
    {active > 0 && <details className="active-ids"><summary>View active report IDs</summary><ul>{(handler.activeReportIds || []).map(id => <li key={id}><code>{id}</code></li>)}</ul></details>}
  </section>
}

function Analytics({ stats, reports, loading }) { const category = Object.entries(stats?.byCategory || {}); const max = Math.max(1, ...category.map(([, n]) => n)); return <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> OPERATIONAL OVERVIEW</div><h1>Analytics</h1><p className="lede">Live aggregates calculated from MongoDB report records.</p></div><span className="db-badge"><i/> DATABASE AGGREGATES</span></div>{!stats ? <div className="panel empty-state">{loading ? 'Loading analytics…' : 'Analytics are unavailable. Check the API connection.'}</div> : <><div className="stat-grid"><StatCard label="Total reports" value={stats.total} note="All time · database count" icon="▤"/><StatCard label="Pending response" value={stats.byStatus?.Pending || 0} note="Awaiting handler assignment" icon="◷"/><StatCard label="In progress" value={stats.byStatus?.['In Progress'] || 0} note="Currently being handled" icon="◉"/><StatCard label="Resolved" value={stats.byStatus?.Resolved || 0} note="Response workflow complete" icon="✓"/></div><div className="analytics-grid"><section className="panel chart-panel"><div className="table-title"><div><span className="eyebrow">DATABASE AGGREGATE</span><h2>Reports by category</h2></div><span className="record-count">{stats.total} TOTAL</span></div>{category.length ? category.map(([name, value]) => <div className="bar-row" key={name}><div><span>{name}</span><b>{value}</b></div><div className="bar-track"><i style={{ width: `${value / max * 100}%` }}/></div></div>) : <div className="empty-state">No category data yet.</div>}</section><section className="panel breakdown"><span className="eyebrow">DISTRIBUTION</span><h2>By priority</h2>{priorities.map(p => <div className="break-row" key={p}><Priority value={p}/><b>{stats.byPriority?.[p] || 0}</b></div>)}<div className="section-divider"/><span className="eyebrow">WORKFLOW</span><h2>By status</h2>{statuses.map(s => <div className="break-row" key={s}><Status value={s}/><b>{stats.byStatus?.[s] || 0}</b></div>)}</section></div><ReportsTable reports={reports} loading={loading} canUpdate={false}/></>}</> }
function StatCard({ label, value, note, icon }) { return <div className="stat-card"><div className="stat-icon">{icon}</div><span>{label}</span><strong>{value}</strong><small>{note}</small></div> }

export default App
