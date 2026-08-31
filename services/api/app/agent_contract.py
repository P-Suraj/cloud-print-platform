from pydantic import BaseModel
from typing import Optional, Dict, Any, Literal

class AgentHeartbeatRequest(BaseModel):
    agent_version: str
    printer_status_bw: str
    printer_status_color: str

class AgentClaimRequest(BaseModel):
    lease_seconds: Optional[int] = 300

class AgentRenewRequest(BaseModel):
    job_id: str
    fencing_token: str
    lease_seconds: Optional[int] = 300

class AgentAdvanceRequest(BaseModel):
    job_id: str
    fencing_token: str
    expected_status: str
    new_status: str
    evidence_json: Optional[Dict[str, Any]] = {}

class AgentOutcomeRequest(BaseModel):
    job_id: str
    fencing_token: str
    outcome_status: Literal["completed", "failed", "needs_attention"]
    completion_source: Optional[Literal[
        "operator_confirmed", "spooler_presumed", "device_telemetry_confirmed"
    ]] = None
    evidence_json: Optional[Dict[str, Any]] = {}
