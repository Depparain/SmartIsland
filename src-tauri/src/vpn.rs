use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use url::Url;

#[cfg(windows)]
use winreg::enums::*;
#[cfg(windows)]
use winreg::RegKey;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VpnStateResponse {
    pub connected: bool,
    pub mode: String,
    pub uri_key: String,
}

pub struct VpnManager {
    pub child_process: Mutex<Option<Child>>,
    pub is_connected: Mutex<bool>,
    pub saved_uri: Mutex<String>,
    pub current_mode: Mutex<String>,
    #[cfg(windows)]
    pub job_object: Mutex<Option<isize>>,
}

impl VpnManager {
    pub fn new() -> Self {
        #[cfg(windows)]
        let job = unsafe {
            use windows::Win32::System::JobObjects::*;
            if let Ok(handle) = CreateJobObjectW(None, None) {
                let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let _ = SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const std::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                Some(handle.0 as isize)
            } else {
                None
            }
        };

        Self {
            child_process: Mutex::new(None),
            is_connected: Mutex::new(false),
            saved_uri: Mutex::new(String::new()),
            current_mode: Mutex::new("system-proxy".to_string()),
            #[cfg(windows)]
            job_object: Mutex::new(job),
        }
    }
}

/// Notify WinINet that system proxy configuration has changed
#[cfg(windows)]
pub fn notify_wininet_proxy_change() {
    unsafe {
        use windows::Win32::Networking::WinInet::{
            InternetSetOptionW, INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED,
        };
        let _ = InternetSetOptionW(None, INTERNET_OPTION_SETTINGS_CHANGED, None, 0);
        let _ = InternetSetOptionW(None, INTERNET_OPTION_REFRESH, None, 0);
    }
}

#[cfg(not(windows))]
pub fn notify_wininet_proxy_change() {}

/// Configure Windows registry system proxy and notify WinINet
pub fn set_system_proxy(enable: bool, host_port: &str) {
    #[cfg(windows)]
    {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok((key, _)) = hkcu.create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings") {
            let enable_val: u32 = if enable { 1 } else { 0 };
            let _ = key.set_value("ProxyEnable", &enable_val);
            if enable {
                let _ = key.set_value("ProxyServer", &host_port);
                let _ = key.set_value("ProxyOverride", &"<local>");
            }
        }
        notify_wininet_proxy_change();
    }
}

fn decode_base64_flexible(s: &str) -> Result<String, String> {
    use base64::prelude::*;
    let mut clean = s.trim().replace('-', "+").replace('_', "/");
    while clean.len() % 4 != 0 {
        clean.push('=');
    }
    let bytes = BASE64_STANDARD.decode(&clean).map_err(|e| format!("Base64 decode error: {}", e))?;
    String::from_utf8(bytes).map_err(|e| format!("UTF-8 decode error: {}", e))
}

/// Parse generic proxy link (vless://, vmess://, ss://, trojan://, tuic://, hy2://)
/// into a sing-box valid outbound JSON object.
pub fn parse_proxy_outbound(raw_uri: &str) -> Result<serde_json::Value, String> {
    let uri = raw_uri.trim();

    // 1. Raw JSON config check
    if uri.starts_with('{') && uri.ends_with('}') {
        let val: serde_json::Value = serde_json::from_str(uri)
            .map_err(|e| format!("Invalid JSON proxy config: {}", e))?;
        if val.get("type").is_some() {
            return Ok(val);
        }
    }

    // 2. VMESS (vmess://<base64-json>)
    if uri.starts_with("vmess://") {
        let b64 = &uri[8..];
        let json_str = decode_base64_flexible(b64)?;
        let v: serde_json::Value = serde_json::from_str(&json_str)
            .map_err(|e| format!("Invalid VMess JSON: {}", e))?;

        let tag = v.get("ps").and_then(|s| s.as_str()).unwrap_or("proxy");
        let server = v.get("add").and_then(|s| s.as_str()).ok_or("VMess missing 'add'")?;
        let port: u16 = match v.get("port") {
            Some(serde_json::Value::Number(n)) => n.as_u64().unwrap_or(443) as u16,
            Some(serde_json::Value::String(s)) => s.parse().unwrap_or(443),
            _ => 443,
        };
        let uuid = v.get("id").and_then(|s| s.as_str()).ok_or("VMess missing 'id'")?;
        let alter_id = v.get("aid").and_then(|s| s.as_u64()).unwrap_or(0);
        let net = v.get("net").and_then(|s| s.as_str()).unwrap_or("tcp");
        let tls_enabled = v.get("tls").and_then(|s| s.as_str()).map_or(false, |s| s == "tls");
        let sni = v.get("sni").and_then(|s| s.as_str()).or_else(|| v.get("host").and_then(|s| s.as_str()));

        let mut outbound = serde_json::json!({
            "type": "vmess",
            "tag": tag,
            "server": server,
            "server_port": port,
            "uuid": uuid,
            "security": "auto",
            "alter_id": alter_id
        });

        if tls_enabled {
            outbound["tls"] = serde_json::json!({
                "enabled": true,
                "server_name": sni.unwrap_or(server),
                "utls": {
                    "enabled": true,
                    "fingerprint": "chrome"
                }
            });
        }

        if net == "ws" {
            let path = v.get("path").and_then(|s| s.as_str()).unwrap_or("/");
            let host_hdr = v.get("host").and_then(|s| s.as_str()).unwrap_or("");
            let mut ws_val = serde_json::json!({
                "type": "ws",
                "path": path
            });
            if !host_hdr.is_empty() {
                ws_val["headers"] = serde_json::json!({ "Host": host_hdr });
            }
            outbound["transport"] = ws_val;
        }

        return Ok(outbound);
    }

    // 3. VLESS / TROJAN / SHADOWSOCKS / HYSTERIA2 / TUIC via URL parser
    let parsed_url = Url::parse(uri).map_err(|e| format!("Invalid URL syntax: {}", e))?;
    let scheme = parsed_url.scheme().to_lowercase();
    let host = parsed_url.host_str().ok_or("Proxy URL missing host")?.to_string();
    let port = parsed_url.port().unwrap_or(443);
    let tag = parsed_url.fragment().unwrap_or("proxy").to_string();

    let query: HashMap<String, String> = parsed_url.query_pairs().into_owned().collect();

    match scheme.as_str() {
        "vless" => {
            let uuid = parsed_url.username();
            if uuid.is_empty() {
                return Err("VLESS URL missing UUID".to_string());
            }

            let flow = query.get("flow").cloned().unwrap_or_default();
            let security = query.get("security").map(|s| s.to_lowercase()).unwrap_or_default();
            let sni = query.get("sni")
                .or_else(|| query.get("serverName"))
                .or_else(|| query.get("host"))
                .cloned()
                .unwrap_or_else(|| host.clone());
            let fp = query.get("fp").cloned().unwrap_or_else(|| "chrome".to_string());
            let net_type = query.get("type").map(|s| s.to_lowercase()).unwrap_or_else(|| "tcp".to_string());

            let mut outbound = serde_json::json!({
                "type": "vless",
                "tag": tag,
                "server": host,
                "server_port": port,
                "uuid": uuid,
                "packet_encoding": "xudp"
            });

            if !flow.is_empty() {
                outbound["flow"] = serde_json::Value::String(flow);
            }

            if security == "reality" {
                let pbk = query.get("pbk")
                    .or_else(|| query.get("publicKey"))
                    .ok_or("VLESS Reality missing pbk (public key)")?;
                let sid = query.get("sid")
                    .or_else(|| query.get("shortId"))
                    .cloned()
                    .unwrap_or_default();

                outbound["tls"] = serde_json::json!({
                    "enabled": true,
                    "server_name": sni,
                    "reality": {
                        "enabled": true,
                        "public_key": pbk,
                        "short_id": sid
                    },
                    "utls": {
                        "enabled": true,
                        "fingerprint": fp
                    }
                });
            } else if security == "tls" {
                outbound["tls"] = serde_json::json!({
                    "enabled": true,
                    "server_name": sni,
                    "utls": {
                        "enabled": true,
                        "fingerprint": fp
                    }
                });
            }

            if net_type == "ws" {
                let path = query.get("path").cloned().unwrap_or_else(|| "/".to_string());
                let host_hdr = query.get("host").cloned().unwrap_or_default();
                let mut ws_val = serde_json::json!({
                    "type": "ws",
                    "path": path
                });
                if !host_hdr.is_empty() {
                    ws_val["headers"] = serde_json::json!({ "Host": host_hdr });
                }
                outbound["transport"] = ws_val;
            } else if net_type == "grpc" {
                let service_name = query.get("serviceName").cloned().unwrap_or_default();
                outbound["transport"] = serde_json::json!({
                    "type": "grpc",
                    "service_name": service_name
                });
            }

            Ok(outbound)
        }

        "trojan" => {
            let password = parsed_url.username();
            if password.is_empty() {
                return Err("Trojan URL missing password".to_string());
            }
            let sni = query.get("sni").cloned().unwrap_or_else(|| host.clone());
            let fp = query.get("fp").cloned().unwrap_or_else(|| "chrome".to_string());

            let outbound = serde_json::json!({
                "type": "trojan",
                "tag": tag,
                "server": host,
                "server_port": port,
                "password": password,
                "tls": {
                    "enabled": true,
                    "server_name": sni,
                    "utls": {
                        "enabled": true,
                        "fingerprint": fp
                    }
                }
            });
            Ok(outbound)
        }

        "ss" => {
            // Shadowsocks: SIP002 (base64(method:password)@host:port) or base64(method:password@host:port)
            let user = parsed_url.username();
            let (method, password) = if !user.is_empty() {
                if let Ok(decoded) = decode_base64_flexible(user) {
                    if let Some((m, p)) = decoded.split_once(':') {
                        (m.to_string(), p.to_string())
                    } else {
                        (user.to_string(), parsed_url.password().unwrap_or("").to_string())
                    }
                } else if let Some(p) = parsed_url.password() {
                    (user.to_string(), p.to_string())
                } else {
                    return Err("Invalid Shadowsocks user info".to_string());
                }
            } else {
                // Try decoding host as full base64 string
                if let Ok(decoded) = decode_base64_flexible(&host) {
                    if let Some((mp, hp)) = decoded.split_once('@') {
                        let (m, p) = mp.split_once(':').unwrap_or((mp, ""));
                        return Ok(serde_json::json!({
                            "type": "shadowsocks",
                            "tag": tag,
                            "server": hp.split(':').next().unwrap_or(""),
                            "server_port": hp.split(':').nth(1).and_then(|s| s.parse().ok()).unwrap_or(8388),
                            "method": m,
                            "password": p
                        }));
                    }
                }
                return Err("Shadowsocks missing credentials".to_string());
            };

            let outbound = serde_json::json!({
                "type": "shadowsocks",
                "tag": tag,
                "server": host,
                "server_port": port,
                "method": method,
                "password": password
            });
            Ok(outbound)
        }

        "hysteria2" | "hy2" => {
            let password = parsed_url.username();
            let sni = query.get("sni").cloned().unwrap_or_else(|| host.clone());
            let outbound = serde_json::json!({
                "type": "hysteria2",
                "tag": tag,
                "server": host,
                "server_port": port,
                "password": password,
                "tls": {
                    "enabled": true,
                    "server_name": sni
                }
            });
            Ok(outbound)
        }

        "tuic" => {
            let uuid = parsed_url.username();
            let password = parsed_url.password().unwrap_or("");
            let sni = query.get("sni").cloned().unwrap_or_else(|| host.clone());
            let outbound = serde_json::json!({
                "type": "tuic",
                "tag": tag,
                "server": host,
                "server_port": port,
                "uuid": uuid,
                "password": password,
                "congestion_control": "bbr",
                "tls": {
                    "enabled": true,
                    "server_name": sni
                }
            });
            Ok(outbound)
        }

        _ => Err(format!("Unsupported proxy protocol: '{}'", scheme)),
    }
}

/// Generate production-ready sing-box configuration with routing and Clash API
pub fn generate_singbox_config(uri: &str, mode: &str) -> Result<serde_json::Value, String> {
    if uri.contains("mlkem") || uri.contains("pqv=") {
        return Err("Этот ключ использует Post-Quantum Xray шифрование (mlkem768 / pqv), которое не поддерживается клиентами sing-box. В панели 3X-UI отключите тумблер 'Post-Quantum' (ML-KEM) для этого Inbound и скопируйте обновленный ключ.".to_string());
    }

    let mut proxy_outbound = parse_proxy_outbound(uri)?;
    // Always enforce the tag to be "proxy" so routing rules, DNS detours, and Clash API match
    proxy_outbound["tag"] = serde_json::json!("proxy");

    let inbound = if mode == "tun" {
        serde_json::json!({
            "type": "tun",
            "tag": "tun-in",
            "address": ["172.19.0.1/30"],
            "auto_route": true,
            "strict_route": false,
            "stack": "gvisor"
        })
    } else {
        serde_json::json!({
            "type": "mixed",
            "tag": "mixed-in",
            "listen": "127.0.0.1",
            "listen_port": 7890
        })
    };

    let mut rules = vec![
        serde_json::json!({
            "protocol": "dns",
            "action": "hijack-dns"
        }),
        serde_json::json!({
            "ip_is_private": true,
            "outbound": "direct"
        })
    ];

    // Exclude proxy server IP from tunnel so that direct web panels (like 3X-UI :11221) always open directly
    if let Some(server_str) = proxy_outbound.get("server").and_then(|s| s.as_str()) {
        if let Ok(_ip) = server_str.parse::<std::net::IpAddr>() {
            rules.insert(1, serde_json::json!({
                "ip_cidr": [format!("{}/32", server_str)],
                "outbound": "direct"
            }));
        }
    }

    Ok(serde_json::json!({
        "log": {
            "level": "warn"
        },
        "dns": {
            "servers": [
                {
                    "tag": "dns-remote",
                    "type": "tcp",
                    "server": "1.1.1.1",
                    "detour": "proxy"
                },
                {
                    "tag": "dns-direct",
                    "type": "local",
                    "detour": "direct"
                }
            ],
            "rules": [
                {
                    "outbound": "direct",
                    "server": "dns-direct"
                }
            ],
            "strategy": "prefer_ipv4"
        },
        "inbounds": [
            inbound
        ],
        "outbounds": [
            proxy_outbound,
            {
                "type": "direct",
                "tag": "direct"
            },
            {
                "type": "block",
                "tag": "block"
            }
        ],
        "route": {
            "rules": rules,
            "default_domain_resolver": "dns-direct",
            "auto_detect_interface": true,
            "final": "proxy"
        },
        "experimental": {
            "clash_api": {
                "external_controller": "127.0.0.1:9090",
                "secret": ""
            }
        }
    }))
}

/// Locate xray binary across dev and release directories
fn find_xray_binary(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let sidecar_name = "xray-x86_64-pc-windows-msvc.exe";

    // 1. Check next to running executable
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            let next_to_exe = parent.join("xray.exe");
            if next_to_exe.exists() {
                return Ok(next_to_exe);
            }
            let next_to_exe_msvc = parent.join(sidecar_name);
            if next_to_exe_msvc.exists() {
                return Ok(next_to_exe_msvc);
            }
            let in_binaries = parent.join("binaries").join(sidecar_name);
            if in_binaries.exists() {
                return Ok(in_binaries);
            }
        }
    }

    // 2. Check Tauri resource directory
    if let Ok(resource_dir) = app.path().resource_dir() {
        let sidecar_path = resource_dir.join("binaries").join(sidecar_name);
        if sidecar_path.exists() {
            return Ok(sidecar_path);
        }
        let root_res = resource_dir.join("xray.exe");
        if root_res.exists() {
            return Ok(root_res);
        }
    }

    // 3. Check current working directory
    let cwd_bin = std::path::PathBuf::from("xray.exe");
    if cwd_bin.exists() {
        return Ok(cwd_bin);
    }

    let dev_bin = std::path::PathBuf::from("src-tauri").join("binaries").join(sidecar_name);
    if dev_bin.exists() {
        return Ok(dev_bin);
    }

    let dev_raw = std::path::PathBuf::from("src-tauri").join("binaries").join("xray.exe");
    if dev_raw.exists() {
        return Ok(dev_raw);
    }

    // 4. Fallback: check PATH
    Ok(std::path::PathBuf::from("xray.exe"))
}

/// Generate production Xray configuration supporting VLESS (Reality, Post-Quantum ML-KEM/Kyber, Vision),
/// VMess, Trojan, and Shadowsocks.
pub fn generate_xray_config(uri: &str) -> Result<serde_json::Value, String> {
    let raw_uri = uri.trim();
    let parsed_url = Url::parse(raw_uri).map_err(|e| format!("Invalid URL syntax: {}", e))?;
    let scheme = parsed_url.scheme().to_lowercase();
    let host = parsed_url.host_str().ok_or("Proxy URL missing host")?.to_string();
    let port = parsed_url.port().unwrap_or(443);

    let mut query = std::collections::HashMap::new();
    for (k, v) in parsed_url.query_pairs() {
        query.insert(k.to_string(), v.to_string());
    }

    let proxy_outbound = match scheme.as_str() {
        "vless" => {
            let uuid = parsed_url.username();
            if uuid.is_empty() {
                return Err("VLESS URL missing UUID".to_string());
            }
            let encryption = query.get("encryption").cloned().unwrap_or_else(|| "none".to_string());
            let flow = query.get("flow").cloned();
            let security = query.get("security").map(|s| s.to_lowercase()).unwrap_or_else(|| "none".to_string());
            let sni = query.get("sni").cloned().unwrap_or_else(|| host.clone());
            let fp = query.get("fp").cloned().unwrap_or_else(|| "chrome".to_string());
            let net_type = query.get("type").map(|s| s.to_lowercase()).unwrap_or_else(|| "tcp".to_string());

            let mut user_obj = serde_json::json!({
                "id": uuid,
                "encryption": encryption
            });
            if let Some(f) = flow {
                if !f.is_empty() {
                    user_obj["flow"] = serde_json::Value::String(f);
                }
            }

            let mut stream_settings = serde_json::json!({
                "network": net_type,
            });

            if security == "reality" {
                let pbk = query.get("pbk").or_else(|| query.get("publicKey")).cloned().unwrap_or_default();
                let sid = query.get("sid").or_else(|| query.get("shortId")).cloned().unwrap_or_default();
                let spx = query.get("spx").cloned().unwrap_or_else(|| "/".to_string());

                let mut reality_settings = serde_json::json!({
                    "show": false,
                    "fingerprint": fp,
                    "serverName": sni,
                    "publicKey": pbk,
                    "shortId": sid,
                    "spiderX": spx
                });
                if let Some(pqv) = query.get("pqv") {
                    if !pqv.is_empty() {
                        reality_settings["pqv"] = serde_json::Value::String(pqv.clone());
                    }
                }
                stream_settings["security"] = serde_json::json!("reality");
                stream_settings["realitySettings"] = reality_settings;
            } else if security == "tls" {
                stream_settings["security"] = serde_json::json!("tls");
                stream_settings["tlsSettings"] = serde_json::json!({
                    "serverName": sni,
                    "fingerprint": fp
                });
            }

            if net_type == "ws" {
                let path = query.get("path").cloned().unwrap_or_else(|| "/".to_string());
                let host_hdr = query.get("host").cloned().unwrap_or_default();
                let mut ws_val = serde_json::json!({ "path": path });
                if !host_hdr.is_empty() {
                    ws_val["headers"] = serde_json::json!({ "Host": host_hdr });
                }
                stream_settings["wsSettings"] = ws_val;
            } else if net_type == "grpc" {
                let service_name = query.get("serviceName").cloned().unwrap_or_default();
                stream_settings["grpcSettings"] = serde_json::json!({ "serviceName": service_name });
            } else if net_type == "xhttp" || net_type == "splithttp" {
                let path = query.get("path").cloned().unwrap_or_else(|| "/".to_string());
                let host_hdr = query.get("host").cloned().unwrap_or_default();
                stream_settings["xhttpSettings"] = serde_json::json!({ "path": path, "host": host_hdr });
            }

            serde_json::json!({
                "tag": "proxy",
                "protocol": "vless",
                "settings": {
                    "vnext": [
                        {
                            "address": host,
                            "port": port,
                            "users": [ user_obj ]
                        }
                    ]
                },
                "streamSettings": stream_settings
            })
        }
        "trojan" => {
            let password = parsed_url.username();
            let sni = query.get("sni").cloned().unwrap_or_else(|| host.clone());
            let fp = query.get("fp").cloned().unwrap_or_else(|| "chrome".to_string());
            let security = query.get("security").cloned().unwrap_or_else(|| "tls".to_string());

            serde_json::json!({
                "tag": "proxy",
                "protocol": "trojan",
                "settings": {
                    "servers": [
                        {
                            "address": host,
                            "port": port,
                            "password": password
                        }
                    ]
                },
                "streamSettings": {
                    "network": "tcp",
                    "security": security,
                    "tlsSettings": {
                        "serverName": sni,
                        "fingerprint": fp
                    }
                }
            })
        }
        "vmess" => {
            let b64 = &raw_uri[8..];
            let json_str = decode_base64_flexible(b64)?;
            let v: serde_json::Value = serde_json::from_str(&json_str)
                .map_err(|e| format!("Invalid VMess JSON: {}", e))?;

            let server = v.get("add").and_then(|s| s.as_str()).ok_or("VMess missing 'add'")?;
            let port: u16 = match v.get("port") {
                Some(serde_json::Value::Number(n)) => n.as_u64().unwrap_or(443) as u16,
                Some(serde_json::Value::String(s)) => s.parse().unwrap_or(443),
                _ => 443,
            };
            let uuid = v.get("id").and_then(|s| s.as_str()).ok_or("VMess missing 'id'")?;
            let alter_id = v.get("aid").and_then(|s| s.as_u64()).unwrap_or(0);
            let net = v.get("net").and_then(|s| s.as_str()).unwrap_or("tcp");
            let tls_enabled = v.get("tls").and_then(|s| s.as_str()).map_or(false, |s| s == "tls");
            let sni = v.get("sni").and_then(|s| s.as_str()).or_else(|| v.get("host").and_then(|s| s.as_str()));

            let mut stream_settings = serde_json::json!({ "network": net });
            if tls_enabled {
                stream_settings["security"] = serde_json::json!("tls");
                stream_settings["tlsSettings"] = serde_json::json!({
                    "serverName": sni.unwrap_or(server),
                    "fingerprint": "chrome"
                });
            }

            serde_json::json!({
                "tag": "proxy",
                "protocol": "vmess",
                "settings": {
                    "vnext": [
                        {
                            "address": server,
                            "port": port,
                            "users": [
                                {
                                    "id": uuid,
                                    "alterId": alter_id,
                                    "security": "auto"
                                }
                            ]
                        }
                    ]
                },
                "streamSettings": stream_settings
            })
        }
        _ => return Err(format!("Unsupported protocol for Xray: {}", scheme)),
    };

    let mut direct_ips = vec![
        "10.0.0.0/8".to_string(),
        "172.16.0.0/12".to_string(),
        "192.168.0.0/16".to_string(),
        "127.0.0.0/8".to_string(),
        "fc00::/7".to_string(),
        "fe80::/10".to_string(),
        "::1/128".to_string(),
    ];
    let mut direct_domains = vec![];
    if host.parse::<std::net::IpAddr>().is_ok() {
        direct_ips.push(format!("{}/32", host));
    } else {
        direct_domains.push(host.clone());
    }

    let mut routing_rules = vec![
        serde_json::json!({
            "type": "field",
            "ip": direct_ips,
            "outboundTag": "direct"
        })
    ];
    if !direct_domains.is_empty() {
        routing_rules.insert(0, serde_json::json!({
            "type": "field",
            "domain": direct_domains,
            "outboundTag": "direct"
        }));
    }
    routing_rules.push(serde_json::json!({
        "type": "field",
        "network": "tcp,udp",
        "outboundTag": "proxy"
    }));

    Ok(serde_json::json!({
        "log": {
            "loglevel": "warning"
        },
        "inbounds": [
            {
                "tag": "http-in",
                "port": 7890,
                "listen": "127.0.0.1",
                "protocol": "http",
                "settings": {
                    "allowTransparent": false
                }
            },
            {
                "tag": "socks-in",
                "port": 10808,
                "listen": "127.0.0.1",
                "protocol": "socks",
                "settings": {
                    "auth": "noauth",
                    "udp": true
                }
            }
        ],
        "outbounds": [
            proxy_outbound,
            {
                "tag": "direct",
                "protocol": "freedom"
            },
            {
                "tag": "block",
                "protocol": "blackhole"
            }
        ],
        "routing": {
            "domainStrategy": "AsIs",
            "rules": routing_rules
        }
    }))
}

/// Locate sing-box binary across dev and release directories
fn find_singbox_binary(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let sidecar_name = "sing-box-x86_64-pc-windows-msvc.exe";

    // 1. Check next to running executable
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            let next_to_exe = parent.join("sing-box.exe");
            if next_to_exe.exists() {
                return Ok(next_to_exe);
            }
            let next_to_exe_msvc = parent.join(sidecar_name);
            if next_to_exe_msvc.exists() {
                return Ok(next_to_exe_msvc);
            }
            let in_binaries = parent.join("binaries").join(sidecar_name);
            if in_binaries.exists() {
                return Ok(in_binaries);
            }
        }
    }

    // 2. Check Tauri resource directory
    if let Ok(resource_dir) = app.path().resource_dir() {
        let sidecar_path = resource_dir.join("binaries").join(sidecar_name);
        if sidecar_path.exists() {
            return Ok(sidecar_path);
        }
        let root_res = resource_dir.join("sing-box.exe");
        if root_res.exists() {
            return Ok(root_res);
        }
    }

    // 3. Check current working directory
    let cwd_bin = std::path::PathBuf::from("sing-box.exe");
    if cwd_bin.exists() {
        return Ok(cwd_bin);
    }

    let dev_bin = std::path::PathBuf::from("src-tauri").join("binaries").join(sidecar_name);
    if dev_bin.exists() {
        return Ok(dev_bin);
    }

    // 4. Fallback: check PATH
    Ok(std::path::PathBuf::from("sing-box.exe"))
}

#[tauri::command]
pub async fn vpn_save_config(app: AppHandle, uri: String) -> Result<(), String> {
    let state = app.state::<VpnManager>();
    *state.saved_uri.lock().unwrap() = uri;
    Ok(())
}

#[tauri::command]
pub async fn vpn_get_state(app: AppHandle) -> Result<VpnStateResponse, String> {
    let state = app.state::<VpnManager>();
    let mut child_guard = state.child_process.lock().unwrap();
    let is_alive = if let Some(ref mut child) = *child_guard {
        match child.try_wait() {
            Ok(None) => true,
            _ => false,
        }
    } else {
        false
    };
    if !is_alive && *state.is_connected.lock().unwrap() {
        *state.is_connected.lock().unwrap() = false;
        *child_guard = None;
        set_system_proxy(false, "");
    }
    let connected = *state.is_connected.lock().unwrap();
    let mode = state.current_mode.lock().unwrap().clone();
    let uri_key = state.saved_uri.lock().unwrap().clone();
    Ok(VpnStateResponse {
        connected,
        mode,
        uri_key,
    })
}

#[tauri::command]
pub async fn vpn_toggle(
    app: AppHandle,
    connect: bool,
    mode: Option<String>,
    uri_key: Option<String>,
    uri: Option<String>,
) -> Result<(), String> {
    let state = app.state::<VpnManager>();
    let selected_mode = mode.unwrap_or_else(|| state.current_mode.lock().unwrap().clone());
    let raw_key = uri_key
        .or(uri)
        .unwrap_or_else(|| state.saved_uri.lock().unwrap().clone());

    if !connect {
        // Disconnect
        let mut child_guard = state.child_process.lock().unwrap();
        if let Some(mut child) = child_guard.take() {
            let _ = child.kill();
        }
        set_system_proxy(false, "");
        *state.is_connected.lock().unwrap() = false;
        let _ = app.emit("vpn-status-changed", &serde_json::json!({
            "connected": false,
            "mode": selected_mode
        }));
        return Ok(());
    }

    // Connect: Validate URI
    let trimmed_key = raw_key.trim();
    if trimmed_key.is_empty() {
        return Err("VPN connection key / URI is empty. Please paste your proxy link.".to_string());
    }

    *state.saved_uri.lock().unwrap() = trimmed_key.to_string();
    *state.current_mode.lock().unwrap() = selected_mode.clone();

    let app_data = app.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let _ = std::fs::create_dir_all(&app_data);

    // Dynamic Engine Selection: Xray-core for Post-Quantum ML-KEM/Kyber & VLESS/VMess/Trojan, sing-box for Hy2/TUIC
    let use_xray = find_xray_binary(&app).is_ok() && (
        trimmed_key.starts_with("vless://")
        || trimmed_key.starts_with("vmess://")
        || trimmed_key.starts_with("trojan://")
        || trimmed_key.starts_with("ss://")
        || trimmed_key.contains("mlkem")
        || trimmed_key.contains("pqv=")
    );

    let (executable, config_path) = if use_xray {
        let config = generate_xray_config(trimmed_key)?;
        let path = app_data.join("xray_config.json");
        let config_content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
        std::fs::write(&path, config_content).map_err(|e| format!("Could not write Xray config: {}", e))?;
        (find_xray_binary(&app)?, path)
    } else {
        let config = generate_singbox_config(trimmed_key, &selected_mode)?;
        let path = app_data.join("singbox_config.json");
        let config_content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
        std::fs::write(&path, config_content).map_err(|e| format!("Could not write sing-box config: {}", e))?;
        (find_singbox_binary(&app)?, path)
    };

    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let err_log_path = app_data.join("vpn_core_err.log");
        let err_file = std::fs::File::create(&err_log_path)
            .map_err(|e| format!("Could not create core error log: {}", e))?;
        let out_file = err_file.try_clone().map_err(|e| format!("Could not clone log handle: {}", e))?;

        let mut cmd = Command::new(&executable);
        if let Some(exe_dir) = executable.parent() {
            cmd.current_dir(exe_dir);
            cmd.env("XRAY_LOCATION_ASSET", exe_dir);
        }
        cmd.arg("run")
            .arg("-c")
            .arg(&config_path)
            .stdout(out_file)
            .stderr(err_file)
            .creation_flags(CREATE_NO_WINDOW);

        let spawn_res = cmd.spawn();
        match spawn_res {
            Ok(mut child) => {
                // Attach to Job Object for guaranteed termination on app close
                let child_raw = child.as_raw_handle();
                if let Ok(job_guard) = state.job_object.lock() {
                    if let Some(job) = *job_guard {
                        unsafe {
                            use windows::Win32::System::JobObjects::AssignProcessToJobObject;
                            let _ = AssignProcessToJobObject(
                                windows::Win32::Foundation::HANDLE(job as *mut _),
                                windows::Win32::Foundation::HANDLE(child_raw),
                            );
                        }
                    }
                }

                // Kill previous process if any (e.g. mode switch while connected)
                {
                    let mut prev_guard = state.child_process.lock().unwrap();
                    if let Some(mut old) = prev_guard.take() {
                        let _ = old.kill();
                        let _ = old.wait(); // reap zombie
                    }
                }

                // Verify VPN core didn't exit immediately due to configuration or privilege error.
                // Use graduated checks: the core may need time to parse geoip/geosite databases
                // and initialize network interfaces, especially on first launch.
                let mut core_exited = false;
                for delay_ms in &[500u64, 800, 1200] {
                    std::thread::sleep(std::time::Duration::from_millis(*delay_ms));
                    match child.try_wait() {
                        Ok(Some(_)) => { core_exited = true; break; }
                        Ok(None) => { break; } // still running — good
                        Err(_) => { core_exited = true; break; }
                    }
                }

                if core_exited {
                    let err_str = std::fs::read_to_string(&err_log_path).unwrap_or_default();
                    *state.is_connected.lock().unwrap() = false;
                    set_system_proxy(false, "");
                    crate::window_ctl::log_runtime(&format!("[VPN] Startup failure: {}", err_str));
                    
                    if err_str.contains("Access is denied") {
                        return Err("Для TUN-режима требуются права администратора. Переключите режим на 'Системный прокси' или перезапустите SmartIsland от имени администратора.".to_string());
                    }
                    if !err_str.trim().is_empty() {
                        let first_err = err_str.lines()
                            .find(|l| l.contains("FATAL") || l.contains("ERROR") || l.contains("Warning") || l.contains("Failed"))
                            .unwrap_or_else(|| err_str.lines().next().unwrap_or(""));
                        return Err(format!("Ошибка запуска ядра: {}", first_err.trim()));
                    }
                    return Err("Ядро VPN завершило работу сразу после запуска.".to_string());
                }

                let mut child_guard = state.child_process.lock().unwrap();
                *child_guard = Some(child);
                *state.is_connected.lock().unwrap() = true;

                if selected_mode == "system-proxy" || use_xray {
                    set_system_proxy(true, "127.0.0.1:7890");
                } else {
                    set_system_proxy(false, "");
                }

                let _ = app.emit("vpn-status-changed", &serde_json::json!({
                    "connected": true,
                    "mode": selected_mode
                }));
            }
            Err(e) => {
                *state.is_connected.lock().unwrap() = false;
                set_system_proxy(false, "");
                return Err(format!("Не удалось запустить ядро VPN: {}", e));
            }
        }
    }

    #[cfg(not(windows))]
    {
        *state.is_connected.lock().unwrap() = false;
        return Err("VPN on non-Windows OS is not supported".to_string());
    }

    Ok(())
}

/// Measure round-trip ping latency through active local proxy
#[tauri::command]
pub async fn vpn_check_delay() -> Result<u64, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let start = std::time::Instant::now();
    let mut stream = tokio::time::timeout(
        std::time::Duration::from_millis(2500),
        tokio::net::TcpStream::connect("127.0.0.1:7890"),
    )
    .await
    .map_err(|_| "Timeout connecting to proxy".to_string())?
    .map_err(|e| e.to_string())?;

    let req = "CONNECT cp.cloudflare.com:80 HTTP/1.1\r\nHost: cp.cloudflare.com:80\r\nUser-Agent: SmartIsland\r\n\r\n";
    stream.write_all(req.as_bytes()).await.map_err(|e| e.to_string())?;

    let mut buf = [0u8; 128];
    let n = tokio::time::timeout(
        std::time::Duration::from_millis(3000),
        stream.read(&mut buf),
    )
    .await
    .map_err(|_| "Timeout waiting for proxy response".to_string())?
    .map_err(|e| e.to_string())?;

    let res_str = String::from_utf8_lossy(&buf[..n]);
    if res_str.contains("200") {
        Ok(start.elapsed().as_millis() as u64)
    } else {
        Err(format!("Proxy error: {}", res_str))
    }
}

/// Cleanup function called on application exit
pub fn cleanup_vpn(app: &AppHandle) {
    let state = app.state::<VpnManager>();
    let mut child_guard = state.child_process.lock().unwrap();
    if let Some(mut child) = child_guard.take() {
        let _ = child.kill();
    }
    set_system_proxy(false, "");
}
