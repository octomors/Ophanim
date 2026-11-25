use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
pub struct Event {
    pub event_type: String,
    pub time: String,
    pub exe_name: Option<String>,
    pub friendly_name: Option<String>,
    pub window_title: Option<String>,
}

impl Event {
    pub fn timestamp(&self) -> Option<i64> {
        let value = self.time.get(..19)?;
        NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S")
            .ok()
            .map(|date| date.and_utc().timestamp())
    }

    pub fn exe(&self) -> Option<String> {
        self.exe_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_lowercase)
    }

    pub fn friendly_name(&self) -> Option<&str> {
        self.friendly_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }
}

pub fn day_at(timestamp: i64) -> String {
    DateTime::<Utc>::from_timestamp(timestamp, 0)
        .map(|time| time.date_naive().format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| NaiveDate::from_ymd_opt(1970, 1, 1).unwrap().to_string())
}

pub fn midnight_after(timestamp: i64) -> i64 {
    DateTime::<Utc>::from_timestamp(timestamp, 0)
        .and_then(|time| time.date_naive().succ_opt())
        .and_then(|date| date.and_hms_opt(0, 0, 0))
        .map(|time| time.and_utc().timestamp())
        .unwrap_or(i64::MAX)
}
