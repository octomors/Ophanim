use super::{
    event::{Event, day_at, midnight_after},
    interval::{AppInfo, DayData, DaySession, FocusInterval, Session},
};
use std::collections::{BTreeMap, HashMap};

#[derive(Default)]
pub struct BuiltData {
    pub days: BTreeMap<String, DayData>,
    pub apps: BTreeMap<String, AppInfo>,
    pub sessions: Vec<Session>,
    pub last_event: Option<String>,
    pub event_count: usize,
}

struct OpenFocus {
    start: i64,
    exe: String,
    title: String,
}

fn split_interval(start: i64, end: i64, mut add: impl FnMut(FocusInterval)) {
    if end <= start {
        return;
    }
    let mut cursor = start;
    while cursor < end {
        let next = midnight_after(cursor).min(end);
        let day_start = cursor - cursor.rem_euclid(86_400);
        add(FocusInterval {
            day: day_at(cursor),
            start: (cursor - day_start) as u32,
            end: (next - day_start) as u32,
            exe: String::new(),
            title: String::new(),
        });
        cursor = next;
    }
}

pub fn build(mut events: Vec<Event>) -> BuiltData {
    let mut timed = events
        .drain(..)
        .enumerate()
        .filter_map(|(order, event)| event.timestamp().map(|time| (time, order, event)))
        .collect::<Vec<_>>();
    timed.sort_by_key(|(time, order, _)| (*time, *order));

    let mut result = BuiltData::default();
    let mut focus: Option<OpenFocus> = None;
    let mut last_time = None;
    let mut open_session = None;
    let mut sessions = Vec::new();
    let mut apps = HashMap::<String, AppInfo>::new();

    for (time, _, event) in &timed {
        result.days.entry(day_at(*time)).or_default();
        let exe = event.exe();
        if let Some(exe) = &exe {
            let app = apps.entry(exe.clone()).or_insert_with(|| AppInfo {
                exe: exe.clone(),
                name: exe.clone(),
                first_seen: *time,
            });
            if let Some(name) = event.friendly_name() {
                app.name = name.to_string();
            }
        }

        match event.event_type.as_str() {
            "focus_changed" if exe.is_some() => {
                close_focus(&mut focus, *time, &mut result.days);
                focus = Some(OpenFocus {
                    start: *time,
                    exe: exe.unwrap(),
                    title: event.window_title.clone().unwrap_or_default(),
                });
            }
            "logout" => {
                close_focus(&mut focus, *time, &mut result.days);
                if let Some(start) = open_session.take() {
                    if *time > start {
                        sessions.push(Session { start, end: *time });
                    }
                }
            }
            "logon" => {
                if let Some(previous) = last_time {
                    close_focus(&mut focus, previous, &mut result.days);
                    if let Some(start) = open_session.take() {
                        if previous > start {
                            sessions.push(Session {
                                start,
                                end: previous,
                            });
                        }
                    }
                }
                open_session = Some(*time);
            }
            "process_start" => {
                if let Some(exe) = exe {
                    *result
                        .days
                        .entry(day_at(*time))
                        .or_default()
                        .launches
                        .entry(exe)
                        .or_default() += 1;
                }
            }
            _ => {}
        }
        last_time = Some(*time);
        result.last_event = Some(event.time.clone());
    }

    if let Some(last) = last_time {
        close_focus(&mut focus, last, &mut result.days);
        if let Some(start) = open_session {
            if last > start {
                sessions.push(Session { start, end: last });
            }
        }
    }

    result.sessions = sessions.clone();
    result.event_count = timed.len();
    result.apps = apps.into_iter().collect();
    add_session_days(&sessions, &mut result.days);
    add_off_days(&sessions, &mut result.days);
    for day in result.days.values_mut() {
        day.segments
            .sort_by_key(|segment| (segment.start, segment.end));
    }
    result
}

fn close_focus(focus: &mut Option<OpenFocus>, end: i64, days: &mut BTreeMap<String, DayData>) {
    let Some(open) = focus.take() else {
        return;
    };
    if end <= open.start {
        return;
    }
    let exe = open.exe;
    let title = open.title;
    split_interval(open.start, end, |mut segment| {
        segment.exe.clone_from(&exe);
        segment.title.clone_from(&title);
        days.entry(segment.day.clone())
            .or_default()
            .segments
            .push(segment);
    });
}

fn add_session_days(sessions: &[Session], days: &mut BTreeMap<String, DayData>) {
    for session in sessions {
        let mut cursor = session.start;
        while cursor < session.end {
            let next = midnight_after(cursor).min(session.end);
            let start_of_day = cursor - cursor.rem_euclid(86_400);
            days.entry(day_at(cursor))
                .or_default()
                .sessions
                .push(DaySession {
                    start: (cursor - start_of_day) as u32,
                    end: (next - start_of_day) as u32,
                });
            cursor = next;
        }
    }
}

fn add_off_days(sessions: &[Session], days: &mut BTreeMap<String, DayData>) {
    for pair in sessions.windows(2) {
        let (start, end) = (pair[0].end, pair[1].start);
        if end <= start {
            continue;
        }
        let mut cursor = start;
        while cursor < end {
            let next = midnight_after(cursor).min(end);
            let start_of_day = cursor - cursor.rem_euclid(86_400);
            days.entry(day_at(cursor))
                .or_default()
                .off_periods
                .push(DaySession {
                    start: (cursor - start_of_day) as u32,
                    end: (next - start_of_day) as u32,
                });
            cursor = next;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(event_type: &str, time: &str, exe: Option<&str>) -> Event {
        Event {
            event_type: event_type.into(),
            time: time.into(),
            exe_name: exe.map(str::to_string),
            friendly_name: None,
            window_title: None,
        }
    }

    #[test]
    fn splits_focus_at_midnight_and_closes_at_logout() {
        let built = build(vec![
            event("logon", "2026-09-11T23:59:00+02:00", None),
            event(
                "focus_changed",
                "2026-09-11T23:59:30+02:00",
                Some("Code.exe"),
            ),
            event("logout", "2026-09-12T00:01:00+02:00", None),
        ]);
        let before = &built.days["2026-09-11"].segments[0];
        let after = &built.days["2026-09-12"].segments[0];
        assert_eq!((before.start, before.end), (86_370, 86_400));
        assert_eq!((after.start, after.end), (0, 60));
    }

    #[test]
    fn missing_logout_closes_at_last_event_before_next_logon() {
        let built = build(vec![
            event("logon", "2026-09-11T08:00:00+02:00", None),
            event(
                "focus_changed",
                "2026-09-11T08:10:00+02:00",
                Some("code.exe"),
            ),
            event(
                "process_start",
                "2026-09-11T08:20:00+02:00",
                Some("firefox.exe"),
            ),
            event("logon", "2026-09-11T09:00:00+02:00", None),
            event("logout", "2026-09-11T09:30:00+02:00", None),
        ]);
        assert_eq!(built.sessions.len(), 2);
        assert_eq!(built.sessions[0].end - built.sessions[0].start, 1_200);
        assert_eq!(built.days["2026-09-11"].segments[0].end, 30_000);
    }

    #[test]
    fn focus_without_logout_ends_at_final_event() {
        let built = build(vec![
            event("logon", "2026-09-11T08:00:00+02:00", None),
            event(
                "focus_changed",
                "2026-09-11T08:10:00+02:00",
                Some("code.exe"),
            ),
            event("process_end", "2026-09-11T08:25:00+02:00", None),
        ]);
        assert_eq!(built.days["2026-09-11"].segments[0].end, 30_300);
        assert_eq!(built.sessions[0].end - built.sessions[0].start, 1_500);
    }

    #[test]
    fn latest_nonempty_friendly_name_and_launches_are_retained() {
        let built = build(vec![
            event(
                "process_start",
                "2026-09-11T08:00:00+02:00",
                Some("CODE.exe"),
            ),
            Event {
                friendly_name: Some("Visual Studio Code".into()),
                ..event(
                    "focus_changed",
                    "2026-09-11T08:01:00+02:00",
                    Some("code.exe"),
                )
            },
        ]);
        assert_eq!(built.apps["code.exe"].name, "Visual Studio Code");
        assert_eq!(built.days["2026-09-11"].launches["code.exe"], 1);
    }
}
