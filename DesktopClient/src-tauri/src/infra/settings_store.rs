use crate::domain::entity::Folder;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::PathBuf};

#[derive(Default, Serialize, Deserialize)]
pub struct Settings {
    pub folders: Vec<FolderSetting>,
    pub next_folder_id: u64,
    pub app_visibility: BTreeMap<String, bool>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct FolderSetting {
    pub id: u64,
    pub name: String,
    pub on: bool,
    pub open: bool,
    pub items: Vec<String>,
}

impl From<FolderSetting> for Folder {
    fn from(value: FolderSetting) -> Self {
        Self {
            id: value.id,
            name: value.name,
            on: value.on,
            open: value.open,
            items: value.items,
        }
    }
}

impl From<&Folder> for FolderSetting {
    fn from(value: &Folder) -> Self {
        Self {
            id: value.id,
            name: value.name.clone(),
            on: value.on,
            open: value.open,
            items: value.items.clone(),
        }
    }
}

pub fn settings_path() -> Option<PathBuf> {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .map(|path| path.join("Ophanim").join("Settings").join("client.json"))
}

pub fn load() -> Result<Settings, String> {
    let Some(path) = settings_path() else {
        return Ok(Settings::default());
    };
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Settings::default());
        }
        Err(error) => {
            return Err(format!(
                "Could not read settings {}: {error}",
                path.display()
            ));
        }
    };
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("Could not parse settings {}: {error}", path.display()))
}

pub fn save(settings: &Settings) -> std::io::Result<()> {
    let Some(path) = settings_path() else {
        return Ok(());
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let data = serde_json::to_vec_pretty(settings).map_err(std::io::Error::other)?;
    fs::write(path, data)
}
