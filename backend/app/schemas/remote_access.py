from pydantic import BaseModel, Field


class WinboxSessionResponse(BaseModel):
    tunnel_id: str
    host: str = "127.0.0.1"
    port: int
    winbox_uri: str
    idle_timeout_seconds: int = 300


class SSHSessionRequest(BaseModel):
    cols: int = Field(default=80, gt=0, le=500)
    rows: int = Field(default=24, gt=0, le=200)


class SSHSessionResponse(BaseModel):
    token: str
    websocket_url: str
    idle_timeout_seconds: int = 900


class TunnelStatusItem(BaseModel):
    tunnel_id: str
    local_port: int
    active_conns: int
    idle_seconds: int
    created_at: str


class SSHSessionStatusItem(BaseModel):
    session_id: str
    idle_seconds: int
    created_at: str


class ActiveSessionsResponse(BaseModel):
    winbox_tunnels: list[TunnelStatusItem] = []
    ssh_sessions: list[SSHSessionStatusItem] = []
