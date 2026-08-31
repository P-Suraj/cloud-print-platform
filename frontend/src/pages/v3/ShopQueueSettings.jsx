import React, { useEffect, useState } from 'react';
import { v3Api } from '../../services/v3Api';
import './shopConsole.css';

const DEFAULTS = {
  bw: { lane_type: 'bw', ppm_simplex: 20, ppm_duplex: 10, job_setup_overhead_sec: 15, physical_device_key: 'shared-default', enabled: true },
  colour: { lane_type: 'colour', ppm_simplex: 10, ppm_duplex: 5, job_setup_overhead_sec: 20, physical_device_key: 'shared-default', enabled: true },
};

export default function ShopQueueSettings() {
  const [lanes, setLanes] = useState(DEFAULTS);
  const [backlogs, setBacklogs] = useState({ bw: 0, colour: 0 });
  const [state, setState] = useState({ loading: true, saving: '', error: '' });
  const csrf = sessionStorage.getItem('v3_csrf') || '';

  const load = async () => {
    setState({ loading: true, saving: '', error: '' });
    try {
      const data = await v3Api.getShopQueueSettings();
      const next = { ...DEFAULTS };
      (data.lanes || []).forEach((lane) => { next[lane.lane_type] = { ...next[lane.lane_type], ...lane }; });
      const active = { bw: 0, colour: 0 };
      (data.active_backlogs || []).forEach((backlog) => { active[backlog.lane_type] = backlog.backlog_minutes; });
      setLanes(next); setBacklogs(active); setState({ loading: false, saving: '', error: '' });
    } catch (error) {
      setState({ loading: false, saving: '', error: error.message });
    }
  };

  useEffect(() => { load(); }, []);

  const saveLane = async (laneType) => {
    setState((value) => ({ ...value, saving: laneType, error: '' }));
    try {
      const lane = lanes[laneType];
      await v3Api.updateShopPrinterLane(csrf, {
        lane_type: laneType, ppm_simplex: Number(lane.ppm_simplex), ppm_duplex: Number(lane.ppm_duplex),
        job_setup_overhead_sec: Number(lane.job_setup_overhead_sec), physical_device_key: lane.physical_device_key,
        device_id: lane.device_id || null, enabled: Boolean(lane.enabled),
      });
      await load();
    } catch (error) { setState((value) => ({ ...value, saving: '', error: error.message })); }
  };

  const saveBacklog = async (laneType, minutes) => {
    setState((value) => ({ ...value, saving: `backlog-${laneType}`, error: '' }));
    try {
      await v3Api.updateShopWalkinBacklog(csrf, { lane_type: laneType, backlog_minutes: minutes, duration_minutes: 60 });
      await load();
    } catch (error) { setState((value) => ({ ...value, saving: '', error: error.message })); }
  };

  if (state.loading) return <div className="v3-shop-container"><p>Loading queue settings…</p></div>;
  if (state.error && state.error.includes('not available')) return <div className="v3-shop-container"><h2>Queue settings</h2><p>Queue estimates are not enabled for this shop yet.</p><p className="v3-job-context">They remain hidden until printer telemetry and accuracy checks are approved.</p></div>;

  return <div className="v3-shop-container">
    <h2>Queue settings</h2>
    <p className="v3-job-context">Readiness ranges use fresh printer heartbeats and real workload. They are estimates, never guarantees.</p>
    {state.error && <div style={{ padding: 12, background: '#fee2e2', color: '#991b1b' }}>{state.error}</div>}
    {['bw', 'colour'].map((type) => {
      const lane = lanes[type];
      return <section className="v3-policy-card" key={type}>
        <div><h3>{type === 'bw' ? 'Black & white lane' : 'Colour lane'}</h3><p>Use the same physical printer key when both modes share one device.</p></div>
        <label>Simplex pages/min<input type="number" min="1" value={lane.ppm_simplex} onChange={(e) => setLanes({ ...lanes, [type]: { ...lane, ppm_simplex: e.target.value } })} /></label>
        <label>Duplex pages/min<input type="number" min="1" value={lane.ppm_duplex} onChange={(e) => setLanes({ ...lanes, [type]: { ...lane, ppm_duplex: e.target.value } })} /></label>
        <label>Setup seconds<input type="number" min="0" value={lane.job_setup_overhead_sec} onChange={(e) => setLanes({ ...lanes, [type]: { ...lane, job_setup_overhead_sec: e.target.value } })} /></label>
        <label>Physical printer key<input value={lane.physical_device_key} onChange={(e) => setLanes({ ...lanes, [type]: { ...lane, physical_device_key: e.target.value } })} /></label>
        <label><input type="checkbox" checked={lane.enabled} onChange={(e) => setLanes({ ...lanes, [type]: { ...lane, enabled: e.target.checked } })} /> Enable this lane</label>
        <button className="v3-btn-action v3-btn-approve" disabled={state.saving === type} onClick={() => saveLane(type)}>Save lane</button>
        <div><strong>Walk-in backlog:</strong> {[0, 5, 10, 20, 30].map((minutes) => <button className="v3-btn-action" disabled={state.saving === `backlog-${type}`} key={minutes} onClick={() => saveBacklog(type, minutes)}>{minutes} min</button>)} <span>{backlogs[type]} min active</span></div>
      </section>;
    })}
  </div>;
}
