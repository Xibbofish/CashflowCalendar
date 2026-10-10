export function localDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function watchLocalDay(onChange, { read = localDay, windowTarget = window, documentTarget = document, schedule = setInterval, cancel = clearInterval } = {}) {
  let day = read();
  const check = () => {
    const next = read();
    if (next !== day) { day = next; onChange(); }
  };
  windowTarget.addEventListener('focus', check);
  windowTarget.addEventListener('pageshow', check);
  documentTarget.addEventListener('visibilitychange', check);
  const timer = schedule(check, 30000);
  check();
  return () => {
    cancel(timer);
    windowTarget.removeEventListener('focus', check);
    windowTarget.removeEventListener('pageshow', check);
    documentTarget.removeEventListener('visibilitychange', check);
  };
}
