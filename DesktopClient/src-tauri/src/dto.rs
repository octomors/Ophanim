use crate::domain::{
    aggregate::AppDayAggregate,
    interval::{AppInfo, DayData, FocusInterval},
};
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Clone, Serialize)]
pub struct AppDto {
    pub exe: String,
    pub name: String,
    pub first_seen: i64,
    pub color: String,
    pub show: bool,
}

impl AppDto {
    pub fn from_info(info: &AppInfo, show: bool) -> Self {
        Self {
            exe: info.exe.clone(),
            name: info.name.clone(),
            first_seen: info.first_seen,
            color: app_color(&info.exe),
            show,
        }
    }
}

#[derive(Clone, Serialize)]
pub struct FolderDto {
    pub id: u64,
    pub name: String,
    pub on: bool,
    pub open: bool,
    pub items: Vec<String>,
    pub color: String,
}

#[derive(Clone, Serialize)]
pub struct DayDto {
    pub date: String,
    pub apps: BTreeMap<String, AppDayAggregate>,
}

impl DayDto {
    pub fn new(date: String, apps: BTreeMap<String, AppDayAggregate>) -> Self {
        Self { date, apps }
    }
}

#[derive(Clone, Serialize)]
pub struct DayDetailDto {
    pub date: String,
    pub segments: Vec<FocusInterval>,
    pub sessions: Vec<crate::domain::interval::DaySession>,
    pub off_periods: Vec<crate::domain::interval::DaySession>,
    pub launches: BTreeMap<String, u32>,
}

impl DayDetailDto {
    pub fn new(date: String, data: &DayData, segments: Vec<FocusInterval>) -> Self {
        Self {
            date,
            segments,
            sessions: data.sessions.clone(),
            off_periods: data.off_periods.clone(),
            launches: data.launches.clone(),
        }
    }
}

#[derive(Clone, Serialize)]
pub struct OverviewDto {
    pub days: Vec<DayDetailDto>,
    pub segments: Vec<FocusInterval>,
    pub sessions: Vec<crate::domain::interval::DaySession>,
    pub off_periods: Vec<crate::domain::interval::DaySession>,
    pub apps: BTreeMap<String, AppDto>,
}

#[derive(Clone, Serialize)]
pub struct EntitySegmentsDto {
    pub segments: Vec<FocusInterval>,
    pub raw_segments: Vec<FocusInterval>,
}

#[derive(Serialize)]
pub struct ClientStateDto {
    pub days: Vec<DayDto>,
    pub apps: Vec<AppDto>,
    pub folders: Vec<FolderDto>,
    pub bad_lines: usize,
    pub last_event: Option<String>,
    pub log_folder: Option<String>,
    pub error: Option<String>,
}

pub fn app_color(exe: &str) -> String {
    let hash = exe.chars().fold(0u32, |hash, ch| {
        hash.wrapping_mul(31).wrapping_add(ch as u32)
    });
    format!("hsl({} 58% 52%)", hash % 360)
}

pub fn folder_color(id: u64) -> String {
    format!(
        "hsl({} 65% 50%)",
        ((id as f64 * 137.508).round() as u64) % 360
    )
}
