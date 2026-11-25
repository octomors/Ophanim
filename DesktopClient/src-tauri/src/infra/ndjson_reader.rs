use crate::domain::event::Event;
use std::{
    fs::File,
    io::{BufRead, BufReader},
    path::Path,
};

#[derive(Default)]
pub struct ReadResult {
    pub events: Vec<Event>,
    pub bad_lines: usize,
}

pub fn read_file(path: &Path) -> std::io::Result<ReadResult> {
    let file = File::open(path)?;
    let mut result = ReadResult::default();
    let mut reader = BufReader::new(file);
    let mut bytes = Vec::new();
    loop {
        bytes.clear();
        if reader.read_until(b'\n', &mut bytes)? == 0 {
            break;
        }
        let line = String::from_utf8_lossy(&bytes);
        parse_line(line.trim_end_matches(['\r', '\n']), &mut result);
    }
    Ok(result)
}

pub fn parse_text(text: &str) -> ReadResult {
    let mut result = ReadResult::default();
    for line in text.lines() {
        parse_line(line, &mut result);
    }
    result
}

fn parse_line(line: &str, result: &mut ReadResult) {
    if line.trim().is_empty() {
        return;
    }
    match serde_json::from_str::<Event>(line) {
        Ok(event) if event.timestamp().is_some() => result.events.push(event),
        _ => result.bad_lines += 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_bad_lines_and_accepts_missing_friendly_names() {
        let result = parse_text(
            "{\"event_type\":\"focus_changed\",\"time\":\"2026-09-11T08:00:00+02:00\",\"exe_name\":\"code.exe\"}\nnot json\n",
        );
        assert_eq!(result.events.len(), 1);
        assert_eq!(result.bad_lines, 1);
        assert_eq!(result.events[0].friendly_name, None);
    }
}
