use super::interval::{AppInfo, DayData};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

#[derive(Clone, Debug, Default, Serialize)]
pub struct AppDayAggregate {
    pub seconds: u64,
    pub max_focus: u32,
    pub launches: u32,
}

#[derive(Clone, Debug, Default)]
pub struct PreparedData {
    pub app_days: BTreeMap<String, BTreeMap<String, AppDayAggregate>>,
    pub day_apps: BTreeMap<String, BTreeMap<String, AppDayAggregate>>,
    pub app_days_first_seen: BTreeMap<String, i64>,
    pub app_names: BTreeMap<String, String>,
}

pub fn prepare(days: &BTreeMap<String, DayData>, apps: &BTreeMap<String, AppInfo>) -> PreparedData {
    let mut result = PreparedData::default();
    for (exe, app) in apps {
        result
            .app_days_first_seen
            .insert(exe.clone(), app.first_seen);
        result.app_names.insert(exe.clone(), app.name.clone());
    }
    for (day, data) in days {
        let mut daily = HashMap::<String, AppDayAggregate>::new();
        for segment in &data.segments {
            let aggregate = daily.entry(segment.exe.clone()).or_default();
            let seconds = segment.end.saturating_sub(segment.start);
            aggregate.seconds += u64::from(seconds);
            aggregate.max_focus = aggregate.max_focus.max(seconds);
        }
        for (exe, launches) in &data.launches {
            daily.entry(exe.clone()).or_default().launches += launches;
        }
        for (exe, aggregate) in daily {
            result
                .day_apps
                .entry(day.clone())
                .or_default()
                .insert(exe.clone(), aggregate.clone());
            result
                .app_days
                .entry(exe)
                .or_default()
                .insert(day.clone(), aggregate);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::interval::FocusInterval;

    #[test]
    fn prepares_per_app_and_per_day_aggregates_once() {
        let apps = BTreeMap::from([(
            "code.exe".to_string(),
            AppInfo {
                exe: "code.exe".into(),
                name: "Code".into(),
                first_seen: 1,
            },
        )]);
        let days = BTreeMap::from([(
            "2026-09-11".into(),
            DayData {
                segments: vec![FocusInterval {
                    day: "2026-09-11".into(),
                    start: 10,
                    end: 70,
                    exe: "code.exe".into(),
                    title: "Editor".into(),
                }],
                ..DayData::default()
            },
        )]);
        let prepared = prepare(&days, &apps);
        assert_eq!(prepared.day_apps["2026-09-11"]["code.exe"].seconds, 60);
        assert_eq!(prepared.app_days["code.exe"]["2026-09-11"].max_focus, 60);
    }
}
