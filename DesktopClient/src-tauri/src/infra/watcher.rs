use crate::service::LogService;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::BTreeSet,
    path::PathBuf,
    sync::{Arc, Mutex, mpsc},
    time::Duration,
};

pub fn watch_folder(
    folder: PathBuf,
    service: Arc<Mutex<LogService>>,
) -> notify::Result<RecommendedWatcher> {
    let (sender, receiver) = mpsc::channel::<Vec<PathBuf>>();
    let mut watcher =
        notify::recommended_watcher(move |result: notify::Result<notify::Event>| match result {
            Ok(event)
                if matches!(
                    event.kind,
                    EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                ) =>
            {
                if let Err(error) = sender.send(event.paths) {
                    eprintln!("DayLogs watcher stopped: {error}");
                }
            }
            Ok(_) => {}
            Err(error) => eprintln!("DayLogs watcher error: {error}"),
        })?;
    std::thread::spawn(move || {
        while let Ok(paths) = receiver.recv() {
            let mut pending = paths.into_iter().collect::<BTreeSet<_>>();
            loop {
                match receiver.recv_timeout(Duration::from_millis(100)) {
                    Ok(paths) => pending.extend(paths),
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            match service.lock() {
                Ok(mut service) => service.refresh_files(pending),
                Err(error) => eprintln!("Could not refresh DayLogs: {error}"),
            }
        }
    });
    watcher.watch(&folder, RecursiveMode::NonRecursive)?;
    Ok(watcher)
}
