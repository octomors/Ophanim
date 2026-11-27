use super::interval::{AppInfo, DayData};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

#[derive(Clone, Debug, Default, Serialize)]
pub struct AppDayAggregate {
    pub seconds: u64,
    pub max_focus: u32,
    pub focus_count: u32,
    pub launches: u32,
}

#[derive(Clone, Debug, Default)]
pub struct PreparedData {
    pub app_days: BTreeMap<String, BTreeMap<String, AppDayAggregate>>,
    pub day_apps: BTreeMap<String, BTreeMap<String, AppDayAggregate>>,
    pub app_days_first_seen: BTreeMap<String, i64>,
    pub app_names: BTreeMap<String, String>,
    pub segment_indices: BTreeMap<String, BTreeMap<String, Vec<usize>>>,
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
        for (index, segment) in data.segments.iter().enumerate() {
            match result.segment_indices.get_mut(&segment.exe) {
                Some(days) => match days.get_mut(day) {
                    Some(indices) => indices.push(index),
                    None => {
                        days.insert(day.clone(), vec![index]);
                    }
                },
                None => {
                    result.segment_indices.insert(
                        segment.exe.clone(),
                        BTreeMap::from([(day.clone(), vec![index])]),
                    );
                }
            }
            let aggregate = daily.entry(segment.exe.clone()).or_default();
            let seconds = segment.end.saturating_sub(segment.start);
            aggregate.seconds += u64::from(seconds);
            aggregate.max_focus = aggregate.max_focus.max(seconds);
            aggregate.focus_count = aggregate.focus_count.saturating_add(1);
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
        assert_eq!(prepared.day_apps["2026-09-11"]["code.exe"].focus_count, 1);
        assert_eq!(prepared.segment_indices["code.exe"]["2026-09-11"], vec![0]);
    }
}
