use crate::{
    domain::{
        aggregate::{AppDayAggregate, PreparedData, prepare},
        builder::{BuiltData, build},
        entity::folder_aggregate,
        event::Event,
        interval::{DayData, FocusInterval},
    },
    dto::{
        AppDto, ClientStateDto, DayDetailDto, DayDto, EntitySegmentsDto, FolderDto, OverviewDto,
        folder_color,
    },
    infra::{
        ndjson_reader::{parse_text, read_file},
        settings_store::{self, FolderSetting, Settings},
    },
};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

struct CachedFile {
    modified: Option<SystemTime>,
    size: u64,
    events: Vec<Event>,
    bad_lines: usize,
}

pub struct LogService {
    root: Option<PathBuf>,
    files: BTreeMap<PathBuf, CachedFile>,
    imported_events: Vec<Event>,
    imported_bad_lines: usize,
    built: BuiltData,
    prepared: PreparedData,
    folder_daily: BTreeMap<u64, BTreeMap<String, AppDayAggregate>>,
    folder_segments: BTreeMap<u64, BTreeMap<String, Vec<FocusInterval>>>,
    settings: Settings,
    settings_error: Option<String>,
    load_error: Option<String>,
}

impl LogService {
    pub fn new() -> Self {
        let (settings, load_error) = match settings_store::load() {
            Ok(settings) => (settings, None),
            Err(error) => {
                eprintln!("{error}");
                (Settings::default(), Some(error))
            }
        };
        Self {
            root: None,
            files: BTreeMap::new(),
            imported_events: Vec::new(),
            imported_bad_lines: 0,
            built: BuiltData::default(),
            prepared: PreparedData::default(),
            folder_daily: BTreeMap::new(),
            folder_segments: BTreeMap::new(),
            settings,
            settings_error: load_error,
            load_error: None,
        }
    }

    pub fn initialize_default(&mut self) {
        if let Some(path) = default_daylog_folder() {
            if path.is_dir() {
                if let Err(error) = self.load_folder(&path) {
                    eprintln!("Failed to load DayLogs from {}: {error}", path.display());
                    self.load_error = Some(error);
                }
            }
        }
    }

    pub fn load_folder(&mut self, root: &Path) -> Result<(), String> {
        if self.root.as_deref() != Some(root) {
            self.root = Some(root.to_path_buf());
            self.files.clear();
            self.imported_events.clear();
            self.imported_bad_lines = 0;
        }
        let entries = fs::read_dir(root).map_err(|error| error.to_string())?;
        let mut found = BTreeSet::new();
        for entry in entries {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            if !is_ndjson(&path) {
                continue;
            }
            found.insert(path.clone());
            self.update_cached_file(&path)?;
        }
        self.files.retain(|path, _| found.contains(path));
        self.rebuild();
        self.load_error = None;
        Ok(())
    }

    pub fn refresh_files(&mut self, paths: impl IntoIterator<Item = PathBuf>) {
        let mut changed = false;
        for path in paths {
            if !is_ndjson(&path) {
                continue;
            }
            match self.update_cached_file(&path) {
                Ok(file_changed) => changed |= file_changed,
                Err(error) => {
                    eprintln!("Failed to refresh day log {}: {error}", path.display());
                }
            }
        }
        if changed {
            self.rebuild();
        }
    }

    fn update_cached_file(&mut self, path: &Path) -> Result<bool, String> {
        let metadata = match fs::metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(self.files.remove(path).is_some());
            }
            Err(error) => return Err(error.to_string()),
        };
        let modified = metadata.modified().ok();
        let size = metadata.len();
        if self
            .files
            .get(path)
            .is_some_and(|cached| cached.modified == modified && cached.size == size)
        {
            return Ok(false);
        }
        let data = read_file(path).map_err(|error| error.to_string())?;
        self.files.insert(
            path.to_path_buf(),
            CachedFile {
                modified,
                size,
                events: data.events,
                bad_lines: data.bad_lines,
            },
        );
        Ok(true)
    }

    pub fn load_files(&mut self, files: Vec<(String, String)>) {
        self.root = None;
        self.files.clear();
        self.imported_events.clear();
        self.imported_bad_lines = 0;
        for (_, text) in files {
            let result = parse_text(&text);
            self.imported_events.extend(result.events);
            self.imported_bad_lines += result.bad_lines;
        }
        self.rebuild();
        self.load_error = None;
    }

    pub fn load_file_paths(&mut self, paths: Vec<PathBuf>) -> Result<(), String> {
        self.root = None;
        self.files.clear();
        self.imported_events.clear();
        self.imported_bad_lines = 0;
        for path in paths {
            if is_ndjson(&path) {
                self.update_cached_file(&path)?;
            }
        }
        self.rebuild();
        self.load_error = None;
        Ok(())
    }

    pub fn load_demo(&mut self, text: &str) {
        self.load_files(vec![("demo.ndjson".into(), text.into())]);
    }

    pub fn load_bundled_demo(&mut self) {
        self.load_demo(include_str!("../../../Docs/ui/fixtures/demo.ndjson"));
    }

    pub fn set_app_visibility(&mut self, exe: &str, show: bool) -> Result<(), String> {
        self.settings.app_visibility.insert(exe.to_string(), show);
        settings_store::save(&self.settings).map_err(|error| error.to_string())
    }

    pub fn set_apps_visibility(&mut self, exes: &[String], show: bool) -> Result<(), String> {
        for exe in exes {
            self.settings.app_visibility.insert(exe.clone(), show);
        }
        settings_store::save(&self.settings).map_err(|error| error.to_string())
    }

    pub fn set_folder(&mut self, folder: FolderSetting) -> Result<(), String> {
        let mut folders = self.settings.folders.clone();
        folders.retain(|value| value.id != folder.id);
        folders.push(folder);
        folders.sort_by_key(|value| value.id);
        validate_folders(&folders)?;
        self.settings.folders = folders;
        self.settings.next_folder_id = self.settings.next_folder_id.max(
            self.settings
                .folders
                .iter()
                .map(|value| value.id + 1)
                .max()
                .unwrap_or(1),
        );
        self.prepare_folders();
        settings_store::save(&self.settings).map_err(|error| error.to_string())
    }

    pub fn save_folders(
        &mut self,
        folders: Vec<FolderSetting>,
        next_id: u64,
    ) -> Result<(), String> {
        validate_folders(&folders)?;
        self.settings.folders = folders;
        self.settings.next_folder_id = next_id;
        self.prepare_folders();
        settings_store::save(&self.settings).map_err(|error| error.to_string())
    }

    pub fn state(&self) -> ClientStateDto {
        let mut days = Vec::with_capacity(self.built.days.len());
        for date in self.built.days.keys() {
            let mut apps = self
                .prepared
                .day_apps
                .get(date)
                .cloned()
                .unwrap_or_default();
            for folder in &self.settings.folders {
                if let Some(value) = self
                    .folder_daily
                    .get(&folder.id)
                    .and_then(|values| values.get(date))
                {
                    apps.insert(format!("f:{}", folder.id), value.clone());
                }
            }
            days.push(DayDto::new(date.clone(), apps));
        }
        let apps = self
            .built
            .apps
            .iter()
            .map(|(exe, info)| {
                AppDto::from_info(
                    info,
                    self.settings
                        .app_visibility
                        .get(exe)
                        .copied()
                        .unwrap_or(true),
                )
            })
            .collect();
        let folders = self
            .settings
            .folders
            .iter()
            .map(|folder| FolderDto {
                id: folder.id,
                name: folder.name.clone(),
                on: folder.on,
                open: folder.open,
                items: folder.items.clone(),
                color: folder_color(folder.id),
            })
            .collect();
        ClientStateDto {
            days,
            apps,
            folders,
            bad_lines: self.total_bad_lines(),
            last_event: self.built.last_event.clone(),
            log_folder: self
                .root
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            error: self
                .load_error
                .clone()
                .or_else(|| self.settings_error.clone()),
        }
    }

    pub fn overview(&self, span: usize) -> OverviewDto {
        let all_dates = self.built.days.keys().collect::<Vec<_>>();
        let mut days = Vec::new();
        let mut segments = Vec::new();
        let mut sessions = Vec::new();
        let mut off_periods = Vec::new();
        if let (Some(first), Some(last)) = (all_dates.first(), all_dates.last()) {
            if let (Ok(first_date), Ok(last_date)) = (
                chrono::NaiveDate::parse_from_str(first, "%Y-%m-%d"),
                chrono::NaiveDate::parse_from_str(last, "%Y-%m-%d"),
            ) {
                let requested_start = if span == 0 {
                    first_date
                } else {
                    last_date
                        .checked_sub_days(chrono::Days::new(span.saturating_sub(1) as u64))
                        .unwrap_or(first_date)
                        .max(first_date)
                };
                let mut date = requested_start;
                while date <= last_date {
                    let key = date.format("%Y-%m-%d").to_string();
                    let day = self.built.days.get(&key).cloned().unwrap_or_default();
                    let entity_segments = self.entity_segments(&key, &day);
                    days.push(DayDetailDto::new(key, &day, entity_segments.clone()));
                    segments.extend(entity_segments);
                    sessions.extend(day.sessions);
                    off_periods.extend(day.off_periods);
                    let Some(next) = date.succ_opt() else { break };
                    date = next;
                }
            }
        }
        let apps = self
            .built
            .apps
            .iter()
            .map(|(exe, info)| {
                (
                    exe.clone(),
                    AppDto::from_info(
                        info,
                        self.settings
                            .app_visibility
                            .get(exe)
                            .copied()
                            .unwrap_or(true),
                    ),
                )
            })
            .collect();
        OverviewDto {
            days,
            segments,
            sessions,
            off_periods,
            apps,
        }
    }

    pub fn day_detail(&self, date: &str) -> Option<DayDetailDto> {
        self.built
            .days
            .get(date)
            .map(|data| DayDetailDto::new(date.to_string(), data, self.entity_segments(date, data)))
    }

    pub fn app_segments(&self, entity: &str, start: &str, end: &str) -> EntitySegmentsDto {
        let folder = entity
            .strip_prefix("f:")
            .and_then(|id| id.parse::<u64>().ok())
            .and_then(|id| self.settings.folders.iter().find(|folder| folder.id == id));
        let members = folder
            .map(|folder| folder.items.clone())
            .unwrap_or_else(|| vec![entity.to_string()]);
        let raw_segments = self
            .built
            .days
            .range(start.to_string()..=end.to_string())
            .flat_map(|(_, data)| data.segments.iter())
            .filter(|segment| members.contains(&segment.exe))
            .cloned()
            .collect::<Vec<_>>();
        let segments = if let Some(folder) = folder {
            self.folder_segments
                .get(&folder.id)
                .into_iter()
                .flat_map(|days| days.range(start.to_string()..=end.to_string()))
                .flat_map(|(_, segments)| segments.iter().cloned())
                .collect()
        } else {
            raw_segments.clone()
        };
        EntitySegmentsDto {
            segments,
            raw_segments,
        }
    }

    fn total_bad_lines(&self) -> usize {
        self.imported_bad_lines
            + self
                .files
                .values()
                .map(|file| file.bad_lines)
                .sum::<usize>()
    }

    fn rebuild(&mut self) {
        let mut events = self.imported_events.clone();
        events.extend(
            self.files
                .values()
                .flat_map(|file| file.events.iter().cloned()),
        );
        self.built = build(events);
        self.prepared = prepare(&self.built.days, &self.built.apps);
        self.prepare_folders();
    }

    fn prepare_folders(&mut self) {
        self.folder_daily.clear();
        self.folder_segments.clear();
        for folder in &self.settings.folders {
            let mut daily = folder_aggregate(&folder.items, &self.prepared.app_days);
            let mut segment_days = BTreeMap::new();
            for (date, data) in &self.built.days {
                let mut merged =
                    crate::domain::entity::merge_folder_intervals(&folder.items, &data.segments);
                if merged.is_empty() {
                    continue;
                }
                for segment in &mut merged {
                    segment.exe = format!("f:{}", folder.id);
                }
                if let Some(aggregate) = daily.get_mut(date) {
                    aggregate.max_focus = merged
                        .iter()
                        .map(|segment| segment.end.saturating_sub(segment.start))
                        .max()
                        .unwrap_or_default();
                    aggregate.focus_count = merged.len().min(u32::MAX as usize) as u32;
                }
                segment_days.insert(date.clone(), merged);
            }
            self.folder_daily.insert(folder.id, daily);
            self.folder_segments.insert(folder.id, segment_days);
        }
    }

    fn entity_segments(&self, date: &str, data: &DayData) -> Vec<FocusInterval> {
        let mut segments = data.segments.clone();
        for folder in &self.settings.folders {
            if let Some(folder_segments) = self
                .folder_segments
                .get(&folder.id)
                .and_then(|days| days.get(date))
            {
                segments.extend(folder_segments.iter().cloned());
            }
        }
        segments.sort_by_key(|segment| (segment.start, segment.end, segment.exe.clone()));
        segments
    }
}

fn validate_folders(folders: &[FolderSetting]) -> Result<(), String> {
    let mut ids = BTreeSet::new();
    let mut items = BTreeSet::new();
    for folder in folders {
        if folder.id == 0 || !ids.insert(folder.id) {
            return Err("Folder IDs must be unique positive integers.".into());
        }
        if folder.name.trim().is_empty() {
            return Err("Folder names cannot be empty.".into());
        }
        for item in &folder.items {
            if item.starts_with("f:") || !items.insert(item) {
                return Err("Apps can belong to only one folder.".into());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::interval::{DayData, FocusInterval};

    #[test]
    fn folder_intervals_and_details_are_prepared_with_the_day_data() {
        let date = "2026-09-11".to_string();
        let mut service = LogService::new();
        service.settings = Settings::default();
        service.settings.folders = vec![FolderSetting {
            id: 1,
            name: "Tools".into(),
            on: true,
            open: true,
            items: vec!["a.exe".into(), "b.exe".into()],
        }];
        service.built.days.insert(
            date.clone(),
            DayData {
                segments: vec![
                    FocusInterval {
                        day: date.clone(),
                        start: 10,
                        end: 20,
                        exe: "a.exe".into(),
                        title: "A".into(),
                    },
                    FocusInterval {
                        day: date.clone(),
                        start: 20,
                        end: 30,
                        exe: "b.exe".into(),
                        title: "B".into(),
                    },
                ],
                ..DayData::default()
            },
        );
        service.prepared = prepare(&service.built.days, &service.built.apps);
        service.prepare_folders();

        let daily = &service.folder_daily[&1][&date];
        assert_eq!(daily.seconds, 20);
        assert_eq!(daily.max_focus, 20);
        assert_eq!(daily.focus_count, 1);
        let day = service.day_detail(&date).unwrap();
        assert!(
            day.segments.iter().any(|segment| {
                segment.exe == "f:1" && segment.start == 10 && segment.end == 30
            })
        );
        let detail = service.app_segments("f:1", &date, &date);
        assert_eq!(detail.segments.len(), 1);
        assert_eq!(detail.raw_segments.len(), 2);
        assert_eq!(detail.segments[0].exe, "f:1");
    }
}

fn is_ndjson(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("ndjson"))
}

pub fn default_daylog_folder() -> Option<PathBuf> {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .map(|path| path.join("Ophanim").join("DayLogs"))
}
