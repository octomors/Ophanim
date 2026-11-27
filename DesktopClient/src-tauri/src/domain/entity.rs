use super::{aggregate::AppDayAggregate, interval::FocusInterval};
use std::collections::BTreeMap;

#[derive(Clone, Debug)]
pub struct Folder {
    pub id: u64,
    pub name: String,
    pub on: bool,
    pub open: bool,
    pub items: Vec<String>,
}

pub fn folder_aggregate(
    items: &[String],
    app_days: &BTreeMap<String, BTreeMap<String, AppDayAggregate>>,
) -> BTreeMap<String, AppDayAggregate> {
    let mut combined = BTreeMap::<String, AppDayAggregate>::new();
    for item in items {
        if let Some(days) = app_days.get(item) {
            for (day, aggregate) in days {
                let target = combined.entry(day.clone()).or_default();
                target.seconds += aggregate.seconds;
                target.launches += aggregate.launches;
                target.max_focus = target.max_focus.max(aggregate.max_focus);
                target.focus_count = target.focus_count.saturating_add(aggregate.focus_count);
            }
        }
    }
    combined
}

pub fn merge_folder_intervals(items: &[String], segments: &[FocusInterval]) -> Vec<FocusInterval> {
    let mut members = segments
        .iter()
        .filter(|segment| items.contains(&segment.exe))
        .cloned()
        .collect::<Vec<_>>();
    members.sort_by_key(|segment| (segment.day.clone(), segment.start, segment.end));
    let mut merged: Vec<FocusInterval> = Vec::new();
    for segment in members {
        if let Some(previous) = merged.last_mut() {
            if previous.day == segment.day && previous.end == segment.start {
                previous.end = segment.end;
                continue;
            }
        }
        merged.push(segment);
    }
    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_aggregate_sums_members_by_day_and_uses_merged_max() {
        let app_days = BTreeMap::from([
            (
                "a.exe".into(),
                BTreeMap::from([(
                    "2026-09-11".into(),
                    AppDayAggregate {
                        seconds: 50,
                        max_focus: 30,
                        focus_count: 2,
                        launches: 1,
                    },
                )]),
            ),
            (
                "b.exe".into(),
                BTreeMap::from([(
                    "2026-09-11".into(),
                    AppDayAggregate {
                        seconds: 40,
                        max_focus: 25,
                        focus_count: 3,
                        launches: 2,
                    },
                )]),
            ),
        ]);
        let aggregate = folder_aggregate(&["a.exe".into(), "b.exe".into()], &app_days);
        assert_eq!(aggregate["2026-09-11"].seconds, 90);
        assert_eq!(aggregate["2026-09-11"].max_focus, 30);
        assert_eq!(aggregate["2026-09-11"].focus_count, 5);
        assert_eq!(aggregate["2026-09-11"].launches, 3);
    }

    #[test]
    fn folder_focus_merges_touching_member_intervals() {
        let segments = vec![
            FocusInterval {
                day: "2026-09-11".into(),
                start: 0,
                end: 20,
                exe: "a.exe".into(),
                title: "A".into(),
            },
            FocusInterval {
                day: "2026-09-11".into(),
                start: 20,
                end: 40,
                exe: "b.exe".into(),
                title: "B".into(),
            },
        ];
        let merged = merge_folder_intervals(&["a.exe".into(), "b.exe".into()], &segments);
        assert_eq!(merged.len(), 1);
        assert_eq!((merged[0].start, merged[0].end), (0, 40));
    }
}
