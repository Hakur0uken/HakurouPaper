//! Authenticated, loopback-only local requests forwarded to the live editor.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::{HashMap, VecDeque}, fs::OpenOptions, io::{self, BufRead, BufReader, Read, Write}, net::{TcpListener, TcpStream}, path::{Path, PathBuf}, sync::{atomic::{AtomicUsize, Ordering}, mpsc, Arc, Mutex}, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::{Emitter, Manager, State};

const LIMIT: u64 = 16 * 1024 * 1024;
const WAIT: Duration = Duration::from_secs(30);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Request { id: String, expires_at: u64, request: Value }
#[derive(Default)]
struct Pending { queue: VecDeque<Request>, replies: HashMap<String, mpsc::Sender<Value>> }
#[derive(Default)]
pub(crate) struct AgentState(Mutex<Pending>);
#[derive(Deserialize)]
struct Wire { token: String, request: Value }
fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }

#[tauri::command]
pub(crate) fn take_agent_requests(state: State<'_, AgentState>) -> Vec<Request> {
    let mut pending = state.0.lock().unwrap_or_else(|error| error.into_inner());
    let requests: Vec<_> = pending.queue.drain(..).collect();
    requests.into_iter().filter(|request| request.expires_at > now() && pending.replies.contains_key(&request.id)).collect()
}

#[tauri::command]
pub(crate) fn answer_agent_request(state: State<'_, AgentState>, id: String, response: Value) -> Result<(), String> {
    let sender = state.0.lock().map_err(|_| "request state unavailable")?.replies.remove(&id);
    sender.ok_or("request expired")?.send(response).map_err(|_| "request ended".to_string())
}

fn read_wire(stream: &TcpStream, token: &str) -> io::Result<Value> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    let mut line = String::new();
    let read = BufReader::new(stream.take(LIMIT + 1)).read_line(&mut line)?;
    if read as u64 > LIMIT || !line.ends_with('\n') { return Err(io::Error::other("request too large or incomplete")); }
    let wire: Wire = serde_json::from_str(&line).map_err(|_| io::Error::other("invalid request"))?;
    if wire.token.len() != token.len() || !wire.token.bytes().zip(token.bytes()).fold(0u8, |difference, (a, b)| difference | (a ^ b)).eq(&0) {
        return Err(io::Error::new(io::ErrorKind::PermissionDenied, "invalid local token"));
    }
    if !matches!(wire.request["action"].as_str(), Some("docs" | "get" | "replace" | "apply" | "save")) { return Err(io::Error::other("unknown action")); }
    Ok(wire.request)
}

fn connection_file(path: &Path, port: u16, token: &str) -> io::Result<()> {
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent)?; }
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut options = OpenOptions::new(); options.write(true).create_new(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    let result = (|| {
        let mut file = options.open(&temporary)?;
        file.write_all(json!({"version":1,"port":port,"token":token,"pid":std::process::id()}).to_string().as_bytes())?;
        file.sync_all()?; drop(file);
        std::fs::rename(&temporary, path)
    })();
    if result.is_err() { let _ = std::fs::remove_file(&temporary); }
    result
}

fn serve(mut stream: TcpStream, token: &str, app: &tauri::AppHandle) -> io::Result<()> {
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let response = match read_wire(&stream, token) {
        Err(error) => json!({"error":error.to_string()}),
        Ok(request) => {
            let id = uuid::Uuid::new_v4().to_string();
            let (sender, receiver) = mpsc::channel();
            let state = app.state::<AgentState>();
            {
                let mut pending = state.0.lock().unwrap_or_else(|error| error.into_inner());
                pending.replies.insert(id.clone(), sender);
                pending.queue.push_back(Request { id: id.clone(), expires_at: now() + WAIT.as_millis() as u64, request });
            }
            let _ = app.emit("agent-requested", ());
            let response = receiver.recv_timeout(WAIT).unwrap_or_else(|_| json!({"error":"request timed out; read the document again before retrying an edit"}));
            let mut pending = state.0.lock().unwrap_or_else(|error| error.into_inner());
            pending.replies.remove(&id);
            pending.queue.retain(|request| request.id != id);
            response
        }
    };
    serde_json::to_writer(&mut stream, &response)?;
    stream.write_all(b"\n")
}

pub(crate) fn start(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let token = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    let path = app.path().app_local_data_dir()?.join("agent-connection.json");
    connection_file(&path, listener.local_addr()?.port(), &token)?;
    let app = app.clone();
    let connections = Arc::new(AtomicUsize::new(0));
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            if connections.fetch_add(1, Ordering::SeqCst) >= 8 { connections.fetch_sub(1, Ordering::SeqCst); continue; }
            let (app, token, connections) = (app.clone(), token.clone(), connections.clone());
            std::thread::spawn(move || { let _ = serve(stream, &token, &app); connections.fetch_sub(1, Ordering::SeqCst); });
        }
    });
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Shutdown;
    fn wire(bytes: &str) -> io::Result<Value> {
        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        let mut client = TcpStream::connect(listener.local_addr()?)?;
        client.write_all(bytes.as_bytes())?; client.shutdown(Shutdown::Write)?;
        let (server, _) = listener.accept()?;
        read_wire(&server, "test-secret")
    }
    #[test]
    fn local_protocol_checks_authentication_and_limits_the_available_actions() {
        assert!(wire("{\"token\":\"wrong\",\"request\":{\"action\":\"docs\"}}\n").is_err());
        assert!(wire("{\"token\":\"test-secret\",\"request\":{\"action\":\"exec\"}}\n").is_err());
        assert_eq!(wire("{\"token\":\"test-secret\",\"request\":{\"action\":\"get\",\"document\":\"中文\"}}\n").unwrap()["document"], "中文");
        assert!(wire("GET / HTTP/1.1\r\n").is_err());
    }
}
