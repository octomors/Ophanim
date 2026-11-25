use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct FocusInterval {
    pub day: String,
    pub start: u32,
    pub end: u32,
    pub exe: String,
    pub title: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Session {
    pub start: i64,
    pub end: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct DaySession {
    pub start: u32,
    pub end: u32,
}

#[derive(Clone, Debug, Serialize)]
pub struct AppInfo {
    pub exe: String,
    pub name: String,
    pub first_seen: i64,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct DayData {
    pub segments: Vec<FocusInterval>,
    pub sessions: Vec<DaySession>,
    pub off_periods: Vec<DaySession>,
    pub launches: std::collections::BTreeMap<String, u32>,
}
