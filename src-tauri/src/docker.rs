use bollard::container::{ListContainersOptions, RestartContainerOptions, StartContainerOptions, StopContainerOptions};
use bollard::Docker;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainerInfo {
    pub id: String,
    pub name: String,
    pub image: String,
    pub state: String,
    pub status: String,
    pub ports: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DockerStateResponse {
    pub is_running: bool,
    pub containers: Vec<DockerContainerInfo>,
}

fn get_docker_client() -> Result<Docker, bollard::errors::Error> {
    #[cfg(windows)]
    {
        // Connect to Windows named pipe //./pipe/docker_engine with fast 1s timeout
        Docker::connect_with_named_pipe("//./pipe/docker_engine", 1, bollard::API_DEFAULT_VERSION)
    }
    #[cfg(not(windows))]
    {
        Docker::connect_with_local_defaults()
    }
}

#[tauri::command]
pub async fn docker_get_state() -> Result<DockerStateResponse, String> {
    let docker = match get_docker_client() {
        Ok(d) => d,
        Err(_) => {
            return Ok(DockerStateResponse {
                is_running: false,
                containers: Vec::new(),
            });
        }
    };

    // Ping daemon with 400ms timeout to avoid hanging if daemon is stopped
    let ping_res = tokio::time::timeout(std::time::Duration::from_millis(400), docker.ping()).await;
    if ping_res.is_err() || ping_res.unwrap().is_err() {
        return Ok(DockerStateResponse {
            is_running: false,
            containers: Vec::new(),
        });
    }

    let mut options = ListContainersOptions::<String>::default();
    options.all = true;

    match docker.list_containers(Some(options)).await {
        Ok(list) => {
            let mut result = Vec::new();
            for c in list {
                let id = c.id.unwrap_or_default();
                let short_id = if id.len() > 12 { &id[..12] } else { &id }.to_string();
                let name = c
                    .names
                    .and_then(|names| names.into_iter().next())
                    .map(|n| n.trim_start_matches('/').to_string())
                    .unwrap_or(short_id.clone());

                let image = c.image.unwrap_or_default();
                let state = c.state.unwrap_or_else(|| "unknown".to_string());
                let status = c.status.unwrap_or_default();

                let mut ports = Vec::new();
                if let Some(c_ports) = c.ports {
                    for p in c_ports {
                        if let Some(pub_p) = p.public_port {
                            let priv_p = p.private_port;
                            let p_type = p.typ.map(|t| t.to_string()).unwrap_or_else(|| "tcp".to_string());
                            ports.push(format!("{}:{} / {}", pub_p, priv_p, p_type));
                        }
                    }
                }

                result.push(DockerContainerInfo {
                    id: short_id,
                    name,
                    image,
                    state,
                    status,
                    ports,
                });
            }

            Ok(DockerStateResponse {
                is_running: true,
                containers: result,
            })
        }
        Err(_) => Ok(DockerStateResponse {
            is_running: false,
            containers: Vec::new(),
        }),
    }
}

#[tauri::command]
pub async fn docker_start(id: String) -> Result<(), String> {
    let docker = get_docker_client().map_err(|e| e.to_string())?;
    docker
        .start_container(&id, None::<StartContainerOptions<String>>)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_stop(id: String) -> Result<(), String> {
    let docker = get_docker_client().map_err(|e| e.to_string())?;
    docker
        .stop_container(&id, Some(StopContainerOptions { t: 5 }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_restart(id: String) -> Result<(), String> {
    let docker = get_docker_client().map_err(|e| e.to_string())?;
    docker
        .restart_container(&id, Some(RestartContainerOptions { t: 5 }))
        .await
        .map_err(|e| e.to_string())
}
